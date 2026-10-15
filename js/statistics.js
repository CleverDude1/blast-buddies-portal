// Statistics page. Needs: js/layout.js, js/clan-colors.js (CLAN_COLORS), /api/stats (records, level 100, guns) and /api/rooms (live players).
const STATS_URL = '/api/stats';
const PODIUM_URL = '/api/podium';          // same data the Podium page uses (medals, players, clans)
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

let stats = null, statsErr = false, rooms = null, lvPlayers = [], podium = null, podiumErr = false;
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
const periodLabel = (key, r) => key === 'best_kdr' || key.startsWith('hour_gain_') ? r.period : key === 'weekly_kills' ? 'Week of ' + r.period : key === 'ranked_trophies' ? `${r.period} · ${String(r.achieved_at).slice(0, 10)}` : (r.period || String(r.achieved_at).slice(0, 10));
const nameHtml = (r, isClan) => `<b>${esc(r.holder_name)}</b> ${isClan ? (r.clan_tag ? '[' + tagHtml(r.clan_tag, r.clan_color) + ']' : '') : tagHtml(r.clan_tag, r.clan_color)}`;
function recordCard(key, title, sub, iconId, isClan) {
  const list = stats?.records?.[key] || [];
  const vf = key === 'best_kdr' ? v => Number(v).toFixed(2) : key.startsWith('hour_gain_') ? v => '+' + fmt(v) : fmt;
  if (!list.length) return card(key, { icon: iconId, title, sub, notes: [stats ? 'No records yet' : waiting()] });
  const body = `<div class="st-recs">${list.map((r, i) => `<div class="st-rec"><b class="st-rank r${i + 1}">${i + 1}</b>
      <div class="who">${nameHtml(r, isClan)}<small class="st-ok">${esc(periodLabel(key, r))}</small></div><span class="val">${vf(r.value)}</span></div>`).join('')}</div>`;
  return card(key, { icon: iconId, title, sub, body,
    details: () => `<h3>${title}</h3><div class="muted">${sub}. Top ${list.length}, one entry per ${isClan ? 'clan' : 'player'} (their own best).</div>
      <div class="st-list">${list.map((r, i) => `<div class="st-row" style="grid-template-columns:34px 1fr auto"><span class="n">${i + 1}</span>
        <span class="nm" style="white-space:normal">${nameHtml(r, isClan)}<br><small class="muted">${esc(periodLabel(key, r))} · ${isClan ? 'clan' : 'player'} ID ${esc(r.holder_id)}${isClan && r.clan_tag ? ` · <span class="st-swatch" style="background:${colorOf(r.clan_color)}"></span>color ${esc(r.clan_color)}` : ''}</small></span>
        <span class="r"><b style="color:var(--text);font-size:17px">${vf(r.value)}</b></span></div>`).join('')}</div>` });
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

// ---------- highest players online (all time) ----------
function peakCard() {
  const p = stats?.peak, base = { icon: 'player-updates', title: 'Highest players online', sub: 'All time · tracked by this site' };
  if (!p) return card('peak', { ...base, value: '—', notes: [stats ? 'No peak recorded yet' : waiting()] });
  const when = new Date(p.achieved_at).toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
  return card('peak', { ...base, value: fmt(p.total),
    notes: [`NA <b>${p.na_players ?? '?'}</b> · EU <b>${p.eu_players ?? '?'}</b> · AS <b>${p.as_players ?? '?'}</b>`, `<span class="st-ok">${when}</span>`],
    details: () => `<h3>Highest players online</h3><div class="muted">The most players seen online at the same time, across all regions.</div>
      <div class="dlg-grid"><div>Players<b>${fmt(p.total)}</b></div><div>Active rooms<b>${p.rooms ?? '?'}</b></div>
        <div>North America<b>${p.na_players ?? '?'}</b></div><div>Europe<b>${p.eu_players ?? '?'}</b></div>
        <div>Asia<b>${p.as_players ?? '?'}</b></div><div>When<b style="font-size:14px">${when}</b></div></div>
      <div class="dlg-section">The peak is only recorded while the site is checking (someone has this page open or the collector runs), so a higher peak between checks can be missed.</div>` });
}

// ---------- medal ranks (players and clans) ----------
// Every medal is worth points by place; points decide the rank title. Uses the Podium data (daily, weekly and ranked medals).
// A clan adds up the points of its members, counted for each player's current clan.

// 10 medals, by place on a board (place 10 or below = last medal). Edit the points freely.
const MEDAL_TIERS = [
  { name: 'Gold',   pts: 1000 },   // 1st
  { name: 'Silver', pts: 950 },    // 2nd
  { name: 'Bronze', pts: 850 },    // 3rd
  { name: 'Glass',  pts: 700 },    // 4th
  { name: 'Copper', pts: 500 },    // 5th
  { name: 'Iron',   pts: 400 },    // 6th
  { name: 'Stone',  pts: 300 },    // 7th
  { name: 'Clay',   pts: 200 },    // 8th
  { name: 'Wood',   pts: 100 },    // 9th
  { name: 'Pebble', pts: 50 },     // 10th or below
];
const medalTierIndex = place => Math.min(Math.max(Number(place) || MEDAL_TIERS.length, 1), MEDAL_TIERS.length) - 1;

// 16 titles x 2,000 points each: title N starts at (N-1) x 2,000, so Annihilator starts at 30,000 = 30 gold medals.
const POINTS_PER_TITLE = 2000;
const RANK_TITLES = [
  ['Wild Brawler', '#9aa5b1'], ['Adept Brawler', '#9aa5b1'], ['Skilled Brawler', '#9aa5b1'],
  ['Bounty Hunter', '#4dd0e1'], ['Expert Hunter', '#4dd0e1'], ['Master Hunter', '#4dd0e1'],
  ['Castle Guardian', '#5c9dff'], ['Noble Guardian', '#5c9dff'], ['Throne Guardian', '#5c9dff'],
  ['Gallant Warrior', '#ffb44d'], ['Veteran Warrior', '#ffb44d'], ['Heroic Warrior', '#ffb44d'],
  ['Great Warlord', '#ff6b6b'], ['Supreme Warlord', '#ff6b6b'], ['Ultimate Warlord', '#ff6b6b'],
  ['Annihilator', '#ff3df0'],
];

// Hook for the 30-day season: return false to ignore a medal (e.g. m => m.created_at >= SEASON_START). Default counts everything.
const medalInSeason = m => true;

function rankOf(points) {
  const last = RANK_TITLES.length - 1, i = Math.min(Math.floor(points / POINTS_PER_TITLE), last), max = i === last;
  const into = points - i * POINTS_PER_TITLE;
  return { title: RANK_TITLES[i][0], color: RANK_TITLES[i][1], next: max ? null : RANK_TITLES[i + 1][0],
           pct: max ? 100 : Math.round(into / POINTS_PER_TITLE * 100), toNext: max ? 0 : POINTS_PER_TITLE - into };
}

function medalBoards() {
  if (!podium) return null;
  const P = new Map(), C = new Map(), clanName = {};
  for (const c of Object.values(podium.clans || {})) if (c?.tag) clanName[c.tag] = c.name;
  const blank = () => ({ counts: Array(MEDAL_TIERS.length).fill(0), points: 0 });
  for (const m of podium.medals || []) {
    if (m.category === 'clan' || !medalInSeason(m)) continue;   // medals the clan itself won are not counted here
    const t = medalTierIndex(m.place), w = MEDAL_TIERS[t].pts, pl = podium.players?.[m.entity_id];
    const a = P.get(m.entity_id) || { id: m.entity_id, ...blank() }; a.counts[t]++; a.points += w; P.set(m.entity_id, a);
    if (pl?.clan_tag) {
      const c = C.get(pl.clan_tag) || { id: pl.clan_tag, tag: pl.clan_tag, color: pl.clan_color, ...blank(), who: new Set() };
      c.counts[t]++; c.points += w; c.who.add(m.entity_id); if (pl.clan_color != null) c.color = pl.clan_color; C.set(pl.clan_tag, c);
    }
  }
  const sort = (x, y) => y.points - x.points || y.counts[0] - x.counts[0];
  return {
    players: [...P.values()].map(a => { const pl = podium.players?.[a.id]; return { ...a, name: pl?.name || a.id, tag: pl?.clan_tag || '', color: pl?.clan_color, rank: rankOf(a.points) }; }).sort(sort).slice(0, 3),
    clans: [...C.values()].map(c => ({ ...c, name: clanName[c.tag] || '', members: c.who.size, rank: rankOf(c.points) })).sort(sort).slice(0, 3),
  };
}

const rankBadge = r => `<span style="color:${r.rank.color};font-weight:800">${esc(r.rank.title)}</span>`;
const rankBar = r => `<div class="bar b-lvl" style="margin-top:5px" title="${r.rank.next ? fmt(r.rank.toNext) + ' pts to ' + esc(r.rank.next) : 'Max title'}"><i style="width:${r.rank.pct}%;background:${r.rank.color}"></i></div>`;
const medalBreakdown = r => MEDAL_TIERS.map((t, i) => r.counts[i] ? `${t.name} ${r.counts[i]}` : '').filter(Boolean).join(' · ') || '—';

function medalCard(key, title, sub, iconId, isClan) {
  const list = medalBoards()?.[isClan ? 'clans' : 'players'] || [];
  if (!list.length) return card(key, { icon: iconId, title, sub, notes: [podium ? 'No medals yet' : podiumErr ? 'Podium API not reachable' : 'Loading...'] });
  const who = r => isClan ? `[${tagHtml(r.tag, r.color)}] <b>${esc(r.name)}</b>` : `<b>${esc(r.name)}</b> ${tagHtml(r.tag, r.color)}`;
  const body = `<div class="st-recs">${list.map((r, i) => `<div class="st-rec"><b class="st-rank r${i + 1}">${i + 1}</b>
      <div class="who">${who(r)}<small class="st-ok">${rankBadge(r)}${isClan ? ' · ' + r.members + ' member' + (r.members === 1 ? '' : 's') : ''}</small>${rankBar(r)}</div>
      <span class="val">${fmt(r.points)}<small style="display:block;font-size:11px;font-weight:400">pts</small></span></div>`).join('')}</div>`;
  return card(key, { icon: iconId, title, sub, body,
    details: () => `<h3>${title}</h3><div class="muted">${sub}. Every medal is worth points (Gold ${MEDAL_TIERS[0].pts} down to ${MEDAL_TIERS[MEDAL_TIERS.length - 1].name} ${MEDAL_TIERS[MEDAL_TIERS.length - 1].pts}). Each title needs ${fmt(POINTS_PER_TITLE)} points, so one gold medal is half a title and ${fmt((RANK_TITLES.length - 1) * POINTS_PER_TITLE)} points (30 golds) makes an Annihilator.${isClan ? ' A clan adds up the points of its members.' : ''}</div>
      <div class="st-list">${list.map((r, i) => `<div class="st-row" style="grid-template-columns:34px 1fr auto"><span class="n">${i + 1}</span>
        <span class="nm" style="white-space:normal">${who(r)}<br>${rankBadge(r)} <small class="muted">· ${r.rank.next ? fmt(r.rank.toNext) + ' pts to ' + esc(r.rank.next) : 'highest title reached'}</small>${rankBar(r)}
        <small class="muted">${isClan ? r.members + ' members with medals · ' : ''}${medalBreakdown(r)}</small></span>
        <span class="r"><b style="color:var(--text);font-size:17px">${fmt(r.points)}</b> pts</span></div>`).join('')}</div>` });
}

// ---------- page ----------
function render() {
  $('stGrid').innerHTML = [
    levelCard(), onlineCard(), peakCard(),
    recordCard('daily_kills', 'Highest daily kills', 'Top 3 · daily · all time', 'daily'),
    recordCard('weekly_kills', 'Highest weekly kills', 'Top 3 · weekly · all time', 'weekly'),
    recordCard('ranked_trophies', 'Highest ranked trophies', 'Top 3 · ranked · all time', 'season'),
    recordCard('hour_gain_daily', 'Biggest gain in 1 hour', 'Top 3 · daily kills · all time', 'daily'),
    recordCard('hour_gain_weekly', 'Biggest gain in 1 hour', 'Top 3 · weekly kills · all time', 'weekly'),
    recordCard('hour_gain_ranked', 'Biggest gain in 1 hour', 'Top 3 · ranked trophies · all time', 'season'),
    recordCard('clan_kills', 'Highest clan kills', 'Top 3 · clans · all time', 'clans', true),
    recordCard('hour_gain_clan', 'Biggest clan gain in 1 hour', 'Top 3 · clan kills · all time', 'clans', true),
    recordCard('best_kdr', 'Best KDR of all time', 'Top 3 · at least 1,000 kills', 'compare'),
    gunCard('day', 'Daily'), gunCard('week', 'Weekly'), gunCard('ranked', 'Ranked'),
    medalCard('medals_players', 'Highest medal rank', 'Top 3 players · by medal points', 'podium', false),
    medalCard('medals_clans', 'Highest medal rank', 'Top 3 clans · from their members', 'clans', true),
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
async function loadPodium() {
  try { const r = await fetch(PODIUM_URL); if (!r.ok) throw new Error('HTTP ' + r.status); podium = await r.json(); podiumErr = false; }
  catch (e) { console.warn('podium failed:', e); podiumErr = true; }
  render();
}
async function loadPeak() {   // asks the server to re-check the online peak (it only counts when the live total beats it)
  try { const r = await fetch(STATS_URL + '?mode=online'); if (!r.ok) return; const d = await r.json(); if (stats && d.peak) { stats.peak = d.peak; render(); } }
  catch (e) { console.warn('peak failed:', e); }
}
render();
loadStats();
loadRooms();
loadPodium();
setInterval(loadRooms, ROOMS_EVERY);
setInterval(loadPeak, 60000);
