module.exports = { apps: [{ name: 'auction-monitor', script: 'dist/worker.js', instances: 1, exec_mode: 'fork' }] }
