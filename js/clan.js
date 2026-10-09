// ================= CONFIG =================
const API_URL = '/api/clan';
const TOP_N = 50;

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

// ================= DATA SOURCES (not connected yet) =================
// Previous bests per clanId: { [clanId]: { kills } }  (highest recorded values)
async function getClanBests(clans) {
  // TODO: const r = await fetch(`/api/clan-bests?ids=${clans.map(c => c.clanId).join(',')}`); return r.json();
  return {};   // no data yet -> every bar shows as full with "NEW"
}
// TODO: clan detail API. Should return extra info for one clanId.
async function getClanDetails(clanId) { return null; }

// ================= HELPERS =================
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt = n => Number(n).toLocaleString();
const PH = "this.onerror=null;this.src='images/placeholder.png'";

// Higher is better. Bar is proportional to the previous best; full when matched, exceeded, or no prior score.
function compare(cur, best) {
  if (best == null || best <= 0) return { fill: 1, pct: null };
  return { fill: Math.min(1, cur / best), pct: (cur / best - 1) * 100 };
}
function pctHtml(pct) {
  if (pct == null) return '<span class="pct new">NEW</span>';
  return `<span class="pct ${pct >= 0 ? 'good' : 'bad'}">${pct > 0 ? '+' : ''}${pct.toFixed(1)}%</span>`;
}
function statCell(valueText, c, cls, dl = '') {
  return `<div class="stat"><div class="top"><span>${valueText}</span>${pctHtml(c.pct)}</div><div class="bar ${cls}"><i style="width:${(c.fill * 100).toFixed(1)}%"></i></div>${dl}</div>`;
}
// Finds the array of clans anywhere inside the API response
function extractClans(d, depth = 0) {
  if (Array.isArray(d)) return d;
  if (!d || typeof d !== 'object' || depth > 3) return null;
  for (const v of Object.values(d)) {
    if (Array.isArray(v) && v.length && typeof v[0] === 'object' && 'clanId' in v[0]) return v;
  }
  for (const v of Object.values(d)) { const f = extractClans(v, depth + 1); if (f) return f; }
  return null;
}

// ================= STRONGEST CLANS (from the player leaderboards) =================
const POWER = { day: ['Daily', '/api/leaderboard-day', 'kills'], week: ['Weekly', '/api/leaderboard-week', 'kills'], ranked: ['Ranked', `/api/leaderboard-ranked?season=${CONFIG.currentSeason}`, 'trophies'] };
let powerBoard = 'day', powerLists = null;
function playersOf(d, dep = 0) {
  if (Array.isArray(d)) return d;
  if (!d || typeof d !== 'object' || dep > 3) return null;
  for (const v of Object.values(d)) if (Array.isArray(v) && v.length && typeof v[0] === 'object' && 'playerId' in v[0]) return v;
  for (const v of Object.values(d)) { const f = playersOf(v, dep + 1); if (f) return f; }
  return null;
}
async function drawPower() {
  if (!powerLists) {
    const get = async u => { try { const r = await fetch(u); return r.ok ? (playersOf(await r.json()) || []) : []; } catch (e) { return []; } };
    const [day, week, ranked] = await Promise.all(Object.values(POWER).map(p => get(p[1])));
    const clanOf = new Map();                                   // the weekly board has no clan tags: borrow them from daily + ranked
    for (const p of [...ranked, ...day]) if (p.clanTag) clanOf.set(p.playerId, p);
    powerLists = { day, week, ranked, clanOf };
  }
  const [, , unit] = POWER[powerBoard];
  const items = powerLists[powerBoard].slice(0, 50).map(p => { const c = p.clanTag ? p : powerLists.clanOf.get(p.playerId); return { tag: c?.clanTag, color: c?.clanColor, score: unit === 'trophies' ? p.trophies : p.kills }; });
  const seg = `<div class="seg">${Object.entries(POWER).map(([key, v]) => `<button data-p="${key}" class="${key === powerBoard ? 'on' : ''}">${v[0]}</button>`).join('')}</div>`;
  CLANPOWER.render($('clanPower'), CLANPOWER.top3(items), unit, CLAN_COLORS, seg, 'STRONGEST CLANS ON THE PLAYER LEADERBOARDS');
}
$('clanPower').addEventListener('click', e => { const b = e.target.closest('[data-p]'); if (b) { powerBoard = b.dataset.p; drawPower(); } });

// ================= LOAD =================
let rows = [];
async function load() {
  let clans;
  try {
    const res = await fetch(API_URL);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const d = await res.json();
    console.log('API response:', d);
    clans = extractClans(d);
    if (!clans) throw new Error('No clan list found in the response');
  } catch (e) {
    console.error('Clan API failed:', e);
    $('status').innerHTML = '<b>Could not load clans.</b> Check the Console (F12) for details.';
    return;
  }
  clans = [...clans].sort((a, b) => b.kills - a.kills).slice(0, TOP_N);   // ranked by kills
  const bests = await getClanBests(clans);
  rows = clans.map((c, i) => {
    const b = bests[c.clanId];
    return { rank: i + 1, hm: null, c, kc: compare(c.kills, b?.kills), fillPct: c.memberCap > 0 ? Math.min(100, c.memberCount / c.memberCap * 100) : 0 };
  });
  await applyHourly();
}

