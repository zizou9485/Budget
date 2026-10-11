/* Interface du budget. Tout est stocké dans le navigateur (localStorage), rien n'est envoyé ailleurs. */
(function () {
  'use strict';
  const C = window.Core;
  const KEY = 'budget:v1', THEME_KEY = 'budget:theme';
  let state = load();
  const today = () => C.todayISO();
  const ui = { tab: 'accueil', month: today().slice(0, 7), opsMonth: today().slice(0, 7), opsFilter: 'all' };

  /* ---------- stockage ---------- */
  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) return C.normalizeState(JSON.parse(raw));
    } catch (e) { console.error(e); }
    return C.defaultState();
  }
  let warned = false;
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(state)); }
    catch (e) {
      if (!warned) { warned = true; toast('Impossible d’enregistrer sur cet appareil. Fais une sauvegarde dès que possible.'); }
    }
  }
  function commit() { save(); render(); }

  /* ---------- formats ---------- */
  const mk = (o) => new Intl.NumberFormat('fr-FR', Object.assign({ style: 'currency', currency: 'EUR' }, o));
  const nf2 = mk(), nf0 = mk({ maximumFractionDigits: 0 }), nfS = mk({ signDisplay: 'exceptZero' });
  const clean = (n) => { n = +n || 0; return Math.abs(n) < 0.005 ? 0 : n; };
  const eur = (n) => nf2.format(clean(n));
  const eur0 = (n) => nf0.format(Math.round(clean(n)));
  const eurS = (n) => nfS.format(clean(n));
  const utc = (iso) => { const p = iso.split('-').map(Number); return new Date(Date.UTC(p[0], p[1] - 1, p[2] || 1)); };
  const F = (o) => new Intl.DateTimeFormat('fr-FR', Object.assign({ timeZone: 'UTC' }, o));
  const fMonth = F({ month: 'long', year: 'numeric' }), fMonthName = F({ month: 'long' }), fMonthShort = F({ month: 'short', year: 'numeric' });
  const fDay = F({ weekday: 'long', day: 'numeric', month: 'long' }), fDayShort = F({ day: 'numeric', month: 'short' });
  const fMonthOnly = F({ month: 'short' });
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  const monthLabel = (M) => cap(fMonth.format(utc(M + '-01')));
  const dayShort = (iso) => fDayShort.format(utc(iso));
  const cl = (...a) => a.filter(Boolean).join(' ');

  /* ---------- DOM ---------- */
  function append(el, c) {
    if (c === null || c === undefined || c === false) return;
    if (Array.isArray(c)) c.forEach((x) => append(el, x));
    else el.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  function h(tag, props) {
    const el = document.createElement(tag);
    props = props || {};
    let val;
    Object.keys(props).forEach((k) => {
      const v = props[k];
      if (v === null || v === undefined || v === false) return;
      if (k === 'class') el.className = v;
      else if (k.slice(0, 2) === 'on') el.addEventListener(k.slice(2), v);
      else if (k === 'value') val = v;
      else if (k === 'checked') el.checked = true;
      else el.setAttribute(k, v === true ? '' : v);
    });
    for (let i = 2; i < arguments.length; i++) append(el, arguments[i]);
    if (val !== undefined) el.value = val;
    return el;
  }
  const NS = 'http://www.w3.org/2000/svg';
  function sv(tag, attrs) {
    const el = document.createElementNS(NS, tag);
    Object.keys(attrs || {}).forEach((k) => el.setAttribute(k, attrs[k]));
    for (let i = 2; i < arguments.length; i++) append(el, arguments[i]);
    return el;
  }
  function icon(d) {
    return sv('svg', { viewBox: '0 0 24 24', width: 22, height: 22, fill: 'none', stroke: 'currentColor', 'stroke-width': 1.8, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' }, sv('path', { d: d }));
  }
  let toastTimer;
  function toast(msg) {
    const t = document.getElementById('toast');
    t.textContent = msg; t.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 3600);
  }

  /* ---------- feuilles (fenêtres du bas) ---------- */
  function openSheet(title, build) {
    const back = h('div', { class: 'sheet-back' });
    const sheet = h('section', { class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': title });
    const close = () => { back.remove(); document.removeEventListener('keydown', onKey); if (!document.querySelector('.sheet-back')) document.body.classList.remove('noscroll'); };
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    sheet.append(h('header', { class: 'sheet-h' }, h('h2', {}, title), h('button', { class: 'icon-btn', 'aria-label': 'Fermer', onclick: close }, '×')));
    sheet.append(build(close));
    back.addEventListener('click', (e) => { if (e.target === back) close(); });
    document.addEventListener('keydown', onKey);
    back.append(sheet); document.body.append(back); document.body.classList.add('noscroll');
    return close;
  }
  function message(title, text) {
    openSheet(title, (close) => h('div', { class: 'sheet-b' }, h('p', {}, text), h('div', { class: 'actions' }, h('button', { class: 'btn', onclick: close }, 'Compris'))));
  }

  /* ---------- champs de formulaire ---------- */
  function field(label, control, hint) {
    const lbl = h('span', { class: 'lbl' }, label);
    const el = h('label', { class: 'field' }, lbl, control, hint ? h('span', { class: 'hint' }, hint) : null);
    el.lbl = lbl; return el;
  }
  const textIn = (v, ph, extra) => h('input', Object.assign({ type: 'text', value: v || '', placeholder: ph || '', autocomplete: 'off' }, extra || {}));
  const numIn = (v, ph) => h('input', { type: 'text', inputmode: 'decimal', autocomplete: 'off', placeholder: ph || '0,00', value: v === null || v === undefined || v === '' ? '' : String(v).replace('.', ',') });
  const dateIn = (v) => h('input', { type: 'date', value: v || '' });
  const monthIn = (v) => h('input', { type: 'month', value: v || '' });
  const num = (el) => C.parseNumber(el.value);
  function seg(options, value, onchange) {
    let cur = value;
    const wrap = h('div', { class: 'seg', role: 'radiogroup' });
    const btns = options.map((o) => h('button', { type: 'button', role: 'radio', 'aria-checked': String(o[0] === cur), class: o[0] === cur ? 'on' : '', onclick: () => set(o[0]) }, o[1]));
    function set(v) { cur = v; btns.forEach((b, i) => { const on = options[i][0] === v; b.className = on ? 'on' : ''; b.setAttribute('aria-checked', String(on)); }); if (onchange) onchange(v); }
    append(wrap, btns); wrap.get = () => cur; wrap.set = set; return wrap;
  }
  const accountOptions = (sel) => state.accounts.map((a) => h('option', { value: a.id, selected: a.id === sel }, a.name));

  /* ---------- barre d'onglets ---------- */
  const TABS = [
    { id: 'accueil', label: 'Accueil', d: 'M3 11l9-8 9 8v9a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z' },
    { id: 'budget', label: 'Budget', d: 'M3 6h18v12H3z M3 7l9 6 9-6' },
    { id: 'fixes', label: 'Fixes', d: 'M17 2l4 4-4 4 M3 11V9a3 3 0 0 1 3-3h15 M7 22l-4-4 4-4 M21 13v2a3 3 0 0 1-3 3H3' },
    { id: 'ops', label: 'Opérations', d: 'M8 6h13 M8 12h13 M8 18h13 M3 6h.01 M3 12h.01 M3 18h.01' },
    { id: 'reglages', label: 'Réglages', d: 'M4 21v-7 M4 10V3 M12 21v-9 M12 8V3 M20 21v-5 M20 12V3 M1 14h6 M9 8h6 M17 16h6' }
  ];
  function renderTabs() {
    const nav = document.getElementById('tabs'); nav.replaceChildren();
    TABS.forEach((t) => {
      const badge = t.id === 'ops' ? C.unclassifiedList(state).length : 0;
      nav.append(h('button', { class: cl('tab', ui.tab === t.id && 'on'), 'aria-current': ui.tab === t.id ? 'page' : null, onclick: () => go(t.id) },
        icon(t.d), h('span', {}, t.label), badge ? h('i', { class: 'badge', 'aria-label': badge + ' à classer' }, String(badge)) : null));
    });
  }
  function go(tab) { if (ui.tab !== tab) window.scrollTo(0, 0); ui.tab = tab; render(); }

  /* ---------- rendu général ---------- */
  function render() {
    const y = window.scrollY;
    renderTabs();
    const top = document.getElementById('top'), view = document.getElementById('view');
    top.replaceChildren(); view.replaceChildren();
    ({ accueil: viewHome, budget: viewBudget, fixes: viewFixes, ops: viewOps, reglages: viewSettings })[ui.tab](top, view);
    window.scrollTo(0, y);
  }
  const titleBar = (title, ...actions) => h('div', { class: 'titlebar' }, h('h1', {}, title), h('div', { class: 'tb-actions' }, actions));
  function monthSwitch(cur, onChange) {
    return h('div', { class: 'mswitch' },
      h('button', { class: 'icon-btn', 'aria-label': 'Mois précédent', onclick: () => onChange(C.addMonths(cur, -1)) }, '‹'),
      h('strong', {}, monthLabel(cur)),
      h('button', { class: 'icon-btn', 'aria-label': 'Mois suivant', onclick: () => onChange(C.addMonths(cur, 1)) }, '›'));
  }
  const envName = (id) => { const e = state.envelopes.find((x) => x.id === id); return e ? e.name : null; };

  /* ====================================================== ACCUEIL ====================================================== */
  function viewHome(top, view) {
    const t = today(), M = t.slice(0, 7);
    const sim = C.simulate(state, t, 6);
    const sum = C.monthSummary(state, M, t);
    const allow = C.dailyAllowance(state, t);
    const end = sim.monthEnds[M];
    const lastDay = C.dateIn(M, C.daysInMonth(M));

    top.append(titleBar(cap(fDay.format(utc(t)))));

    view.append(h('section', { class: 'hero' },
      h('p', { class: 'hero-label' }, 'Fin ' + fMonthName.format(utc(M + '-01'))),
      sim.known
        ? h('p', { class: cl('hero-fig', end < 0 && 'neg') }, eur0(end))
        : h('p', { class: 'hero-fig dim' }, '–'),
      sim.known
        ? h('p', { class: 'hero-sub' }, end >= 0
          ? 'sur ton compte le ' + dayShort(lastDay) + ', si tu restes dans tes enveloppes.'
          : 'Il manquerait ' + eur(-end) + ' pour finir le mois, enveloppes comprises.')
        : h('p', { class: 'hero-sub' }, 'Indique ton solde pour voir ce qu’il te restera.'),
      sim.known ? null : h('button', { class: 'btn', onclick: () => openBalance('courant') }, 'Indiquer mon solde')));

    const bal = C.totalBudgetBalance(state);
    view.append(h('div', { class: 'strip' },
      stat('Solde du jour', bal === null ? '–' : eur(bal), null),
      stat('Reste à répartir', eurS(sum.reste), sum.reste < 0 ? 'neg' : 'pos', 'ce mois'),
      stat('Par jour', eur(allow.perDay), null, 'enveloppes, ' + allow.daysLeft + ' j')));

    if (sim.firstNeg) {
      view.append(h('div', { class: 'alert', role: 'alert' },
        h('strong', {}, 'Zone rouge le ' + dayShort(sim.firstNeg.date)),
        h('span', {}, 'Ton compte descendrait à ' + eur(sim.min.balance) + ' le ' + dayShort(sim.min.date) + '. Réduis une enveloppe ou décale une dépense.'),
        h('button', { class: 'btn ghost', onclick: () => go('budget') }, 'Ajuster le budget')));
    }

    if (!state.settings.hideOnboarding) {
      const steps = [
        ['Indiquer ton solde actuel', bal !== null, () => openBalance('courant')],
        ['Ajouter ton salaire', state.recurring.some((r) => r.kind === 'income'), () => openRecurring(null, 'income')],
        ['Ajouter tes abonnements et charges fixes', state.recurring.some((r) => r.kind === 'expense' && !r.schedule), () => openRecurring(null, 'expense')],
        ['Créer tes enveloppes (manger, sorties…)', state.envelopes.length > 0, () => { go('budget'); }]
      ];
      if (steps.some((s) => !s[1])) {
        view.append(h('section', { class: 'block' },
          h('div', { class: 'block-h' }, h('h2', {}, 'Pour démarrer'), h('button', { class: 'link', onclick: () => { state.settings.hideOnboarding = true; commit(); } }, 'Masquer')),
          h('ul', { class: 'todo' }, steps.map((s) => h('li', { class: s[1] ? 'done' : '' }, h('button', { onclick: s[2] }, h('span', { class: 'tick', 'aria-hidden': 'true' }, s[1] ? '✓' : ''), s[0]))))));
      }
    }

    view.append(h('section', { class: 'block' },
      h('div', { class: 'block-h' }, h('h2', {}, 'Les 6 prochains mois')),
      sim.known ? chart(sim) : h('p', { class: 'muted' }, 'La projection apparaît dès que ton solde est renseigné.'),
      h('ul', { class: 'ends' }, Object.keys(sim.monthEnds).map((m) => h('li', {}, h('span', {}, monthLabel(m)), h('b', { class: sim.monthEnds[m] < 0 ? 'neg' : '' }, eur0(sim.monthEnds[m])))))));

    const limit = C.addDays(t, 30);
    const soon = sim.pending.filter((o) => o.date <= limit).slice(0, 10);
    if (sim.toConfirm.length) {
      view.append(h('section', { class: 'block' },
        h('div', { class: 'block-h' }, h('h2', {}, 'À confirmer'), h('span', { class: 'muted small' }, 'prévu, pas encore vu passer')),
        h('ul', { class: 'rows' }, sim.toConfirm.map((o) => occRow(o, true)))));
    }
    view.append(h('section', { class: 'block' },
      h('div', { class: 'block-h' }, h('h2', {}, 'À venir, 30 jours')),
      soon.length ? h('ul', { class: 'rows' }, soon.map((o) => occRow(o, false))) : h('p', { class: 'muted' }, 'Rien de prévu. Ajoute tes charges dans l’onglet Fixes.')));
  }
  function stat(label, value, tone, sub) {
    return h('div', { class: 'stat' }, h('span', { class: 'stat-l' }, label), h('b', { class: cl('stat-v', tone) }, value), sub ? h('span', { class: 'stat-s' }, sub) : null);
  }
  function occRow(o, late) {
    const sign = o.kind === 'income' ? '+' : '−';
    return h('li', {}, h('button', { class: 'row', onclick: () => openOccurrence(o.key) },
      h('span', { class: 'row-main' }, h('span', { class: 'row-t' }, o.name), h('span', { class: 'row-s' }, (late ? 'prévu le ' : '') + dayShort(o.date) + (o.group ? ' · ' + o.group : ''))),
      h('span', { class: cl('amt', o.kind === 'income' && 'pos') }, sign + eur(o.amount).replace('-', ''))));
  }

  function chart(sim) {
    const W = 340, H = 150, pl = 6, pr = 6, pt = 12, pb = 20;
    const pts = sim.days, vals = pts.map((p) => p.balance);
    let lo = Math.min(0, ...vals), hi = Math.max(0, ...vals);
    if (hi - lo < 1) hi = lo + 1;
    const padv = (hi - lo) * 0.1; lo -= padv; hi += padv;
    const x = (i) => pl + (W - pl - pr) * i / Math.max(1, pts.length - 1);
    const y = (v) => pt + (H - pt - pb) * (1 - (v - lo) / (hi - lo));
    const line = pts.map((p, i) => (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(p.balance).toFixed(1)).join(' ');
    const area = line + ' L' + x(pts.length - 1).toFixed(1) + ' ' + y(0).toFixed(1) + ' L' + x(0).toFixed(1) + ' ' + y(0).toFixed(1) + ' Z';
    const y0 = y(0);
    const svg = sv('svg', { viewBox: '0 0 ' + W + ' ' + H, class: 'chart', role: 'img', 'aria-label': 'Solde projeté sur 6 mois' },
      sv('defs', {},
        sv('clipPath', { id: 'cp-up' }, sv('rect', { x: 0, y: 0, width: W, height: y0 })),
        sv('clipPath', { id: 'cp-dn' }, sv('rect', { x: 0, y: y0, width: W, height: H - y0 }))),
      sv('path', { d: area, class: 'ch-up', 'clip-path': 'url(#cp-up)' }),
      sv('path', { d: area, class: 'ch-dn', 'clip-path': 'url(#cp-dn)' }),
      sv('line', { x1: pl, x2: W - pr, y1: y0, y2: y0, class: 'ch-zero' }),
      sv('path', { d: line, class: 'ch-line' }));
    pts.forEach((p, i) => {
      if (p.date.slice(8) !== '01' && i !== 0) return;
      const label = sv('text', { x: x(i) + 3, y: H - 6, class: 'ch-t' }); label.textContent = fMonthOnly.format(utc(p.date));
      svg.append(sv('line', { x1: x(i), x2: x(i), y1: pt, y2: H - pb + 3, class: 'ch-tick' }), label);
    });
    if (sim.min.balance < 0) {
      const i = pts.findIndex((p) => p.date === sim.min.date);
      svg.append(sv('circle', { cx: x(i), cy: y(sim.min.balance), r: 3.5, class: 'ch-dot' }));
    }
    return svg;
  }

  /* ====================================================== BUDGET ====================================================== */
  function viewBudget(top, view) {
    const t = today(), M = ui.month;
    const s = C.monthSummary(state, M, t);
    top.append(titleBar('Budget', h('button', { class: 'btn small', onclick: () => openEnvelope(null) }, 'Enveloppe')));
    view.append(monthSwitch(M, (m) => { ui.month = m; render(); }));

    const line = (label, value, cls, sub) => h('li', { class: cls }, h('span', {}, label, sub ? h('small', {}, sub) : null), h('b', {}, value));
    view.append(h('section', { class: 'ledger' },
      h('ul', {},
        line('Revenus', eurS(s.income), 'pos', s.incomes.length ? s.incomes.length + (s.incomes.length > 1 ? ' versements' : ' versement') : 'aucun prévu'),
        line('Charges fixes', eurS(-s.fixedTotal), '', s.fixed.length + ' prévues'),
        line('Enveloppes', eurS(-s.varBudget), '', 'plafonds (ou dépensé si dépassé)'),
        line('Épargne', eurS(-s.goalBudget), '', 'objectifs'),
        s.unclassifiedSpend > 0 ? line('Non classé', eurS(-s.unclassifiedSpend), 'neg', 'dépenses à ranger') : null),
      h('div', { class: cl('ledger-total', s.reste < 0 ? 'neg' : 'pos') }, h('span', {}, 'Reste à répartir'), h('b', {}, eurS(s.reste))),
      s.reste < 0 ? h('p', { class: 'warn-line' }, 'Tu as prévu ' + eur(-s.reste) + ' de plus que ce qui rentre ce mois-ci.') : null));

    if (!s.rows.length) {
      view.append(h('section', { class: 'empty' },
        h('p', {}, 'Une enveloppe, c’est un plafond pour une catégorie : manger, sortir, bouger… Tu fixes le montant, l’appli te dit ce qu’il reste.'),
        h('button', { class: 'btn', onclick: addPresets }, 'Ajouter les enveloppes classiques'),
        h('button', { class: 'btn ghost', onclick: () => openEnvelope(null) }, 'Créer la mienne')));
      return;
    }
    view.append(h('ul', { class: 'envs' }, s.rows.map((r) => envRow(r, s))));
  }
  function addPresets() {
    ['Manger', 'Sorties', 'Transport', 'Shopping', 'Divers'].forEach((n) => state.envelopes.push({ id: C.uid(), name: n, type: 'variable', budget: 0, overrides: {} }));
    commit(); toast('Enveloppes ajoutées. Touche-en une pour fixer son plafond.');
  }
  function envRow(r, s) {
    const env = r.env, goal = env.type === 'goal';
    const pct = r.budget > 0 ? Math.min(100, (r.spent / r.budget) * 100) : (r.spent > 0 ? 100 : 0);
    const isNow = ui.month === today().slice(0, 7);
    const right = goal ? eur(r.spent) + ' / ' + eur(r.budget)
      : (r.remaining >= 0 ? eur(r.remaining) + ' restants' : eur(-r.remaining) + ' en trop');
    let sub;
    if (goal) {
      const g = env.goal || {};
      sub = g.target ? 'Objectif ' + eur(g.target) + (g.by ? ' avant ' + monthLabel(g.by).toLowerCase() : '') + ' · de côté : ' + eur(C.goalSaved(state, env)) : 'Définis le montant à atteindre';
    } else sub = eur(r.spent) + ' dépensés sur ' + eur(r.budget);
    return h('li', {}, h('button', { class: 'env', onclick: () => openEnvelope(env) },
      h('span', { class: 'env-top' }, h('span', { class: 'env-n' }, env.name), h('span', { class: cl('env-r', r.status) }, right)),
      h('span', { class: cl('gauge', r.status, goal && 'goal') }, h('i', { style: 'width:' + pct.toFixed(1) + '%' }), (!goal && isNow && r.budget > 0) ? h('b', { style: 'left:' + (s.pace * 100).toFixed(1) + '%', title: 'Où tu en serais en dépensant régulièrement' }) : null),
      h('span', { class: 'env-s' }, sub)));
  }

  function openEnvelope(env) {
    const isNew = !env;
    const e = env ? JSON.parse(JSON.stringify(env)) : { id: C.uid(), name: '', type: 'variable', budget: null, overrides: {}, goal: null };
    const M = ui.month;
    openSheet(isNew ? 'Nouvelle enveloppe' : e.name, (close) => {
      const name = textIn(e.name, 'Manger, Sorties, Permis…');
      const type = seg([['variable', 'Dépenses'], ['goal', 'Épargne, objectif']], e.type, () => sync());
      const budget = numIn(e.budget === null ? '' : e.budget, 'Automatique');
      const month = numIn(e.overrides && e.overrides[M] !== undefined && e.overrides[M] !== null ? e.overrides[M] : '', 'Comme d’habitude');
      const target = numIn(e.goal ? e.goal.target : '', '1200');
      const by = monthIn(e.goal ? e.goal.by : C.addMonths(M, 8));
      const saved = numIn(e.goal ? e.goal.saved : 0, '0');
      const fBudget = field('', budget), fMonth = field('', month), fTarget = field('Montant à atteindre', target), fBy = field('Pour le mois de', by), fSaved = field('Déjà de côté', saved, 'Le reste se calcule à partir de là, plus les virements que tu classes dans cette enveloppe.');
      const rate = h('p', { class: 'calc' });
      function temp() {
        return { id: e.id, name: name.value, type: type.get(), budget: isNaN(num(budget)) ? (type.get() === 'goal' ? null : 0) : num(budget), overrides: {}, goal: { target: num(target) || 0, by: by.value, saved: num(saved) || 0 } };
      }
      function sync() {
        const g = type.get() === 'goal';
        fTarget.hidden = fBy.hidden = fSaved.hidden = !g; rate.hidden = !g;
        fBudget.lbl.textContent = g ? 'Versement par mois' : 'Plafond par mois';
        fMonth.lbl.textContent = (g ? 'Versement de ' : 'Plafond de ') + monthLabel(M).toLowerCase() + ' seulement';
        budget.placeholder = g ? 'Automatique' : '0,00';
        if (g) {
          const te = temp(); te.budget = null;
          const v = C.envBudget(state, te, M);
          rate.textContent = te.goal.target && te.goal.by ? 'À ce rythme : ' + eur(v) + ' par mois pour y arriver à temps.' : '';
        }
      }
      [target, by, saved, budget].forEach((i) => i.addEventListener('input', sync));
      sync();
      const body = h('div', { class: 'sheet-b' }, field('Nom', name), field('Type', type), fTarget, fBy, fSaved, rate, fBudget, fMonth,
        h('div', { class: 'actions' },
          h('button', { class: 'btn', onclick: () => {
            const te = temp();
            if (!te.name.trim()) return toast('Donne un nom à l’enveloppe.');
            if (te.type === 'goal') {
              if (!(te.goal.target > 0) || !te.goal.by) return toast('Indique le montant à atteindre et le mois visé.');
            } else { te.goal = null; if (te.budget < 0) return toast('Le plafond ne peut pas être négatif.'); }
            const out = Object.assign({}, e, { name: te.name.trim(), type: te.type, budget: te.budget, goal: te.goal });
            out.overrides = Object.assign({}, e.overrides || {});
            const mv = num(month);
            if (isNaN(mv)) delete out.overrides[M]; else out.overrides[M] = mv;
            const i = state.envelopes.findIndex((x) => x.id === e.id);
            if (i >= 0) state.envelopes[i] = out; else state.envelopes.push(out);
            commit(); close();
          } }, 'Enregistrer'),
          isNew ? null : h('button', { class: 'btn danger ghost', onclick: () => {
            if (confirm('Supprimer l’enveloppe « ' + e.name + ' » ? Les opérations qui y étaient rangées redeviennent à classer.')) { C.deleteEnvelope(state, e.id); commit(); close(); }
          } }, 'Supprimer')));
      return body;
    });
  }

  /* ====================================================== FIXES ====================================================== */
  function cadence(it) {
    const d = it.day || +it.start.slice(8, 10);
    if (it.schedule) return 'Chaque mois le ' + d + ', jusqu’en ' + fMonthShort.format(utc(it.schedule[it.schedule.length - 1].date.slice(0, 7) + '-01'));
    const e = it.every || 1;
    if (e === 1) return 'Chaque mois le ' + d;
    if (e === 3) return 'Chaque trimestre le ' + d;
    if (e === 6) return 'Chaque semestre le ' + d;
    if (e === 12) return 'Chaque année le ' + d + ' ' + fMonthOnly.format(utc(it.start));
    return 'Tous les ' + e + ' mois le ' + d;
  }
  function viewFixes(top, view) {
    const t = today();
    top.append(titleBar('Revenus et charges fixes', h('button', { class: 'btn small', onclick: () => openRecurring(null) }, 'Ajouter')));
    if (!state.recurring.length) {
      view.append(h('section', { class: 'empty' }, h('p', {}, 'Salaire, loyer, abonnements, assurance, prêt : tout ce qui revient à date fixe, chaque mois, chaque trimestre ou chaque année.'),
        h('button', { class: 'btn', onclick: () => openRecurring(null, 'income') }, 'Ajouter mon salaire'),
        h('button', { class: 'btn ghost', onclick: () => openRecurring(null, 'expense') }, 'Ajouter une charge')));
      return;
    }
    const groups = [['Revenus', (r) => r.kind === 'income'], ['Prêts', (r) => r.kind === 'expense' && !!r.schedule], ['Charges fixes', (r) => r.kind === 'expense' && !r.schedule]];
    groups.forEach((g) => {
      const items = state.recurring.filter(g[1]);
      if (!items.length) return;
      const total = C.sum(items.map((it) => { const n = C.nextOccurrence(state, it, t); return n && (it.every || 1) === 1 ? n.amount : 0; }));
      view.append(h('section', { class: 'block' },
        h('div', { class: 'block-h' }, h('h2', {}, g[0]), h('span', { class: 'muted small' }, 'environ ' + eur0(total) + ' par mois')),
        h('ul', { class: 'rows' }, items.map((it) => {
          const n = C.nextOccurrence(state, it, t);
          let sub = cadence(it);
          if (n) sub += ' · prochaine : ' + dayShort(n.date);
          else sub += ' · terminé';
          if (it.schedule) { const ls = C.loanStats(it, t); sub = 'Reste ' + eur0(ls.remaining) + ' à rembourser · ' + ls.count + ' échéances · fin ' + fMonthShort.format(utc(ls.end.slice(0, 7) + '-01')); }
          return h('li', {}, h('button', { class: 'row', onclick: () => openRecurring(it) },
            h('span', { class: 'row-main' }, h('span', { class: 'row-t' }, it.name), h('span', { class: 'row-s' }, sub)),
            h('span', { class: cl('amt', it.kind === 'income' && 'pos') }, n ? eur(n.amount) : '–')));
        }))));
    });
  }

  function openRecurring(item, kindHint) {
    const isNew = !item;
    const t = today();
    const it = item ? JSON.parse(JSON.stringify(item)) : {
      id: C.uid(), kind: kindHint || 'expense', name: '', group: '', accountId: 'courant', every: 1, start: t, end: null, match: '',
      steps: [{ from: t.slice(0, 7), amount: 0 }], overrides: {}
    };
    const loan = !!it.schedule;
    openSheet(isNew ? 'Nouvelle ligne fixe' : it.name, (close) => {
      const kind = seg([['expense', 'Dépense'], ['income', 'Revenu']], it.kind, () => { fMatch.lbl.textContent = labelMatchText(); });
      const name = textIn(it.name, 'Spotify, Loyer, Salaire…');
      const group = textIn(it.group, 'Abonnements, Logement…', { list: 'groups' });
      const dl = h('datalist', { id: 'groups' }, ['Abonnements', 'Logement', 'Assurance', 'Transport', 'Prêt', 'Salaire', 'Santé', 'Autre'].map((g) => h('option', { value: g })));
      const every = h('select', {}, [[1, 'Chaque mois'], [2, 'Tous les 2 mois'], [3, 'Chaque trimestre'], [4, 'Tous les 4 mois'], [6, 'Chaque semestre'], [12, 'Chaque année']].map((o) => h('option', { value: o[0], selected: (it.every || 1) === o[0] }, o[1])));
      const start = dateIn(it.start), end = dateIn(it.end || '');
      const match = textIn(it.match, 'ex. SPOTIFY');
      const labelMatchText = () => 'Mot du relevé bancaire (facultatif)';
      const fMatch = field(labelMatchText(), match, 'Sert à reconnaître automatiquement le prélèvement ou le virement quand tu importes un CSV.');

      const steps = it.steps.map((s) => ({ from: s.from, amount: s.amount }));
      const stepsBox = h('div', { class: 'steps' });
      function drawSteps() {
        stepsBox.replaceChildren();
        steps.forEach((s, i) => {
          const a = numIn(s.amount === 0 && isNew ? '' : s.amount);
          a.addEventListener('input', () => { s.amount = num(a); });
          if (i === 0) stepsBox.append(field('Montant', a));
          else {
            const m = monthIn(s.from); m.addEventListener('input', () => { s.from = m.value; });
            stepsBox.append(h('div', { class: 'step' }, field('À partir de', m), field('Nouveau montant', a), h('button', { class: 'icon-btn', 'aria-label': 'Retirer ce changement', onclick: () => { steps.splice(i, 1); drawSteps(); } }, '×')));
          }
        });
        stepsBox.append(h('button', { class: 'link', type: 'button', onclick: () => { steps.push({ from: C.addMonths(t.slice(0, 7), 12), amount: steps[steps.length - 1].amount || 0 }); drawSteps(); } }, 'Ajouter un changement de montant (augmentation, nouveau tarif…)'));
      }
      drawSteps();

      const overrides = Object.assign({}, it.overrides || {});
      const grid = h('div', { class: 'grid' });
      function draft() {
        const d = Object.assign({}, it, { start: start.value || t, every: +every.value, steps: steps.filter((s) => !isNaN(s.amount)).map((s) => ({ from: s.from || it.start.slice(0, 7), amount: s.amount })), overrides: {} });
        if (!d.steps.length) d.steps = [{ from: d.start.slice(0, 7), amount: 0 }];
        d.steps[0].from = d.start.slice(0, 7);
        return d;
      }
      function drawGrid() {
        grid.replaceChildren();
        const d = draft(); let n = 0;
        for (let k = 0; k < 30 && n < 24; k++) {
          const M = C.addMonths(t.slice(0, 7), k);
          const o = C.itemOccurrences(d, M, { raw: true })[0];
          if (!o) continue;
          n++;
          const inp = numIn(typeof overrides[M] === 'number' ? overrides[M] : '', eur(o.amount).replace(/\u00a0€/, ''));
          const skip = h('input', { type: 'checkbox', checked: overrides[M] === null, 'aria-label': 'Sauter ' + monthLabel(M) });
          inp.addEventListener('input', () => { const v = num(inp); if (isNaN(v)) delete overrides[M]; else overrides[M] = v; skip.checked = false; });
          skip.addEventListener('change', () => { if (skip.checked) { overrides[M] = null; inp.value = ''; } else delete overrides[M]; });
          grid.append(h('div', { class: 'g-row' }, h('span', {}, monthLabel(M), h('small', {}, ' · le ' + (+o.date.slice(8)))), inp, h('label', { class: 'chk' }, skip, 'Sauter')));
        }
        if (!n) grid.append(h('p', { class: 'muted' }, 'Aucune échéance à venir pour ces réglages.'));
      }
      const details = h('details', { class: 'adv' }, h('summary', {}, 'Ajuster mois par mois'),
        h('p', { class: 'hint' }, 'Pour un salaire qui varie ou un mois sans prélèvement : saisis le montant réel de ce mois, ou coche « Sauter ». Laisse vide pour garder le montant habituel.'), grid);
      details.addEventListener('toggle', () => { if (details.open) drawGrid(); });

      const body = h('div', { class: 'sheet-b' });
      if (loan) {
        const ls = C.loanStats(it, t);
        body.append(field('Nom', name), field('Catégorie', group, null), dl,
          h('p', { class: 'calc' }, 'Échéancier chargé : ' + it.schedule.length + ' mensualités de ' + dayShort(it.schedule[0].date) + ' ' + it.schedule[0].date.slice(0, 4) + ' à ' + dayShort(it.schedule[it.schedule.length - 1].date) + ' ' + it.schedule[it.schedule.length - 1].date.slice(0, 4) + '. Capital restant : ' + eur(ls.remaining) + '.'),
          fMatch, details);
      } else {
        body.append(field('Type', kind), field('Nom', name), field('Catégorie', group), dl, stepsBox, field('Fréquence', every),
          field('Première échéance, ou prochaine', start, 'Le jour du mois, et le mois pour les paiements trimestriels ou annuels, viennent de cette date.'),
          field('Date de fin (facultatif)', end), fMatch, details);
      }
      body.append(h('div', { class: 'actions' },
        h('button', { class: 'btn', onclick: () => {
          if (!name.value.trim()) return toast('Donne un nom à cette ligne.');
          const out = Object.assign({}, it, { name: name.value.trim(), group: group.value.trim(), match: match.value.trim() });
          if (!loan) {
            const d = draft();
            if (!(d.steps[0].amount > 0)) return toast('Indique un montant supérieur à zéro.');
            if (!start.value) return toast('Indique la date de la première échéance.');
            out.kind = kind.get(); out.start = d.start; out.every = d.every; out.steps = d.steps; out.end = end.value || null; out.day = +d.start.slice(8, 10);
          }
          out.overrides = overrides;
          const i = state.recurring.findIndex((x) => x.id === it.id);
          if (i >= 0) state.recurring[i] = out; else state.recurring.push(out);
          commit(); close();
        } }, 'Enregistrer'),
        isNew ? null : h('button', { class: 'btn danger ghost', onclick: () => {
          if (confirm('Supprimer « ' + it.name + ' » ? Les opérations déjà passées restent dans tes relevés.')) { C.deleteRecurring(state, it.id); commit(); close(); }
        } }, 'Supprimer')));
      return body;
    });
  }

  function openOccurrence(key) {
    const M = key.split('@')[1];
    const occ = C.occurrencesForMonth(state, M).find((o) => o.key === key);
    if (!occ) return;
    const t = today(), inc = occ.kind === 'income';
    openSheet(occ.name, (close) => {
      const body = h('div', { class: 'sheet-b' });
      body.append(h('p', { class: 'calc' }, (inc ? 'Prévu le ' : 'Prévu le ') + dayShort(occ.due) + ' · ' + eur(occ.expected) + (occ.group ? ' · ' + occ.group : '')));
      if (occ.done) {
        body.append(h('p', {}, (inc ? 'Reçu le ' : 'Payé le ') + dayShort(occ.tx.date) + ' : ' + eur(Math.abs(occ.tx.amount)) + '.'),
          h('div', { class: 'actions' }, h('button', { class: 'btn ghost', onclick: () => { C.unmarkPaid(state, key); commit(); close(); } }, 'Annuler, ce n’est pas passé')));
        return body;
      }
      const amount = numIn(occ.expected), date = dateIn(occ.due <= t ? occ.due : t);
      body.append(field(inc ? 'Montant reçu' : 'Montant payé', amount, 'Change-le si le montant réel diffère du prévu.'), field('Date', date),
        h('div', { class: 'actions' },
          h('button', { class: 'btn', onclick: () => {
            const v = num(amount); if (!(v > 0) || !date.value) return toast('Indique un montant et une date.');
            C.markPaid(state, occ, v, date.value); commit(); close(); toast(inc ? 'Revenu enregistré.' : 'Paiement enregistré.');
          } }, inc ? 'Marquer comme reçu' : 'Marquer comme payé'),
          h('button', { class: 'btn ghost', onclick: () => {
            const v = num(amount); if (!(v >= 0)) return toast('Indique le montant de ce mois.');
            const i = state.recurring.find((r) => r.id === occ.item.id); i.overrides = i.overrides || {}; i.overrides[M] = v; commit(); close(); toast('Montant de ce mois mis à jour.');
          } }, 'Changer le montant de ce mois'),
          h('button', { class: 'btn ghost', onclick: () => {
            const i = state.recurring.find((r) => r.id === occ.item.id); i.overrides = i.overrides || {}; i.overrides[M] = null; commit(); close(); toast('Échéance sautée pour ce mois.');
          } }, 'Sauter ce mois'),
          h('button', { class: 'link', onclick: () => { close(); openRecurring(occ.item); } }, 'Modifier la ligne entière')));
      return body;
    });
  }

  /* ====================================================== OPÉRATIONS ====================================================== */
  function viewOps(top, view) {
    const M = ui.opsMonth;
    top.append(titleBar('Opérations',
      h('button', { class: 'btn ghost small', onclick: () => pickCSV(null) }, 'Importer'),
      h('button', { class: 'btn small', onclick: () => openTx(null) }, 'Ajouter')));
    view.append(monthSwitch(M, (m) => { ui.opsMonth = m; render(); }));
    const toSort = C.unclassifiedList(state);
    view.append(h('div', { class: 'chips' },
      h('button', { class: cl('chip', ui.opsFilter === 'all' && 'on'), onclick: () => { ui.opsFilter = 'all'; render(); } }, 'Toutes'),
      h('button', { class: cl('chip', ui.opsFilter === 'sort' && 'on'), onclick: () => { ui.opsFilter = 'sort'; render(); } }, 'À classer' + (toSort.length ? ' (' + toSort.length + ')' : ''))));

    let list = ui.opsFilter === 'sort' ? toSort.slice() : state.tx.filter((x) => x.date.slice(0, 7) === M);
    list.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : (b.batch || 0) - (a.batch || 0) || (b.seq || 0) - (a.seq || 0)));
    if (ui.opsFilter === 'all') {
      const bud = list.filter((x) => C.isBudgetAcc(state, x.accountId) && x.cat !== 'interne');
      const inn = C.sum(bud.filter((x) => x.amount > 0).map((x) => x.amount));
      const out = C.sum(bud.filter((x) => x.amount < 0).map((x) => -x.amount));
      view.append(h('div', { class: 'strip two' }, stat('Entrées', eur(inn), 'pos'), stat('Sorties', eur(out), null)));
    }
    if (!list.length) {
      view.append(h('section', { class: 'empty' }, h('p', {}, ui.opsFilter === 'sort' ? 'Tout est classé.' : 'Aucune opération ce mois-ci. Importe le CSV de ta banque ou ajoute une dépense à la main.')));
      return;
    }
    let lastDay = '';
    const ul = h('ul', { class: 'rows tx' });
    list.forEach((x) => {
      if (x.date !== lastDay) { lastDay = x.date; ul.append(h('li', { class: 'day' }, cap(fDay.format(utc(x.date))))); }
      const catLabel = x.cat === 'interne' ? 'Virement interne' : (x.cat ? envName(x.cat) : null);
      const acc = C.account(state, x.accountId);
      const linked = x.occKey ? (state.recurring.find((r) => r.id === x.occKey.split('@')[0]) || {}).name : null;
      ul.append(h('li', {}, h('button', { class: 'row', onclick: () => openTx(x) },
        h('span', { class: 'row-main' }, h('span', { class: 'row-t' }, x.label || '(sans libellé)'),
          h('span', { class: 'row-s' }, acc && acc.type !== 'courant' ? acc.name + ', hors budget' : (linked ? 'Ligne fixe : ' + linked : (catLabel || h('em', { class: 'tosort' }, 'À classer'))))),
        h('span', { class: cl('amt', x.amount > 0 && 'pos', x.cat === 'interne' && 'dim') }, eurS(x.amount)))));
    });
    view.append(ul);
  }

  function openTx(tx) {
    const isNew = !tx;
    const x = tx ? JSON.parse(JSON.stringify(tx)) : { id: C.uid(), accountId: 'courant', date: today(), amount: 0, label: '', source: 'manual', cat: null, createdAt: Date.now() };
    openSheet(isNew ? 'Nouvelle opération' : 'Opération', (close) => {
      const kind = seg([['out', 'Dépense'], ['in', 'Revenu']], x.amount > 0 ? 'in' : 'out');
      const label = textIn(x.label, 'Courses, Resto…');
      const amount = numIn(isNew ? '' : Math.abs(x.amount));
      const date = dateIn(x.date);
      const acc = h('select', {}, accountOptions(x.accountId));
      const cat = h('select', {},
        h('option', { value: '' }, 'Non classé'),
        state.envelopes.length ? h('optgroup', { label: 'Enveloppes' }, state.envelopes.map((e) => h('option', { value: e.id, selected: x.cat === e.id }, e.name))) : null,
        h('optgroup', { label: 'Autre' }, h('option', { value: 'interne', selected: x.cat === 'interne' }, 'Virement interne (ne compte pas)')));
      if (x.cat) cat.value = x.cat;
      const remember = h('input', { type: 'checkbox', checked: true });
      const fRem = field('', h('span', { class: 'chk' }, remember, 'Faire pareil pour les libellés de ce genre'));
      fRem.hidden = true;
      cat.addEventListener('change', () => { fRem.hidden = !(cat.value && C.normLabel(label.value)); });
      const body = h('div', { class: 'sheet-b' });
      const readonly = x.source === 'csv';
      if (readonly) body.append(h('p', { class: 'calc' }, 'Importée du relevé : ' + eurS(x.amount) + ' le ' + dayShort(x.date) + (x.balance !== null && x.balance !== undefined ? ' · solde ' + eur(x.balance) : '') + '.'));
      else body.append(field('Type', kind));
      body.append(field('Libellé', label));
      if (!readonly) body.append(field('Montant', amount), field('Date', date));
      body.append(field('Compte', acc), field('Enveloppe', cat), fRem);
      if (x.occKey) {
        const it = state.recurring.find((r) => r.id === x.occKey.split('@')[0]);
        body.append(h('p', { class: 'calc' }, 'Rapprochée de la ligne fixe « ' + (it ? it.name : '?') + ' ». ',
          h('button', { class: 'link', onclick: () => { delete state.occ[x.occKey]; const real = state.tx.find((t2) => t2.id === x.id); if (real) delete real.occKey; commit(); close(); } }, 'Délier')));
      }
      body.append(h('div', { class: 'actions' },
        h('button', { class: 'btn', onclick: () => {
          if (!readonly) {
            const v = num(amount); if (!(v > 0)) return toast('Indique un montant.');
            x.amount = kind.get() === 'in' ? v : -v; x.date = date.value || today();
          }
          x.label = label.value.trim(); x.accountId = acc.value; x.cat = cat.value || null;
          const i = state.tx.findIndex((t2) => t2.id === x.id);
          if (i >= 0) { const old = state.tx[i]; x.occKey = old.occKey; state.tx[i] = x; } else state.tx.push(x);
          let extra = 0;
          if (x.cat && remember.checked && !fRem.hidden) {
            const m = C.normLabel(x.label);
            if (m) {
              const r = state.rules.find((q) => q.match === m);
              if (r) r.cat = x.cat; else state.rules.push({ match: m, cat: x.cat });
              state.tx.forEach((o) => { if (o.id !== x.id && !o.cat && !o.occKey && C.normLabel(o.label).includes(m)) { o.cat = x.cat; extra++; } });
            }
          }
          commit(); close(); if (extra) toast(extra + ' autre' + (extra > 1 ? 's' : '') + ' opération' + (extra > 1 ? 's' : '') + ' classée' + (extra > 1 ? 's' : '') + ' pareil.');
        } }, 'Enregistrer'),
        isNew ? null : h('button', { class: 'btn danger ghost', onclick: () => { if (confirm('Supprimer cette opération ?')) { C.deleteTx(state, x.id); commit(); close(); } } }, 'Supprimer')));
      return body;
    });
  }

  /* ---------- import CSV ---------- */
  async function readText(file) {
    const buf = await file.arrayBuffer();
    try { return new TextDecoder('utf-8', { fatal: true }).decode(buf); }
    catch (e) { return new TextDecoder('windows-1252').decode(buf); }
  }
  function pickCSV(accountId) {
    const inp = h('input', { type: 'file', accept: '.csv,text/csv,text/plain' });
    inp.addEventListener('change', async () => {
      const f = inp.files && inp.files[0]; if (!f) return;
      try { openImport(f.name, C.parseCSV(await readText(f)), accountId); }
      catch (err) { message('Import impossible', err.message); }
    });
    inp.click();
  }
  function openImport(fileName, parsed, accountId) {
    openSheet('Importer un relevé', (close) => {
      const acc = h('select', {}, accountOptions(accountId || 'courant'));
      const info = h('div', {});
      const btn = h('button', { class: 'btn' }, 'Importer');
      function refresh() {
        const p = C.previewImport(state, acc.value, parsed.rows);
        const last = parsed.rows[parsed.rows.length - 1];
        info.replaceChildren(
          h('p', { class: 'calc' }, parsed.rows.length + ' opérations lues dans ' + fileName + ' · ' + p.fresh + ' nouvelles · ' + p.dupes + ' déjà importées' + (parsed.skipped.length ? ' · ' + parsed.skipped.length + ' ligne(s) ignorée(s)' : '') + '.'),
          last && last.balance !== null ? h('p', { class: 'calc' }, 'Solde après import : ' + eur(last.balance) + ' au ' + dayShort(last.date) + '.') : null,
          p.fresh ? h('ul', { class: 'rows mini' }, p.freshRows.slice(-5).reverse().map((r) => h('li', {}, h('span', { class: 'row' }, h('span', { class: 'row-main' }, h('span', { class: 'row-t' }, r.label), h('span', { class: 'row-s' }, dayShort(r.date))), h('span', { class: cl('amt', r.amount > 0 && 'pos') }, eurS(r.amount)))))) : null);
        btn.disabled = !p.fresh; btn.textContent = p.fresh ? 'Importer ' + p.fresh + ' opération' + (p.fresh > 1 ? 's' : '') : 'Rien de nouveau';
      }
      acc.addEventListener('change', refresh); refresh();
      btn.addEventListener('click', () => {
        const r = C.importRows(state, acc.value, parsed.rows);
        commit(); close();
        const parts = [r.added + ' ajoutée' + (r.added > 1 ? 's' : '')];
        if (r.matched) parts.push(r.matched + ' rapprochée' + (r.matched > 1 ? 's' : '') + ' de tes lignes fixes');
        if (r.merged) parts.push(r.merged + ' fusionnée' + (r.merged > 1 ? 's' : '') + ' avec une saisie manuelle');
        if (C.account(state, acc.value).type === 'courant' && r.toSort) { parts.push(r.toSort + ' à classer'); ui.tab = 'ops'; ui.opsFilter = 'sort'; render(); }
        toast(parts.join(', ') + '.');
      });
      return h('div', { class: 'sheet-b' }, field('Compte concerné', acc, 'Un relevé du compte courant alimente le budget. Un relevé de livret met à jour son solde.'), info, h('div', { class: 'actions' }, btn));
    });
  }

  function openBalance(accountId) {
    const a = C.account(state, accountId);
    openSheet('Solde : ' + a.name, (close) => {
      const cur = C.currentBalance(state, accountId);
      const amount = numIn(cur === null ? '' : cur), date = dateIn(today());
      return h('div', { class: 'sheet-b' },
        h('p', { class: 'calc' }, 'Recopie le solde affiché par ta banque. Les opérations que tu ajoutes ensuite à la main s’y ajoutent. Un import CSV remet le solde au niveau du relevé.'),
        field('Solde', amount), field('À la date du', date),
        h('div', { class: 'actions' }, h('button', { class: 'btn', onclick: () => {
          const v = num(amount); if (isNaN(v)) return toast('Indique un montant.');
          C.setBalance(state, accountId, v, date.value || today()); commit(); close();
        } }, 'Enregistrer')));
    });
  }

  /* ====================================================== RÉGLAGES ====================================================== */
  function viewSettings(top, view) {
    top.append(titleBar('Réglages'));
    view.append(h('section', { class: 'block' }, h('div', { class: 'block-h' }, h('h2', {}, 'Comptes')),
      h('ul', { class: 'rows' }, state.accounts.map((a) => {
        const b = C.currentBalance(state, a.id);
        return h('li', {}, h('div', { class: 'row static' },
          h('span', { class: 'row-main' }, h('span', { class: 'row-t' }, a.name), h('span', { class: 'row-s' }, (a.type === 'courant' ? 'Compte courant, alimente le budget' : 'Épargne, suivi à part') + (a.balance ? ' · au ' + dayShort(a.balance.asOf) : ''))),
          h('span', { class: 'amt' }, b === null ? '–' : eur(b)),
          h('span', { class: 'row-actions' }, h('button', { class: 'link', onclick: () => openBalance(a.id) }, 'Solde'), h('button', { class: 'link', onclick: () => pickCSV(a.id) }, 'CSV'))));
      }))));

    const last = state.settings.lastExport;
    const age = last ? Math.floor((Date.now() - last) / 86400000) : null;
    view.append(h('section', { class: 'block' }, h('div', { class: 'block-h' }, h('h2', {}, 'Sauvegarde')),
      h('p', { class: 'muted' }, 'Tes données vivent uniquement sur cet appareil. Si tu changes de téléphone ou vides les données du navigateur, elles disparaissent : exporte de temps en temps.'),
      h('p', { class: cl('muted', age === null || age > 30 ? 'neg-text' : '') }, last ? 'Dernière sauvegarde : il y a ' + age + ' jour' + (age > 1 ? 's' : '') + '.' : 'Aucune sauvegarde pour l’instant.'),
      h('div', { class: 'actions row-a' }, h('button', { class: 'btn', onclick: exportJSON }, 'Exporter'), h('button', { class: 'btn ghost', onclick: pickJSON }, 'Importer un fichier'))));

    if (state.rules.length) {
      view.append(h('section', { class: 'block' }, h('div', { class: 'block-h' }, h('h2', {}, 'Classements retenus')),
        h('ul', { class: 'rows' }, state.rules.map((r, i) => h('li', {}, h('div', { class: 'row static' },
          h('span', { class: 'row-main' }, h('span', { class: 'row-t' }, r.match), h('span', { class: 'row-s' }, '→ ' + (r.cat === 'interne' ? 'Virement interne' : (envName(r.cat) || 'enveloppe supprimée')))),
          h('button', { class: 'icon-btn', 'aria-label': 'Oublier ce classement', onclick: () => { state.rules.splice(i, 1); commit(); } }, '×')))))));
    }

    const theme = localStorage.getItem(THEME_KEY) || 'auto';
    view.append(h('section', { class: 'block' }, h('div', { class: 'block-h' }, h('h2', {}, 'Apparence')),
      seg([['auto', 'Automatique'], ['light', 'Clair'], ['dark', 'Sombre']], theme, (v) => { try { localStorage.setItem(THEME_KEY, v); } catch (e) { /* ignore */ } applyTheme(); })));

    view.append(h('section', { class: 'block' }, h('div', { class: 'block-h' }, h('h2', {}, 'Zone sensible')),
      h('button', { class: 'btn danger ghost', onclick: () => { if (confirm('Effacer toutes les données de l’appli sur cet appareil ?') && confirm('Vraiment tout effacer ? Pense à exporter avant.')) { state = C.defaultState(); commit(); toast('Données effacées.'); } } }, 'Tout effacer')));
  }
  function applyTheme() { document.documentElement.dataset.theme = localStorage.getItem(THEME_KEY) || 'auto'; }

  function exportJSON() {
    const name = 'budget-sauvegarde-' + today() + '.json';
    const stamp = () => { state.settings.lastExport = Date.now(); commit(); };
    const blob = new Blob([JSON.stringify(state, null, 1)], { type: 'application/json' });
    const download = () => { const a = h('a', { href: URL.createObjectURL(blob), download: name }); document.body.append(a); a.click(); a.remove(); stamp(); };
    try {
      const file = new File([blob], name, { type: 'application/json' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        navigator.share({ files: [file], title: name }).then(stamp).catch((e) => { if (e && e.name !== 'AbortError') download(); });
        return;
      }
    } catch (e) { /* repli ci-dessous */ }
    download();
  }
  function pickJSON() {
    const inp = h('input', { type: 'file', accept: '.json,application/json' });
    inp.addEventListener('change', async () => {
      const f = inp.files && inp.files[0]; if (!f) return;
      let data;
      try { data = JSON.parse(await f.text()); if (!data || !Array.isArray(data.accounts)) throw new Error('format'); }
      catch (e) { return message('Fichier non reconnu', 'Ce fichier ne ressemble pas à une sauvegarde de l’appli.'); }
      openSheet('Importer ce fichier', (close) => h('div', { class: 'sheet-b' },
        h('p', {}, 'Que veux-tu faire avec ' + f.name + ' ?'),
        h('div', { class: 'actions' },
          h('button', { class: 'btn', onclick: () => { state = C.mergeState(state, data); commit(); close(); toast('Données ajoutées à l’existant.'); } }, 'Ajouter à ce que j’ai déjà'),
          h('button', { class: 'btn ghost danger', onclick: () => { if (confirm('Remplacer toutes les données actuelles ?')) { state = C.normalizeState(data); commit(); close(); toast('Sauvegarde restaurée.'); } } }, 'Tout remplacer'))));
    });
    inp.click();
  }

  /* ---------- démarrage ---------- */
  applyTheme();
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  render();
  window.__budget = { get state() { return state; }, ui: ui, render: render };
})();
