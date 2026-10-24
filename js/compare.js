// ================= CONFIG =================
// Players: lifetime stats come from the `players` table through /api/stats (compare-* modes).
// Clans: still /api/compare (api/compare.js on Vercel). Use full https:// URLs if these pages are hosted somewhere else.
const API = '/api/compare';
const PLAYER_API = '/api/stats';
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
// clan averages come from the SQL views: [label, column, rankColumn, better, format]
const AVG = {
  clan:   [['Average kills', 'avg_kills', 'avg_kills_rank', 'high'], ['Maximum kills', 'max_kills', null, 'high'], ['Average members', 'avg_members', 'avg_members_rank', 'high'], ['Maximum members', 'max_members', null, 'high']],
};

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
const WN = id => (window.BB_WEAPONS && window.BB_WEAPONS[id]) || ('Weapon ' + id);                       // image file name
const WL = id => (window.BB_WEAPON_LABELS && window.BB_WEAPON_LABELS[id]) || WN(id);                     // name shown to players
const wIcon = id => `<img src="images/weapons/${esc(WN(id))}.png" alt="" style="height:20px;vertical-align:middle;margin-right:6px" onerror="this.onerror=null;this.style.display='none'">`;

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
// na / nb = optional small notes under each value
function cmpRow(label, va, vb, o = {}) {
  const { dir = 'high', fmt = compact, dfmt = fmt, ra = null, rb = null, diff = true, bar = true, na = '', nb = '' } = o;
  const has = va != null && vb != null;
  const hi = has && va !== vb ? (va > vb ? 'a' : 'b') : null;                      // the HIGHER number gets the + difference
  const lead = hi ? (dir === 'high' ? hi : (hi === 'a' ? 'b' : 'a')) : null;       // the BETTER number is highlighted
  let d = '';
  if (hi && diff) {
    const hv = Math.max(va, vb), lv = Math.min(va, vb), pct = lv > 0 ? (hv / lv - 1) * 100 : null;
    d = `+${dfmt(hv - lv)}` + (pct == null ? '' : ` · +${pct < 10 ? pct.toFixed(1) : Math.round(pct).toLocaleString()}%`);
  }
  const cell = (s, v, r, n) => `<div class="v ${s}${lead === s ? ' lead' : ''}"><b>${v == null ? 'N/A' : fmt(v)}</b><small>${[r ? '#' + r : '', n, hi === s ? d : ''].filter(Boolean).join(' ')}</small></div>`;
  const share = has && va + vb > 0 ? va / (va + vb) * 100 : 50;
  return { lead, html: `<div class="cmp-row">${cell('a', va, ra, na)}<div class="mid">${label}<div class="split${has && bar ? '' : ' none'}"><i style="width:${share}%"></i></div></div>${cell('b', vb, rb, nb)}</div>` };
}
// a row of plain text values (clan, top weapon ...)
const textRow = (label, ta, tb) => `<div class="cmp-row"><div class="v a"><b>${esc(ta ?? 'N/A')}</b></div><div class="mid">${label}<div class="split none"><i></i></div></div><div class="v b"><b>${esc(tb ?? 'N/A')}</b></div></div>`;

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
    if (!options[type].length) options[type] = await getJson(type === 'player' ? `${PLAYER_API}?mode=compare-options` : `${API}?mode=options&type=${type}`);
    labelToId = {}; idToLabel = {};
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
// players: the winner is decided by lifetime KDR ONLY; the bar shows the two KDRs
function kdrHead(info, ka, kb, body) {
  const has = ka != null && kb != null, tie = has && ka === kb;
  const title = !has ? 'NOT ENOUGH DATA' : tie ? 'TIED' : 'LEADING';
  const who = has && !tie ? `<span style="color:var(${ka > kb ? '--ca' : '--cb'})">${esc((ka > kb ? info.a : info.b).name)}</span>` : '';
  const bar = has && ka + kb > 0 ? `<i class="a" style="flex:${ka}">${ka.toFixed(2)}</i><i class="b" style="flex:${kb}">${kb.toFixed(2)}</i>` : '<i style="flex:1;background:#2a3322;color:#8b9380">N/A</i>';
  return `<div class="cmp-card"><div class="cmp-head"><h3>${who}<small>${title} · LIFETIME KDR</small></h3><div class="leadbar">${bar}</div></div>
    <div class="cmp-names">${nameTag('a', info.a)}${nameTag('b', info.b)}</div>${body}</div>`;
}

const when = iso => new Date(iso).toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
const dateOnly = iso => iso ? new Date(iso).toISOString().slice(0, 10) : null;
const secHead = (title, notes) => `<div class="cmp-sec">${title}${notes.length ? `<span class="note">${esc(notes.join(' · '))}</span>` : ''}</div>`;