// Loads the snapshot to compare with (last hour, or since 00:00 UTC), fills in the +/- labels and arrows, and redraws.
async function applyHourly() {
  if (!rows.length) return;
  const prev = await HOURLY.loadPrev('clan');
  const hm = HOURLY.marks(prev, rows.map(r => ({ id: r.c.clanId, rank: r.rank, vals: { kills: r.c.kills, members: r.c.memberCount } })), { kills: 'high', members: 'high' });
  rows.forEach(r => { r.hm = hm ? hm.get(r.c.clanId) : null; });
  $('status').textContent = `Top ${rows.length} clans by kills.` + HOURLY.note(hm);
  render();
}
HOURLY.mountToggle(applyHourly);

// ================= RENDER =================
function render() {
  const q = $('q').value.trim().toLowerCase();
  const list = rows.filter(r => !q || r.c.name.toLowerCase().includes(q) || (r.c.tag || '').toLowerCase().includes(q));
  $('rows').innerHTML = list.map(r => {
    const c = r.c, col = CLAN_COLORS[c.color] || '#ffffff';
    const open = c.openJoin ? 'open' : 'closed';
    return `<div class="lb-row cl-row">
      <span class="rank">${r.rank}${r.hm ? r.hm.move : ''}</span>
      <span class="pname" title="${esc(c.name)}">${esc(c.name)}</span>
      ${statCell(fmt(c.kills), r.kc, 'b-kills', r.hm?.d.kills)}
      <div class="stat"><div class="top"><span>${fmt(c.memberCount)}<small class="muted"> / ${fmt(c.memberCap)}</small></span><span class="pct new">${r.fillPct.toFixed(0)}%</span></div><div class="bar b-members"><i style="width:${r.fillPct.toFixed(1)}%"></i></div>${r.hm?.d.members || ''}</div>
      <span class="clan" style="color:${col}">${esc(c.tag)}</span>
      <span class="status-ic"><img src="images/icons/${open}.png" alt="${open === 'open' ? 'Open to join' : 'Closed to join'}" title="${open === 'open' ? 'Open to join' : 'Closed to join'}" onerror="${PH}"></span>
      <button class="inspect" data-id="${esc(c.clanId)}" aria-label="Clan details for ${esc(c.name)}"><img src="images/icons/inspect.png" alt="" onerror="${PH}"></button>
    </div>`;
  }).join('') || '<p class="muted" style="padding:24px">No clans match.</p>';
}
$('q').addEventListener('input', render);

// ================= CLAN DETAILS MODAL =================
$('rows').addEventListener('click', async e => {
  const btn = e.target.closest('.inspect'); if (!btn) return;
  const c = rows.find(x => x.c.clanId === btn.dataset.id).c;
  $('dlgBody').innerHTML = `<h3>${esc(c.name)}</h3><div class="muted">[${esc(c.tag)}] · ID ${esc(c.clanId)} · ${c.openJoin ? 'Open to join' : 'Closed to join'}</div>
    <div class="dlg-grid">
      <div>Kills<b>${fmt(c.kills)}</b></div><div>Members<b>${fmt(c.memberCount)} / ${fmt(c.memberCap)}</b></div>
    </div>
    <div class="dlg-section" id="detailsSlot">Loading clan details...</div>`;
  $('dlg').showModal();
  const d = await getClanDetails(c.clanId);   // TODO: wire to real API
  renderDetails($('detailsSlot'), d);
});
// Structure for the clan detail API response. Add sections here once the API exists.
function renderDetails(el, d) {
  if (!d) { el.textContent = 'Detailed clan info is not available yet. It will appear here once the clan detail API is connected.'; return; }
  el.innerHTML = Object.entries(d).map(([k, v]) => `<div><b>${esc(k)}</b>: ${esc(JSON.stringify(v))}</div>`).join('');
}
$('dlgClose').onclick = () => $('dlg').close();
$('dlg').addEventListener('click', e => { if (e.target === $('dlg')) $('dlg').close(); });

// ================= XLSX EXPORT =================
$('xlsx').onclick = () => {
  if (!window.XLSX) return alert('XLSX library failed to load.');
  const pc = c => c.pct == null ? 'NEW' : +c.pct.toFixed(1);
  const data = rows.map(r => ({ Rank: r.rank, Clan: r.c.name, Tag: r.c.tag, ClanId: r.c.clanId, Kills: r.c.kills, 'Kills vs best %': pc(r.kc),
    Members: r.c.memberCount, MemberCap: r.c.memberCap, 'Members full %': +r.fillPct.toFixed(1), OpenToJoin: r.c.openJoin ? 'Yes' : 'No' }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data), 'Clans Top ' + TOP_N);
  XLSX.writeFile(wb, `blast-buddies-clans-${new Date().toISOString().slice(0, 10)}.xlsx`);
};

drawPower();
load();
