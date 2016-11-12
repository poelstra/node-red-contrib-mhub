/**
 * MHub integration for Node-RED.
 *
 * Copyright (C) 2016 Martin Poelstra
 */


import * as events from "events";
import MHubClient, { MClientOptions, Message as MHubMessage } from "mhub";
import Promise from "ts-promise";

declare type RedMessage = Object;

declare interface Status {
	fill?: "red" | "green" | "yellow" | "blue" | "grey";
	shape?: "ring" | "dot";
	text?: string;
}

declare class Node extends events.EventEmitter {
	public id: string;
	constructor(config: any);
	public send(msg: RedMessage): void;
	public send(msg: RedMessage[]): void;
	public send(msg: (RedMessage[] | RedMessage)[]): void;
	public log(text: string): void;
	public warn(text: string): void;
	public error(text: string, msg?: any): void;
	public status(config: Status): void;
}

export = function(RED: any): void {
	/**
	 * Baseclass for Node-RED nodes.
	 * This is a bit of a dirty trick to make definition of nodes
	 * more straightforward as TypeScript classes.
	 */
	// tslint:disable-next-line:variable-name
	let NodeRedNode: typeof Node = <any>function(config: any): any {
		RED.nodes.createNode(this, config);
	};

	const STATUS_CONNECTING: Status = { fill: "yellow", shape: "ring", text: "node-red:common.status.connecting" };
	const STATUS_DISCONNECTED: Status = { fill: "red", shape: "ring", text: "node-red:common.status.disconnected" };
	const STATUS_SUBSCRIBE_FAILED: Status = { fill: "yellow", shape: "ring", text: "mhub.status.subscribe-failed" };

	interface MHubServerConfig {
		host: string;
		usetls: boolean;
		tls: string;
		verifyServerCert: boolean;
		keepalive: number;
	}

	enum ClientState {
		Disconnected,
		Connecting,
		Connected
	}

	type MessageHandler = (msg: MHubMessage) => void;

	/**
	 * Subscriptions to MHub are shared between 'in' nodes.
	 * This interface remembers the subscription patterns for
	 * each MHub node (e.g. node "default", pattern "test*").
	 * It stores the subscription id, pointing to a record in
	 * Subscriptions.
	 */
	interface NodePatterns {
		[mhubNodeId: string]: {
			[pattern: string]: string; // subscription id
		};
	}

	/**
	 * Subscriptions store the list of all subcribed Node-RED
	 * nodes using the given (MHub-)node and subscription pattern.
	 * If the same node/pattern pair is used on multiple Node-RED
	 * nodes, there will be more than one MessageHandler.
	 */
	interface Subscriptions {
		[subscriptionId: string]: {
			node: string;
			pattern: string;
			handlers: MessageHandlers;
		};
	}

	interface MessageHandlers {
		[nodeRedNodeId: string]: MessageHandler;
	}

	/**
	 * MHub connection node.
	 * Connections are shared between Node-RED nodes.
	 */
	class MHubServerNode extends NodeRedNode {
		private _config: MHubServerConfig;
		private _client: MHubClient;
		private _clientState: ClientState = ClientState.Disconnected;
		private _reconnectTimeout: number = 5000; // ms
		private _reconnectTimer: NodeJS.Timer;
		private _nodes: { [id: string]: Node; } = {}; // Registered NodeRED nodes
		private _subscriptions: Subscriptions = {};
		private _subscriptionCounter: number = 0;
		private _nodePatterns: NodePatterns = {};
		private _stopping: boolean = false; // Destructing node

		constructor(config: MHubServerConfig) {
			super(config);
			this._config = config;

			this.on("close", (done: () => void): void => {
				this._stopping = true;
				this._close().then(() => {
					done();
				});
			});
		}

		/**
		 * Register in/out node.
		 * Connection to a server is only made after the first node starts using
		 * this configuration.
		 */
		public register(node: Node): void {
			this._nodes[node.id] = node;
			this._init();
		}

		/**
		 * Unregister in/out node.
		 * Connection to a server is closed when the last node unregisters.
		 */
		public unregister(node: Node, done?: () => void): void {
			// TODO Unsubscribe everything for this node?
			delete this._nodes[node.id];
			if (Object.keys(this._nodes).length === 0) {
				this._close().then(done);
			} else if (done) {
				Promise.resolve().then(done);
			}
		}

		/**
		 * Subscribe to node+pattern.
		 * MHub In nodes having the same node+pattern combination will share the same
		 * subscription to reduce duplicate messages being sent.
		 *
		 * Note: only subscribe after the connection has been established (listen for
		 * "status" event with first param "connected").
		 * When the connection to the server is lost, the subscription needs to be made
		 * again after the reconnect (which automatically triggers the same event again).
		 * The promise may be rejected with a connection error or e.g. a subscribe failure.
		 */
		public subscribe(source: Node, node: string, pattern: string, onMessage: MessageHandler): Promise<void> {
			return new Promise<void>((resolve, reject) => {
				// Find subscriptions to specific node, or create a pool for this node
				const nodeSubs = this._nodePatterns[node] || (this._nodePatterns[node] = {});
				// Find existing subscriptions using this pattern (on this MHub node)
				let subId: string = nodeSubs[pattern];
				// If no-one subscribed yet, create a new subscription for it
				if (!subId) {
					subId = nodeSubs[pattern] = String(this._subscriptionCounter++);
					this._subscriptions[subId] = {
						node,
						pattern,
						handlers: {},
					};
					resolve(this._client.subscribe(node, pattern, subId));
				} else {
					resolve(undefined);
				}
				// Add a new listener to this subscription ID
				this._subscriptions[subId].handlers[source.id] = onMessage;
			});
		}

		/**
		 * Unsubscribe node+pattern combination.
		 * Note: a disconnect will automatically unsubscribe everything.
		 */
		public unsubscribe(source: Node, node: string, pattern: string): void {
			// Find subscription ID for node+pattern combination
			const nodeSubs = this._nodePatterns[node];
			if (!nodeSubs) {
				return;
			}
			const subId: string = nodeSubs[pattern];
			if (!subId) {
				return;
			}
			// See if this RED node is indeed subscribed, then unsubscribe
			const sub = this._subscriptions[subId];
			if (!sub.handlers[source.id]) {
				return;
			}
			delete sub.handlers[source.id];
			// If this was the last subscribed RED node, clean up this subscription
			if (Object.keys(sub.handlers).length > 0) {
				return;
			}
			// TODO unsubscribe from MHub once it supports that
			// this._client.unsubscribe(node, pattern, subId).catch((e) => {
			// 	this.warn(RED._("mhub.errors.unsubscribe-failed", { error: e }));
			// });
			delete this._subscriptions[subId];
			delete nodeSubs[pattern];
			if (Object.keys(this._nodePatterns).length === 0) {
				delete this._nodePatterns[node];
			}
		}

		/**
		 * Publish message to MHub node.
		 */
		public publish(node: string, msg: MHubMessage): Promise<void> {
			if (!this._client) {
				this.error(RED._("mhub.errors.internal-error"));
				return Promise.reject(new Error(RED._("mhub.errors.internal-error")));
			}
			return Promise.resolve(this._client.publish(node, msg));
		}

		public get connected(): boolean {
			return this._clientState === ClientState.Connected;
		}

		public get connecting(): boolean {
			return this._clientState === ClientState.Connecting;
		}

		public get label(): string {
			return this._config.host;
		}

		private _setClientState(state: ClientState): void {
			this._clientState = state;
			this.emit("status", state);
		}

		/**
		 * Lazy init: create MHub client only when there's someone actively
		 * using this configuration.
		 */
		private _init(): void {
			if (this._client) {
				return;
			}

			let options: MClientOptions = {};
			let url = this._config.host;
			if (this._config.usetls && this._config.tls) {
				const tlsNode = RED.nodes.getNode(this._config.tls);
				if (tlsNode) {
					tlsNode.addTLSOptions(options);
				}
				if (url.indexOf("://") < 0) {
					url = "wss://" + url;
				}
			}

			if (this._config.keepalive !== undefined) {
				options.keepalive = this._config.keepalive * 1000;
			}
			this._client = new MHubClient(url, options);
			this._setClientState(ClientState.Connecting);
			this._client.on("open", (): void => {
				this.log(RED._("mhub.state.connected", { server: this._client.url }));
				this._setClientState(ClientState.Connected);
			});
			this._client.on("close", (): void => {
				this.log(RED._("mhub.state.disconnected", { server: this._client.url }));
				this._handleClose();
			});
			this._client.on("error", (e: Error): void => {
				this.error(RED._("mhub.state.connection-error", { error: e, server: this._client.url }));
				this._handleClose();
			});
			this._client.on("message", (msg: MHubMessage, subscription: string): void => {
				this._handleMessage(msg, subscription);
			});
		}

		private _handleMessage(msg: MHubMessage, subscriptionId: string): void {
			const sub = this._subscriptions[subscriptionId];
			if (!sub) {
				return;
			}
			const handlers = sub.handlers;
			for (let nodeId in handlers) {
				if (handlers.hasOwnProperty(nodeId)) {
					handlers[nodeId](msg);
				}
			}
		}

		private _handleClose(): void {
			this._setClientState(ClientState.Disconnected);
			this._nodes = {};
			this._nodePatterns = {};
			this._subscriptions = {};
			this._subscriptionCounter = 0;
			if (!this._stopping) {
				this._reconnect();
			}
		}

		private _reconnect(): void {
			if (this._reconnectTimer === undefined) {
				this._close();
				this._reconnectTimer = setTimeout(
					() => {
						this._reconnectTimer = undefined;
						this._setClientState(ClientState.Connecting);
						this._client.connect();
					},
					this._reconnectTimeout
				);
			}
		}

		private _close(): Promise<void> {
			return new Promise<void>((resolve) => {
				if (this._reconnectTimer !== undefined) {
					clearTimeout(this._reconnectTimer);
					this._reconnectTimer = undefined;
				}
				if (this._clientState === ClientState.Connected) {
					this._client.once("close", resolve);
					this._client.close();
				} else {
					this._client.close();
					this._setClientState(ClientState.Disconnected);
					resolve(undefined);
				}
			});
		}
	}

	interface MHubBaseConfig {
		server: string;
		node: string;
	}

	interface MHubInConfig extends MHubBaseConfig {
		pattern?: string;
	}

	class MHubBaseNode extends NodeRedNode {
		protected _server: MHubServerNode;

		constructor(config: MHubBaseConfig) {
			super(config);

			this._server = RED.nodes.getNode(config.server);
			if (!this._server) {
				this.error(RED._("mhub.errors.missing-config"));
				return;
			}

			this._server.register(this);
			this._server.on("status", () => this._updateStatus());
			this._updateStatus();

			this.on("close", (done: () => void) => {
				if (this._server) {
					this._server.unregister(this, done);
				}
			});
		}

		private _updateStatus(): void {
			if (!this._server) {
				return;
			}
			if (this._server.connecting) {
				this.status(STATUS_CONNECTING);
			} else if (this._server.connected) {
				const connectedStatus: Status = {
					fill: "green",
					shape: "dot",
					text: this._server.label,
				};
				this.status(connectedStatus);
			} else {
				this.status(STATUS_DISCONNECTED);
			}
		}
	}

	class MHubInNode extends MHubBaseNode {
		constructor(config: MHubInConfig) {
			super(config);

			if (!this._server) {
				return;
			}

			const node = config.node || "default";
			if (typeof node !== "string") {
				this.error(RED._("mhub.errors.invalid-node"));
				return;
			}
			if (typeof config.pattern !== "string") {
				this.error(RED._("mhub.errors.invalid-pattern"));
				return;
			}

			this._server.on("status", (state: ClientState) => {
				if (state === ClientState.Connected) {
					this._subscribe(node, config.pattern);
				}
			});
			if (this._server.connected) {
				this._subscribe(node, config.pattern);
			}

			this.on("close", () => {
				this._server.unsubscribe(this, node, config.pattern);
			});
		}

		private _subscribe(node: string, pattern: string): void {
			this._server.subscribe(this, node, pattern, (msg: MHubMessage): void => {
				this.send({
					headers: msg.headers,
					payload: msg.data,
					topic: msg.topic,
				});
			}).catch((e) => {
				this.warn(RED._("mhub.errors.subscribe-failed", { error: e }));
				this.status(STATUS_SUBSCRIBE_FAILED);
			});
		}
	}

	interface MHubOutConfig extends MHubBaseConfig {
		topic?: string;
	}

	class MHubOutNode extends MHubBaseNode {
		constructor(config: MHubOutConfig) {
			super(config);

			if (!this._server) {
				return;
			}

			this.on("input", (msg: any) => {
				const node: string = config.node || msg.node || "default";
				if (typeof node !== "string") {
					this.warn(RED._("mhub.errors.invalid-node"));
					return;
				}
				const topic: string = config.topic || msg.topic;
				if (typeof topic !== "string" || !topic) {
					this.warn(RED._("mhub.errors.missing-or-invalid-topic"));
					return;
				}
				const headers: { [key: string]: string; } = msg.headers;
				// tslint:disable-next-line:no-null-keyword
				if (headers !== undefined && headers !== null && typeof headers !== "object") {
					this.warn(RED._("mhub.errors.invalid-headers"));
					return;
				}
				const data: any = msg.payload;
				const mhubMessage = new MHubMessage(
					topic, data, headers
				);
				this._server.publish(node, mhubMessage).catch((e) => {
					this.warn(RED._("mhub.errors.publish-failed", { error: e }));
				});
			});
		}
	}

	RED.nodes.registerType("mhub-server", MHubServerNode);
	RED.nodes.registerType("mhub in", MHubInNode);
	RED.nodes.registerType("mhub out", MHubOutNode);
};
