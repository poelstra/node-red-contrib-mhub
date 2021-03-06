# MHub for Node-RED

This package provides "MHub in" (i.e. subscribe) and "MHub out" (i.e. publish) nodes for [Node-RED](https://nodered.org/).

[MHub](https://github.com/poelstra/mhub) is a simple, flexible message bus using a JSON-based protocol.
It natively supports websockets, but also 'plain' TCP ports.

Because both the protocol and the messages are transmitted using JSON, this makes
it very powerful, yet still simple enough to be directly implemented in e.g. a microcontroller.

# Installation

In Node-RED:
- click the top-right 'hamburger' menu
- click "Manage palette"
- click the "Install" tab
- search "mhub" (or "node-red-contrib-mhub")
- click its "Install" button

Or, using the command prompt:
```sh
cd ~/.node-red/
npm install node-red-contrib-mhub
```

When an update is available, again use Node-RED's Palette Manager to update.

# Usage

Usage is very simple and basically the same as using e.g. the builtin MQTT nodes:

- Drag an MHub in or out node onto the canvas
- Double-click to edit properties
- Click the pencil icon to add/edit server settings
- Fill in the other details
	- For an In node, leave the "Pattern" empty to receive all messages, or e.g. `/myhome/**/temperature`
	- For an Out node, use any "Topic" you like, e.g. `/myhome/room1/deviceA/temperature`

# Caveats

- MHub messages are sent as an object containing topic, data and headers properties.
  Node-RED by convention calls MHub's `.data` property `.payload`, so the MHub in/out nodes
  emit/accept `.payload` instead.
- Messages in MHub are JSON objects (including the payload), but many Node-RED nodes default
  to set the`.payload` property to a string.
  It's an easy mistake to enter JSON in an edit box, which will cause the other side to
  receive a string instead of an object. Use a `json` node to convert it to an object first.

# Changelog

Notable changes listed below, for details see the version tags in Git.

1.4.0 (2020-04-21):
- Update to Node-RED 1.0 (handle node complete event, move to "network" category)
- Update MHub to 2.1.0
- Update build dependencies

1.3.1 (2019-07-21):
- Update dependencies to latest versions to address security warnings

1.3.0 (2017-08-22):
- Implement user/pass authentication of MHub 0.9.0
- Silence EventEmitter warning when using many in/out nodes (false-positive)
- Improved feedback on node's status when connection/login fails
- Update integrated node help to Node-RED's latest format

1.2.1 (2017-02-26):
- Fix node stop/restart when DNS lookup takes long (MHub 0.8.0)
- Fix hang during stop when server node configured without publish/subscribe nodes

1.2.0 (2016-11-12):
- Implement keepalive (MHub 0.7.0)
- Make TLS actually work

1.1.0 (2016-11-03):
- Allow leaving 'node' field empty to use "default"
- Show hostname as connected status

1.0.0 (2016-10-31):
- Initial version

# License

The MIT license.

Copyright (C) 2016 [Martin Poelstra](https://github.com/poelstra)
