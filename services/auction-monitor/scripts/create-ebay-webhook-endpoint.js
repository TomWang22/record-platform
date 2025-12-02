#!/usr/bin/env node
/**
 * Simple eBay webhook endpoint for Marketplace Account Deletion notifications
 * 
 * This is a minimal endpoint that satisfies eBay's compliance requirements.
 * It accepts POST requests from eBay and returns 200 OK.
 * 
 * Usage:
 *   node scripts/create-ebay-webhook-endpoint.js
 * 
 * Or use with Express:
 *   npm install express
 *   node scripts/create-ebay-webhook-endpoint.js
 */

const http = require('http');
const crypto = require('crypto');
const url = require('url');

const PORT = process.env.PORT || 3000;
const VERIFICATION_TOKEN = process.env.EBAY_VERIFICATION_TOKEN || 'ebay_verify_abc123xyz789_32chars_min';
const ENDPOINT_URL = process.env.EBAY_ENDPOINT_URL || '';

const server = http.createServer((req, res) => {
  const parsedUrl = url.parse(req.url, true);
  const path = parsedUrl.pathname;
  const method = req.method;
  const fullUrl = `https://${req.headers.host}${req.url}`;

  // Handle verification (eBay sends GET request with challenge_code)
  if (method === 'GET' && path === '/ebay/notifications') {
    const challengeCode = parsedUrl.query.challenge_code || parsedUrl.query.challenge;
    if (challengeCode) {
      // eBay verification process:
      // 1. Concatenate: challenge_code + verification_token + endpoint_url
      // 2. Compute SHA-256 hash
      // 3. Return JSON with challengeResponse
      const endpointUrl = ENDPOINT_URL || fullUrl.split('?')[0]; // Use full endpoint URL
      const concatenated = challengeCode + VERIFICATION_TOKEN + endpointUrl;
      const hash = crypto.createHash('sha256').update(concatenated).digest('hex');
      
      const response = JSON.stringify({ challengeResponse: hash });
      res.writeHead(200, { 
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(response)
      });
      res.end(response);
      console.log(`[${new Date().toISOString()}] Verification request received:`);
      console.log(`  Challenge code: ${challengeCode}`);
      console.log(`  Endpoint URL: ${endpointUrl}`);
      console.log(`  Challenge response: ${hash}`);
      return;
    }
  }

  // Handle notifications (eBay sends POST requests)
  if (method === 'POST' && path === '/ebay/notifications') {
    let body = '';
    req.on('data', chunk => {
      body += chunk.toString();
    });
    
    req.on('end', () => {
      try {
        const data = JSON.parse(body);
        console.log(`[${new Date().toISOString()}] Notification received:`, JSON.stringify(data, null, 2));
        
        // Verify token if present
        if (data.verificationToken && data.verificationToken !== VERIFICATION_TOKEN) {
          console.warn('Invalid verification token');
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid token' }));
          return;
        }
        
        // Return 200 OK to acknowledge receipt
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'received' }));
      } catch (e) {
        console.error('Error parsing notification:', e);
        res.writeHead(200, { 'Content-Type': 'application/json' }); // Still return 200
        res.end(JSON.stringify({ status: 'received' }));
      }
    });
    return;
  }

  // Health check
  if (method === 'GET' && path === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', service: 'ebay-webhook' }));
    return;
  }

  // 404 for other paths
  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not Found');
});

server.listen(PORT, () => {
  console.log(`eBay webhook endpoint listening on http://localhost:${PORT}/ebay/notifications`);
  console.log(`Verification token: ${VERIFICATION_TOKEN}`);
  console.log(`\nFor local testing with ngrok:`);
  console.log(`  1. Install ngrok: brew install ngrok`);
  console.log(`  2. Run: ngrok http ${PORT}`);
  console.log(`  3. Use the HTTPS URL in eBay's notification endpoint field`);
});

