require('./env-config-loader');
require('console-stamp')(console, { pattern: 'dd/mm/yyyy HH:MM:ss.l' });
const express = require('express');
const bodyParser = require('body-parser');
const passport = require('passport');
const formidable = require('formidable');
const LocalAPIKeyStrategy = require('passport-localapikey-update').Strategy;
const config = require('./config');
const restController = require('./controllers/rest-controller');

if (!console.debug) console.debug = (...args) => { console.log.apply(this, args) };

const app = express();
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

passport.use(new LocalAPIKeyStrategy((apikey, done) => {
  if (apikey === config.apiKey) {
    return done(null, apikey);
  }
  return done('client not found');
}));

const fileUpload = (req, res, next) => {
  const form = new formidable.IncomingForm();
  form.uploadDir = 'uploads/';
  form.keepExtensions = true;

  form.parse(req, (err, fields, files) => {
    if (err) {
      console.error(err.message);
      return next(err);
    }
    req.files = files;
    req.fields = fields;
    next();
  });
};

app.get('/api/unauthorized', (req, res) => {
  res.status(401).send('unauthorized request');
});

const localApiKeyAuth = passport.authenticate('localapikey', {
  session: false,
  failureRedirect: '/api/unauthorized',
});

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({
  extended: true
}));

app.post('/api/generate-ssl-cert', [localApiKeyAuth, restController.validations], restController.generateSSlCert);
app.post('/api/activate-custom-domain', [localApiKeyAuth, restController.validations], restController.activateCustomDomain);
app.post('/api/deactivate-custom-domain', [localApiKeyAuth, restController.validations], restController.deactivateCustomDomain);
app.post('/api/delete-custom-domain', [localApiKeyAuth, restController.validations], restController.deleteCustomDomain);
app.post('/api/activate-domain-api-keys', [localApiKeyAuth, restController.validations], restController.activateDomainKey);
app.post('/api/deactivate-domain-api-keys', [localApiKeyAuth, restController.validations], restController.deactivateDomainKey);

app.get('/api/unauthorized', (req,res) => {
  res.status(401).send('unauthorized request');
});

app.use((err, req, res, next) => {
  console.error(err.toString());
  res.status(500).send(err.toString());
});

const server = app.listen(config.port, () => {
  const port = server.address().port;
  console.log('app listening at port: ', port);
});