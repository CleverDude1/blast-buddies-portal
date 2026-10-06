// ================= CONFIG =================
const API = '/api/compare';   // api/compare.js on Vercel. Use a full https:// URL if these pages are hosted somewhere else.
const DAY = 864e5, WEEK = 7 * DAY;
const dayStart = t => Math.floor(t / DAY) * DAY;                              // all periods are UTC
const weekStart = t => Math.floor((t - 4 * DAY) / WEEK) * WEEK + 4 * DAY;     // weeks start Monday 00:00 UTC

// metric = [key, label, better ('high' | 'low')]
const DL = [['kills', 'Kills', 'high'], ['deaths', 'Deaths', 'low'], ['kdr', 'KDR', 'high']];
const BOARDS = {
  day:    { label: 'Daily',  unit: 'days',  metrics: DL },
  week:   { label: 'Weekly', unit: 'weeks', metrics: DL },
  ranked: { label: 'Ranked', unit: 'days',  metrics: [['trophies', 'Trophies', 'high'], ['wins', 'Wins', 'high'], ['losses', 'Losses', 'low'], ['winrate', 'Win rate', 'high']] },
};
// averages come from the SQL views: [label, column, rankColumn, better, format]
const AVG = {
  day:    [['Average kills', 'avg_kills', 'avg_kills_rank', 'high'], ['Maximum kills', 'max_kills', null, 'high'], ['Average deaths', 'avg_deaths', 'avg_deaths_rank', 'low'],
           ['Average KDR', 'avg_kdr', 'avg_kdr_rank', 'high', 'kdr'], ['Average position', 'avg_rank', 'avg_rank_rank', 'low', 'pos']],
  ranked: [['Average trophies', 'avg_trophies', 'avg_trophies_rank', 'high'], ['Maximum trophies', 'max_trophies', null, 'high'], ['Average position', 'avg_rank', 'avg_rank_rank', 'low', 'pos']],
  clan:   [['Average kills', 'avg_kills', 'avg_kills_rank', 'high'], ['Maximum kills', 'max_kills', null, 'high'], ['Average members', 'avg_members', 'avg_members_rank', 'high'], ['Maximum members', 'max_members', null, 'high']],
};
AVG.week = AVG.day;

const T7 = [['7', 'Last 7 days'], ['30', 'Last 30 days'], ['365', 'Last 365 days']];
const GRAPHS = {
  day:      { title: 'Daily',   metrics: DL, tabs: [['today', 'Today'], ['yesterday', 'Yesterday'], ['final', 'Final scores']] },
  week:     { title: 'Weekly',  metrics: DL, tabs: [['current', 'Current week'], ['previous', 'Previous week'], ['final', 'Final scores']] },
  ranked:   { title: 'Ranked',  metrics: [['trophies', 'Trophies'], ['wins', 'Wins'], ['losses', 'Losses']], tabs: [['7', 'Last 7 days'], ['30', 'Last 30 days'], ['season', 'Whole season']] },
  ckills:   { title: 'Kills',   metrics: [['kills', 'Kills']], tabs: T7, src: 'clan' },
  cmembers: { title: 'Members', metrics: [['members', 'Members']], tabs: T7, src: 'clan' },
};
const GSTATE0 = { day: { tab: 'today', metric: 'kills' }, week: { tab: 'current', metric: 'kills' }, ranked: { tab: '30', metric: 'trophies' },
                  ckills: { tab: '30', metric: 'kills' }, cmembers: { tab: '30', metric: 'members' } };

// ================= HELPERS =================
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const num = v => (v === null || v === undefined || v === '' || Number.isNaN(Number(v))) ? null : Number(v);
function compact(n) {
  if (n == null) return 'N/A';
  const a = Math.abs(n);
  if (a >= 1e9) return (n / 1e9).toFixed(2) + 'B';
  if (a >= 1e6) return (n / 1e6).toFixed(2) + 'M';
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
}
const FMT = { kdr: v => v.toFixed(2), winrate: v => v.toFixed(1) + '%', fill: v => v.toFixed(0) + '%', pos: v => '#' + v.toFixed(1) };
const DFMT = { winrate: v => v.toFixed(1) + ' pts', fill: v => v.toFixed(0) + ' pts' };

