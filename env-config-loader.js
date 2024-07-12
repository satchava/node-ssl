const env = require('./env.json');

// Setup environment variables
Object.keys(env).forEach((key) => {
  if (typeof env[key] === 'string') {
    process.env[key] = env[key];
  } else {
    process.env[key] = JSON.stringify(env[key]);
  }
});
