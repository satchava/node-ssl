const _ = require('lodash');
const fs = require('fs');
const config = require('./config-default.js');

config.rootDirPath = __dirname;
const envConfigJsonFile = `./config.${process.env.NODE_ENV}.json`; // environment JSON config file
const envConfigJsFile = `./config.${process.env.NODE_ENV}.js`; // environment JS config file

if (fs.existsSync(envConfigJsonFile)) { // check if environment config exists in JSON file
  const envConfig = require(envConfigJsonFile);
  _.merge(config, envConfig);
} else if (fs.existsSync(envConfigJsFile)) { // check if environment config exists in JS file
  const envConfig = require(envConfigJsFile);
  _.merge(config, envConfig);
}

module.exports = config;
