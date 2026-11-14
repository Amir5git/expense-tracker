'use strict';

/* Test runner.
 *
 * Spawns the Node server against a throwaway DATA_DIR, then runs each suite in
 * its own process. UI suites get fresh current-month sample data so they are
 * deterministic no matter when CI runs.
 *
 *   npm test
 *   TEST_PORT=3401 npm test
 */

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { freePort } = require('./lib/cdp');

const ROOT = path.resolve(__dirname, '..');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function waitForHealth(base, timeout = 25000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    try {
      const res = await fetch(base + '/api/health');
      if (res.ok) return true;
    } catch { /* server still starting */ }
    await sleep(200);
  }
  return false;
}

async function api(base, method, pathname, body) {
  const res = await fetch(base + pathname, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return res;
}

async function stopProcess(child) {
  if (!child || child.exitCode !== null) return;
  try {
    if (process.platform === 'win32') {
      spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    } else {
      child.kill('SIGTERM');
    }
  } catch { /* already gone */ }
  await sleep(250);
}

(async () => {
  const port = Number(process.env.TEST_PORT) || await freePort();
  const base = `http://127.0.0.1:${port}`;
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'expense-test-data-'));

  const server = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(port), DATA_DIR: dataDir, ACCESS_LOG: '0' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let serverLog = '';
  server.stdout.on('data', chunk => { serverLog += chunk; });
  server.stderr.on('data', chunk => { serverLog += chunk; });

  const suites = [
    ['API', 'api.test.js'],
    ['UI', 'ui.test.js'],
    ['Bulk actions', 'bulk.test.js'],
    ['Categories', 'category.test.js'],
    ['App lock', 'lock.test.js'],
  ];

  let failedSuites = 0;

  try {
    if (!await waitForHealth(base)) {
      throw new Error(`Server did not start on ${base}:\n${serverLog}`);
    }
    console.log(`Test server: ${base}`);
    console.log(`Temp data:   ${dataDir}\n`);

    for (const [name, file] of suites) {
      // API tests build their own data. UI suites start from a clean,
      // current-month sample so layout checks do not depend on the date.
      if (file !== 'api.test.js') {
        await api(base, 'DELETE', '/api/data?confirm=DELETE');
        await api(base, 'POST', '/api/sample-data');
      }

      console.log(`\n=== ${name} (tests/${file}) ===`);
      const child = spawn(process.execPath, [path.join(__dirname, file)], {
        cwd: ROOT,
        env: { ...process.env, BASE: base },
        stdio: 'inherit',
      });
      const code = await new Promise(resolve => child.on('exit', resolve));
      if (code) failedSuites++;
    }

    if (failedSuites) {
      console.error(`\n${failedSuites} suite(s) failed.`);
      process.exitCode = 1;
    } else {
      console.log('\nAll suites passed.');
    }
  } catch (err) {
    console.error(err);
    process.exitCode = 1;
  } finally {
    await stopProcess(server);
    try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
})();
