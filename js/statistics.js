// Statistics page. Needs: js/layout.js, js/clan-colors.js (CLAN_COLORS), /api/stats (records, level 100, guns) and /api/rooms (live players).
const STATS_URL = '/api/stats';
const ROOMS_URL = '/api/rooms';          // same project; use the full https://blast-buddies-portal.vercel.app/api/rooms if this page is hosted elsewhere
const ROOMS_EVERY = 30000;               // refresh the "online now" card every 30 s
const REGIONS = [['na', 'North America'], ['eu', 'Europe'], ['as', 'Asia']];

// topWeaponId -> weapon name (must match images/weapons/<Name>.png). FILL THIS IN, e.g. { 9: 'Assault', 12: 'Sniper' }
const WEAPON_NAMES = {};
const wName = id => WEAPON_NAMES[id] || 'Weapon ' + id;
const wImg = id => `images/weapons/${WEAPON_NAMES[id] || id}.png`;

const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = n => Number(n).toLocaleString();
const PH = "this.onerror=null;this.src='images/placeholder.png'";
const statIcon = id => `<img src="images/icons/${id}.png" alt="" onerror="${PH}">`;   // reuses the sidebar icons; swap for your own stat icons
const colorOf = c => CLAN_COLORS[c] || '#ffffff';
const tagHtml = (tag, color) => tag ? `<span class="st-tag" style="color:${colorOf(color)}">${esc(tag)}</span>` : '';

let stats = null, statsErr = false, rooms = null, lvPlayers = [];
const detail = {};

function card(key, o) {
  if (o.details) detail[key] = o.details;
  return `<div class="map-card st-card"${o.details ? ` data-d="${key}"` : ''}>
    <div class="st-head"><span class="st-icon">${statIcon(o.icon)}</span><div><div class="st-title">${o.title}</div><div class="st-sub">${o.sub}</div></div></div>
    ${o.value !== undefined ? `<div class="map-val">${o.value}</div>` : ''}
    ${(o.notes || []).map(n => `<div class="map-note">${n}</div>`).join('')}
    ${o.body || ''}
    ${o.details ? '<button class="see-details" type="button">See details</button>' : ''}
  </div>`;
}
const waiting = () => statsErr ? 'Stats API not reachable' : 'Loading...';

// ---------- level 100 ----------
const lvRows = q => {
  const l = lvPlayers.filter(p => !q || p.name.toLowerCase().includes(q) || (p.clan_tag || '').toLowerCase().includes(q));
  return l.map((p, i) => `<div class="st-row"><span class="n">${i + 1}</span><span class="nm">${esc(p.name)}</span><span>${tagHtml(p.clan_tag, p.clan_color)}</span></div>`).join('') || '<p class="muted">No players match.</p>';
};
function levelCard() {
  const l = stats?.level100;
  return card('lvl', { icon: 'podium', title: 'Players at level 100', sub: 'Estimated · seen on the top-50 boards',
    value: l ? fmt(l.count) : '—', notes: [l ? 'Click to see who' : waiting()],
    details: l ? () => { lvPlayers = l.players; return `<h3>Players at level 100</h3><div class="muted">Anyone who was ever seen at level 100 stays on this list. Estimate: only players that appeared on the top-50 boards are counted.</div>
      <input class="search st-filter" id="lvFilter" placeholder="Search name or clan" autocomplete="off"><div class="st-list" id="lvList">${lvRows('')}</div>`; } : null });
}

// ---------- records (top 3 holders each) ----------
const periodLabel = (key, r) => key === 'weekly_kills' ? 'Week of ' + r.period : key === 'ranked_trophies' ? `${r.period} · ${String(r.achieved_at).slice(0, 10)}` : (r.period || String(r.achieved_at).slice(0, 10));
const nameHtml = (r, isClan) => `<b>${esc(r.holder_name)}</b> ${isClan ? (r.clan_tag ? '[' + tagHtml(r.clan_tag, r.clan_color) + ']' : '') : tagHtml(r.clan_tag, r.clan_color)}`;
function recordCard(key, title, sub, iconId, isClan) {
  const list = stats?.records?.[key] || [];
  if (!list.length) return card(key, { icon: iconId, title, sub, notes: [stats ? 'No records yet' : waiting()] });
  const body = `<div class="st-recs">${list.map((r, i) => `<div class="st-rec"><b class="st-rank r${i + 1}">${i + 1}</b>
      <div class="who">${nameHtml(r, isClan)}<small class="st-ok">${esc(periodLabel(key, r))}</small></div><span class="val">${fmt(r.value)}</span></div>`).join('')}</div>`;
  return card(key, { icon: iconId, title, sub, body,
    details: () => `<h3>${title}</h3><div class="muted">${sub}. Top ${list.length}, one entry per ${isClan ? 'clan' : 'player'} (their own best).</div>
      <div class="st-list">${list.map((r, i) => `<div class="st-row" style="grid-template-columns:34px 1fr auto"><span class="n">${i + 1}</span>
        <span class="nm" style="white-space:normal">${nameHtml(r, isClan)}<br><small class="muted">${esc(periodLabel(key, r))} · ${isClan ? 'clan' : 'player'} ID ${esc(r.holder_id)}${isClan && r.clan_tag ? ` · <span class="st-swatch" style="background:${colorOf(r.clan_color)}"></span>color ${esc(r.clan_color)}` : ''}</small></span>
        <span class="r"><b style="color:var(--text);font-size:17px">${fmt(r.value)}</b></span></div>`).join('')}</div>` });
}

