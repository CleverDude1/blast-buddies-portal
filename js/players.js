// Player database page. Reads /api/stats?mode=player-list (the permanent `players` table) and /api/stats?mode=player&id=... (details + name/clan history).
// Needs: js/layout.js, js/clan-colors.js (CLAN_COLORS), js/level.js (xpToLevel, MAX_LEVEL), js/weapon-names.js (BB_WEAPONS)
const PL_API = '/api/stats';
const PL_PAGE = 50;                         // players per page

let plAll = [], plQ = '', plSort = 'xp', plDir = -1, plOnly100 = false, plPg = 1, plErr = false;

const pl$ = id => document.getElementById(id);
const plEsc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const plFmt = n => Number(n).toLocaleString();
const PL_PH = "this.onerror=null;this.src='images/placeholder.png'";
const plColor = c => CLAN_COLORS[c] || '#ffffff';
const plWName = id => (window.BB_WEAPONS && window.BB_WEAPONS[id]) || ('Weapon ' + id);                              // image file name
const plWLabel = id => (window.BB_WEAPON_LABELS && window.BB_WEAPON_LABELS[id]) || plWName(id);                    // name shown to players
const plWImg = (id, style = '') => `<img${style ? ` style="${style}"` : ''} src="images/weapons/${plEsc(plWName(id))}.png" alt="${plEsc(plWLabel(id))}" title="${plEsc(plWLabel(id))}" onerror="this.onerror=function(){this.onerror=null;this.src='images/placeholder.png'};this.src='images/weapons/${plEsc(id)}.png'">`;
const plAgo = iso => {
  const t = Date.parse(iso); if (!t) return '-';
  const m = Math.max(0, Math.round((Date.now() - t) / 60000));
  return m < 60 ? m + 'm ago' : m < 1440 ? Math.round(m / 60) + 'h ago' : Math.round(m / 1440) + 'd ago';
};
const plDate = iso => iso ? new Date(iso).toISOString().slice(0, 10) : '-';

const COLS = [['#', null], ['Name', 'name'], ['Level / XP', 'xp'], ['Kills', 'kills'], ['KDR', 'kdr'], ['Weapon', null], ['Clan', null], ['Last seen', 'last'], ['First seen', 'first'], ['', null]];
const KEY = { xp: p => p.total_xp || 0, name: p => (p.name || '').toLowerCase(), kills: p => p.kills == null ? -1 : Number(p.kills), kdr: p => p.kdr == null ? -1 : Number(p.kdr),
  last: p => Date.parse(p.last_seen_at) || 0, first: p => Date.parse(p.first_seen_at) || 0 };

function plList() {
  const s = plQ.trim().toLowerCase();
  const a = plAll.filter(p => (!s || (p.name || '').toLowerCase().includes(s) || (p.clan_tag || '').toLowerCase().includes(s) || String(p.player_id).toLowerCase().includes(s)) && (!plOnly100 || p.lvl >= MAX_LEVEL));
  const k = KEY[plSort];
  return a.sort((x, y) => (k(x) > k(y) ? 1 : k(x) < k(y) ? -1 : 0) * plDir);
}

