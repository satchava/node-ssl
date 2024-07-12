const fs = require('fs');
const util = require('util');
const exec = require('child_process').exec;
const BluebirdPromise = require('bluebird');
const homedir = require('homedir');
const { uniq } = require("lodash");
const { URL } = require('url');

const APPLAUD_DOMAINS = ['applaudhcm.com', 'applaudcloud.com', 'applaudcloud-eu.com', 'applaudcloud.de', 'tryapplaud.com', 'tryapplaud-eu.com'];
const certificateDir = `${homedir('ubuntu')}/certs/live`;
const wildCardCertDir = `${homedir('ubuntu')}/certs/wild-card-certs/letsencrypt/live`;
const NGINX_PATH = process.env.NGINX_PATH || '/etc/nginx/';
const sitesAvailableStr = 'sites-available';
const sitesEnabledStr = 'sites-enabled';
const sitesEnabledDirStr = `${NGINX_PATH}${sitesEnabledStr}`;
const sitesAvailableDirStr = `${NGINX_PATH}${sitesAvailableStr}`;

const readFile = util.promisify(fs.readFile);
const writeFile = util.promisify(fs.writeFile);

// Utility
function fileExists (filepath) {
  try {
    Boolean(fs.statSync(filepath))
  } catch (e) {
    return false
  }
  return true
}

function isSiteEnabled (args) {
  console.log('###### start isSiteEnabled ######');
  const enabledPath = `${sitesEnabledDirStr}/${args.domain}`;
  return fileExists(enabledPath);
}

function sudoRemove (args) {
  console.log('###### start sudoRemove ######');
  return new BluebirdPromise((resolve, reject) => {
    // Would prefer `fs.unlink` but, I don't know how to make it work with sudo
    if (fileExists(args.filepath)) {
      exec(`sudo rm ${args.filepath}`, (err, stdout, stderr) => {
        if (err) return reject(err);
        return resolve(args);
      });
    } else {
      return resolve(args);
    }
  });
}

function sudoMove (args) {
  // Would prefer `fs.writeFile` but sudo
  console.log('###### start sudoMove ######');
  return new BluebirdPromise((resolve, reject) => {
    const mv = 'mv';
    const cmd = `sudo ${mv} ${args.filepath} ${sitesAvailableDirStr}`;
    exec(cmd, (err, stdout, stderr) => {
      if (err) return reject(err);
      return resolve(args);
    });
  });
}

// Nginx process functions
function manageNginx (args) {
  // i.e. sudo nginx -s stop|quit|reload
  console.log('###### start manageNginx ######');
  return new BluebirdPromise((resolve, reject) => {
    const cmd = `sudo service nginx ${args.action}`;
    exec(cmd, (err, stdout, stderr) => {
      if (err) {
        console.log('manageNginx',args.action, err);
        return reject(err);
      }
      return resolve(args);
    });
  });
}

function enableSite (args) {
  // would prefer `fs.symlink` but, sudo
  console.log('###### start enableSite ######');
  return new BluebirdPromise((resolve, reject) => {
    const availablePath = `${sitesAvailableDirStr}/${args.domain}`;
    const enabledPath = `${sitesEnabledDirStr}/${args.domain}`;
    const cmd = `sudo ln -s ${availablePath} ${enabledPath}`;

    sudoRemove({ filepath: enabledPath })
      .then(() => new BluebirdPromise((res, rej) => {
        exec(cmd, (err, stdout, stderr) => {
          if (err) return rej(err);
          return res(args);
        });
      }))
      .then(() => resolve(args))
      .catch((error) => {
        console.log('Failed enableSite:- ', error);
        reject(new Error('Unable to enableSite nginx configuration.'));
      });
  });
}

