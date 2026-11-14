'use strict';

/* Headless Chrome layout/animation smoke test via CDP. */

const { launch, report } = require('./lib/cdp');

const BASE = process.env.BASE || 'http://127.0.0.1:3000';

(async () => {
  const browser = await launch({ base: BASE });
  const { send, evaluate, check, results, sleep, setViewport } = browser;

  async function loadReady() {
    await evaluate(`new Promise(resolve => {
      const started = Date.now();
      const timer = setInterval(() => {
        const v = document.querySelector('#view');
        const ready = document.body.dataset.view && v && !v.querySelector('.loading-block');
        if (ready || Date.now() - started > 8000) { clearInterval(timer); resolve(!!ready); }
      }, 80);
    })`, true);
  }

  async function goView(view) {
    await evaluate(`location.hash = '#/${view}'`);
    await evaluate(`new Promise(resolve => {
      const started = Date.now();
      const timer = setInterval(() => {
        const v = document.querySelector('#view');
        const ready = document.body.dataset.view === '${view}' && v && !v.querySelector('.loading-block');
        if (ready || Date.now() - started > 8000) { clearInterval(timer); resolve(!!ready); }
      }, 80);
    })`, true);
  }

  async function metrics() {
    return evaluate(`(() => {
      const rect = el => { const r = el.getBoundingClientRect(); return { x: +r.x.toFixed(1), y: +r.y.toFixed(1), w: +r.width.toFixed(1), h: +r.height.toFixed(1), right: +r.right.toFixed(1) }; };
      const topbar = document.querySelector('#topbar');
      const quick = document.querySelector('.topbar-quick');
      const nav = document.querySelector('#bottomnav');
      const view = document.querySelector('#view');
      const btn = document.querySelector('#viewActions .btn');
      const sidebar = document.querySelector('#sidebar');
      const visible = el => el && getComputedStyle(el).display !== 'none' && el.getBoundingClientRect().width > 0;
      const navLinks = [...nav.querySelectorAll('a')].map(a => ({ label: a.querySelector('span').textContent, nav: a.dataset.nav, active: a.classList.contains('active') }));
      const quickLinks = [...quick.querySelectorAll('a')].map(a => ({ nav: a.dataset.nav, visible: visible(a), ...rect(a) }));
      return {
        viewport: { w: innerWidth, h: innerHeight },
        docScrollWidth: document.documentElement.scrollWidth,
        overflowX: document.documentElement.scrollWidth > innerWidth + 1,
        topbar: rect(topbar),
        topbarOverflow: topbar.scrollWidth > topbar.clientWidth + 1,
        title: rect(document.querySelector('#viewTitle')),
        quickDisplay: getComputedStyle(quick).display,
        quickVisible: visible(quick),
        quick: rect(quick),
        quickLinks,
        theme: rect(document.querySelector('#topThemeBtn')),
        navVisible: visible(nav),
        navLinks,
        viewClass: view.className,
        viewRect: rect(view),
        btnRadius: btn ? getComputedStyle(btn).borderRadius : null,
        btnRect: btn ? rect(btn) : null,
        sidebarVisible: visible(sidebar),
      };
    })()`);
  }

  /* ---------- mobile ---------- */
  await setViewport(390, 844, true);
  await send('Page.navigate', { url: BASE + '/#/dashboard' });
  await sleep(400);
  await loadReady();

  for (const view of ['dashboard', 'transactions', 'accounts', 'analytics', 'settings']) {
    await goView(view);
    await sleep(420); // let enter animations settle
    const m = await metrics();
    check(`${view}: no horizontal overflow`, !m.overflowX, `doc ${m.docScrollWidth} / viewport ${m.viewport.w}`);
    check(`${view}: topbar fits`, !m.topbarOverflow, `scroll ${m.topbar.scrollWidth}px`);
    check(`${view}: view-enter class applied`, m.viewClass.includes('view-enter'), m.viewClass);
    if (view === 'dashboard') {
      check('mobile: quick nav visible', m.quickVisible, m.quickDisplay);
      check('mobile: quick nav on the right', m.quick.right <= m.theme.right && m.quick.x > m.viewport.w / 2, `quick.right=${m.quick.right} theme.right=${m.theme.right}`);
      check('mobile: 5 bottom nav items', m.navLinks.length === 5, m.navLinks.map(l => l.label).join(', '));
      check('mobile: bottom nav is Home/Activity/Accounts/Stats/Settings',
        m.navLinks.map(l => l.nav).join(',') === 'dashboard,transactions,accounts,analytics,settings',
        m.navLinks.map(l => l.label).join(', '));
      check('mobile: dashboard nav active', m.navLinks.some(l => l.nav === 'dashboard' && l.active), '');
      check('mobile: pill buttons', m.btnRadius === '999px', m.btnRadius);
      check('mobile: sidebar hidden', !m.sidebarVisible, '');
    }
    if (view === 'accounts') {
      const acc = m.quickLinks.find(l => l.nav === 'accounts');
      const set = m.quickLinks.find(l => l.nav === 'settings');
      check('accounts: accounts shortcut hidden', !acc.visible, '');
      check('accounts: settings shortcut visible', set.visible, '');
      check('accounts: accounts bottom tab active', m.navLinks.some(l => l.nav === 'accounts' && l.active), '');
      check('accounts: accounts view active state', await evaluate(`document.body.dataset.view === 'accounts'`), '');
    }
    if (view === 'settings') {
      const set = m.quickLinks.find(l => l.nav === 'settings');
      check('settings: settings shortcut hidden', !set.visible, '');
    }
  }

  /* ---------- modal animation ---------- */
  await goView('dashboard');
  await evaluate(`openTxModal()`);
  await sleep(350);
  const modalOpen = await evaluate(`(() => {
    const o = document.querySelector('.modal-overlay');
    return o ? { present: true, closing: o.classList.contains('closing'), modal: !!o.querySelector('.modal') } : { present: false };
  })()`);
  check('modal: opens', modalOpen.present && modalOpen.modal, JSON.stringify(modalOpen));

  await evaluate(`document.querySelector('.modal-overlay [data-close]').click()`);
  const midClose = await evaluate(`(() => { const o = document.querySelector('.modal-overlay'); return o ? { present: true, closing: o.classList.contains('closing') } : { present: false }; })()`);
  check('modal: animates out before removal', midClose.present && midClose.closing, JSON.stringify(midClose));
  await sleep(260);
  const afterClose = await evaluate(`!document.querySelector('.modal-overlay') && document.body.style.overflow === ''`);
  check('modal: removed after animation', afterClose, '');

  /* ---------- liquid bottom nav ---------- */
  await goView('dashboard');
  await sleep(700);
  const liquidState = () => evaluate(`(() => {
    const nav = document.querySelector('#bottomnav');
    const liquid = nav.querySelector('.nav-liquid');
    const active = nav.querySelector('a.active');
    const nr = nav.getBoundingClientRect();
    const ar = active.getBoundingClientRect();
    const blob = liquid.querySelector('.nav-blob.main');
    const trail = liquid.querySelector('.nav-blob.trail');
    const icon = active.querySelector('svg');
    const label = active.querySelector('span:not(.nav-ripple)');
    const br = blob.getBoundingClientRect();
    const tr = trail.getBoundingClientRect();
    const ir = icon.getBoundingClientRect();
    const lr = label.getBoundingClientRect();
    const s = getComputedStyle(blob);
    const inside = r => r.top >= br.top - 0.5 && r.bottom <= br.bottom + 0.5 && r.left >= br.left - 0.5 && r.right <= br.right + 0.5;
    const parse = c => {
      const nums = c.match(/[\\d.]+/g) || [];
      if (!nums.length) return [0, 0, 0];
      const rgb = nums.slice(0, 3).map(Number);
      return c.startsWith('color(srgb') ? rgb.map(v => v * 255) : rgb;
    };
    const lum = rgb => {
      const a = rgb.map(v => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
      return 0.2126 * a[0] + 0.7152 * a[1] + 0.0722 * a[2];
    };
    const activeColor = getComputedStyle(active).color;
    const pillBg = getComputedStyle(blob).backgroundColor;
    const lf = lum(parse(activeColor));
    const lb = lum(parse(pillBg));
    return {
      ready: nav.classList.contains('liquid-ready'),
      opacity: getComputedStyle(liquid).opacity,
      center: ar.left - nr.left + ar.width / 2,
      blobCenter: br.left + br.width / 2,
      tabW: ar.width,
      pillW: br.width,
      pillH: br.height,
      trailW: tr.width,
      trailH: tr.height,
      wrapsIcon: inside(ir),
      wrapsLabel: inside(lr),
      activeColor,
      pillBg,
      contrast: (Math.max(lf, lb) + 0.05) / (Math.min(lf, lb) + 0.05),
      label: label.textContent,
      duration: s.transitionDuration,
      easing: s.transitionTimingFunction,
    };
  })()`);

  const l1 = await liquidState();
  check('liquid: ready and visible', l1.ready && parseFloat(l1.opacity) > 0.9, JSON.stringify(l1));
  check('liquid: centered under active tab', Math.abs(l1.blobCenter - l1.center) < 1.5, `blob ${l1.blobCenter.toFixed(1)} / tab ${l1.center.toFixed(1)}`);
  check('liquid: capsule spans the tab width', Math.abs(l1.pillW - (l1.tabW - 10)) < 1, `pill ${l1.pillW} / tab ${l1.tabW}`);
  check('liquid: capsule wraps icon + label', l1.wrapsIcon && l1.wrapsLabel, `icon ${l1.wrapsIcon}, label ${l1.wrapsLabel}`);
  check('liquid: glow matches capsule', l1.trailW === l1.pillW && l1.trailH === l1.pillH, `trail ${l1.trailW}x${l1.trailH} vs pill ${l1.pillW}x${l1.pillH}`);
  check('liquid: capsule is visibly tinted', l1.pillBg !== 'rgba(0, 0, 0, 0)' && l1.pillBg !== 'transparent', l1.pillBg);
  check('liquid: active label contrast >= 4.5', l1.contrast >= 4.5, `${Number(l1.contrast).toFixed(2)} (${l1.activeColor} on ${l1.pillBg})`);
  check('liquid: springy transition', parseFloat(l1.duration) >= 0.4 && l1.easing.includes('cubic-bezier'), `${l1.duration} ${l1.easing}`);

  for (const theme of ['light', 'dark']) {
    await evaluate(`document.documentElement.dataset.theme = '${theme}'`);
    await sleep(350);
    const c = await liquidState();
    check(`${theme} theme: liquid label contrast >= 4.5`, c.contrast >= 4.5, `${Number(c.contrast).toFixed(2)} (${c.activeColor} on ${c.pillBg})`);
  }

  await goView('accounts');
  await sleep(800);
  const l2 = await liquidState();
  check('liquid: flows to the new tab', Math.abs(l2.blobCenter - l2.center) < 1.5 && Math.abs(l2.center - l1.center) > 20, `blob ${l2.blobCenter.toFixed(1)} / tab ${l2.center.toFixed(1)}, moved ${(l2.center - l1.center).toFixed(1)}px`);

  await evaluate(`location.hash = '#/budgets'`);
  await sleep(700);
  const fallback = await evaluate(`({
    hash: location.hash,
    view: document.body.dataset.view,
    active: (document.querySelector('#bottomnav a.active') || {}).dataset?.nav,
    hasBudgetLink: !!document.querySelector('[data-nav="budgets"], [data-nav="recurring"]')
  })`);
  check('removed budget/recurring routes fall back to dashboard',
    fallback.hash === '#/dashboard' && fallback.view === 'dashboard' && fallback.active === 'dashboard' && !fallback.hasBudgetLink,
    JSON.stringify(fallback));

  await goView('dashboard');
  await sleep(500);
  const ripple = await evaluate(`(() => {
    const link = document.querySelector('#bottomnav a[data-nav="dashboard"]');
    const r = link.getBoundingClientRect();
    link.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, pointerType: 'touch' }));
    const el = link.querySelector('.nav-ripple');
    return el ? { present: true, left: el.style.left, top: el.style.top, animation: getComputedStyle(el).animationName } : { present: false };
  })()`);
  check('liquid: tap ripple appears', ripple.present && ripple.animation === 'navRipple', JSON.stringify(ripple));

  const smooth = await evaluate(`({
    behavior: getComputedStyle(document.documentElement).scrollBehavior,
    padding: getComputedStyle(document.documentElement).scrollPaddingTop,
    modal: getComputedStyle(document.querySelector('#view')).scrollBehavior
  })`);
  check('smooth scroll: page enabled', smooth.behavior === 'smooth', smooth.behavior);
  check('smooth scroll: sticky-header offset', smooth.padding === '76px', smooth.padding);

  /* ---------- desktop ---------- */
  await setViewport(1280, 900, false);
  await goView('dashboard');
  await sleep(420);
  const d = await metrics();
  check('desktop: sidebar visible', d.sidebarVisible, '');
  check('desktop: bottom nav hidden', !d.navVisible, '');
  check('desktop: quick nav hidden', !d.quickVisible, d.quickDisplay);
  check('desktop: no horizontal overflow', !d.overflowX, `doc ${d.docScrollWidth} / viewport ${d.viewport.w}`);
  check('desktop: pill buttons', d.btnRadius === '999px', d.btnRadius);

  /* ---------- narrow phones ---------- */
  for (const width of [360, 320]) {
    await setViewport(width, 740, true);
    for (const view of ['dashboard', 'accounts', 'transactions', 'analytics', 'settings']) {
      await goView(view);
      await sleep(700);
      const m = await metrics();
      check(`${width}px ${view}: no horizontal overflow`, !m.overflowX, `doc ${m.docScrollWidth}/${m.viewport.w}`);
      check(`${width}px ${view}: topbar fits`, !m.topbarOverflow, '');
      check(`${width}px ${view}: quick nav visible`, m.quickVisible, '');
      const lq = await liquidState();
      check(`${width}px ${view}: capsule wraps content`, lq.wrapsIcon && lq.wrapsLabel, `pill ${lq.pillW} / tab ${lq.tabW}`);
    }
  }

  /* ---------- reduced motion ---------- */
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  const rm = await evaluate(`(() => {
    const el = document.querySelector('#view > *');
    const s = getComputedStyle(el);
    return { duration: s.animationDuration, delay: s.animationDelay, scroll: getComputedStyle(document.documentElement).scrollBehavior };
  })()`);
  check('reduced motion: animations disabled', parseFloat(rm.duration) <= 0.001, JSON.stringify(rm));
  check('reduced motion: delays zeroed', rm.delay === '0s', rm.delay);
  check('reduced motion: smooth scroll off', rm.scroll === 'auto', rm.scroll);


  const failed = report(results);
  await browser.close();
  process.exit(failed ? 1 : 0);
})().catch(err => {
  console.error('ERROR', err);
  process.exit(2);
});
