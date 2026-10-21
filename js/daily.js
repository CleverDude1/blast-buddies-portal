// ================= CONFIG =================
const API_URL = '/api/pangolin-test';
const TOP_N = 50;

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
// Personal bests per playerId: { [playerId]: { kills, deaths, kdr } }
//   kills = highest daily kills, deaths = LOWEST daily deaths, kdr = highest daily KDR.
async function getPersonalBests(players) {
  // TODO: connect the real source, e.g.
  // const r = await fetch(`/api/personal-bests?ids=${players.map(p => p.playerId).join(',')}`); return r.json();
  return {};   // no data yet -> every bar shows as full with "NEW"
}
// TODO: clan API. Should return { color: <number> } for a clan tag.
async function getClanInfo(tag) { return null; }

// ================= HELPERS =================
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const kdrOf = p => p.deaths > 0 ? p.kills / p.deaths : p.kills;
const fmt = n => Number(n ?? 0).toLocaleString();
const PH = "this.onerror=null;this.src='images/placeholder.png'";
const weaponName = id => (window.BB_WEAPONS && window.BB_WEAPONS[id]) || ('Weapon ' + id);

// mode 'high': higher is better (kills, kdr). mode 'low': lower is better (deaths).
// Returns fill 0..1 (proportional to the personal best) and pct change vs best.
function compare(cur, best, mode) {
  if (best == null) return { fill: 1, pct: null };               // no prior score -> full
  if (mode === 'high') {
    if (best <= 0) return { fill: 1, pct: null };
    return { fill: Math.min(1, cur / best), pct: (cur / best - 1) * 100 };  // exceeded -> full
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

// ================= LOAD =================
let rows = [];
function demoPlayers() {
  return Array.from({ length: TOP_N }, (_, i) => ({
    playerId: 'demo' + i, name: 'Player ' + (i + 1), kills: 4200 - i * 70, deaths: 150 + i * 9, assists: 0,
    totalXp: 1170000 - i * 15000, characterSkinId: 1, topWeaponId: (i % 12) + 1, topWeaponSkinId: 1,
    clanTag: ['FT', 'BB', 'XO', ''][i % 4], clanColor: i % 12 }));
}

let isDemo = false;
async function load() {
  let players, demo = false;
  try {
    const res = await fetch(API_URL);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const d = await res.json();
    console.log('API response:', d);
    players = d?.leaderboards?.daily?.top;
    if (!Array.isArray(players) || !players.length) throw new Error('No daily leaderboard found in the response');
  } catch (e) {
    console.warn('API failed:', e); players = demoPlayers(); demo = true;
  }
  players = players.slice(0, TOP_N);   // keeps the API's order
  const bests = await getPersonalBests(players);
  const tags = [...new Set(players.map(p => p.clanTag).filter(Boolean))];
  const clanInfo = Object.fromEntries(await Promise.all(tags.map(async t => [t, await getClanInfo(t)])));

  rows = players.map((p, i) => {
    const b = bests[p.playerId], kdr = kdrOf(p), level = xpToLevel(p.totalXp);
    const color = clanInfo[p.clanTag]?.color ?? p.clanColor;
    return { rank: i + 1, hm: null, p, level, kdr, color,
      kc: compare(p.kills, b?.kills, 'high'), dc: compare(p.deaths, b?.deaths, 'low'), rc: compare(kdr, b?.kdr, 'high') };
  });
  CLANPOWER.render($('clanPower'), demo ? [] : CLANPOWER.top3(players.map(p => ({ tag: p.clanTag, color: p.clanColor, score: p.kills }))), 'kills', CLAN_COLORS);
  isDemo = demo;
  await applyHourly();
}

// Loads the snapshot to compare with (last hour, or since 00:00 UTC), fills in the +/- labels and arrows, and redraws.
async function applyHourly() {
  if (!rows.length) return;
  const prev = isDemo ? null : await HOURLY.loadPrev('day');
  const hm = HOURLY.marks(prev, rows.map(r => { const p = r.p; return { id: p.playerId, rank: r.rank, vals: { kills: p.kills, deaths: p.deaths, kdr: kdrOf(p) } }; }), { kills: 'high', deaths: 'low', kdr: 'high' }, 'kills');
  rows.forEach(r => { r.hm = hm ? hm.get(r.p.playerId) : null; });
  $('status').innerHTML = isDemo
    ? '<b>Demo data:</b> the API could not be reached from this page (network or CORS), so sample players are shown.'
    : `Top ${rows.length} players today.` + HOURLY.note(hm);
  render();
}
HOURLY.mountToggle(applyHourly);

// ================= RENDER =================
function render() {
  const q = $('q').value.trim().toLowerCase();
  const list = rows.filter(r => !q || r.p.name.toLowerCase().includes(q) || (r.p.clanTag || '').toLowerCase().includes(q));
  $('rows').innerHTML = list.map(r => {
    const p = r.p, col = CLAN_COLORS[r.color] || '#ffffff';
    return `<div class="lb-row">
      <span class="rank">${r.rank}${r.hm ? r.hm.move : ''}</span>
      <span class="pname" title="${esc(p.name)}">${esc(p.name)}</span>
      <div class="stat"><div class="top"><span>${r.level}</span><span class="pct new">/ ${MAX_LEVEL}</span></div><div class="bar b-lvl"><i style="width:${r.level / MAX_LEVEL * 100}%"></i></div></div>
      ${statCell(fmt(p.kills), r.kc, 'high', 'b-kills', r.hm?.d.kills)}
      ${statCell(fmt(p.deaths), r.dc, 'low', 'b-deaths', r.hm?.d.deaths)}
      ${statCell(r.kdr.toFixed(2), r.rc, 'high', 'b-kdr', r.hm?.d.kdr)}
      <span class="weapon"><img src="images/weapons/${esc(p.topWeaponId)}.png" alt="Weapon ${esc(p.topWeaponId)}" title="Weapon ${esc(p.topWeaponId)}" onerror="${PH}"></span>
      <span class="clan" style="color:${col}">${p.clanTag ? esc(p.clanTag) : ''}</span>
      <button class="inspect" data-id="${esc(p.playerId)}" aria-label="Player details for ${esc(p.name)}"><img src="images/icons/inspect.png" alt="" onerror="${PH}"></button>
    </div>`;
  }).join('') || '<p class="muted" style="padding:24px">No players match.</p>';
}
$('q').addEventListener('input', render);

// ================= PLAYER DETAILS MODAL =================
// Everything comes from the leaderboard row itself (stats, seasons, weaponStats), no extra API call.
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
        const hs = w.weaponId === 101 ? '-' : (w.kills ? (w.headshots / w.kills * 100).toFixed(1) + '%' : '-');   // 101 = knife, no headshots
        return `<tr><td style="${S_CELL_L}"><img src="images/weapons/${esc(name)}.png" alt="" title="${esc(name)}" onerror="${PH}" style="height:24px;vertical-align:middle;margin-right:6px">${esc(name)}</td><td style="${S_CELL}">${fmt(w.kills)}</td><td style="${S_CELL}">${w.weaponId === 101 ? '-' : fmt(w.headshots)}</td><td style="${S_CELL}">${hs}</td></tr>`;
      }).join('')}
    </table>`);
  }

  el.innerHTML = parts.join('') || 'No detailed stats available for this player.';
}

$('rows').addEventListener('click', e => {
  const btn = e.target.closest('.inspect'); if (!btn) return;
  const r = rows.find(x => x.p.playerId === btn.dataset.id), p = r.p;
  $('dlgBody').innerHTML = `<h3>${esc(p.name)}</h3><div class="muted">${p.clanTag ? '[' + esc(p.clanTag) + '] · ' : ''}ID ${esc(p.playerId)}</div>
    <h4>Today</h4>
    <div class="dlg-grid">
      <div>Level<b>${r.level}</b></div><div>Total XP<b>${fmt(p.totalXp)}</b></div>
      <div>Kills<b>${fmt(p.kills)}</b></div><div>Deaths<b>${fmt(p.deaths)}</b></div>
      <div>Assists<b>${fmt(p.assists)}</b></div><div>KDR<b>${r.kdr.toFixed(2)}</b></div>
    </div>
    <div class="dlg-section" id="detailsSlot"></div>`;
  renderDetails($('detailsSlot'), p);
  $('dlg').showModal();
});
$('dlgClose').onclick = () => $('dlg').close();
$('dlg').addEventListener('click', e => { if (e.target === $('dlg')) $('dlg').close(); });

// ================= XLSX EXPORT =================
$('xlsx').onclick = () => {
  if (!window.XLSX) return alert('XLSX library failed to load.');
  const pc = c => c.pct == null ? 'NEW' : +c.pct.toFixed(1);
  const data = rows.map(r => ({ Rank: r.rank, Nickname: r.p.name, PlayerId: r.p.playerId, Level: r.level, TotalXP: r.p.totalXp,
    Kills: r.p.kills, 'Kills vs best %': pc(r.kc), Deaths: r.p.deaths, 'Deaths vs best %': pc(r.dc),
    KDR: +r.kdr.toFixed(2), 'KDR vs best %': pc(r.rc), Assists: r.p.assists, WeaponId: r.p.topWeaponId, Clan: r.p.clanTag || '' }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data), 'Daily Top ' + TOP_N);
  XLSX.writeFile(wb, `blast-buddies-daily-${new Date().toISOString().slice(0, 10)}.xlsx`);
};

load();
