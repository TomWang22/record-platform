module.exports = { apps: [{ name: 'analytics-service', script: 'dist/server.js', instances: 'max', exec_mode: 'cluster' }] }
