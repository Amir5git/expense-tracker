'use strict';

/* Portable headless-Chrome helper used by the UI test suites.
 *
 * Chrome is located from CHROME_BIN / CHROME_PATH, then the usual install
 * locations on Windows, macOS and Linux. Each launch gets a throwaway profile
 * and a free DevTools port, so suites can run one after another without stale
 * service-worker assets. */

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function findChrome() {
  const candidates = [process.env.CHROME_BIN, process.env.CHROME_PATH];

  if (process.platform === 'win32') {
    candidates.push(
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
      path.join(process.env.LOCALAPPDATA || '', 'Google\\Chrome\\Application\\chrome.exe'),
      path.join(process.env.PROGRAMFILES || '', 'Google\\Chrome\\Application\\chrome.exe')
    );
  } else if (process.platform === 'darwin') {
    candidates.push(
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Chromium.app/Contents/MacOS/Chromium'
    );
  } else {
    candidates.push(
      '/usr/bin/google-chrome',
      '/usr/bin/google-chrome-stable',
      '/usr/bin/chromium',
      '/usr/bin/chromium-browser'
    );
  }

  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) return candidate;
  }
  throw new Error('Chrome not found. Set CHROME_BIN to the browser executable.');
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

async function killChrome(chrome) {
  if (!chrome || chrome.killed) return;
  try {
    if (process.platform === 'win32') {
      spawn('taskkill', ['/pid', String(chrome.pid), '/T', '/F'], { stdio: 'ignore' });
    } else {
      chrome.kill('SIGKILL');
    }
  } catch { /* already gone */ }
}

async function launch({ base, viewport = { width: 390, height: 844 } } = {}) {
  if (!base) throw new Error('launch({ base }) is required');

  const chromePath = findChrome();
  const debugPort = await freePort();
  const userDir = fs.mkdtempSync(path.join(os.tmpdir(), 'expense-cdp-'));

  const args = [
    '--headless=new',
    '--disable-gpu',
    '--hide-scrollbars',
    '--no-first-run',
    '--no-default-browser-check',
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${userDir}`,
    `--window-size=${viewport.width},${viewport.height}`,
    'about:blank',
  ];
  if (process.platform === 'linux') args.unshift('--no-sandbox', '--disable-dev-shm-usage');

  const chrome = spawn(chromePath, args, { stdio: 'ignore' });

  let targets = null;
  for (let i = 0; i < 120; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${debugPort}/json`);
      if (res.ok) { targets = await res.json(); break; }
    } catch { /* not up yet */ }
    await sleep(100);
  }
  if (!targets) {
    await killChrome(chrome);
    throw new Error('Chrome DevTools endpoint did not start');
  }

  const page = targets.find(t => t.type === 'page');
  if (!page) {
    await killChrome(chrome);
    throw new Error('Chrome opened without a page target');
  }

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });

  let seq = 0;
  const pending = new Map();
  const errors = [];
  ws.onmessage = event => {
    const msg = JSON.parse(event.data);
    if (msg.method === 'Runtime.exceptionThrown') {
      errors.push(msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text);
    }
    if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
      errors.push(msg.params.args.map(a => a.value || a.description || '').join(' '));
    }
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(JSON.stringify(msg.error)));
      else resolve(msg.result);
    }
  };

  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });

  async function evaluate(expression, awaitPromise = false) {
    const res = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise });
    if (res.exceptionDetails) {
      throw new Error(res.exceptionDetails.exception?.description || res.exceptionDetails.text);
    }
    return res.result.value;
  }

  const results = [];
  const check = (name, ok, detail) => {
    results.push({ name, ok: !!ok, detail });
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
  };

  const waitFor = async (expression, timeout = 8000) => {
    const started = Date.now();
    while (Date.now() - started < timeout) {
      if (await evaluate(expression)) return true;
      await sleep(120);
    }
    return false;
  };

  const setViewport = (width, height, mobile) => send('Emulation.setDeviceMetricsOverride', {
    width, height, deviceScaleFactor: mobile ? 2 : 1, mobile,
    screenWidth: width, screenHeight: height,
  });

  const navigate = hash => send('Page.navigate', { url: base + (hash || '') });

  async function close() {
    try { ws.close(); } catch { /* ignore */ }
    await killChrome(chrome);
    await sleep(250);
    try { fs.rmSync(userDir, { recursive: true, force: true }); } catch { /* ignore */ }
  }

  await send('Page.enable');
  await send('Runtime.enable');

  return {
    base, chrome, ws, send, evaluate, check, results, errors, waitFor, setViewport, navigate, close, sleep,
  };
}

function report(results) {
  const failed = results.filter(r => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  return failed.length;
}

module.exports = { launch, report, sleep, findChrome, freePort };