const getDomainKeyConfig = (existingConfig, keys = [], operation) => {
  let existingKeys = [];
  let [keysToAdd, keysToRemove] = operation === 'add' ? [keys, []] : [[], keys];
  if (existingConfig) {
      const existingKeysStr = existingConfig.match(/\([a-zA-Z0-9|]*\)\)/g);
      if (existingKeysStr) existingKeys = existingConfig.match(/\([a-zA-Z0-9|]*\)\)/g)[0].replace(/[\(\)]/g, '').split('|');
  }
  existingKeys = [...existingKeys, ...keysToAdd];
  existingKeys = uniq(existingKeys.filter(k => !keysToRemove.includes(k)));

  // At least 2 keys should be present to add the extra config to site conf.
  // In those 2 keys one key will be DEFAULT_DOMAIN_API_KEY & other was created by user.
  if (existingKeys.length <= 1)
      return '';
  
  return `
    root /etc/nginx/common;
    error_page 403 @forbidden;
    location @forbidden {
        rewrite ^(.*)$ /4xx.html break;
    }
    if ($http_x_com_applaudhr_domain_key !~ (${existingKeys.join("|")})){
        return 403;
    }
  `;
}

function disableSite (args) {
  console.log('###### start disableSite ######');
  return new BluebirdPromise((resolve, reject) => {
    args.filepath = `${sitesEnabledDirStr}/${args.domain}`;
    sudoRemove(args)
      .then(args => {
        args.action = 'reload';
        return args;
      })
      .then(manageNginx)
      .then(args => resolve(args))
      .catch((error) => {
        console.log('Failed sudoRemove:- ', error);
        reject(new Error('Unable to disable nginx configuration.'));
      });
  });
}

const generateSeededDomainConfig = (args) => new BluebirdPromise((res, rej) => {
  console.log('#### start generateSeededDomainConfig ####');
  const confPath = `${sitesEnabledDirStr}/${args.domain}`;
  readFile(confPath, 'utf-8')
    .then((fileContent) => {
      const re = new RegExp(`# DOMAIN KEY CONFIG START - ${args.fullDomain}.*# DOMAIN KEY CONFIG END - ${args.fullDomain}`, 'gs')
      let existingConfig = fileContent.match(re);
      if (existingConfig) existingConfig = existingConfig[0];
      let newConfig = fileContent.replace(re, '').trim();
      const domainKeyConfig = getDomainKeyConfig(existingConfig, args.keys, args.operation);

      if (domainKeyConfig) {
        newConfig = `
        # DOMAIN KEY CONFIG START - ${args.fullDomain}
          server {
            listen 443 ssl;
            listen [::]:443 ssl;
    
            server_name ${args.fullDomain};
            server_tokens off;
    
            ssl_certificate ${wildCardCertDir}/${args.domain}/fullchain.pem;
            ssl_certificate_key ${wildCardCertDir}/${args.domain}/privkey.pem;
            ${domainKeyConfig}
            include snippets/ssl-params.conf;
            include snippets/well-known.conf;
    
            include common/protect.conf;
            include common/properties.conf;
          }
        # DOMAIN KEY CONFIG END - ${args.fullDomain}
        
        ${newConfig}
      `;
      }
      const tmpPath = __dirname + `/tmp/${args.domain}`;
      writeFile(tmpPath, newConfig.trim())
        .then(() => {
          args.filepath = tmpPath;
          sudoMove(args)
            .then(() => {
              res(args);
            })
            .catch(err => {
              console.log(`Failed to move config`, args);
              rej(err);
            });
        })
        .catch((err) => {
          console.log(`Unable to write config file`, args);
          rej(err);
        });
    })
    .catch(err => {
      console.log(`Error occurred while reading file`, args);
      rej(err);
    });
});

const createAndActivateSeededDomainConfig = (args) => new BluebirdPromise((res, rej) => {
  console.log("#### start createAndActivateSeededDomainConfig ####");
  generateSeededDomainConfig(args)
    .then(enableSite)
    .then(args => {
      args.action = 'reload';
      return args;
    })
    .then(manageNginx)
    .then(res)
    .catch((err) => {
      console.log("Failed to createAndActivateSeededDomainConfig", args);
      rej(err);
    });
});

