// Start both HTTP server and worker
// Import server first (it starts the HTTP server on port 4008)
require('./server.js');

// Then start the worker in the background after a short delay
// The worker will skip its HTTP server since RUN_WORKER_ONLY is not set
setTimeout(() => {
  require('./worker.js');
}, 1000);
