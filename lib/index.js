const utils = require("./utils");
const config = require("./config");
const fragility = require("./fragility");
const spatial = require("./spatial");
const vulnerability = require("./vulnerability");
const gdacs = require("./gdacs");
const cap = require("./cap");
const usgs = require("./usgs");
const openmeteo = require("./openmeteo");
const delta = require("./delta");
const monitor = require("./monitor");

module.exports = {
	...utils,
	...config,
	...fragility,
	...spatial,
	...vulnerability,
	...gdacs,
	...cap,
	...usgs,
	...openmeteo,
	...delta,
	...monitor,
};
