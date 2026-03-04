#!/usr/bin/env node
/**
 * Simple OAuth callback server for Chrome Web Store setup
 *
 * Receives authorization code from Google OAuth redirect
 * and displays it for manual entry in setup script
 *
 * Usage:
 *   node scripts/oauth_callback_server.js
 */

const http = require('http');
const url = require('url');
const { escapeHtml } = require('./shared/html_escape');

const PORT = 3456;
const CALLBACK_PATH = '/oauth/callback';

const server = http.createServer((req, res) => {
  const parsedUrl = url.parse(req.url, true);

  if (parsedUrl.pathname === CALLBACK_PATH) {
    const code = parsedUrl.query.code;
    const error = parsedUrl.query.error;

    if (error) {
      console.error(`\n❌ OAuth error: ${error}`);
      res.writeHead(400, { 'Content-Type': 'text/html' });
      res.end(`<h1>OAuth Error</h1><p>${escapeHtml(error)}</p>`);
      return;
    }

    if (code) {
      console.log('\n========================================');
      console.log('✅ Authorization code received!');
      console.log('========================================');
      console.log(`\nCode: ${code}`);
      console.log('\nCopy this code and paste it in the setup script.');
      console.log('========================================\n');

      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>OAuth Success</title>
          <style>
            body {
              font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
              max-width: 600px;
              margin: 100px auto;
              padding: 20px;
              text-align: center;
            }
            .success { color: #22c55e; font-size: 48px; }
            .code {
              background: #f3f4f6;
              padding: 20px;
              border-radius: 8px;
              margin: 20px 0;
              font-family: monospace;
              word-break: break-all;
              user-select: all;
            }
            .btn {
              background: #3b82f6;
              color: white;
              border: none;
              padding: 12px 24px;
              border-radius: 6px;
              cursor: pointer;
              font-size: 16px;
            }
            .btn:hover { background: #2563eb; }
          </style>
        </head>
        <body>
          <div class="success">✅</div>
          <h1>Authorization Successful!</h1>
          <p>Copy the authorization code below:</p>
          <div class="code" id="code">${escapeHtml(code)}</div>
          <button class="btn" onclick="copyCode()">Copy Code</button>
          <p style="margin-top: 40px; color: #6b7280;">
            Paste this code in the terminal running the setup script.
          </p>
          <script>
            function copyCode() {
              const code = ${JSON.stringify(code)};
              navigator.clipboard.writeText(code);
              alert('Code copied to clipboard!');
            }
          </script>
        </body>
        </html>
      `);

      // Don't auto-shutdown - keep showing the code
      // User needs time to copy it

      return;
    }

    res.writeHead(400, { 'Content-Type': 'text/plain' });
    res.end('Missing authorization code');
    return;
  }

  // Health check
  if (parsedUrl.pathname === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(`
      <!DOCTYPE html>
      <html>
      <body style="font-family: sans-serif; text-align: center; padding: 100px;">
        <h1>OAuth Callback Server Running</h1>
        <p>Listening for Chrome Web Store OAuth callbacks on:</p>
        <code>${CALLBACK_PATH}</code>
      </body>
      </html>
    `);
    return;
  }

  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not Found');
});

server.listen(PORT, () => {
  console.log('========================================');
  console.log('OAuth Callback Server');
  console.log('========================================');
  console.log(`\n✅ Server running on port ${PORT}`);
  console.log(`\nCallback URL: http://localhost:${PORT}${CALLBACK_PATH}`);
  console.log(`Public URL: https://noxonbot.wpmix.net${CALLBACK_PATH}`);
  console.log('\nWaiting for OAuth redirect...');
  console.log('\n⚠️  Make sure reverse proxy forwards to this port!');
  console.log('========================================\n');
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n\nShutting down server...');
  server.close(() => {
    console.log('Server closed.');
    process.exit(0);
  });
});
