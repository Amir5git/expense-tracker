'use strict';

/* CDP smoke test for the passphrase lock screen.
 *
 * The suite enables the lock itself (so it never depends on prior state) and
 * disables it again on the way out, leaving the temp database clean. */

const { launch, report } = require('./lib/cdp');

const BASE = process.env.BASE || 'http://127.0.0.1:3000';
const PASS = process.env.PASS || 'correct horse battery';

async function api(method, pathname, body, cookie) {
  const res = await fetch(BASE + pathname, {
    method,
    headers: {
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const setCookie = res.headers.get('set-cookie');
  let data = null;
  try { data = await res.json(); } catch { /* ignore */ }
  return { status: res.status, data, cookie: setCookie ? setCookie.split(';')[0] : cookie };
}

(async () => {
  // Enable the lock before the browser opens. The returned session cookie is
  // kept so the suite can disable the lock again afterwards.
  const enabled = await api('POST', '/api/auth/enable', { passphrase: PASS });
  if (enabled.status !== 200 || !enabled.data?.enabled) {
    throw new Error(`Could not enable app lock: ${enabled.status} ${JSON.stringify(enabled.data)}`);
  }
  const sessionCookie = enabled.cookie;

  const browser = await launch({ base: BASE });
  const { send, evaluate, check, results, waitFor, setViewport, sleep } = browser;

  try {
    await setViewport(390, 844, true);
    await send('Page.navigate', { url: BASE + '/#/dashboard' });
    check('lock screen shows', await waitFor(`!document.querySelector('#lockScreen').hidden`));
    check('app shell is hidden', await evaluate(`document.body.classList.contains('locked')`));
    check('lock card has input', await evaluate(`!!document.querySelector('#lockPass')`));

    await evaluate(`document.querySelector('#lockPass').value = ${JSON.stringify(PASS)}`);
    await evaluate(`document.querySelector('#lockForm').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))`);
    check('unlock reveals the app', await waitFor(`!document.body.classList.contains('locked')`, 10000));
    check('lock screen hides', await evaluate(`document.querySelector('#lockScreen').hidden`));
    check('dashboard renders after unlock', await waitFor(`document.querySelector('#view').textContent.trim().length > 0`));

    await send('Page.reload');
    await sleep(1500);
    check('session cookie keeps app unlocked', await evaluate(`!document.body.classList.contains('locked') && document.querySelector('#lockScreen').hidden`));
    check('app content still renders', await evaluate(`document.querySelector('#view').textContent.trim().length > 0`));

    await evaluate(`api.post('/api/auth/logout', {})`, true);
    await send('Page.reload');
    check('logout locks again', await waitFor(`!document.querySelector('#lockScreen').hidden`, 8000));
  } finally {
    const disabled = await api('POST', '/api/auth/disable', { passphrase: PASS }, sessionCookie);
    check('lock disabled for later suites', disabled.status === 200 && disabled.data?.enabled === false, `${disabled.status}`);

    const failed = report(results);
    await browser.close();
    process.exit(failed ? 1 : 0);
  }
})().catch(err => {
  console.error('ERROR', err);
  process.exit(2);
});