// value of a metric from a state/history row (players and clans)
function val(r, m) {
  if (!r) return null;
  const k = num(r.kills), d = num(r.deaths), w = num(r.ranked_wins), l = num(r.ranked_losses);
  switch (m) {
    case 'kills': return k;
    case 'deaths': return d;
    case 'kdr': return k == null ? null : (d > 0 ? k / d : k);
    case 'trophies': return num(r.trophies);
    case 'wins': return w;
    case 'losses': return l;
    case 'winrate': return (w == null || l == null || w + l === 0) ? null : w / (w + l) * 100;
    case 'members': return num(r.member_count);
    case 'fill': return num(r.member_cap) > 0 ? num(r.member_count) / num(r.member_cap) * 100 : null;
  }
}
// position of `id` among everyone on the board for one metric (1 = best)
function rankIn(pop, idKey, id, m, dir) {
  const mine = val(pop.find(r => r[idKey] === id), m);
  if (mine == null) return null;
  let better = 0;
  for (const r of pop) { const v = val(r, m); if (v != null && (dir === 'high' ? v > mine : v < mine)) better++; }
  return better + 1;
}

// one comparison row: value A | label + split bar | value B. Returns {html, lead}
function cmpRow(label, va, vb, o = {}) {
  const { dir = 'high', fmt = compact, dfmt = fmt, ra = null, rb = null, diff = true, bar = true } = o;
  const has = va != null && vb != null;
  const hi = has && va !== vb ? (va > vb ? 'a' : 'b') : null;                      // the HIGHER number gets the + difference
  const lead = hi ? (dir === 'high' ? hi : (hi === 'a' ? 'b' : 'a')) : null;       // the BETTER number is highlighted
  let d = '';
  if (hi && diff) {
    const hv = Math.max(va, vb), lv = Math.min(va, vb), pct = lv > 0 ? (hv / lv - 1) * 100 : null;
    d = `+${dfmt(hv - lv)}` + (pct == null ? '' : ` · +${pct < 10 ? pct.toFixed(1) : Math.round(pct).toLocaleString()}%`);
  }
  const cell = (s, v, r) => `<div class="v ${s}${lead === s ? ' lead' : ''}"><b>${v == null ? 'N/A' : fmt(v)}</b><small>${[r ? '#' + r : '', hi === s ? d : ''].filter(Boolean).join(' ')}</small></div>`;
  const share = has && va + vb > 0 ? va / (va + vb) * 100 : 50;
  return { lead, html: `<div class="cmp-row">${cell('a', va, ra)}<div class="mid">${label}<div class="split${has && bar ? '' : ' none'}"><i style="width:${share}%"></i></div></div>${cell('b', vb, rb)}</div>` };
}

// ================= STATE =================
let type = 'player', options = { player: [], clan: [] }, labelToId = {}, idToLabel = {};
let gstate = {}, seriesData = {}, names = { a: '', b: '' };

// ================= OPTIONS / PICKERS =================
async function getJson(url) {
  const r = await fetch(url);
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
  return j;
}
async function loadOptions() {
  $('msg').textContent = 'Loading list...';
  try {
    if (!options[type].length) options[type] = await getJson(`${API}?mode=options&type=${type}`);
    labelToId = {}; idToLabel = {};
    const seen = {};
    options[type].forEach(o => { seen[o.name] = (seen[o.name] || 0) + 1; });
    options[type].forEach(o => {
      let l = o.name + (o.tag ? ` [${o.tag}]` : '');
      if (labelToId[l.toLowerCase()]) l += ` #${o.id.slice(0, 4)}`;
      labelToId[l.toLowerCase()] = o.id; idToLabel[o.id] = l;
    });
    $('opts').innerHTML = options[type].map(o => `<option value="${esc(idToLabel[o.id])}"></option>`).join('');
    $('msg').textContent = options[type].length ? '' : 'No data yet. Nobody has been collected for this list.';
  } catch (e) { console.error(e); $('msg').textContent = 'Could not load the list: ' + e.message; }
}
const pickId = v => labelToId[String(v).trim().toLowerCase()] || null;

// ================= RENDER: COMPARISON =================
function nameTag(s, i) { return `<span class="${s}">${esc(i.name)}${i.tag ? `<small>[${esc(i.tag)}]</small>` : ''}</span>`; }

