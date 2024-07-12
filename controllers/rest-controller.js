const path = require('path');
const _ = require('lodash');
const LetsEncrypt = require('../helpers/lets-encrypt');
const nginx = require('../helpers/nginx');
const Response = {
  internalServerError: (res, err) => {
    res.status(500).send(err);
  },
  badRequest: (res, err) => {
    res.status(400).send(err);
  },
  okWithData: (res, data) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
  }
}

function validations(req, res, next) {
  const fields = req.body;

  console.log(fields);

  const requiredParams = ['domains'];
  const bodyParams = Object.keys(fields);
  const missingParams = _.difference(requiredParams, bodyParams);

  if (missingParams.length !== 0) {
    const err = `missing parameters in request: ${missingParams}`;
    return res.status(400).send(err);
  }
  next();
}

function generateSSlCert(req, res) {
  LetsEncrypt.generateSSlCert(req.body).then((body) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
    console.log('###### Custom domain created and activated ######');
  }).catch((err) => {
    console.log(err);
    res.status(500).send(err);
  });
}

function activateCustomDomain(req, res) {
  const args = req.body;
  const domains = (_.isArray(args.domains)) ? args.domains : [ args.domains ];
  args.domain = domains[0];
  nginx.enableSite(args).then((body) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ message: 'Custom domain activated.' }));
    console.log('###### Custom domain activated ######');
  }).catch((err) => {
    console.log(err);
    res.status(500).send(err);
  });
}

function deactivateCustomDomain(req, res) {
  const args = req.body;
  const domains = (_.isArray(args.domains)) ? args.domains : [ args.domains ];
  args.domain = domains[0];
  nginx.disableSite(args).then((body) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ message: 'Custom domain deactivated.' }));
  }).catch((err) => {
    console.log(err);
    res.status(500).send(err);
  });
}

function deleteCustomDomain(req, res) {
  const args = req.body;
  const domains = (_.isArray(args.domains)) ? args.domains : [ args.domains ];
  args.domain = domains[0];
  nginx.removeSite(args).then((body) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ message: 'Custom domain deleted.' }));
  }).catch((err) => {
    console.log(err);
    res.status(500).send(err);
  });
}

const activateDomainKey = (req, res) => {
  const args = req.body;
  args.domains = _.uniq(_.flatten(args.domains.map(d => [d.domain, d.customDomain])).filter(d => d));
  args.operation = 'add';

    nginx.addOrRemoveDomainKeytoSiteConf(args)
    .then(() => Response.okWithData(res, { message: 'Domain Key activated'}))
    .catch(err => {
      console.log(`Failed to activate domain key for domain`, args, err);
      Response.internalServerError(res, { message: 'Failed to deactivate domain key for domain' });
    });
}

const deactivateDomainKey = (req, res) => {
  const reqBody = req.body;
  const domains = _.uniq(_.flatten(reqBody.domains.map(d => [d.domain, d.customDomain])).filter(d => d));
  const args = { domains, operation: 'remove', keys: reqBody.disabledKeys, };


    nginx.addOrRemoveDomainKeytoSiteConf(args)
    .then(() => Response.okWithData(res, { message: 'Domain Key deactivated'}))
    .catch(err => {
      console.log(`Failed to deactivate domain key for domain`, args, err);
      Response.internalServerError(res, { message: 'Failed to deactivate domain key for domain' });
    });
}

module.exports = {
  validations,
  generateSSlCert,
  activateCustomDomain,
  deactivateCustomDomain,
  deleteCustomDomain,
  activateDomainKey,
  deactivateDomainKey,
};
