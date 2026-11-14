'use strict';

/* CDP test: create + edit a category from Settings. */

const { launch, report } = require('./lib/cdp');

const BASE = process.env.BASE || 'http://127.0.0.1:3000';

(async () => {
  const browser = await launch({ base: BASE });
  const { send, evaluate, check, results, errors, waitFor, setViewport } = browser;

  await setViewport(390, 844, true);
  await send('Page.navigate', { url: BASE + '/#/settings' });
  check('settings loads', await waitFor(`!!document.querySelector('[data-add-cat]')`));

  await evaluate(`document.querySelector('[data-add-cat]').click()`);
  const opened = await waitFor(`!!document.querySelector('.modal [data-role="cat-name"]')`);
  check('new category modal opens', opened);
  if (!opened) {
    console.log('console errors:', errors);
    const failed = report(results);
    await browser.close();
    process.exit(failed ? 1 : 0);
  }

  const name = 'Test Cat ' + Date.now().toString().slice(-5);
  await evaluate(`(() => {
    const i = document.querySelector('.modal [data-role="cat-name"]');
    i.value = ${JSON.stringify(name)};
    i.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await evaluate(`document.querySelector('.modal [data-ok]').click()`);
  check('create closes modal', await waitFor(`!document.querySelector('.modal')`));
  check('create shows toast', await evaluate(`(document.querySelector('#toastRoot .toast')||{}).textContent||''`).then(t => t.includes('Category saved')), await evaluate(`(document.querySelector('#toastRoot .toast')||{}).textContent||''`));
  check('category is in state', await evaluate(`State.categories.some(c => c.name === ${JSON.stringify(name)})`));

  const id = await evaluate(`(State.categories.find(c => c.name === ${JSON.stringify(name)})||{}).id`);
  check('category has id', !!id, String(id));
  check('created row renders', await waitFor(`!!document.querySelector('[data-edit-cat="${id}"]')`));

  await evaluate(`document.querySelector('[data-edit-cat="${id}"]').click()`);
  check('edit modal opens', await waitFor(`!!document.querySelector('.modal [data-role="cat-name"]')`));
  check('edit modal prefilled', await evaluate(`document.querySelector('.modal [data-role="cat-name"]').value`) === name);

  const renamed = name + ' x';
  await evaluate(`(() => {
    const i = document.querySelector('.modal [data-role="cat-name"]');
    i.value = ${JSON.stringify(renamed)};
    i.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await evaluate(`document.querySelector('.modal [data-ok]').click()`);
  check('edit closes modal', await waitFor(`!document.querySelector('.modal')`));
  check('edit persisted', await evaluate(`State.categories.some(c => c.name === ${JSON.stringify(renamed)})`));
  check('edited row renders', await waitFor(`document.body.textContent.includes(${JSON.stringify(renamed)})`));

  // cleanup
  await evaluate(`api.del('/api/categories/${id}')`, true).catch(() => {});
  check('no JS errors during flow', errors.length === 0, errors.join(' | '));

  const failed = report(results);
  await browser.close();
  process.exit(failed ? 1 : 0);
})().catch(err => {
  console.error('ERROR', err);
  process.exit(2);
});
