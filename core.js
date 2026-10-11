/* Logique pure du budget : dates, récurrences, enveloppes, projection, import CSV.
   Aucune dépendance au navigateur, donc testable avec Node. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Core = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const pad = (n) => String(n).padStart(2, '0');
  const uid = () => Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4);
  const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
  const sum = (a) => a.reduce((x, y) => x + y, 0);

  /* ---------- dates (ISO 'YYYY-MM-DD', mois 'YYYY-MM', tout en entiers, sans fuseau) ---------- */
  function ymParse(k) { const p = k.split('-'); return { y: +p[0], m: +p[1] }; }
  function ymKey(y, m) { return y + '-' + pad(m); }
  function addMonths(k, n) { const o = ymParse(k); const t = o.y * 12 + (o.m - 1) + n; return ymKey(Math.floor(t / 12), (t % 12) + 1); }
  function monthDiff(a, b) { const A = ymParse(a), B = ymParse(b); return (B.y * 12 + B.m) - (A.y * 12 + A.m); }
  function daysInMonth(k) { const o = ymParse(k); return new Date(Date.UTC(o.y, o.m, 0)).getUTCDate(); }
  function dateIn(k, day) { return k + '-' + pad(Math.min(day, daysInMonth(k))); }
  function addDays(iso, n) {
    const p = iso.split('-').map(Number);
    const t = new Date(Date.UTC(p[0], p[1] - 1, p[2] + n));
    return t.getUTCFullYear() + '-' + pad(t.getUTCMonth() + 1) + '-' + pad(t.getUTCDate());
  }
  function dayDiff(a, b) {
    const pa = a.split('-').map(Number), pb = b.split('-').map(Number);
    return Math.round((Date.UTC(pb[0], pb[1] - 1, pb[2]) - Date.UTC(pa[0], pa[1] - 1, pa[2])) / 86400000);
  }
  function todayISO(d) { d = d || new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }

  /* ---------- état ---------- */
  function defaultState() {
    return {
      v: 1,
      settings: { lastExport: null, hideOnboarding: false },
      accounts: [
        { id: 'courant', name: 'Compte courant', type: 'courant', balance: null },
        { id: 'livret', name: 'Livret', type: 'epargne', balance: null }
      ],
      recurring: [], envelopes: [], tx: [], occ: {}, rules: []
    };
  }
  function normalizeState(s) {
    const d = defaultState();
    s = s || {};
    return {
      v: 1,
      settings: Object.assign({}, d.settings, s.settings || {}),
      accounts: (s.accounts && s.accounts.length ? s.accounts : d.accounts),
      recurring: s.recurring || [], envelopes: s.envelopes || [], tx: s.tx || [],
      occ: s.occ || {}, rules: s.rules || []
    };
  }
  function mergeState(base, incoming) {
    const out = normalizeState(JSON.parse(JSON.stringify(base)));
    const inc = normalizeState(incoming);
    inc.accounts.forEach((a) => { if (!out.accounts.find((x) => x.id === a.id)) out.accounts.push(a); });
    inc.recurring.forEach((r) => { if (!out.recurring.find((x) => x.id === r.id)) out.recurring.push(r); });
    inc.envelopes.forEach((e) => { if (!out.envelopes.find((x) => x.id === e.id)) out.envelopes.push(e); });
    const keys = new Set(out.tx.map((t) => t.key || t.id));
    inc.tx.forEach((t) => { if (!keys.has(t.key || t.id)) out.tx.push(t); });
    inc.rules.forEach((r) => { if (!out.rules.find((x) => x.match === r.match)) out.rules.push(r); });
    Object.keys(inc.occ).forEach((k) => { if (!(k in out.occ)) out.occ[k] = inc.occ[k]; });
    return out;
  }

  const account = (state, id) => state.accounts.find((a) => a.id === id);
  const isBudgetAcc = (state, id) => { const a = account(state, id); return !a || a.type === 'courant'; };

  function currentBalance(state, accountId) {
    const a = account(state, accountId);
    if (!a || !a.balance) return null;
    let b = a.balance.amount;
    state.tx.forEach((t) => {
      if (t.accountId !== accountId || t.source !== 'manual') return;
      if (t.date > a.balance.asOf || (t.date === a.balance.asOf && (t.createdAt || 0) > (a.balance.setAt || 0))) b += t.amount;
    });
    return round2(b);
  }
  function totalBudgetBalance(state) {
    let known = false, total = 0;
    state.accounts.forEach((a) => {
      if (a.type !== 'courant') return;
      const b = currentBalance(state, a.id);
      if (b !== null) { known = true; total += b; }
    });
    return known ? round2(total) : null;
  }
  function setBalance(state, accountId, amount, asOf) {
    const a = account(state, accountId);
    a.balance = { amount: round2(amount), asOf: asOf || todayISO(), setAt: Date.now() };
  }

  /* ---------- lignes récurrentes (revenus, charges fixes, prêts) ---------- */
  function stepAmount(steps, M, fallback) {
    if (!steps || !steps.length) return fallback;
    const sorted = steps.slice().sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0));
    let amt;
    sorted.forEach((s) => { if (s.from <= M) amt = s.amount; });
    return amt === undefined ? sorted[0].amount : amt;
  }
  function itemOccurrences(item, M, opts) {
    const raw = opts && opts.raw;
    if (item.schedule) {
      return item.schedule.filter((p) => p.date.slice(0, 7) === M)
        .map((p) => ({ date: p.date, amount: p.amount, capital: p.capital }));
    }
    const sm = item.start.slice(0, 7);
    const diff = monthDiff(sm, M);
    const every = Math.max(1, item.every || 1);
    if (diff < 0 || diff % every !== 0) return [];
    const date = dateIn(M, item.day || +item.start.slice(8, 10));
    if (date < item.start) return [];
    if (item.end && date > item.end) return [];
    let amt = stepAmount(item.steps, M, item.amount || 0);
    if (!raw && item.overrides && Object.prototype.hasOwnProperty.call(item.overrides, M)) amt = item.overrides[M];
    if (amt === null || amt === undefined) return [];
    return [{ date: date, amount: amt }];
  }
  function occurrencesForMonth(state, M) {
    const out = [];
    state.recurring.forEach((item) => {
      itemOccurrences(item, M).forEach((o) => {
        const key = item.id + '@' + M;
        const txId = state.occ[key];
        const tx = txId ? state.tx.find((t) => t.id === txId) : null;
        out.push({
          key: key, item: item, kind: item.kind, name: item.name, group: item.group || '',
          date: tx ? tx.date : o.date, due: o.date, expected: o.amount, capital: o.capital,
          done: !!tx, tx: tx, amount: tx ? Math.abs(tx.amount) : o.amount
        });
      });
    });
    return out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  }
  function nextOccurrence(state, item, today) {
    const tm = today.slice(0, 7);
    for (let k = 0; k < 60; k++) {
      const M = addMonths(tm, k);
      const os = itemOccurrences(item, M);
      for (const o of os) {
        const done = state.occ[item.id + '@' + M] && state.tx.find((t) => t.id === state.occ[item.id + '@' + M]);
        if (o.date >= today && !done) return o;
      }
    }
    return null;
  }
  function loanStats(item, today) {
    const left = item.schedule.filter((p) => p.date >= today);
    return {
      remaining: round2(sum(left.map((p) => p.capital || 0))),
      count: left.length,
      end: item.schedule.length ? item.schedule[item.schedule.length - 1].date : null
    };
  }
  function markPaid(state, occ, amount, date) {
    const sign = occ.kind === 'income' ? 1 : -1;
    unmarkPaid(state, occ.key);
    const tx = {
      id: uid(), accountId: occ.item.accountId || 'courant', date: date, amount: round2(sign * amount),
      label: occ.name, source: 'manual', cat: null, occKey: occ.key, createdAt: Date.now()
    };
    state.tx.push(tx);
    state.occ[occ.key] = tx.id;
    return tx;
  }
  function unmarkPaid(state, key) {
    const id = state.occ[key];
    if (!id) return;
    const tx = state.tx.find((t) => t.id === id);
    if (tx) { if (tx.source === 'manual') state.tx = state.tx.filter((t) => t.id !== id); else delete tx.occKey; }
    delete state.occ[key];
  }
  function deleteTx(state, id) {
    const tx = state.tx.find((t) => t.id === id);
    if (tx && tx.occKey) delete state.occ[tx.occKey];
    state.tx = state.tx.filter((t) => t.id !== id);
  }
  function deleteRecurring(state, id) {
    state.recurring = state.recurring.filter((r) => r.id !== id);
    Object.keys(state.occ).forEach((k) => {
      if (k.indexOf(id + '@') === 0) {
        const tx = state.tx.find((t) => t.id === state.occ[k]);
        if (tx) delete tx.occKey;
        delete state.occ[k];
      }
    });
  }
  function deleteEnvelope(state, id) {
    state.envelopes = state.envelopes.filter((e) => e.id !== id);
    state.tx.forEach((t) => { if (t.cat === id) t.cat = null; });
    state.rules = state.rules.filter((r) => r.cat !== id);
  }

  /* ---------- enveloppes ---------- */
  function envSpent(state, envId, M) {
    let s = 0;
    state.tx.forEach((t) => {
      if (t.cat === envId && t.date.slice(0, 7) === M && isBudgetAcc(state, t.accountId)) s += -t.amount;
    });
    return round2(s);
  }
  function goalSavedBefore(state, env, M) {
    let s = (env.goal && env.goal.saved) || 0;
    state.tx.forEach((t) => {
      if (t.cat === env.id && isBudgetAcc(state, t.accountId) && t.date.slice(0, 7) < M) s += -t.amount;
    });
    return s;
  }
  function goalSaved(state, env) {
    return round2(goalSavedBefore(state, env, '9999-12'));
  }
  function envBudget(state, env, M) {
    if (env.overrides && env.overrides[M] !== undefined && env.overrides[M] !== null) return env.overrides[M];
    if (env.type === 'goal' && (env.budget === null || env.budget === undefined)) {
      const g = env.goal;
      if (!g || !g.target || !g.by) return 0;
      const left = monthDiff(M, g.by) + 1;
      if (left <= 0) return 0;
      return Math.max(0, round2((g.target - goalSavedBefore(state, env, M)) / left));
    }
    return env.budget || 0;
  }
  function unclassified(state, M) {
    let s = 0;
    state.tx.forEach((t) => {
      if (t.date.slice(0, 7) !== M || !isBudgetAcc(state, t.accountId)) return;
      if (t.cat || t.occKey || t.amount >= 0) return;
      s += -t.amount;
    });
    return round2(s);
  }
  function unclassifiedList(state) {
    return state.tx.filter((t) => !t.cat && !t.occKey && isBudgetAcc(state, t.accountId));
  }
  function elapsed(M, today) {
    const tm = today.slice(0, 7);
    if (M < tm) return 1;
    if (M > tm) return 0;
    return +today.slice(8, 10) / daysInMonth(M);
  }

  function monthSummary(state, M, today) {
    const tm = today.slice(0, 7);
    const occ = occurrencesForMonth(state, M);
    const incomes = occ.filter((o) => o.kind === 'income');
    const fixed = occ.filter((o) => o.kind === 'expense');
    const income = round2(sum(incomes.map((o) => o.amount)));
    const fixedTotal = round2(sum(fixed.map((o) => o.amount)));
    const pace = elapsed(M, today);
    const rows = state.envelopes.map((env) => {
      const budget = envBudget(state, env, M);
      const spent = envSpent(state, env.id, M);
      const ratio = budget > 0 ? spent / budget : (spent > 0 ? 2 : 0);
      let status;
      if (env.type === 'goal') status = spent >= budget - 0.005 ? 'done' : (M < tm ? 'late' : 'pending');
      else if (spent > budget + 0.005) status = 'over';
      else if (ratio >= 0.85 || (M === tm && budget > 0 && ratio > pace + 0.2)) status = 'warn';
      else status = 'ok';
      return { env: env, budget: budget, spent: spent, remaining: round2(budget - spent), ratio: ratio, status: status };
    });
    const varBudget = round2(sum(rows.filter((r) => r.env.type !== 'goal').map((r) => Math.max(r.budget, r.spent))));
    const goalBudget = round2(sum(rows.filter((r) => r.env.type === 'goal').map((r) => Math.max(r.budget, r.spent))));
    const unc = unclassified(state, M);
    return {
      M: M, occ: occ, incomes: incomes, fixed: fixed, income: income, fixedTotal: fixedTotal, rows: rows,
      varBudget: varBudget, goalBudget: goalBudget, unclassifiedSpend: unc, pace: pace,
      reste: round2(income - fixedTotal - varBudget - goalBudget - unc)
    };
  }
  function dailyAllowance(state, today) {
    const M = today.slice(0, 7);
    const s = monthSummary(state, M, today);
    const left = daysInMonth(M) - +today.slice(8, 10) + 1;
    const rem = round2(sum(s.rows.filter((r) => r.env.type !== 'goal').map((r) => Math.max(0, r.remaining))));
    return { remaining: rem, perDay: round2(rem / left), daysLeft: left };
  }

  /* ---------- projection jour par jour ---------- */
  function simulate(state, today, horizon) {
    horizon = horizon || 6;
    const startM = today.slice(0, 7);
    const start = totalBudgetBalance(state);
    const events = {};
    const add = (d, a) => { events[d] = (events[d] || 0) + a; };
    const pending = [], toConfirm = [];
    for (let k = 0; k < horizon; k++) {
      const M = addMonths(startM, k), dim = daysInMonth(M);
      occurrencesForMonth(state, M).forEach((o) => {
        if (o.done) return;
        const sign = o.kind === 'income' ? 1 : -1;
        if (o.date < today) {
          toConfirm.push(o);
          if (o.kind !== 'income') add(today, sign * o.amount);
          return;
        }
        add(o.date, sign * o.amount);
        pending.push(o);
      });
      state.envelopes.forEach((env) => {
        const budget = envBudget(state, env, M);
        const spent = k === 0 ? envSpent(state, env.id, M) : 0;
        const rem = Math.max(0, budget - spent);
        if (rem <= 0) return;
        if (env.type === 'goal') { add(dateIn(M, dim), -rem); return; }
        const first = k === 0 ? +today.slice(8, 10) : 1;
        const n = dim - first + 1;
        for (let d = first; d <= dim; d++) add(dateIn(M, d), -rem / n);
      });
    }
    const lastM = addMonths(startM, horizon - 1);
    const endDate = dateIn(lastM, daysInMonth(lastM));
    const days = [], monthEnds = {};
    let bal = start || 0, d = today, min = { date: today, balance: bal }, firstNeg = null;
    while (d <= endDate) {
      bal += events[d] || 0;
      days.push({ date: d, balance: round2(bal) });
      if (bal < min.balance) min = { date: d, balance: bal };
      if (bal < -0.005 && !firstNeg) firstNeg = { date: d, balance: bal };
      const mk = d.slice(0, 7);
      if (d === dateIn(mk, daysInMonth(mk))) monthEnds[mk] = round2(bal);
      d = addDays(d, 1);
    }
    return {
      known: start !== null, start: start || 0, days: days, monthEnds: monthEnds,
      min: { date: min.date, balance: round2(min.balance) },
      firstNeg: firstNeg ? { date: firstNeg.date, balance: round2(firstNeg.balance) } : null,
      pending: pending, toConfirm: toConfirm
    };
  }

  /* ---------- import CSV bancaire ---------- */
  function parseNumber(s) {
    if (s === null || s === undefined) return NaN;
    s = String(s).replace(/\u2212/g, '-').replace(/[^0-9.,+\-]/g, '');
    if (!s) return NaN;
    const c = s.includes(','), p = s.includes('.');
    if (c && p) s = s.lastIndexOf(',') > s.lastIndexOf('.') ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
    else if (c) s = s.replace(',', '.');
    return Number(s);
  }
  function parseDate(s) {
    s = String(s || '').trim();
    let m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (m) return m[3] + '-' + m[2] + '-' + m[1];
    m = s.match(/^(\d{2})\/(\d{2})\/(\d{2})$/);
    if (m) return '20' + m[3] + '-' + m[2] + '-' + m[1];
    m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return m[1] + '-' + m[2] + '-' + m[3];
    return null;
  }
  function splitCSV(text, delim) {
    const rows = []; let row = [], f = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (q) {
        if (ch === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += ch;
      } else if (ch === '"') q = true;
      else if (ch === delim) { row.push(f); f = ''; }
      else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && text[i + 1] === '\n') i++;
        row.push(f); f = '';
        if (row.some((x) => x.trim() !== '')) rows.push(row);
        row = [];
      } else f += ch;
    }
    row.push(f);
    if (row.some((x) => x.trim() !== '')) rows.push(row);
    return rows;
  }
  const norm = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();

  function parseCSV(text) {
    text = String(text).replace(/^\uFEFF/, '');
    const first = text.split(/\r?\n/)[0] || '';
    const delim = [';', '\t', ','].map((d) => [d, first.split(d).length]).sort((a, b) => b[1] - a[1])[0][0];
    const all = splitCSV(text, delim);
    if (all.length < 2) throw new Error('Fichier vide ou illisible.');
    const head = all[0].map(norm);
    const find = (re, not) => head.findIndex((h) => re.test(h) && !(not && not.test(h)));
    const iDate = find(/^date/, /valeur/);
    const iVal = find(/valeur/);
    const iAmt = find(/^montant/);
    const iDeb = find(/^debit/);
    const iCre = find(/^credit/);
    const iLab = find(/^(libelle|description|intitule|operation|detail)/);
    const iBal = find(/^solde/);
    if (iDate < 0 || iLab < 0 || (iAmt < 0 && iDeb < 0 && iCre < 0)) {
      throw new Error('Colonnes non reconnues. Il faut au minimum : Date, Libellé et Montant (ou Débit / Crédit).');
    }
    const rows = [], skipped = [];
    all.slice(1).forEach((r, idx) => {
      const date = parseDate(r[iDate]);
      let amount;
      if (iAmt >= 0) amount = parseNumber(r[iAmt]);
      else {
        const d = iDeb >= 0 ? parseNumber(r[iDeb]) : NaN, c = iCre >= 0 ? parseNumber(r[iCre]) : NaN;
        amount = (isNaN(c) ? 0 : c) - (isNaN(d) ? 0 : Math.abs(d));
        if (isNaN(d) && isNaN(c)) amount = NaN;
      }
      if (!date || isNaN(amount)) { skipped.push(idx + 2); return; }
      const bal = iBal >= 0 ? parseNumber(r[iBal]) : NaN;
      rows.push({
        date: date, valueDate: iVal >= 0 ? parseDate(r[iVal]) : null, amount: round2(amount),
        label: String(r[iLab] || '').replace(/\s+/g, ' ').trim(), balance: isNaN(bal) ? null : round2(bal)
      });
    });
    if (rows.length > 1 && rows[0].date > rows[rows.length - 1].date) rows.reverse();
    return { rows: rows, skipped: skipped };
  }

  function txKeys(accountId, rows) {
    const counts = {};
    return rows.map((r) => {
      const base = [accountId, r.date, r.amount.toFixed(2), r.label, r.balance === null ? '' : r.balance.toFixed(2)].join('|');
      counts[base] = (counts[base] || 0) + 1;
      return base + '#' + counts[base];
    });
  }
  function previewImport(state, accountId, rows) {
    const existing = new Set(state.tx.filter((t) => t.key).map((t) => t.key));
    const keys = txKeys(accountId, rows);
    const fresh = rows.filter((r, i) => !existing.has(keys[i]));
    return { total: rows.length, fresh: fresh.length, dupes: rows.length - fresh.length, freshRows: fresh };
  }
  function normLabel(label) {
    return String(label || '').toUpperCase().replace(/\S*\d\S*/g, '').replace(/\s+/g, ' ').trim();
  }
  function applyRules(state, tx) {
    if (tx.cat || tx.occKey) return;
    const nl = normLabel(tx.label);
    for (const r of state.rules) { if (r.match && nl.includes(r.match)) { tx.cat = r.cat; return; } }
  }
  function keywordHit(item, label) {
    return !!(item.match && String(label).toUpperCase().includes(String(item.match).toUpperCase()));
  }
  function autoMatch(state) {
    let matched = 0;
    state.tx.forEach((tx) => {
      if (tx.occKey || tx.cat || !isBudgetAcc(state, tx.accountId)) return;
      const M = tx.date.slice(0, 7);
      let best = null;
      [addMonths(M, -1), M, addMonths(M, 1)].forEach((m) => {
        occurrencesForMonth(state, m).forEach((o) => {
          if (o.done) return;
          if ((o.kind === 'income') !== (tx.amount > 0)) return;
          const dd = Math.abs(dayDiff(o.due, tx.date));
          const kw = keywordHit(o.item, tx.label);
          const near = Math.abs(Math.abs(tx.amount) - o.expected) <= Math.max(0.5, o.expected * 0.02);
          if (!((kw && dd <= 10) || (near && dd <= 4))) return;
          const score = (kw ? 0 : 100) + dd;
          if (!best || score < best.score) best = { o: o, score: score };
        });
      });
      if (best) { state.occ[best.o.key] = tx.id; tx.occKey = best.o.key; matched++; }
    });
    return matched;
  }
  function importRows(state, accountId, rows) {
    const existing = new Set(state.tx.filter((t) => t.key).map((t) => t.key));
    const keys = txKeys(accountId, rows);
    const batch = Date.now();
    let added = 0, dupes = 0, merged = 0;
    rows.forEach((r, i) => {
      if (existing.has(keys[i])) { dupes++; return; }
      const tx = {
        id: uid(), key: keys[i], accountId: accountId, date: r.date, valueDate: r.valueDate, amount: r.amount,
        label: r.label, balance: r.balance, source: 'csv', batch: batch, seq: i, cat: null
      };
      const cand = state.tx.find((t) => {
        if (t.source !== 'manual' || t.accountId !== accountId) return false;
        if ((t.amount > 0) !== (r.amount > 0) || Math.abs(dayDiff(t.date, r.date)) > 7) return false;
        if (t.occKey) {
          const item = state.recurring.find((x) => x.id === t.occKey.split('@')[0]);
          return Math.abs(t.amount - r.amount) <= Math.max(1, Math.abs(t.amount) * 0.03) || (item && keywordHit(item, r.label));
        }
        return Math.abs(t.amount - r.amount) < 0.005;
      });
      if (cand) {
        tx.cat = cand.cat || null; tx.note = cand.note;
        if (cand.occKey) { tx.occKey = cand.occKey; state.occ[cand.occKey] = tx.id; }
        state.tx[state.tx.indexOf(cand)] = tx;
        merged++;
      } else {
        applyRules(state, tx);
        state.tx.push(tx);
      }
      existing.add(keys[i]);
      added++;
    });
    const last = state.tx
      .filter((t) => t.accountId === accountId && t.source === 'csv' && t.balance !== null && t.balance !== undefined)
      .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : (a.batch - b.batch) || (a.seq - b.seq))).pop();
    if (last) { const a = account(state, accountId); a.balance = { amount: last.balance, asOf: last.date, setAt: Date.now() }; }
    const matched = autoMatch(state);
    return { added: added, dupes: dupes, merged: merged, matched: matched, toSort: unclassifiedList(state).length };
  }

  return {
    uid, round2, sum, ymParse, addMonths, monthDiff, daysInMonth, dateIn, addDays, dayDiff, todayISO,
    defaultState, normalizeState, mergeState, account, isBudgetAcc, currentBalance, totalBudgetBalance, setBalance,
    stepAmount, itemOccurrences, occurrencesForMonth, nextOccurrence, loanStats, markPaid, unmarkPaid, deleteTx,
    deleteRecurring, deleteEnvelope, envSpent, goalSaved, goalSavedBefore, envBudget, unclassified, unclassifiedList,
    monthSummary, dailyAllowance, simulate, parseNumber, parseDate, parseCSV, previewImport, importRows, normLabel,
    applyRules, autoMatch
  };
});
