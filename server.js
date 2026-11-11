'use strict';

/**
 * Expense Tracker — Node.js entry point
 *
 * Serves the shared Hono app (app.js) with node:sqlite storage.
 * The same app also runs on Cloudflare Workers via worker.js.
 *
 * Run:  npm start   (http://localhost:3000)
 */

const path = require('path');
const fs = require('fs');
const os = require('os');
const { serve } = require('@hono/node-server');
const { serveStatic } = require('@hono/node-server/serve-static');
const { NodeDB } = require('./db');
const { createApp, ensureSchema } = require('./app');

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0'; // 0.0.0.0 so phones on the same Wi-Fi can reach it
const LOG_ACCESS = process.env.ACCESS_LOG === '1';

const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(__dirname, 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });
const DB_PATH = path.join(DATA_DIR, 'expenses.db');

(async () => {
  const db = new NodeDB(DB_PATH);
  await ensureSchema(db);

  const app = createApp(db, { recurringTimer: true });

  /* request log — enable with ACCESS_LOG=1 (useful for diagnosing access) */
  if (LOG_ACCESS) {
    app.use('*', async (c, next) => {
      const sock = c.env && c.env.incoming && c.env.incoming.socket;
      const ip = sock ? String(sock.remoteAddress || '?').replace(/^::ffff:/, '') : '?';
      if (ip !== '127.0.0.1' && ip !== '::1' && ip !== '?') {
        console.log(`[request] ${c.req.method} ${c.req.url} from ${ip}`);
      }
      await next();
    });
  }

  /* ---- static frontend ---- */
  app.use('*', serveStatic({ root: './public' }));

  const server = serve({ fetch: app.fetch, port: PORT, hostname: HOST }, () => {
    const nets = os.networkInterfaces();
    const lan = [];
    for (const list of Object.values(nets)) {
      for (const net of list || []) {
        if (net.family === 'IPv4' && !net.internal) lan.push(net.address);
      }
    }
    console.log('');
    console.log('  💸 Expense Tracker');
    console.log('  ------------------------------------');
    console.log(`  Local:   http://localhost:${PORT}`);
    for (const ip of lan) console.log(`  Network: http://${ip}:${PORT}   ← open this on your phone (same Wi-Fi)`);
    console.log('');
    console.log(`  Database: ${DB_PATH}`);
    console.log('');
  });

  /* TCP-level logging: shows ANY inbound connection attempt (even ones that
     never become valid HTTP requests). Enable with ACCESS_LOG=1. */
  if (LOG_ACCESS) {
    server.on('connection', socket => {
      const ip = (socket.remoteAddress || '?').replace(/^::ffff:/, '');
      if (ip !== '127.0.0.1' && ip !== '::1' && ip !== '?') {
        console.log(`[tcp] connection from ${ip}:${socket.remotePort}`);
      }
    });
  }
})().catch(err => {
  console.error(err);
  process.exit(1);
});