// Players. Lifetime numbers (all modes) come from the `players` table. Nothing from the daily / weekly / ranked sections
// below is counted in the result: the leader is whoever has the better lifetime KDR.
function renderPlayers(d) {
  const { info } = d, A = d.a, P = d.b;
  const lvl = p => p.total_xp != null ? xpToLevel(Number(p.total_xp)) : num(p.level);
  const kdrOf = p => num(p.kills) == null ? null : val({ kills: p.kills, deaths: p.deaths }, 'kdr');
  const perGame = (p, f) => { const g = num(p.games), v = num(p[f]); return g > 0 && v != null ? v / g : null; };
  const f2 = v => v.toFixed(2);
  const ka = kdrOf(A), kb = kdrOf(P);
  const missing = [num(A.kills) == null ? `${info.a.name}: lifetime stats not collected yet` : '', num(P.kills) == null ? `${info.b.name}: lifetime stats not collected yet` : ''].filter(Boolean);
  let body = '';

  // ----- profile -----
  body += secHead('PROFILE', []);
  body += cmpRow('Level', lvl(A), lvl(P), { fmt: v => String(v), bar: false, diff: false }).html;
  body += cmpRow('Total XP', num(A.total_xp), num(P.total_xp), { bar: false, diff: false }).html;
  body += cmpRow('Games played', num(A.games), num(P.games), { bar: false, diff: false }).html;
  body += textRow('Clan', A.clan_tag ? `[${A.clan_tag}]` : 'None', P.clan_tag ? `[${P.clan_tag}]` : 'None');
  body += textRow('Top weapon', A.top_weapon_id != null ? WL(A.top_weapon_id) : null, P.top_weapon_id != null ? WL(P.top_weapon_id) : null);
  body += textRow('First seen by the tracker', dateOnly(A.first_seen_at), dateOnly(P.first_seen_at));

  // ----- lifetime (decides the result through KDR) -----
  body += secHead('LIFETIME · ALL MODES · RESULT IS DECIDED BY KDR ONLY', missing);
  body += cmpRow('Kills', num(A.kills), num(P.kills)).html;
  body += cmpRow('Deaths', num(A.deaths), num(P.deaths), { dir: 'low' }).html;
  body += cmpRow('KDR', ka, kb, { fmt: f2 }).html;
  body += cmpRow('Kills per game', perGame(A, 'kills'), perGame(P, 'kills'), { fmt: f2 }).html;
  body += cmpRow('Deaths per game', perGame(A, 'deaths'), perGame(P, 'deaths'), { dir: 'low', fmt: f2 }).html;

  // ----- guns -----
  const wa = new Map(d.weapons.a.map(w => [w.weapon_id, w])), wb = new Map(d.weapons.b.map(w => [w.weapon_id, w]));
  const ids = [...new Set([...wa.keys(), ...wb.keys()])].sort((x, y) => ((wb.get(y)?.kills || 0) + (wa.get(y)?.kills || 0)) - ((wb.get(x)?.kills || 0) + (wa.get(x)?.kills || 0)));
  if (ids.length) {
    const sum = m => [...m.values()].reduce((s, w) => s + w.kills, 0);
    const hsRate = m => { let k = 0, h = 0; for (const w of m.values()) if (w.weapon_id !== 101) { k += w.kills; h += w.headshots; } return k > 0 ? h / k * 100 : null; };
    const totA = sum(wa), totB = sum(wb);
    body += secHead('GUNS · LIFETIME KILLS WITH EACH GUN · NOT COUNTED IN THE RESULT', []);
    body += cmpRow('Headshot rate (all guns)', hsRate(wa), hsRate(wb), { fmt: FMT.winrate, dfmt: DFMT.winrate }).html;
    const note = (w, tot, id) => w ? [tot > 0 ? `${(w.kills / tot * 100).toFixed(0)}% of kills` : '', id !== 101 && w.kills ? `HS ${(w.headshots / w.kills * 100).toFixed(0)}%` : ''].filter(Boolean).join(' · ') : '';
    for (const id of ids) {
      const a = wa.get(id), b = wb.get(id);
      body += cmpRow(`${wIcon(id)}${esc(WL(id))}`, wa.size ? (a?.kills ?? 0) : null, wb.size ? (b?.kills ?? 0) : null, { na: note(a, totA, id), nb: note(b, totB, id) }).html;
    }
  }

  // ----- ranked seasons (all of them) -----
  const sa = new Map((A.seasons || []).map(s => [s.season, s])), sb = new Map((P.seasons || []).map(s => [s.season, s]));
  const seasons = [...new Set([...sa.keys(), ...sb.keys()])].sort((x, y) => y - x);
  if (seasons.length) {
    const wl = s => s ? `${s.rankedWins}W ${s.rankedLosses}L${s.rankedWins + s.rankedLosses ? ` (${(s.rankedWins / (s.rankedWins + s.rankedLosses) * 100).toFixed(0)}%)` : ''}` : '';
    body += secHead('RANKED SEASONS · NOT COUNTED IN THE RESULT', []);
    for (const n of seasons) body += cmpRow(`Season ${n} trophies`, num(sa.get(n)?.trophies), num(sb.get(n)?.trophies), { na: wl(sa.get(n)), nb: wl(sb.get(n)), diff: false }).html;
  }

  // ----- daily / weekly / ranked right now (not counted) -----
  const live = r => r && Date.now() - Date.parse(r.last_seen_at) < 3 * 36e5;   // the collector runs hourly
  for (const key of ['day', 'week', 'ranked']) {
    const B = BOARDS[key], ra = d.state.a[key], rb = d.state.b[key];
    const notes = [ra && !live(ra) ? `${info.a.name}: last seen ${when(ra.last_seen_at)}` : '', rb && !live(rb) ? `${info.b.name}: last seen ${when(rb.last_seen_at)}` : ''].filter(Boolean);
    body += secHead((key === 'ranked' ? `RANKED SEASON ${d.season}` : B.label.toUpperCase()) + ' · NOT COUNTED IN THE RESULT', notes);
    body += cmpRow('Leaderboard position', live(ra) ? num(ra.rank) : null, live(rb) ? num(rb.rank) : null, { dir: 'low', fmt: v => '#' + v, diff: false, bar: false }).html;
    for (const [m, label, dir] of B.metrics)
      body += cmpRow(label, val(ra, m), val(rb, m), { dir, fmt: FMT[m] || compact, dfmt: DFMT[m] || FMT[m] || compact }).html;
  }
  return kdrHead(info, ka, kb, body);
}

