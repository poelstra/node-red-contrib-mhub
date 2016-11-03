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

At a command prompt:
- `cd ~/.node-red/`
- `npm install node-red-contrib-mhub`

# Usage

Usage is very simple and basically the same as using e.g. the builtin MQTT nodes:

- Drag an MHub in or out node onto the canvas
- Double-click to edit properties
- Click the pencil icon to add/edit server settings
- Fill in the other details (try node "default")
	- For an In node, leave the "Pattern" empty to receive all messages
	- For an Out node, use any "Topic" you like.

# Caveats

- MHub messages are sent as an object containing topic, data and headers properties.
  Node-RED by convention calls the `.data` property `.payload`, so the MHub in/out nodes also emit/accept that name instead.
- Messages in MHub are JSON objects, but many Node-RED nodes default to set the `.payload` property to a string.
  It's an easy mistake to enter JSON in that box, which will cause the other side to receive a string instead of
  an object.

# Changelog

Notable changes listed below, for details see the version tags in Git.

1.1.0 (2016-11-03):
- Allow leaving 'node' field empty to use "default"
- Show hostname as connected status

1.0.0 (2016-10-31):
- Initial version

# License

The MIT license.

Copyright (C) 2016 [Martin Poelstra](https://github.com/poelstra)