function headCard(info, lead, body) {
  const la = lead.a, lb = lead.b;
  const title = la === lb ? 'TIED' : 'LEADING';
  const who = la === lb ? '' : `<span style="color:var(${la > lb ? '--ca' : '--cb'})">${esc((la > lb ? info.a : info.b).name)}</span>`;
  const bar = la + lb === 0 ? '<i style="flex:1;background:#2a3322;color:#8b9380">0</i>'
    : `${la ? `<i class="a" style="flex:${la}">${la}</i>` : ''}${lb ? `<i class="b" style="flex:${lb}">${lb}</i>` : ''}`;
  return `<div class="cmp-card"><div class="cmp-head"><h3>${who}<small>${title}</small></h3><div class="leadbar">${bar}</div></div>
    <div class="cmp-names">${nameTag('a', info.a)}${nameTag('b', info.b)}</div>${body}</div>`;
}

function renderPlayers(d) {
  const { a, b } = d.info, lead = { a: 0, b: 0 };
  let body = '';
  for (const key of ['day', 'week', 'ranked']) {
    const B = BOARDS[key], pop = d.boards[key] || [];
    const ra = pop.find(r => r.player_id === a.id), rb = pop.find(r => r.player_id === b.id);
    body += `<div class="cmp-sec">${key === 'ranked' ? `RANKED SEASON ${d.season}` : B.label.toUpperCase()}</div>`;
    body += cmpRow('Leaderboard position', num(ra?.rank), num(rb?.rank), { dir: 'low', fmt: v => '#' + v, diff: false, bar: false }).html;
    for (const [m, label, dir] of B.metrics) {
      const row = cmpRow(label, val(ra, m), val(rb, m), { dir, fmt: FMT[m] || compact, dfmt: DFMT[m] || FMT[m] || compact,
        ra: ra ? rankIn(pop, 'player_id', a.id, m, dir) : null, rb: rb ? rankIn(pop, 'player_id', b.id, m, dir) : null });
      if (row.lead) lead[row.lead]++;
      body += row.html;
    }
  }
  return headCard(d.info, lead, body);
}
function renderClans(d) {
  const { a, b } = d.info, lead = { a: 0, b: 0 };
  const ra = d.pop.find(r => r.clan_id === a.id), rb = d.pop.find(r => r.clan_id === b.id);
  const idx = id => { const i = d.pop.slice().sort((x, y) => (num(y.kills) ?? -1) - (num(x.kills) ?? -1)).findIndex(r => r.clan_id === id); return i < 0 ? null : i + 1; };
  let body = `<div class="cmp-sec">CLAN LEADERBOARD</div>`;
  body += cmpRow('Leaderboard position', idx(a.id), idx(b.id), { dir: 'low', fmt: v => '#' + v, diff: false, bar: false }).html;
  for (const [m, label] of [['kills', 'Kills'], ['members', 'Members'], ['fill', 'Capacity filled']]) {
    const row = cmpRow(label, val(ra, m), val(rb, m), { fmt: FMT[m] || compact, dfmt: DFMT[m] || compact,
      ra: ra ? rankIn(d.pop, 'clan_id', a.id, m, 'high') : null, rb: rb ? rankIn(d.pop, 'clan_id', b.id, m, 'high') : null });
    if (row.lead) lead[row.lead]++;
    body += row.html;
  }
  const open = r => r ? (r.open_join ? 'Open' : 'Closed') : 'N/A';
  body += `<div class="cmp-row"><div class="v a"><b>${open(ra)}</b></div><div class="mid">Join status<div class="split none"><i></i></div></div><div class="v b"><b>${open(rb)}</b></div></div>`;
  return headCard(d.info, lead, body);
}

