// Player database page. Reads /api/stats?mode=player-list (the permanent `players` table) and /api/stats?mode=player&id=... (name/clan history).
// Needs: js/layout.js, js/clan-colors.js (CLAN_COLORS), js/level.js (xpToLevel, MAX_LEVEL)
const PL_API = '/api/stats';
const PL_PAGE = 50;                         // players per page

let plAll = [], plQ = '', plSort = 'xp', plDir = -1, plOnly100 = false, plPg = 1, plErr = false;

const pl$ = id => document.getElementById(id);
const plEsc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const plFmt = n => Number(n).toLocaleString();
const PL_PH = "this.onerror=null;this.src='images/placeholder.png'";
const plColor = c => CLAN_COLORS[c] || '#ffffff';
const plAgo = iso => {
  const t = Date.parse(iso); if (!t) return '-';
  const m = Math.max(0, Math.round((Date.now() - t) / 60000));
  return m < 60 ? m + 'm ago' : m < 1440 ? Math.round(m / 60) + 'h ago' : Math.round(m / 1440) + 'd ago';
};
const plDate = iso => iso ? new Date(iso).toISOString().slice(0, 10) : '-';

const COLS = [['#', null], ['Name', 'name'], ['Level / XP', 'xp'], ['Weapon', null], ['Clan', null], ['Last seen', 'last'], ['First seen', 'first'], ['', null]];
const KEY = { xp: p => p.total_xp || 0, name: p => (p.name || '').toLowerCase(), last: p => Date.parse(p.last_seen_at) || 0, first: p => Date.parse(p.first_seen_at) || 0 };

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
      <span class="weapon">${p.top_weapon_id != null ? `<img src="images/weapons/${plEsc(p.top_weapon_id)}.png" alt="Weapon ${plEsc(p.top_weapon_id)}" title="Weapon ${plEsc(p.top_weapon_id)}" onerror="${PL_PH}">` : ''}</span>
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
const plShow = (f, v) => v == null || v === '' ? 'none' : f === 'top_weapon_id' ? 'Weapon ' + v : v;
async function plOpen(id) {
  const p = plAll.find(x => x.player_id === id); if (!p) return;
  pl$('dlgBody').innerHTML = `<h3>${plEsc(p.name)}</h3><div class="muted">${p.clan_tag ? `[<span style="color:${plColor(p.clan_color)};font-weight:800">${plEsc(p.clan_tag)}</span>] · ` : ''}ID ${plEsc(p.player_id)}</div>
    <div class="dlg-grid"><div>Level<b>${p.lvl}</b></div><div>Total XP<b>${plFmt(p.total_xp || 0)}</b></div>
      <div>Top weapon<b>${p.top_weapon_id != null ? 'Weapon ' + plEsc(p.top_weapon_id) : '-'}</b></div><div>Last seen<b>${plAgo(p.last_seen_at)}</b></div>
      <div>First seen<b>${plDate(p.first_seen_at)}</b></div><div>Clan<b>${plEsc(p.clan_tag || 'none')}</b></div></div>
    <div class="dlg-section" id="plHist">Loading history...</div>`;
  pl$('dlg').showModal();
  let html = 'No name or clan changes recorded yet.';
  try {
    const r = await fetch(`${PL_API}?mode=player&id=${encodeURIComponent(id)}`); if (!r.ok) throw new Error('HTTP ' + r.status);
    const ev = [];
    for (const h of (await r.json()).history || []) {
      if (h.change_type !== 'change' || !h.changes) continue;
      for (const f of Object.keys(FIELD_LABEL)) if (h.changes[f]) ev.push(`<div><b>${FIELD_LABEL[f]}: ${plEsc(plShow(f, h.changes[f].from))} → ${plEsc(plShow(f, h.changes[f].to))}</b><span>${plDate(h.observed_at)}</span></div>`);
    }
    if (ev.length) html = `<b>History</b><div class="pl-hist">${ev.join('')}</div>`;
  } catch (e) { html = 'Could not load the history.'; }
  if (pl$('plHist')) pl$('plHist').innerHTML = html;
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