function plRender() {
  pl$('plHead').innerHTML = COLS.map(([l, k]) => k ? `<span><button data-sort="${k}" class="${plSort === k ? 'on' : ''}">${l}${plSort === k ? (plDir < 0 ? ' ▼' : ' ▲') : ''}</button></span>` : `<span>${l}</span>`).join('');
  const day = Date.now() - 864e5, week = Date.now() - 7 * 864e5;
  pl$('plStats').innerHTML = [
    [plAll.length, 'Players in the database'],
    [plAll.filter(p => Date.parse(p.last_seen_at) > day).length, 'Seen in the last 24 hours'],
    [plAll.filter(p => Date.parse(p.first_seen_at) > week).length, 'New in the last 7 days'],
    [plAll.filter(p => p.lvl >= MAX_LEVEL).length, 'At level 100'],
  ].map(([v, l]) => `<div class="pl-stat"><b>${plFmt(v)}</b><span>${l}</span></div>`).join('');
  const list = plList(), pages = Math.max(1, Math.ceil(list.length / PL_PAGE));
  plPg = Math.min(plPg, pages);
  const from = (plPg - 1) * PL_PAGE;
  pl$('rows').innerHTML = list.slice(from, from + PL_PAGE).map((p, i) => `<div class="pl-row">
      <span class="n">${from + i + 1}</span>
      <span class="pname" data-id="${plEsc(p.player_id)}" title="${plEsc(p.name)}">${plEsc(p.name)}</span>
      <div class="stat"><div class="top"><span>${p.lvl}</span><span class="pct new">${plFmt(p.total_xp || 0)} XP</span></div><div class="bar b-lvl"><i style="width:${p.lvl / MAX_LEVEL * 100}%"></i></div></div>
      <span class="when">${p.kills != null ? plFmt(p.kills) : '-'}</span>
      <span class="when">${p.kdr != null ? Number(p.kdr).toFixed(2) : '-'}</span>
      <span class="weapon">${p.top_weapon_id != null ? plWImg(p.top_weapon_id) : ''}</span>
      <span class="clan" style="color:${plColor(p.clan_color)}">${plEsc(p.clan_tag || '')}</span>
      <span class="when" title="${plEsc(p.last_seen_at)}">${plAgo(p.last_seen_at)}</span>
      <span class="when">${plDate(p.first_seen_at)}</span>
      <button class="inspect" data-id="${plEsc(p.player_id)}" aria-label="Player details for ${plEsc(p.name)}"><img src="images/icons/inspect.png" alt="" onerror="${PL_PH}"></button>
    </div>`).join('') || '<p class="muted" style="padding:24px">No players match.</p>';
  pl$('plPager').innerHTML = list.length > PL_PAGE ? `<button class="pill" data-pg="-1" ${plPg <= 1 ? 'disabled' : ''}>Previous</button><span>Page ${plPg} of ${pages}</span><button class="pill" data-pg="1" ${plPg >= pages ? 'disabled' : ''}>Next</button>` : '';
  pl$('status').textContent = plErr ? '' : `${plFmt(list.length)} player${list.length === 1 ? '' : 's'}${plQ || plOnly100 ? ' match' : ''}.`;
}

// ---------- events ----------
pl$('q').addEventListener('input', e => { plQ = e.target.value; plPg = 1; plRender(); });
pl$('only100').addEventListener('change', e => { plOnly100 = e.target.checked; plPg = 1; plRender(); });
pl$('plHead').addEventListener('click', e => {
  const b = e.target.closest('[data-sort]'); if (!b) return;
  if (plSort === b.dataset.sort) plDir = -plDir; else { plSort = b.dataset.sort; plDir = plSort === 'name' ? 1 : -1; }
  plPg = 1; plRender();
});
pl$('plPager').addEventListener('click', e => { const b = e.target.closest('[data-pg]'); if (b && !b.disabled) { plPg += Number(b.dataset.pg); plRender(); window.scrollTo({ top: 0 }); } });
pl$('rows').addEventListener('click', e => { const b = e.target.closest('[data-id]'); if (b) plOpen(b.dataset.id); });
pl$('dlgClose').onclick = () => pl$('dlg').close();
pl$('dlg').addEventListener('click', e => { if (e.target === pl$('dlg')) pl$('dlg').close(); });

// ---------- player details + history ----------
const FIELD_LABEL = { name: 'Name', clan_tag: 'Clan', top_weapon_id: 'Top weapon' };
const plShow = (f, v) => v == null || v === '' ? 'none' : f === 'top_weapon_id' ? plWLabel(v) : v;
const PL_T = 'width:100%;border-collapse:collapse;font-size:.9em';
const PL_C = 'padding:4px 8px;text-align:right', PL_L = 'padding:4px 8px;text-align:left';