// ---------- popular guns (top 3 of the top 50) ----------
function gunCard(board, label) {
  const g = stats?.guns?.[board], list = g?.list || [], total = g?.total || 0;
  const bar = x => `<div class="bar b-lvl"><i style="width:${total ? x.count / total * 100 : 0}%"></i></div>`;
  const body = list.length
    ? `<div class="st-guns">${list.slice(0, 3).map(x => `<div class="st-gun"><img src="${esc(wImg(x.id))}" alt="" onerror="${PH}"><div><div class="t"><span>${esc(wName(x.id))}</span><small>${x.count} of ${total}</small></div>${bar(x)}</div></div>`).join('')}</div>`
    : `<div class="map-note">${stats ? 'No data' : waiting()}</div>`;
  return card('guns-' + board, { icon: 'weapons', title: 'Most popular guns', sub: `${label} · top ${total || 50} players`, body,
    details: list.length ? () => `<h3>Most popular guns · ${label}</h3><div class="muted">Main weapon of each of the top ${total} players on the ${label.toLowerCase()} leaderboard.</div>
      <div class="st-list">${list.map((x, i) => `<div class="st-row gun"><img src="${esc(wImg(x.id))}" alt="" onerror="${PH}"><span class="nm">${i + 1}. ${esc(wName(x.id))}</span><span class="r">${x.count} players (${(x.count / total * 100).toFixed(0)}%)</span></div>`).join('')}</div>` : null });
}

// ---------- players online now ----------
function roomStats() {
  if (!rooms || !rooms.regions) return null;
  const out = []; let total = 0, count = 0;
  for (const [k, name] of REGIONS) {
    const r = rooms.regions[k]; if (!r) continue;
    const list = r.success && Array.isArray(r.data) ? r.data : [];
    const players = list.reduce((s, x) => s + (Number(x.players) || 0), 0);
    out.push({ k, name, ok: !!r.success, list, players }); total += players; count += list.length;
  }
  return { regions: out, total, count };
}
function onlineCard() {
  const s = roomStats();
  if (!s) return card('online', { icon: 'player-updates', title: 'Players online now', sub: 'NA + EU + AS · live', value: '—', notes: [rooms === false ? 'Rooms API not reachable' : 'Loading...'] });
  return card('online', { icon: 'player-updates', title: 'Players online now', sub: 'NA + EU + AS · live', value: fmt(s.total),
    notes: [s.regions.map(r => `${r.k.toUpperCase()} <b>${r.ok ? r.players : '?'}</b>`).join(' · '), `<span class="st-ok">${s.count} active rooms</span>`],
    details: () => `<h3>Players online now</h3><div class="muted">${fmt(s.total)} players in ${s.count} rooms. Refreshes every ${ROOMS_EVERY / 1000} seconds.</div>` +
      s.regions.map(r => `<div class="st-reg"><span>${r.name}</span><small>${r.ok ? `${r.players} players · ${r.list.length} rooms` : 'unavailable'}</small></div>
        <div class="st-list">${[...r.list].sort((a, b) => b.players - a.players).map(x => `<div class="st-row" style="grid-template-columns:1fr auto"><span class="nm">${esc(x.map)} <span class="muted">· ${esc(x.mode)} ${esc(x.gameMode)}</span></span><span class="r">${x.players}/${x.maxPlayers}</span></div>`).join('') || '<p class="muted">No rooms.</p>'}</div>`).join('') });
}

// ---------- page ----------
function render() {
  $('stGrid').innerHTML = [
    levelCard(), onlineCard(),
    recordCard('daily_kills', 'Highest daily kills', 'Top 3 · daily · all time', 'daily'),
    recordCard('weekly_kills', 'Highest weekly kills', 'Top 3 · weekly · all time', 'weekly'),
    recordCard('ranked_trophies', 'Highest ranked trophies', 'Top 3 · ranked · all time', 'season'),
    recordCard('clan_kills', 'Highest clan kills', 'Top 3 · clans · all time', 'clans', true),
    gunCard('day', 'Daily'), gunCard('week', 'Weekly'), gunCard('ranked', 'Ranked'),
  ].join('');
}
$('stGrid').addEventListener('click', e => {
  const c = e.target.closest('[data-d]'); if (!c || !detail[c.dataset.d]) return;
  $('dlgBody').innerHTML = detail[c.dataset.d]();
  $('dlg').showModal();
});
$('dlgBody').addEventListener('input', e => { if (e.target.id === 'lvFilter') $('lvList').innerHTML = lvRows(e.target.value.trim().toLowerCase()); });
$('dlgClose').onclick = () => $('dlg').close();
$('dlg').addEventListener('click', e => { if (e.target === $('dlg')) $('dlg').close(); });

async function loadStats() {
  try {
    const r = await fetch(STATS_URL); if (!r.ok) throw new Error('HTTP ' + r.status);
    stats = await r.json(); statsErr = false;
    $('status').textContent = 'Records and level-100 counts are estimates built from the top-50 leaderboards. Updated ' + new Date(stats.updatedAt).toLocaleTimeString() + '.';
  } catch (e) {
    console.warn('stats failed:', e); statsErr = true;
    $('status').innerHTML = '<b>Could not load statistics.</b> Check the Console (F12) for details.';
  }
  render();
}
async function loadRooms() {
  try { const r = await fetch(ROOMS_URL); if (!r.ok) throw new Error('HTTP ' + r.status); rooms = await r.json(); }
  catch (e) { console.warn('rooms failed:', e); if (!rooms) rooms = false; }
  render();
}
render();
loadStats();
loadRooms();
setInterval(loadRooms, ROOMS_EVERY);
