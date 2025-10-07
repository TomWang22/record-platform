module.exports = { apps: [{ name: 'listings-service', script: 'dist/server.js', instances: 'max', exec_mode: 'cluster', env: { NODE_ENV: 'production' } }] }