// Values come from the LIVE leaderboard APIs. Someone who is not on the live list shows the newest stored JSON values (fallback) and is marked "last seen".
function renderClans(d) {
  const { a, b } = d.info, lead = { a: 0, b: 0 }, fb = d.fallback || {};
  const la = d.pop.find(r => r.clan_id === a.id), lb = d.pop.find(r => r.clan_id === b.id);
  const ra = la || fb.a, rb = lb || fb.b;
  const sorted = d.pop.slice().sort((x, y) => (num(y.kills) ?? -1) - (num(x.kills) ?? -1));
  const idx = id => { const i = sorted.findIndex(r => r.clan_id === id); return i < 0 ? null : i + 1; };
  const notes = [!la && fb.a ? `${a.name}: last seen ${when(fb.a._at)}` : '', !lb && fb.b ? `${b.name}: last seen ${when(fb.b._at)}` : ''].filter(Boolean);
  let body = secHead('CLAN LEADERBOARD', notes);
  body += cmpRow('Leaderboard position', idx(a.id), idx(b.id), { dir: 'low', fmt: v => '#' + v, diff: false, bar: false }).html;
  for (const [m, label] of [['kills', 'Kills'], ['members', 'Members'], ['fill', 'Capacity filled']]) {
    const row = cmpRow(label, val(ra, m), val(rb, m), { fmt: FMT[m] || compact, dfmt: DFMT[m] || compact,
      ra: la ? rankIn(d.pop, 'clan_id', a.id, m, 'high') : null, rb: lb ? rankIn(d.pop, 'clan_id', b.id, m, 'high') : null });
    if (row.lead) lead[row.lead]++;
    body += row.html;
  }
  const open = r => r ? (r.open_join ? 'Open' : 'Closed') : 'N/A';
  body += `<div class="cmp-row"><div class="v a"><b>${open(ra)}</b></div><div class="mid">Join status<div class="split none"><i></i></div></div><div class="v b"><b>${open(rb)}</b></div></div>`;
  return headCard(d.info, lead, body);
}

// ================= RENDER: AVERAGES (clans) =================
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
  const cards = avgCard('Clan overview', find(d.averages, 'clan_id', d.info.a.id), find(d.averages, 'clan_id', d.info.b.id), AVG.clan, 'days');
  return `<div class="cmp-card"><div class="cmp-title">AVERAGE SCORES AND RANKINGS</div>
    <div class="avg-grid">${cards}</div>
    <p class="gr-note" style="margin:0;padding:0 28px 20px">Averages use one value per period (the last one seen). "×N" is how many periods were tracked. The # is the rank among all clans' averages.</p></div>`;
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
  const pq = `a=${encodeURIComponent(ia)}&b=${encodeURIComponent(ib)}`;
  history.replaceState(null, '', `?${q}`);
  $('msg').textContent = 'Loading...'; $('result').innerHTML = '';
  try {
    const player = type === 'player';
    const d = await getJson(player ? `${PLAYER_API}?mode=compare-players&${pq}` : `${API}?mode=compare&${q}`);
    names = { a: d.info.a.name, b: d.info.b.name };
    gstate = JSON.parse(JSON.stringify(GSTATE0));
    const keys = player ? ['day', 'week', 'ranked'] : ['ckills', 'cmembers'];
    $('result').innerHTML = (player ? renderPlayers(d) : renderClans(d) + renderAverages(d))
      + (player ? '<div class="cmp-sec" style="margin-top:28px">HISTORY · DAILY, WEEKLY AND RANKED</div>' : '')
      + `<div class="gr-grid">${keys.map(graphCard).join('')}</div><p class="gr-note">Day and week boundaries use UTC. Lines show what the collector recorded, so history starts from when collection began.</p>`;
    $('msg').textContent = '';
    seriesData = prep(await getJson(player ? `${PLAYER_API}?mode=compare-series&${pq}` : `${API}?mode=series&${q}`));
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
