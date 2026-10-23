// ================= CONFIG =================
// ONE request loads everything (daily, weekly, ranked seasons, clans). Switching tabs never calls the API again.
// The snapshot is also cached in this browser for 5 minutes, so reloading or coming back to the page does not
// use up the "1 request per 5 minutes per IP" budget. If you ever need to go through your own server instead,
// change this to '/api/pangolin-test'.
const API_URL = 'https://api.pangolinworks.dev/blast-buddies';
const CACHE_KEY = 'bb-snapshot-v1';
const CACHE_MS = 5 * 60 * 1000;
const BOARD_N = 100;   // daily / weekly / clans show the top 100 (that is all the API publishes)

// xpToLevel() and MAX_LEVEL come from js/level.js
// window.BB_WEAPONS (weapon id -> name, matches images/weapons/<name>.png) comes from js/weapon-name.js

// Clan color number -> CSS color. Colors not listed fall back to white. Add more as you identify them.
const CLAN_COLORS = {
  0:'#ff4d4d',   // red
  1:'#ff9a2e',   // orange
  3:'#d4a017',   // darker yellow
  6:'#4dff6a',   // green
  7:'#2f9e44',   // darker green
  9:'#1fa3a3',   // dark cyan
  11:'#1f3dff',  // bright dark blue
  13:'#2b4aa8',  // dark blue
  16:'#b86bff',  // purple (see note: also described as red)
  18:'#ff5c8a',  // slightly more pink red
  23:'#ffd84d',  // yellow
  26:'#8ff7ff',  // lighter cyan
  27:'#4df0ff',  // cyan
  30:'#ff7ac8'   // pink
};

// ================= PLACEHOLDER DATA SOURCES =================
// Personal bests per playerId: { [playerId]: { kills, deaths, kdr } }  (daily / weekly views only)
//   kills = highest daily kills, deaths = LOWEST daily deaths, kdr = highest daily KDR.
async function getPersonalBests(players) {
  // TODO: connect the real source, e.g.
  // const r = await fetch(`/api/personal-bests?ids=${players.map(p => p.playerId).join(',')}`); return r.json();
  return {};   // no data yet -> every bar shows as full with "NEW"
}

// ================= HELPERS =================
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const kdrOf = p => p.deaths > 0 ? p.kills / p.deaths : p.kills;
const fmt = n => Number(n ?? 0).toLocaleString();
const PH = "this.onerror=null;this.src='images/placeholder.png'";
const weaponName = id => (window.BB_WEAPONS && window.BB_WEAPONS[id]) || ('Weapon ' + id);
const clamp01 = x => Math.max(0, Math.min(1, x));

// mode 'high': higher is better (kills, kdr). mode 'low': lower is better (deaths).
function compare(cur, best, mode) {
  if (best == null) return { fill: 1, pct: null };
  if (mode === 'high') {
    if (best <= 0) return { fill: 1, pct: null };
    return { fill: Math.min(1, cur / best), pct: (cur / best - 1) * 100 };
  }
  if (cur <= best) return { fill: 1, pct: best > 0 ? (cur / best - 1) * 100 : null };
  return { fill: best > 0 ? best / cur : 0.03, pct: best > 0 ? (cur / best - 1) * 100 : null };
}
function pctHtml(pct, mode) {
  if (pct == null) return '<span class="pct new">NEW</span>';
  const good = mode === 'high' ? pct >= 0 : pct <= 0;
  return `<span class="pct ${good ? 'good' : 'bad'}">${pct > 0 ? '+' : ''}${pct.toFixed(1)}%</span>`;
}
function statCell(valueText, c, mode, cls, dl = '') {
  return `<div class="stat"><div class="top"><span>${valueText}</span>${pctHtml(c.pct, mode)}</div><div class="bar ${cls}"><i style="width:${(c.fill * 100).toFixed(1)}%"></i></div>${dl}</div>`;
}
// Plain stat cell with a bar (used by the ranked and clan views)
const simpleStat = (txt, frac, cls, extra = '') =>
  `<div class="stat"><div class="top"><span>${txt}</span>${extra}</div><div class="bar ${cls}"><i style="width:${(clamp01(frac) * 100).toFixed(1)}%"></i></div></div>`;
