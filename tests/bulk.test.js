'use strict';

/* CDP smoke test for bulk transaction actions, undo, and mobile gestures. */

const { launch, report } = require('./lib/cdp');

const BASE = process.env.BASE || 'http://127.0.0.1:3000';

(async () => {
  const browser = await launch({ base: BASE });
  const { send, evaluate, check, results, waitFor, setViewport, sleep } = browser;

  await setViewport(390, 844, true);
  await send('Page.navigate', { url: BASE + '/#/transactions' });
  check('transactions view loads', await waitFor(`!!document.querySelector('#txList .tx-row')`));

  const beforeTotal = await evaluate(`State.tx.total`);

  await evaluate(`document.querySelector('[data-tx-select]').click()`);
  await sleep(300);
  check('bulk bar appears', await evaluate(`!document.querySelector('#txBulkBar').hidden`));
  check('checkboxes render', await evaluate(`document.querySelectorAll('#txList .tx-check').length`) > 0);
  check('select button becomes cancel', await evaluate(`!!document.querySelector('[data-tx-cancel]')`));

  await evaluate(`document.querySelectorAll('#txList .tx-row')[0].click()`);
  await evaluate(`document.querySelectorAll('#txList .tx-row')[1].click()`);
  await sleep(200);
  check('two rows selected', await evaluate(`document.querySelector('#txBulkCount').textContent`) === '2 selected');
  check('row gets selected class', await evaluate(`document.querySelectorAll('#txList .tx-row.selected').length`) === 2);
  check('delete enabled with selection', await evaluate(`!document.querySelector('#txBulkDelete').disabled`));

  // Bulk category change
  await evaluate(`document.querySelector('#txBulkCategory').click()`);
  await sleep(300);
  check('category picker opens', await evaluate(`!!document.querySelector('.modal [data-cat-id]')`));
  const firstCat = await evaluate(`document.querySelector('.modal [data-cat-id]').dataset.catId`);
  await evaluate(`document.querySelector('.modal [data-cat-id]').click()`);
  await sleep(900);
  check('category applied toast', await evaluate(`(document.querySelector('#toastRoot .toast')||{}).textContent||''`).then(t => /transaction/.test(t)));
  check('category actually changed', await evaluate(`State.tx.rows.filter(r => String(r.category_id) === '${firstCat}').length`) >= 2);
  check('selection survives bulk edit', await evaluate(`State.tx.selected.size`) === 2);

  // Delete + undo
  await evaluate(`document.querySelector('#txBulkAll').click()`);
  await sleep(200);
  const selected = await evaluate(`State.tx.selected.size`);
  check('select all selects loaded rows', selected > 0, String(selected));

  await evaluate(`document.querySelector('#txBulkDelete').click()`);
  check('confirm dialog opens', await waitFor(`!!document.querySelector('.modal [data-confirm]')`));
  await evaluate(`document.querySelector('.modal [data-confirm]').click()`);
  check('undo toast appears', await waitFor(`!!document.querySelector('#toastRoot .toast-action')`, 8000));
  check('undo toast says Undo', await evaluate(`document.querySelector('#toastRoot .toast-action').textContent`) === 'Undo');
  const afterDelete = await evaluate(`State.tx.total`);
  check('rows deleted', afterDelete < beforeTotal, `${beforeTotal} -> ${afterDelete}`);
  check('select mode exits after delete', await evaluate(`!State.tx.selectMode`));
  check('bulk bar hidden after delete', await evaluate(`document.querySelector('#txBulkBar').hidden`));

  await evaluate(`document.querySelector('#toastRoot .toast-action').click()`);
  check('restore completes', await waitFor(`State.tx.total === ${beforeTotal}`, 8000), `total ${await evaluate(`State.tx.total`)}`);

  // Single delete undo
  await evaluate(`document.querySelectorAll('#txList .tx-row')[0].click()`);
  check('edit modal opens from row', await waitFor(`!!document.querySelector('.modal [data-del]')`));
  await evaluate(`document.querySelector('.modal [data-del]').click()`);
  check('single delete confirm opens', await waitFor(`!!document.querySelector('.modal [data-confirm]')`));
  await evaluate(`document.querySelector('.modal [data-confirm]').click()`);
  check('single delete undo toast', await waitFor(`!!document.querySelector('#toastRoot .toast-action')`, 8000));
  const singleDeleted = await waitFor(`State.tx.total === ${beforeTotal - 1}`, 8000);
  const afterSingle = await evaluate(`State.tx.total`);
  check('single row deleted', singleDeleted, `${beforeTotal} -> ${afterSingle}`);
  await evaluate(`document.querySelector('#toastRoot .toast-action').click()`);
  check('single delete restored', await waitFor(`State.tx.total === ${beforeTotal}`, 8000), `total ${await evaluate(`State.tx.total`)}`);

  // ---- gestures ----
  await evaluate(`location.hash = '#/transactions'`);
  await waitFor(`!!document.querySelector('#txList .tx-row')`);

  const swipe = async (fromX, toX) => evaluate(`(() => {
    const view = document.querySelector('#view');
    const touch = (x, y) => new Touch({ identifier: 1, target: view, clientX: x, clientY: y, pageX: x, pageY: y });
    const fire = (type, x) => view.dispatchEvent(new TouchEvent(type, {
      bubbles: true, cancelable: true,
      touches: type === 'touchend' ? [] : [touch(x, 400)],
      changedTouches: [touch(x, 400)],
    }));
    fire('touchstart', ${fromX});
    fire('touchmove', ${toX});
    fire('touchend', ${toX});
    return location.hash;
  })()`);
  await sleep(600);
  check('swipe left moves to accounts', (await swipe(320, 160)) === '#/accounts', await evaluate(`location.hash`));
  await sleep(500);
  check('swipe right moves back to transactions', (await swipe(80, 260)) === '#/transactions', await evaluate(`location.hash`));
  await sleep(500);

  const pulled = await evaluate(`(() => {
    const view = document.querySelector('#view');
    const touch = (x, y) => new Touch({ identifier: 2, target: view, clientX: x, clientY: y, pageX: x, pageY: y });
    const fire = (type, y, touches) => view.dispatchEvent(new TouchEvent(type, {
      bubbles: true, cancelable: true, touches, changedTouches: [touch(200, y)],
    }));
    window.scrollTo(0, 0);
    fire('touchstart', 100, [touch(200, 100)]);
    fire('touchmove', 230, [touch(200, 230)]);
    const hint = document.querySelector('#pullHint');
    const shown = hint.classList.contains('show') && hint.textContent === 'Release to refresh';
    fire('touchend', 230, []);
    return shown;
  })()`);
  check('pull to refresh shows release hint', pulled);
  await sleep(700);
  check('pull hint hides after refresh', await evaluate(`!document.querySelector('#pullHint').classList.contains('show')`));

  await evaluate(`document.querySelectorAll('#txList .tx-row')[0].click()`);
  check('modal opens for drag test', await waitFor(`!!document.querySelector('.modal .modal-head')`));
  const dragged = await evaluate(`(() => {
    const modal = document.querySelector('.modal');
    const head = modal.querySelector('.modal-head');
    const ev = (type, y) => new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 7, pointerType: 'touch', clientX: 180, clientY: y, isPrimary: true });
    head.dispatchEvent(ev('pointerdown', 100));
    head.dispatchEvent(ev('pointermove', 320));
    head.dispatchEvent(ev('pointerup', 320));
    return true;
  })()`);
  await sleep(600);
  check('dragging sheet down dismisses it', dragged && await evaluate(`!document.querySelector('.modal')`));

  const failed = report(results);
  await browser.close();
  process.exit(failed ? 1 : 0);
})().catch(err => {
  console.error('ERROR', err);
  process.exit(2);
});