function plSeasons(list) {
  const s = (list || []).slice().sort((a, b) => a.season - b.season);
  if (!s.length) return '';
  return `<h4>Ranked seasons</h4><table style="${PL_T}"><tr><th style="${PL_L}">Season</th><th style="${PL_C}">Trophies</th><th style="${PL_C}">Wins</th><th style="${PL_C}">Losses</th><th style="${PL_C}">Win rate</th></tr>
    ${s.map(x => { const g = (x.rankedWins || 0) + (x.rankedLosses || 0); return `<tr><td style="${PL_L}">${plEsc(x.season)}</td><td style="${PL_C}">${plFmt(x.trophies)}</td><td style="${PL_C}">${plFmt(x.rankedWins)}</td><td style="${PL_C}">${plFmt(x.rankedLosses)}</td><td style="${PL_C}">${g ? (x.rankedWins / g * 100).toFixed(1) + '%' : '-'}</td></tr>`; }).join('')}</table>`;
}
function plWeapons(list) {
  const w = (list || []).filter(x => x.kills > 0).sort((a, b) => b.kills - a.kills);
  if (!w.length) return '';
  return `<h4>Weapons</h4><table style="${PL_T}"><tr><th style="${PL_L}">Weapon</th><th style="${PL_C}">Kills</th><th style="${PL_C}">Headshots</th><th style="${PL_C}">HS %</th></tr>
    ${w.map(x => { const knife = x.weapon_id === 101; return `<tr><td style="${PL_L}">${plWImg(x.weapon_id, 'height:24px;vertical-align:middle;margin-right:6px')}${plEsc(plWLabel(x.weapon_id))}</td><td style="${PL_C}">${plFmt(x.kills)}</td><td style="${PL_C}">${knife ? '-' : plFmt(x.headshots)}</td><td style="${PL_C}">${knife || !x.kills ? '-' : (x.headshots / x.kills * 100).toFixed(1) + '%'}</td></tr>`; }).join('')}</table>`;
}

async function plOpen(id) {
  const p = plAll.find(x => x.player_id === id); if (!p) return;
  const lifetime = p.kills != null ? `<h4>Lifetime</h4><div class="dlg-grid"><div>Kills<b>${plFmt(p.kills)}</b></div><div>Deaths<b>${plFmt(p.deaths || 0)}</b></div>
      <div>KDR<b>${Number(p.kdr).toFixed(2)}</b></div><div>Games<b>${plFmt(p.games || 0)}</b></div><div>Assists<b>${plFmt(p.assists || 0)}</b></div></div>` : '';
  pl$('dlgBody').innerHTML = `<h3>${plEsc(p.name)}</h3><div class="muted">${p.clan_tag ? `[<span style="color:${plColor(p.clan_color)};font-weight:800">${plEsc(p.clan_tag)}</span>] · ` : ''}ID ${plEsc(p.player_id)}</div>
    <div class="dlg-grid"><div>Level<b>${p.lvl}</b></div><div>Total XP<b>${plFmt(p.total_xp || 0)}</b></div>
      <div>Top weapon<b>${p.top_weapon_id != null ? plEsc(plWLabel(p.top_weapon_id)) : '-'}</b></div><div>Last seen<b>${plAgo(p.last_seen_at)}</b></div>
      <div>First seen<b>${plDate(p.first_seen_at)}</b></div><div>Clan<b>${plEsc(p.clan_tag || 'none')}</b></div></div>
    ${lifetime}
    <div class="dlg-section" id="plMore">Loading details...</div>`;
  pl$('dlg').showModal();
  let html = '';
  try {
    const r = await fetch(`${PL_API}?mode=player&id=${encodeURIComponent(id)}`); if (!r.ok) throw new Error('HTTP ' + r.status);
    const d = await r.json(), ev = [];
    for (const h of d.history || []) {
      if (h.change_type !== 'change' || !h.changes) continue;
      for (const f of Object.keys(FIELD_LABEL)) if (h.changes[f]) ev.push(`<div><b>${FIELD_LABEL[f]}: ${plEsc(plShow(f, h.changes[f].from))} → ${plEsc(plShow(f, h.changes[f].to))}</b><span>${plDate(h.observed_at)}</span></div>`);
    }
    html = plSeasons(d.seasons) + plWeapons(d.weapons)
      + `<h4>History</h4>` + (ev.length ? `<div class="pl-hist">${ev.join('')}</div>` : '<p class="muted">No name or clan changes recorded yet.</p>');
  } catch (e) { html = 'Could not load the details.'; }
  if (pl$('plMore')) pl$('plMore').innerHTML = html;
}

// ---------- load ----------
(async () => {
  pl$('plHead').innerHTML = COLS.map(([l]) => `<span>${l}</span>`).join('');
  try {
    const r = await fetch(`${PL_API}?mode=player-list`); if (!r.ok) throw new Error('HTTP ' + r.status);
    plAll = ((await r.json()).players || []).map(p => ({ ...p, lvl: xpToLevel(Number(p.total_xp) || 0) }));
  } catch (e) {
    console.warn('players failed:', e); plErr = true;
    pl$('status').innerHTML = '<b>Could not load the player database.</b> Check the Console (F12) for details.';
  }
  plRender();
})();