const weaponImg = (id, style = '') => {
  const name = weaponName(id);
  // try images/weapons/<name>.png, then <id>.png, then the placeholder
  return `<img${style ? ` style="${style}"` : ''} src="images/weapons/${esc(name)}.png" alt="${esc(name)}" title="${esc(name)}" onerror="this.onerror=function(){this.onerror=null;this.src='images/placeholder.png'};this.src='images/weapons/${esc(id)}.png'">`;
};

// ================= SNAPSHOT (one request, cached) =================
let snap = null, snapAt = 0, snapNote = '';

async function loadSnapshot() {
  if (snap && Date.now() - snapAt < CACHE_MS) return;
  let stored = null;
  try { stored = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null'); } catch (e) { /* no usable cache */ }
  if (stored && Date.now() - stored.at < CACHE_MS) { snap = stored.data; snapAt = stored.at; snapNote = ''; return; }
  try {
    const res = await fetch(API_URL);
    if (res.status === 429) {
      const wait = Number(res.headers.get('Retry-After')) || 300;
      throw new Error(`rate limited, try again in about ${Math.ceil(wait / 60)} min`);
    }
    if (!res.ok) throw new Error('HTTP ' + res.status);
    snap = await res.json(); snapAt = Date.now(); snapNote = '';
    try { localStorage.setItem(CACHE_KEY, JSON.stringify({ at: snapAt, data: snap })); } catch (e) { /* too big for storage: memory cache still works */ }
  } catch (e) {
    console.warn('API failed:', e);
    if (!snap && stored) { snap = stored.data; snapAt = stored.at; }
    if (!snap) throw e;
    snapNote = ` (couldn't refresh: ${e.message}. Showing the last saved data.)`;
  }
}

// ---- pull the pieces out of the snapshot ----
const listOf = v => Array.isArray(v) ? v : (Array.isArray(v?.top) ? v.top : []);
const rowsOf = s => s?.top || s?.standings || s?.players || s?.rows || [];
function rankedSeasons(d) {   // newest first; seasons the API marks available:false are left out
  const out = new Map();
  const add = s => { if (s && typeof s === 'object' && s.season != null && s.available !== false && rowsOf(s).length) out.set(Number(s.season), s); };
  for (const v of Object.values(d?.ranked || {})) { if (Array.isArray(v)) v.forEach(add); else add(v); }
  return [...out.values()].sort((a, b) => b.season - a.season);
}

// Clan history: the API keeps the top 20 clans of each previous month, with every member's kills.
function clanArchives(d) {   // newest month first
  const a = d?.clans?.archives || d?.clanArchives || [];
  return a.filter(m => m && m.period && rowsOf(m).length).sort((x, y) => String(y.period).localeCompare(String(x.period)));
}
function monthLabel(period) {
  const [y, m] = String(period).split('-').map(Number);
  if (!y || !m) return String(period);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleString(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

// playerId -> a row that has full details (stats / weapons / seasons), so slim ranked rows can borrow them
let detail = new Map();
function buildDetail() {
  detail = new Map();
  const add = rows => rows.forEach(p => { if (p?.playerId && p.stats && !detail.has(p.playerId)) detail.set(p.playerId, p); });
  const seasons = rankedSeasons(snap);
  seasons.slice(0, 1).forEach(s => add(rowsOf(s)));
  add(listOf(snap.leaderboards?.daily));
  add(listOf(snap.leaderboards?.weekly));
  seasons.slice(1).forEach(s => add(rowsOf(s)));
}
const FILL_ALWAYS = ['totalXp', 'level', 'stats', 'seasons', 'weaponStats'];
const FILL_CURRENT = ['topWeaponId', 'topWeaponSkinId', 'clanTag', 'clanColor', 'clanId'];
function fill(p, isCurrent) {
  const d = detail.get(p.playerId);
  if (!d || d === p) return p;
  const o = { ...p };
  for (const k of [...FILL_ALWAYS, ...(isCurrent ? FILL_CURRENT : [])]) if (o[k] == null && d[k] != null) o[k] = d[k];
  return o;
}
const levelOf = p => p.totalXp != null ? xpToLevel(p.totalXp) : (p.level ?? null);

// ================= VIEW STATE =================
let view = { type: 'daily', season: null };
let rows = [], hmToken = 0;
const keyOf = v => v.type === 'ranked' ? 'ranked-' + v.season : v.type === 'history' ? 'history-' + v.period : v.type;
function parseKey(k) {
  if (k === 'daily' || k === 'weekly' || k === 'clans') return { type: k, season: null };
  let m = /^ranked-(\d+)$/.exec(k || '');
  if (m && rankedSeasons(snap).some(s => s.season === Number(m[1]))) return { type: 'ranked', season: Number(m[1]) };
  m = /^history-(\d{4}-\d{2})$/.exec(k || '');
  if (m && clanArchives(snap).some(a => a.period === m[1])) return { type: 'history', period: m[1] };
  return null;
}
const boardName = () => view.type === 'weekly' ? 'week' : 'day';

function renderTabs() {
  const archives = clanArchives(snap);
  const tabs = [['daily', 'Daily'], ['weekly', 'Weekly'],
    ...rankedSeasons(snap).map(s => ['ranked-' + s.season, 'Ranked S' + s.season]), ['clans', 'Clans'],
    ...(archives.length ? [['history-' + archives[0].period, 'Clan History']] : [])];
  const active = k => view.type === 'history' ? k.startsWith('history-') : k === keyOf(view);
  let html = tabs.map(([k, l]) =>
    `<button class="pill" data-k="${k}" style="${active(k) ? 'outline:2px solid currentColor' : 'opacity:.65'}">${l}</button>`).join('');
  if (view.type === 'history') {
    html += `<select id="month" class="pill" aria-label="Month">${archives.map(a =>
      `<option value="history-${esc(a.period)}"${a.period === view.period ? ' selected' : ''}>${esc(monthLabel(a.period))}</option>`).join('')}</select>`;
  }
  $('tabs').innerHTML = html;
}
$('tabs').addEventListener('click', e => {
  const b = e.target.closest('[data-k]'); if (!b) return;
  const v = parseKey(b.dataset.k); if (!v) return;
  history.replaceState(null, '', '#' + b.dataset.k);
  setView(v);
});
$('tabs').addEventListener('change', e => {
  if (e.target.id !== 'month') return;
  const v = parseKey(e.target.value); if (!v) return;
  history.replaceState(null, '', '#' + e.target.value);
  setView(v);
});

function renderHead() {
  const icon = (src, t) => `<img src="images/icons/${src}.png" alt="${t}" title="${t}">`;
  const txt = t => `<span style="text-align:center">${t}</span>`;
  let h;
  $('head').className = 'lb-row lb-head' + (view.type === 'clans' || view.type === 'history' ? ' cl-row' : '');
  if (view.type === 'ranked') {
    h = [txt('#'), '<span>Nickname</span>', icon('col-lvl', 'Level'), icon('col-trophies', 'Trophies'), icon('col-wins', 'Wins'), icon('col-losses', 'Losses'), icon('col-weapon', 'Top weapon'), icon('col-clan', 'Clan'), '<span></span>'];
  } else if (view.type === 'clans') {
    h = [txt('#'), '<span>Clan</span>', icon('col-kills', 'Kills'), icon('col-members', 'Members'), icon('col-clan', 'Tag'),
      `<img src="images/icons/col-status.png" alt="Join status" title="Open / closed to join">`, '<span></span>'];
  } else if (view.type === 'history') {
    h = [txt('#'), '<span>Clan</span>', icon('col-kills', 'Kills'), icon('col-members', 'Members'), icon('col-clan', 'Tag'), '<span></span>', '<span></span>'];
  } else {
    h = [txt('#'), '<span>Nickname</span>', icon('col-lvl', 'Level'), icon('col-kills', 'Kills'), icon('col-deaths', 'Deaths'), icon('col-kdr', 'KDR'), icon('col-weapon', 'Top weapon'), icon('col-clan', 'Clan'), '<span></span>'];
  }
  $('head').innerHTML = h.join('');
}

// ================= BUILD ROWS FOR THE CURRENT VIEW =================
async function buildRows() {
  if (view.type === 'daily' || view.type === 'weekly') {
    const players = listOf(snap.leaderboards?.[view.type]).slice(0, BOARD_N);   // keeps the API's order
    const bests = await getPersonalBests(players);
    return players.map((p, i) => {
      const b = bests[p.playerId], kdr = kdrOf(p);
      return { rank: i + 1, hm: null, p, level: levelOf(p), kdr, color: p.clanColor,
        kc: compare(p.kills, b?.kills, 'high'), dc: compare(p.deaths, b?.deaths, 'low'), rc: compare(kdr, b?.kdr, 'high') };
    });
  }
  if (view.type === 'ranked') {
    const all = rankedSeasons(snap);
    const season = all.find(s => s.season === view.season);
    const isCurrent = season && season === all[0];
    return rowsOf(season).map((raw, i) => {
      const p = fill(raw, isCurrent);
      return { rank: raw.rank ?? i + 1, p, level: levelOf(p), color: p.clanColor };
    });
  }
  if (view.type === 'history') {
    const month = clanArchives(snap).find(a => a.period === view.period);
    return rowsOf(month).map((c, i) => ({ rank: c.rank ?? i + 1, c, color: c.color }));
  }
  return listOf(snap.clans).slice(0, BOARD_N).map((c, i) => ({ rank: c.rank ?? i + 1, c, color: c.color }));
}

async function setView(v) {
  view = v;
  renderTabs(); renderHead();
  const my = ++hmToken;
  const built = await buildRows();
  if (my !== hmToken) return;
  rows = built;
  await applyHourly();
}

// ================= HOURLY MARKS (daily / weekly only) =================
async function applyHourly() {
  if (!snap) return;
  const my = ++hmToken;
  const stamp = snap.generatedAt ? ` Updated ${new Date(snap.generatedAt).toLocaleTimeString()}.` : '';
  let hm = null, status;
  const isBoard = view.type === 'daily' || view.type === 'weekly';

  if (isBoard && rows.length) {
    const prev = await HOURLY.loadPrev(boardName());
    if (my !== hmToken) return;
    hm = HOURLY.marks(prev, rows.map(r => { const p = r.p; return { id: p.playerId, rank: r.rank, vals: { kills: p.kills, deaths: p.deaths, kdr: kdrOf(p) } }; }), { kills: 'high', deaths: 'low', kdr: 'high' }, 'kills');
    rows.forEach(r => { r.hm = hm ? hm.get(r.p.playerId) : null; });
  }
  const el = $('clanPower');
  if (el && window.CLANPOWER) {
    let power = [];
    if (isBoard && rows.length) power = CLANPOWER.top3(rows.map(r => ({ tag: r.p.clanTag, color: r.p.clanColor, score: r.p.kills })));
    else if ((view.type === 'clans' || view.type === 'history') && rows.length) power = CLANPOWER.top3(rows.map(r => ({ tag: r.c.tag, color: r.c.color, score: r.c.kills })));
    CLANPOWER.render(el, power, 'kills', CLAN_COLORS);
  }

  if (view.type === 'daily') status = `Top ${rows.length} players today.` + HOURLY.note(hm);
  else if (view.type === 'weekly') status = `Top ${rows.length} players this week.` + HOURLY.note(hm);
  else if (view.type === 'ranked') status = `Ranked season ${view.season}: ${rows.length} players.`;
  else if (view.type === 'history') status = `Top ${rows.length} clans in ${monthLabel(view.period)}. Click the icon on a clan to see every member's kills.`;
  else status = `Top ${rows.length} clans this month.`;
  $('status').innerHTML = status + stamp + esc(snapNote) + (snap.metadata?.stale ? ' <b>Data is stale.</b>' : '');
  render();
}
HOURLY.mountToggle(applyHourly);

// ================= RENDER =================
function render() {
  const q = $('q').value.trim().toLowerCase();
  let html;
  if (view.type === 'clans' || view.type === 'history') {
    const hist = view.type === 'history';
    const list = rows.filter(r => !q || r.c.name.toLowerCase().includes(q) || (r.c.tag || '').toLowerCase().includes(q));
    const maxK = Math.max(1, ...rows.map(r => r.c.kills || 0));
    html = list.map(r => {
      const c = r.c, col = CLAN_COLORS[c.color] || '#ffffff';
      const members = hist
        ? simpleStat(`${c.memberCount}`, c.memberCount / 20, 'b-lvl')   // archives have no member cap; clans hold up to 20
        : simpleStat(`${c.memberCount} / ${c.memberCap}`, c.memberCap ? c.memberCount / c.memberCap : 0, 'b-lvl');
      return `<div class="lb-row cl-row">
        <span class="rank">${r.rank}</span>
        <span class="pname" style="color:${col}" title="${esc(c.name)}">${esc(c.name)}</span>
        ${simpleStat(fmt(c.kills), c.kills / maxK, 'b-kills')}
        ${members}
        <span class="clan" style="color:${col}">${esc(c.tag)}</span>
        ${hist ? '<span></span>' : `<span style="color:${c.openJoin ? '#4dff6a' : '#ff4d4d'}">${c.openJoin ? 'Open' : 'Closed'}</span>`}
        ${hist ? `<button class="inspect" data-clan="${esc(c.clanId)}" aria-label="Members of ${esc(c.name)}"><img src="images/icons/inspect.png" alt="" onerror="${PH}"></button>` : '<span></span>'}
      </div>`;
    }).join('');
  } else if (view.type === 'ranked') {
    const list = rows.filter(r => !q || r.p.name.toLowerCase().includes(q) || (r.p.clanTag || '').toLowerCase().includes(q));
    const maxT = Math.max(1, ...rows.map(r => r.p.trophies || 0));
    const maxW = Math.max(1, ...rows.map(r => r.p.rankedWins || 0));
    const maxL = Math.max(1, ...rows.map(r => r.p.rankedLosses || 0));
    html = list.map(r => {
      const p = r.p, col = CLAN_COLORS[r.color] || '#ffffff';
      const g = (p.rankedWins || 0) + (p.rankedLosses || 0);
      const wr = g ? `<span class="pct new">${(p.rankedWins / g * 100).toFixed(0)}%</span>` : '';
      return `<div class="lb-row">
        <span class="rank">${r.rank}</span>
        <span class="pname" title="${esc(p.name)}">${esc(p.name)}</span>
        ${r.level != null ? `<div class="stat"><div class="top"><span>${r.level}</span><span class="pct new">/ ${MAX_LEVEL}</span></div><div class="bar b-lvl"><i style="width:${r.level / MAX_LEVEL * 100}%"></i></div></div>` : '<span class="muted">-</span>'}
        ${simpleStat(fmt(p.trophies), (p.trophies || 0) / maxT, 'b-kills')}
        ${simpleStat(fmt(p.rankedWins), (p.rankedWins || 0) / maxW, 'b-kdr', wr)}
        ${simpleStat(fmt(p.rankedLosses), (p.rankedLosses || 0) / maxL, 'b-deaths')}
        <span class="weapon">${p.topWeaponId != null ? weaponImg(p.topWeaponId) : ''}</span>
        <span class="clan" style="color:${col}">${p.clanTag ? esc(p.clanTag) : ''}</span>
        <button class="inspect" data-id="${esc(p.playerId)}" aria-label="Player details for ${esc(p.name)}"><img src="images/icons/inspect.png" alt="" onerror="${PH}"></button>
      </div>`;
    }).join('');
  } else {
    const list = rows.filter(r => !q || r.p.name.toLowerCase().includes(q) || (r.p.clanTag || '').toLowerCase().includes(q));
    html = list.map(r => {
      const p = r.p, col = CLAN_COLORS[r.color] || '#ffffff';
      return `<div class="lb-row">
        <span class="rank">${r.rank}${r.hm ? r.hm.move : ''}</span>
        <span class="pname" title="${esc(p.name)}">${esc(p.name)}</span>
        <div class="stat"><div class="top"><span>${r.level}</span><span class="pct new">/ ${MAX_LEVEL}</span></div><div class="bar b-lvl"><i style="width:${r.level / MAX_LEVEL * 100}%"></i></div></div>
        ${statCell(fmt(p.kills), r.kc, 'high', 'b-kills', r.hm?.d.kills)}
        ${statCell(fmt(p.deaths), r.dc, 'low', 'b-deaths', r.hm?.d.deaths)}
        ${statCell(r.kdr.toFixed(2), r.rc, 'high', 'b-kdr', r.hm?.d.kdr)}
        <span class="weapon">${weaponImg(p.topWeaponId)}</span>
        <span class="clan" style="color:${col}">${p.clanTag ? esc(p.clanTag) : ''}</span>
        <button class="inspect" data-id="${esc(p.playerId)}" aria-label="Player details for ${esc(p.name)}"><img src="images/icons/inspect.png" alt="" onerror="${PH}"></button>
      </div>`;
    }).join('');
  }
  $('rows').innerHTML = html || '<p class="muted" style="padding:24px">No results match.</p>';
}
$('q').addEventListener('input', render);

// ================= PLAYER DETAILS MODAL (daily, weekly and ranked) =================
// Everything comes from the snapshot already in memory, no extra API call.
const S_TABLE = 'width:100%;border-collapse:collapse;font-size:.9em';
const S_CELL = 'padding:4px 8px;text-align:right';
const S_CELL_L = 'padding:4px 8px;text-align:left';

function renderDetails(el, p) {
  const parts = [];

  // Lifetime stats (casual play included)
  const st = p.stats;
  if (st) {
    const lifeKdr = st.deaths > 0 ? st.kills / st.deaths : st.kills;
    parts.push(`<h4>Lifetime</h4><div class="dlg-grid">
      <div>Kills<b>${fmt(st.kills)}</b></div><div>Deaths<b>${fmt(st.deaths)}</b></div>
      <div>KDR<b>${lifeKdr.toFixed(2)}</b></div><div>Games<b>${fmt(st.games)}</b></div>
      <div>Assists<b>${fmt(st.assists)}</b></div>
    </div>`);
  }

  // Ranked seasons
  const seasons = (p.seasons || []).slice().sort((a, b) => a.season - b.season);
  if (seasons.length) {
    parts.push(`<h4>Ranked seasons</h4><table style="${S_TABLE}">
      <tr><th style="${S_CELL_L}">Season</th><th style="${S_CELL}">Trophies</th><th style="${S_CELL}">Wins</th><th style="${S_CELL}">Losses</th><th style="${S_CELL}">Win rate</th></tr>
      ${seasons.map(s => {
        const g = (s.rankedWins || 0) + (s.rankedLosses || 0);
        const wr = g ? (s.rankedWins / g * 100).toFixed(1) + '%' : '-';
        return `<tr><td style="${S_CELL_L}">${esc(s.season)}</td><td style="${S_CELL}">${fmt(s.trophies)}</td><td style="${S_CELL}">${fmt(s.rankedWins)}</td><td style="${S_CELL}">${fmt(s.rankedLosses)}</td><td style="${S_CELL}">${wr}</td></tr>`;
      }).join('')}
    </table>`);
  }

  // Weapons, most kills first
  const weapons = (p.weaponStats || []).filter(w => w.kills > 0).sort((a, b) => b.kills - a.kills);
  if (weapons.length) {
    parts.push(`<h4>Weapons</h4><table style="${S_TABLE}">
      <tr><th style="${S_CELL_L}">Weapon</th><th style="${S_CELL}">Kills</th><th style="${S_CELL}">Headshots</th><th style="${S_CELL}">HS %</th></tr>
      ${weapons.map(w => {
        const name = weaponName(w.weaponId);
        const knife = w.weaponId === 101;   // knife has no headshots
        const hs = knife ? '-' : (w.kills ? (w.headshots / w.kills * 100).toFixed(1) + '%' : '-');
        return `<tr><td style="${S_CELL_L}"><img src="images/weapons/${esc(name)}.png" alt="" title="${esc(name)}" onerror="${PH}" style="height:24px;vertical-align:middle;margin-right:6px">${esc(name)}</td><td style="${S_CELL}">${fmt(w.kills)}</td><td style="${S_CELL}">${knife ? '-' : fmt(w.headshots)}</td><td style="${S_CELL}">${hs}</td></tr>`;
      }).join('')}
    </table>`);
  }

  el.innerHTML = parts.join('') || 'Detailed stats (weapons, lifetime, seasons) are only published for some players. This player is not included.';
}

// Clan history popup: every member's kills for that month
function openClan(clanId) {
  const r = rows.find(x => x.c && x.c.clanId === clanId); if (!r) return;
  const c = r.c, col = CLAN_COLORS[c.color] || '#ffffff';
  const members = (c.members || []).slice().sort((a, b) => b.kills - a.kills);
  const total = c.kills || members.reduce((s, m) => s + (m.kills || 0), 0);
  $('dlgBody').innerHTML = `<h3 style="color:${col}">${esc(c.name)} [${esc(c.tag)}]</h3>
    <div class="muted">${esc(monthLabel(view.period))} · rank ${r.rank}</div>
    <div class="dlg-grid">
      <div>Total kills<b>${fmt(c.kills)}</b></div><div>Members<b>${fmt(c.memberCount)}</b></div>
      <div>Avg kills / member<b>${fmt(c.memberCount ? Math.round(c.kills / c.memberCount) : 0)}</b></div>
    </div>
    <div class="dlg-section"><table style="${S_TABLE}">
      <tr><th style="${S_CELL_L}">#</th><th style="${S_CELL_L}">Player</th><th style="${S_CELL}">Level</th><th style="${S_CELL}">Kills</th><th style="${S_CELL}">Share</th><th style="${S_CELL}">Weapon</th></tr>
      ${members.map((m, i) => `<tr>
        <td style="${S_CELL_L}">${i + 1}</td>
        <td style="${S_CELL_L}">${esc(m.name)}${m.isLeader ? ' <span title="Clan leader">👑</span>' : ''}</td>
        <td style="${S_CELL}">${m.level != null ? esc(m.level) : '-'}</td>
        <td style="${S_CELL}">${fmt(m.kills)}</td>
        <td style="${S_CELL}">${total ? (m.kills / total * 100).toFixed(1) + '%' : '-'}</td>
        <td style="${S_CELL}">${m.topWeaponId != null ? weaponImg(m.topWeaponId, 'height:24px;vertical-align:middle') : ''}</td>
      </tr>`).join('')}
    </table></div>`;
  $('dlg').showModal();
}

$('rows').addEventListener('click', e => {
  const btn = e.target.closest('.inspect'); if (!btn) return;
  if (btn.dataset.clan) return openClan(btn.dataset.clan);
  const r = rows.find(x => x.p && x.p.playerId === btn.dataset.id); if (!r) return;
  const p = r.p, g = (p.rankedWins || 0) + (p.rankedLosses || 0);
  let block;
  if (view.type === 'ranked') {
    block = `<h4>Ranked season ${view.season}</h4><div class="dlg-grid">
      <div>Rank<b>${r.rank}</b></div><div>Trophies<b>${fmt(p.trophies)}</b></div>
      <div>Wins<b>${fmt(p.rankedWins)}</b></div><div>Losses<b>${fmt(p.rankedLosses)}</b></div>
      <div>Win rate<b>${g ? (p.rankedWins / g * 100).toFixed(1) + '%' : '-'}</b></div>
      ${r.level != null ? `<div>Level<b>${r.level}</b></div>` : ''}
      ${p.totalXp != null ? `<div>Total XP<b>${fmt(p.totalXp)}</b></div>` : ''}
    </div>`;
  } else {
    block = `<h4>${view.type === 'weekly' ? 'This week' : 'Today'}</h4><div class="dlg-grid">
      <div>Level<b>${r.level}</b></div><div>Total XP<b>${fmt(p.totalXp)}</b></div>
      <div>Kills<b>${fmt(p.kills)}</b></div><div>Deaths<b>${fmt(p.deaths)}</b></div>
      <div>Assists<b>${fmt(p.assists)}</b></div><div>KDR<b>${r.kdr.toFixed(2)}</b></div>
    </div>`;
  }
  $('dlgBody').innerHTML = `<h3>${esc(p.name)}</h3><div class="muted">${p.clanTag ? '[' + esc(p.clanTag) + '] · ' : ''}ID ${esc(p.playerId)}</div>
    ${block}<div class="dlg-section" id="detailsSlot"></div>`;
  renderDetails($('detailsSlot'), p);
  $('dlg').showModal();
});
$('dlgClose').onclick = () => $('dlg').close();
$('dlg').addEventListener('click', e => { if (e.target === $('dlg')) $('dlg').close(); });

// ================= XLSX EXPORT (current tab) =================
$('xlsx').onclick = () => {
  if (!window.XLSX) return alert('XLSX library failed to load.');
  const pc = c => c.pct == null ? 'NEW' : +c.pct.toFixed(1);
  let data;
  if (view.type === 'clans' || view.type === 'history') {
    data = rows.map(r => ({ Rank: r.rank, Clan: r.c.name, Tag: r.c.tag, Members: r.c.memberCount, MemberCap: r.c.memberCap,
      OpenJoin: r.c.openJoin ? 'Yes' : 'No', Kills: r.c.kills }));
  } else if (view.type === 'ranked') {
    data = rows.map(r => ({ Rank: r.rank, Nickname: r.p.name, PlayerId: r.p.playerId, Level: r.level ?? '', Trophies: r.p.trophies,
      Wins: r.p.rankedWins, Losses: r.p.rankedLosses, WeaponId: r.p.topWeaponId ?? '', Clan: r.p.clanTag || '' }));
  } else {
    data = rows.map(r => ({ Rank: r.rank, Nickname: r.p.name, PlayerId: r.p.playerId, Level: r.level, TotalXP: r.p.totalXp,
      Kills: r.p.kills, 'Kills vs best %': pc(r.kc), Deaths: r.p.deaths, 'Deaths vs best %': pc(r.dc),
      KDR: +r.kdr.toFixed(2), 'KDR vs best %': pc(r.rc), Assists: r.p.assists, WeaponId: r.p.topWeaponId, Clan: r.p.clanTag || '' }));
  }
  const wb = XLSX.utils.book_new();
  if (view.type === 'history') {
    data = rows.map(r => ({ Rank: r.rank, Clan: r.c.name, Tag: r.c.tag, Members: r.c.memberCount, Kills: r.c.kills }));
    const members = rows.flatMap(r => (r.c.members || []).map(m => ({ ClanRank: r.rank, Clan: r.c.name, Tag: r.c.tag,
      Player: m.name, PlayerId: m.playerId, Level: m.level, Kills: m.kills, Leader: m.isLeader ? 'Yes' : '', WeaponId: m.topWeaponId })));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data), 'Clans');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(members), 'Members');
  } else {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data), keyOf(view).slice(0, 31));
  }
  XLSX.writeFile(wb, `blast-buddies-${keyOf(view)}-${new Date().toISOString().slice(0, 10)}.xlsx`);
};

// ================= START =================
(async function start() {
  try {
    await loadSnapshot();
  } catch (e) {
    $('status').innerHTML = `<b>Could not load the rankings:</b> ${esc(e.message)}. Try again in a few minutes.`;
    return;
  }
  buildDetail();
  const v = parseKey(location.hash.slice(1)) || { type: 'daily', season: null };
  await setView(v);
})();
