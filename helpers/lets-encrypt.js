const LetsEncrypt = require('greenlock');
const _ = require('lodash');
const homedir = require('homedir');
const rootDir = homedir('ubuntu');
const BluebirdPromise = require('bluebird');
const nginx = require('./nginx');
const config = require('../config');

// Storage Backend
const leStore = require('le-store-certbot').create({
  configDir: `${rootDir}/certs`,
  debug: true
});

// ACME Challenge Handlers
const leHttpChallenge = require('le-challenge-fs').create({
  webrootPath: `${rootDir}/certs`,
  debug: true
});

const leSniChallenge = require('le-challenge-sni').create({ debug: true });

function leAgree(opts, agreeCb) {
  agreeCb(null, opts.tosUrl);
}

function renewCertificates (results) {
  if (!(results && results._expiresAt)) return true;
  let diffDays = 90;
  try {
    const date2 = new Date();
    const date = results._expiresAt;
    const date1 = new Date(date);
    const diffTime = Math.abs(date2 - date1);
    diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  } catch (e) {}
  return (diffDays < 7);
}

const le = LetsEncrypt.create({
  server: config.letsEncryptUrl,
  version: 'draft-11',
  store: leStore,
  challenges: {
    'http-01': leHttpChallenge,
    'tls-sni-01': leSniChallenge,
    'tls-sni-02': leSniChallenge,
  },
  challengeType: 'http-01',
  agreeToTerms: leAgree,
  webrootPath: `${rootDir}/certs/www/.well-known/acme-challenge/`,
  // sni: require('le-sni-auto').create({}),
  debug: true,
  log: function (debug) { console.log(debug); }, // handles debug outputs
});

const generateSiteConfig = (args) => new BluebirdPromise((resolve, reject) => {
  nginx.createAndActivateConfig(args)
    .then(args => resolve(args))
    .catch((error) => {
      console.log('Failed main generateSiteConfig :- ', error);
      reject(new Error('Unable to create nginx configuration.'));
    });
});

const generateSSlCert = (args) => new BluebirdPromise((resolve, reject) => {
  const domains = (_.isArray(args.domains)) ? args.domains : [ args.domains ];
  args.domain = domains[0];
  console.log(domains);

  const errorHandler = {
    err1: (err) => {
      console.error('[Error]: generateSSlCert');
      console.error(err.stack);
      return reject(err);
    },
    err2: (error) => {
      console.log('Failed main generateSSlCert :- ', error);
      return reject(new Error('Unable to create nginx configuration.'));
    },
  };

  const genCert = () => {
    console.log('###### start genCert ######');
    generateSiteConfig(args)
      .then(args => {
        args.cert.active = true;
        resolve(args.cert)
      })
      .catch(errorHandler.err2);
  };

  const certConfig = {
    domains,
    email: config.email,
    agreeTos: true,
    rsaKeySize: 2048,
    challengeType: 'http-01',
  };

  const renewCert = (results) => {
    console.log('Renew Certificate', args.domain);
    le.renew(certConfig, results)
      .then((d) => {
        if (d) {
          args.cert = d;
          console.log('------------------------------');
          console.log(d);
          console.log('------------------------------');
          console.log('success');
        }
        genCert();
      }, errorHandler.err1)
      .catch(errorHandler.err2);
  };

  const registerCertificates = () => {
    console.log('Create Certificate', args.domain);
    le.register(certConfig).then((results) => {
      args.cert = results;
      console.log('------------------------------');
      console.log(results);
      console.log('------------------------------');
      console.log('success');
      genCert();
    }, errorHandler.err1)
    .catch(errorHandler.err2);
  };

  le.check({domains}).then((results) => {
    if (results) {
      // we already have certificates
      args.cert = results;
      if (renewCertificates(results)) {
        // Renew Certificate manually
        renewCert(results);
      }
      else {
        // Set nginx config
        genCert();
      }
    } else {
      // Register Certificate manually
      registerCertificates();
    }
  }).catch((error) => {
    console.log('Failed main generateSSlCert :- ', error);
    return reject(new Error('Unable to create nginx configuration.'));
  });
});

module.exports = {
  generateSSlCert,
};