// ================= RENDER: AVERAGES =================
function avgCard(title, rowA, rowB, defs, unit) {
  const stats = defs.map(([label, col, rk, dir, f]) => {
    const va = num(rowA?.[col]), vb = num(rowB?.[col]), fmt = FMT[f] || compact;
    const hi = va != null && vb != null && va !== vb ? (va > vb ? 'a' : 'b') : null;
    const lead = hi ? (dir === 'high' ? hi : (hi === 'a' ? 'b' : 'a')) : null;
    const cell = (s, v, r) => `<div class="v ${s}${lead === s ? ' lead' : ''}"><b>${v == null ? 'N/A' : fmt(v)}</b><small>${r && rk ? `#${num(r[rk]) ?? '-'} ×${num(r.periods) ?? 0}` : ''}</small></div>`;
    return `<div class="avg-stat"><div class="lbl">${label}</div><div class="pair">${cell('a', va, rowA)}${cell('b', vb, rowB)}</div></div>`;
  }).join('');
  return `<div class="avg-card"><h4>${title}</h4>${stats}</div>`;
}
function renderAverages(d) {
  const find = (rows, idKey, id, board) => rows.find(r => r[idKey] === id && (!board || r.board === board));
  let cards;
  if (d.type === 'player') {
    cards = ['day', 'week', 'ranked'].map(k => avgCard(k === 'ranked' ? `Ranked season ${d.season}` : BOARDS[k].label,
      find(d.averages, 'player_id', d.info.a.id, k), find(d.averages, 'player_id', d.info.b.id, k), AVG[k], BOARDS[k].unit)).join('');
  } else {
    cards = avgCard('Clan overview', find(d.averages, 'clan_id', d.info.a.id), find(d.averages, 'clan_id', d.info.b.id), AVG.clan, 'days');
  }
  return `<div class="cmp-card"><div class="cmp-title">AVERAGE SCORES AND RANKINGS</div>
    <div class="avg-grid">${cards}</div>
    <p class="gr-note" style="margin:0;padding:0 28px 20px">Averages use one value per period (the last one seen). "×N" is how many periods were tracked. The # is the rank among all tracked players' averages (clans: among all clans).</p></div>`;
}

