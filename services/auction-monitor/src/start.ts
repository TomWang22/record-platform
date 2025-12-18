// Load environment variables from .env file if it exists
try {
  require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
} catch (e) {
  // dotenv not installed or .env not found, continue without it
}

// Start both HTTP server and worker
// Import server first (it starts the HTTP server on port 4008)
require('./server.js');

// Then start the worker in the background after a short delay
// The worker will skip its HTTP server since RUN_WORKER_ONLY is not set
setTimeout(() => {
  require('./worker.js');
}, 1000);
