module.exports = { apps: [{ name: 'records-service', script: 'dist/server.js', instances: 'max', exec_mode: 'cluster' }] }