// ================= GRAPHS =================
function graphCard(key) {
  const G = GRAPHS[key], st = gstate[key];
  const seg = (items, attr, cur) => `<div class="seg" data-g="${key}">${items.map(([k, l]) => `<button data-${attr}="${k}" class="${cur === k ? 'on' : ''}">${l}</button>`).join('')}</div>`;
  return `<div class="gr-card" id="g-${key}"><h3>${G.title}</h3>${seg(G.tabs, 'tab', st.tab)}${G.metrics.length > 1 ? seg(G.metrics, 'metric', st.metric) : ''}
    <div class="legend"><span><i class="dot a"></i>${esc(names.a)}</span><span><i class="dot b"></i>${esc(names.b)}</span></div>
    <div class="chart" id="c-${key}"><div class="chart-empty">Loading history...</div></div></div>`;
}
const fmtDate = t => new Date(t).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', timeZone: 'UTC' });
const fmtHour = t => new Date(t).toISOString().slice(11, 16);
function dateTicks(x0, x1, n = 6) {
  return Array.from({ length: n }, (_, i) => { const t = x0 + (x1 - x0) * i / (n - 1); return { t, l: x1 - x0 <= 2 * DAY ? fmtHour(t) : fmtDate(t) }; });
}
// ----- point builders: rows are sorted oldest -> newest and carry .t (ms) -----
const GAP = 90 * 60e3;   // snapshots are hourly: a line is only extended/carried across a gap shorter than this
const lastVal = (rows, m) => { for (let i = rows.length - 1; i >= 0; i--) { const v = val(rows[i], m); if (v != null) return v; } return null; };
function periodPts(rows, start, end, m, now) {          // one day/week, value climbing from 0
  const inP = rows.filter(r => r.t >= start && r.t < end);
  const pts = inP.map(r => [r.t, val(r, m)]).filter(p => p[1] != null);
  if (!pts.length) return [];
  if (m !== 'kdr') pts.unshift([start, 0]);
  const xe = Math.min(now, end), last = pts[pts.length - 1];
  if (last[0] < xe && xe - last[0] <= GAP) pts.push([xe, last[1]]);
  return pts;
}
function finalPts(rows, starts, len, m) {               // last value of every period
  const pts = [];
  for (const s of starts) { const v = lastVal(rows.filter(r => r.t >= s && r.t < s + len), m); if (v != null) pts.push([s, v]); }
  return pts;
}
function windowPts(rows, from, m, now) {                // plain history since `from` (carries the value in effect at `from`)
  const before = rows.filter(r => r.t < from), inW = rows.filter(r => r.t >= from);
  const pts = inW.map(r => [r.t, val(r, m)]).filter(p => p[1] != null);
  const carry = before.length ? val(before[before.length - 1], m) : null;
  if (carry != null && from - before[before.length - 1].t <= GAP) pts.unshift([from, carry]);
  if (!pts.length) return [];
  if (pts[pts.length - 1][0] < now && now - pts[pts.length - 1][0] <= GAP) pts.push([now, pts[pts.length - 1][1]]);
  return pts;
}
function niceTicks(min, max, n = 5) {
  if (min === max) max = min + 1;
  const raw = (max - min) / (n - 1), p = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / p;
  const step = (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * p, out = [];
  for (let v = Math.floor(min / step) * step; v <= Math.ceil(max / step) * step + step / 2; v += step) out.push(v);
  return out;
}
// ----- SVG step chart -----
function lineChart(el, series, { x0, x1, ticks, zero }) {
  const all = series.flatMap(s => s.pts);
  if (!all.length) { el.innerHTML = '<div class="chart-empty">N/A: no data for this period</div>'; return; }
  const W = 640, H = 300, L = 66, R = 14, T = 14, B = 30;
  let lo = Math.min(...all.map(p => p[1])), hi = Math.max(...all.map(p => p[1]));
  if (zero) lo = 0;
  const yt = niceTicks(lo, hi), y0 = yt[0], y1 = yt[yt.length - 1];
  const X = t => L + (t - x0) / (x1 - x0 || 1) * (W - L - R), Y = v => H - B - (v - y0) / (y1 - y0 || 1) * (H - T - B);
  let g = yt.map(v => `<line x1="${L}" x2="${W - R}" y1="${Y(v)}" y2="${Y(v)}" stroke="#2a3322" stroke-dasharray="3 4"/><text x="${L - 8}" y="${Y(v) + 4}" text-anchor="end">${compact(v)}</text>`).join('');
  g += `<line x1="${L}" x2="${W - R}" y1="${H - B}" y2="${H - B}" stroke="#555f48"/>`;
  g += ticks.map(k => `<text x="${X(k.t)}" y="${H - 8}" text-anchor="middle">${k.l}</text>`).join('');
  for (const s of series) {
    if (!s.pts.length) continue;
    let d = `M${X(s.pts[0][0]).toFixed(1)},${Y(s.pts[0][1]).toFixed(1)}`;
    for (let i = 1; i < s.pts.length; i++) d += ` H${X(s.pts[i][0]).toFixed(1)} V${Y(s.pts[i][1]).toFixed(1)}`;
    const e = s.pts[s.pts.length - 1];
    g += `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="2.5" stroke-linejoin="round"/>`;
    if (s.pts.length <= 200) g += s.pts.map(p => `<circle cx="${X(p[0]).toFixed(1)}" cy="${Y(p[1]).toFixed(1)}" r="2.2" fill="${s.color}"/>`).join('');   // one dot per snapshot
    g += `<circle cx="${X(e[0])}" cy="${Y(e[1])}" r="3.5" fill="${s.color}"/>`;
  }
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img">${g}</svg>`;
}
function drawGraph(key) {
  const G = GRAPHS[key], st = gstate[key], now = Date.now(), src = seriesData[G.src || key], el = $('c-' + key);
  if (!src || !el) return;
  const m = st.metric, tab = st.tab;
  let build, opt;
  if (key === 'day' || key === 'week') {
    const wk = key === 'week', len = wk ? WEEK : DAY, startOf = wk ? weekStart : dayStart;
    if (tab === 'final') {
      const n = wk ? 12 : 30, first = startOf(now) - (n - 1) * len, starts = Array.from({ length: n }, (_, i) => first + i * len);
      build = rows => finalPts(rows, starts, len, m);
      opt = { x0: first, x1: startOf(now) + len, ticks: starts.filter((_, i) => i % Math.ceil(n / 6) === 0).map(t => ({ t, l: fmtDate(t) })) };
    } else {
      const start = startOf(now) - (tab === 'today' || tab === 'current' ? 0 : len);
      build = rows => periodPts(rows, start, start + len, m, now);
      opt = { x0: start, x1: start + len, zero: m !== 'kdr',
        ticks: wk ? ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((l, i) => ({ t: start + i * DAY, l }))
                  : [0, 6, 12, 18, 24].map(h => ({ t: start + h * 36e5, l: String(h).padStart(2, '0') + ':00' })) };
    }
  } else {
    const all = ['a', 'b'].flatMap(s => src[s]).map(r => r.t);
    const from = tab === 'season' ? (all.length ? Math.min(...all) : now - 30 * DAY) : now - Number(tab) * DAY;
    build = rows => windowPts(rows, from, m, now);
    opt = { x0: from, x1: now, ticks: dateTicks(from, now) };
  }
  lineChart(el, [{ pts: build(src.a), color: '#f2b84b' }, { pts: build(src.b), color: '#5aa9ff' }], opt);
}

// ================= RUN =================
function prep(s) { for (const k of Object.keys(s)) for (const side of ['a', 'b']) s[k][side].forEach(r => { r.t = Date.parse(r.observed_at); }); return s; }

async function run() {
  const ia = pickId($('inA').value), ib = pickId($('inB').value);
  if (!ia || !ib) { $('msg').textContent = 'Pick both from the list that appears as you type.'; return; }
  if (ia === ib) { $('msg').textContent = 'Pick two different ones.'; return; }
  const q = `type=${type}&a=${encodeURIComponent(ia)}&b=${encodeURIComponent(ib)}`;
  history.replaceState(null, '', `?${q}`);
  $('msg').textContent = 'Loading...'; $('result').innerHTML = '';
  try {
    const d = await getJson(`${API}?mode=compare&${q}`);
    names = { a: d.info.a.name, b: d.info.b.name };
    gstate = JSON.parse(JSON.stringify(GSTATE0));
    const keys = type === 'player' ? ['day', 'week', 'ranked'] : ['ckills', 'cmembers'];
    $('result').innerHTML = (type === 'player' ? renderPlayers(d) : renderClans(d)) + renderAverages(d)
      + `<div class="gr-grid">${keys.map(graphCard).join('')}</div><p class="gr-note">Day and week boundaries use UTC. Lines show what the collector recorded, so history starts from when collection began.</p>`;
    $('msg').textContent = '';
    seriesData = prep(await getJson(`${API}?mode=series&${q}`));
    keys.forEach(drawGraph);
  } catch (e) { console.error(e); $('msg').textContent = 'Could not load the comparison: ' + e.message; }
}

// graph tabs / metric pills
$('result').addEventListener('click', e => {
  const b = e.target.closest('[data-tab],[data-metric]'); if (!b) return;
  const key = b.closest('[data-g]').dataset.g;
  if (b.dataset.tab) gstate[key].tab = b.dataset.tab; else gstate[key].metric = b.dataset.metric;
  $('g-' + key).outerHTML = graphCard(key);
  drawGraph(key);
});
// players / clans switch
$('typeTabs').addEventListener('click', async e => {
  const b = e.target.closest('[data-type]'); if (!b || b.dataset.type === type) return;
  type = b.dataset.type;
  document.querySelectorAll('#typeTabs button').forEach(x => x.classList.toggle('on', x === b));
  $('inA').value = $('inB').value = ''; $('result').innerHTML = '';
  $('inA').placeholder = type === 'player' ? 'First player' : 'First clan';
  $('inB').placeholder = type === 'player' ? 'Second player' : 'Second clan';
  await loadOptions();
});
$('go').addEventListener('click', run);
[$('inA'), $('inB')].forEach(i => i.addEventListener('keydown', e => { if (e.key === 'Enter') run(); }));

// open a shared link like compare.html?type=player&a=ID&b=ID
(async () => {
  const p = new URLSearchParams(location.search);
  if (p.get('type') === 'clan') {
    type = 'clan';
    document.querySelectorAll('#typeTabs button').forEach(x => x.classList.toggle('on', x.dataset.type === 'clan'));
    $('inA').placeholder = 'First clan'; $('inB').placeholder = 'Second clan';
  }
  await loadOptions();
  if (p.get('a') && p.get('b')) {
    $('inA').value = idToLabel[p.get('a')] || ''; $('inB').value = idToLabel[p.get('b')] || '';
    if ($('inA').value && $('inB').value) run();
  }
})();