const addOrRemoveDomainKeytoSiteConf = async (args) => {
  console.log('##### start addOrRemoveDomainKeytoSiteConf #####');
  let seededDomains = [], customDomains = [];
  for(const domain of args.domains) {
    const url = new URL(domain);
    const fullDomain = url.hostname;
    if (APPLAUD_DOMAINS.some(ad => fullDomain.includes(ad))) {
      const domainParts = fullDomain.split('.');
      const domain = domainParts.slice(1, domainParts.length).join('.');
      seededDomains.push({
        fullDomain,
        domain,
        operation: args.operation,
        keys: args.keys
      });
    } else {
      customDomains.push(fullDomain);
    }
  }

  // Custom Domains
  if(customDomains.length > 0) {
    for(const customDomain of customDomains) {
      const existingConf = await readFile(`${sitesEnabledDirStr}/${customDomain}`, 'utf-8');
      const domainKeyConfig = getDomainKeyConfig(existingConf, args.keys, args.operation)
        await createAndActivateConfig({
          domain: customDomain,
          domainKeyConfig
        })
    }
  }

  // Seeded Domains
  if (seededDomains.length > 0) {
    for(const seededDomain of seededDomains) {
      await createAndActivateSeededDomainConfig(seededDomain);
    }
  }
  return true;
};

function generateSiteConfig(args) {
  console.log('###### start generateSiteConfig ######');
  return new BluebirdPromise((resolve, reject) => {
    const nginxConfig = `
    server {
      listen 80;
      listen [::]:80;
      server_name ${args.domain};
      server_tokens off;

      include snippets/well-known.conf;
      location / {
        rewrite ^/$ https://$host$request_uri redirect;
        rewrite ^/(.*)$ https://$host/$1 redirect;
      }
    }

    server {
      listen 443 ssl;
      listen [::]:443 ssl;

      server_name ${args.domain};
      server_tokens off;

      ssl_certificate ${certificateDir}/${args.domain}/fullchain.pem;
      ssl_certificate_key ${certificateDir}/${args.domain}/privkey.pem;

      ${args.domainKeyConfig ? args.domainKeyConfig : ''}

      include snippets/ssl-params.conf;
      include snippets/well-known.conf;

      include common/protect.conf;
      include common/properties.conf;
    }
    `;

    const tempfilepath = `${__dirname}/tmp/${args.domain}`;

    fs.writeFile(tempfilepath, nginxConfig, (err) => {
      if (err) {
        console.log('Failed fileWrite:- ', err);
        return reject(new Error('Unable to create nginx configuration.'));
      }
      args.filepath = tempfilepath;
      sudoMove(args)
        .then(args => resolve(args))
        .catch((error) => {
          console.log('Failed sudoMove:- ', error);
          reject(new Error('Unable to create nginx configuration.'));
        });
    });
  });
}

function createAndActivateConfig (args) {
  console.log('###### start createAndActivateConfig ######');
  return new BluebirdPromise((resolve, reject) => {
    // args.domainKeyConfig is added to not resolve the function while doing DOMAIN API KEY operations.
    if (isSiteEnabled(args) && args.domainKeyConfig === undefined) {
      console.log('Site already enabled.');
      return resolve(args);
    }
    disableSite(args)
      .then(generateSiteConfig)
      .then(enableSite)
      .then(args => {
        args.action = 'reload';
        return args;
      })
      .then(manageNginx)
      .then(args => resolve(args))
      .catch((error) => {
        console.log('Failed createAndActivateConfig:- ', error);
        reject(new Error('Unable to create nginx configuration.'));
      });
  });
}

function removeSite (args) {
  // if the file is currently enabled, disable it before removing it.
  console.log('###### start removeSite ######');
  return new BluebirdPromise((resolve, reject) => {
    disableSite(args)
      .then(args => {
        args.filepath = `${sitesAvailableDirStr}/${args.domain}`;
        args.action = 'reload';
        return args;
      })
      .then(sudoRemove)
      .then(manageNginx)
      .then(args => resolve(args))
      .catch((error) => {
        console.log('Failed sudoRemove:- ', error);
        reject(new Error('Unable to disable nginx configuration.'));
      });
  });
}

module.exports = {
  manageNginx,
  enableSite,
  disableSite,
  removeSite,
  createAndActivateConfig,
  addOrRemoveDomainKeytoSiteConf,
  constants: {
    NGINX_PATH,
    sitesAvailableStr,
    sitesEnabledStr
  }
};