// ================= CONFIG =================
const API = '/api/podium';   // api/podium.js on Vercel. Use a full https:// URL if these pages are hosted somewhere else.
// xpToLevel() / MAX_LEVEL come from js/level.js, CLAN_COLORS from js/clan-colors.js

// ================= HELPERS =================
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = n => Number(n).toLocaleString();
const num = v => (v === null || v === undefined || v === '' || Number.isNaN(Number(v))) ? null : Number(v);
const PH = "this.onerror=null;this.src='images/placeholder.png'";
const ordinal = n => n + (['st', 'nd', 'rd'][((n + 90) % 100 - 10) % 10 - 1] || 'th');
const CAT = { day: 'Daily', week: 'Weekly', ranked: 'Ranked', clan: 'Clan' };
const catLabel = m => m.category === 'ranked' && m.season != null ? `Ranked season ${m.season}` : CAT[m.category];
const tier = place => place === 1 ? 'g' : place === 2 ? 's' : place === 3 ? 'b' : 'o';

// ================= STATE =================
let data = { medals: [], players: {}, clans: {} };
let filter = 'overall', season = 'all', month = new Date().toISOString().slice(0, 7), list = [];

// ================= FILTER + AGGREGATE =================
function selected() {
  return data.medals.filter(m => {
    if (filter === 'clan') return m.category === 'clan';
    if (m.category === 'clan') return false;                                    // clan medals only appear under "Clan"
    if (filter === 'overall') return true;
    if (filter === 'monthly') return String(m.awarded_on).startsWith(month);
    if (filter === 'ranked') return m.category === 'ranked' && (season === 'all' || String(m.season) === season);
    return m.category === filter;
  });
}
function infoOf(id) {
  if (filter === 'clan') { const c = data.clans[id]; return { name: c?.name || id, c }; }
  const p = data.players[id]; return { name: p?.name || id, p };
}
function aggregate() {
  const map = new Map();
  for (const m of selected()) {
    const a = map.get(m.entity_id) || { id: m.entity_id, g: 0, s: 0, b: 0, o: 0, total: 0 };
    a[tier(m.place)]++; a.total++; map.set(m.entity_id, a);
  }
  const arr = [...map.values()].map(a => ({ ...a, ...infoOf(a.id) }));
  arr.sort((x, y) => y.total - x.total || y.g - x.g || y.s - x.s || y.b - x.b || x.name.localeCompare(y.name));
  arr.forEach((a, i) => {                                                         // equal medals share a rank
    const prev = arr[i - 1];
    a.rank = prev && prev.total === a.total && prev.g === a.g && prev.s === a.s && prev.b === a.b ? prev.rank : i + 1;
  });
  return arr;
}

// ================= RENDER =================
const hdImg = (src, alt) => `<img class="hd" src="images/icons/${src}.png" alt="${alt}" title="${alt}" onerror="${PH}">`;
function renderHead() {
  const clan = filter === 'clan';
  $('head').innerHTML = `<span style="text-align:center">#</span><span>${clan ? 'Clan' : 'Nickname'}</span>
    <img src="images/icons/col-medals.png" alt="Medals" title="Medals" onerror="${PH}">
    ${hdImg('medal-gold', 'Gold (1st)')}${hdImg('medal-silver', 'Silver (2nd)')}${hdImg('medal-bronze', 'Bronze (3rd)')}${hdImg('medal-other', 'Other places (4th and below)')}
    <img src="images/icons/${clan ? 'col-kills' : 'col-xp'}.png" alt="${clan ? 'Kills' : 'XP'}" title="${clan ? 'Kills' : 'XP'}" onerror="${PH}">
    <img src="images/icons/${clan ? 'col-members' : 'col-weapon'}.png" alt="${clan ? 'Members' : 'Top weapon'}" title="${clan ? 'Members' : 'Top weapon'}" onerror="${PH}">
    <img src="images/icons/col-clan.png" alt="${clan ? 'Tag' : 'Clan'}" title="${clan ? 'Tag' : 'Clan'}" onerror="${PH}">
    <span></span>`;
}
const cnt = n => `<span class="c${n ? '' : ' zero'}">${n || '-'}</span>`;

function render() {
  renderHead();
  list = aggregate();
  const clan = filter === 'clan', q = $('q').value.trim().toLowerCase();
  const max = Math.max(1, ...list.map(a => a.total));
  const shown = list.filter(a => !q || a.name.toLowerCase().includes(q) || String((clan ? a.c?.tag : a.p?.clan_tag) ?? '').toLowerCase().includes(q));

  $('rows').innerHTML = shown.map(a => {
    const medals = `<div class="stat"><div class="top"><span>${a.total}</span></div><div class="bar b-medals"><i style="width:${a.total / max * 100}%"></i></div></div>`;
    let mid, tail;
    if (clan) {
      const c = a.c, col = CLAN_COLORS[c?.color] || '#ffffff';
      mid = `<div class="stat"><div class="top"><span>${c?.kills != null ? fmt(c.kills) : 'N/A'}</span></div></div><span class="c">${c ? `${fmt(c.member_count)}/${fmt(c.member_cap)}` : 'N/A'}</span>`;
      tail = `<span class="clan" style="color:${col}">${esc(c?.tag || '')}</span>`;
    } else {
      const p = a.p, xp = num(p?.total_xp), lvl = xp == null ? null : xpToLevel(xp), col = CLAN_COLORS[p?.clan_color] || '#ffffff';
      mid = `${xp == null ? '<span class="muted">N/A</span>'
        : `<div class="stat"><div class="top"><span>${fmt(xp)}</span><span class="pct new">Lv ${lvl}</span></div><div class="bar b-lvl"><i style="width:${lvl / MAX_LEVEL * 100}%"></i></div></div>`}
        <span class="weapon">${p?.top_weapon_id != null ? `<img src="images/weapons/${esc(p.top_weapon_id)}.png" alt="Weapon ${esc(p.top_weapon_id)}" title="Weapon ${esc(p.top_weapon_id)}" onerror="${PH}">` : '<span class="muted">N/A</span>'}</span>`;
      tail = `<span class="clan" style="color:${col}">${p?.clan_tag ? esc(p.clan_tag) : ''}</span>`;
    }
    return `<div class="lb-row pd-row"><span class="rank">${a.rank}</span><span class="pname" title="${esc(a.name)}">${esc(a.name)}</span>${medals}
      ${cnt(a.g)}${cnt(a.s)}${cnt(a.b)}${cnt(a.o)}${mid}${tail}
      <button class="inspect" data-id="${esc(a.id)}" aria-label="Medal history for ${esc(a.name)}"><img src="images/icons/inspect.png" alt="" onerror="${PH}"></button></div>`;
  }).join('') || `<p class="muted" style="padding:24px">${data.medals.length ? 'No medals match.' : 'No medals yet. Add them in Supabase (see supabase/podium.sql).'}</p>`;

  const what = { overall: 'all medals', day: 'daily medals', week: 'weekly medals', ranked: season === 'all' ? 'ranked medals' : `ranked season ${season} medals`, clan: 'clan medals', monthly: `medals in ${month}` }[filter];
  $('status').textContent = `${list.length} ${clan ? 'clans' : 'players'} with ${what}.`;
}

function renderSub() {
  let h = '';
  if (filter === 'ranked') {
    const seasons = [...new Set(data.medals.filter(m => m.category === 'ranked' && m.season != null).map(m => m.season))].sort((a, b) => b - a);
    h = `<label class="muted">Season <select id="seasonSel"><option value="all">All seasons</option>${seasons.map(s => `<option value="${s}"${String(s) === season ? ' selected' : ''}>Season ${s}</option>`).join('')}</select></label>`;
  } else if (filter === 'monthly') {
    h = `<label class="muted">Month <input type="month" id="monthSel" value="${month}"></label>`;
  }
  $('sub').innerHTML = h;
  if ($('seasonSel')) $('seasonSel').onchange = e => { season = e.target.value; render(); };
  if ($('monthSel')) $('monthSel').onchange = e => { if (e.target.value) { month = e.target.value; render(); } };
}

// ================= EVENTS =================
$('filters').addEventListener('click', e => {
  const b = e.target.closest('[data-f]'); if (!b) return;
  filter = b.dataset.f;
  document.querySelectorAll('#filters button').forEach(x => x.classList.toggle('on', x === b));
  renderSub(); render();
});
$('q').addEventListener('input', render);

// medal history popup (uses every medal that player/clan has, whatever the filter)
$('rows').addEventListener('click', e => {
  const btn = e.target.closest('.inspect'); if (!btn) return;
  const id = btn.dataset.id, a = list.find(x => x.id === id), meds = data.medals.filter(m => m.entity_id === id);
  const t = { g: 0, s: 0, b: 0, o: 0 }; meds.forEach(m => t[tier(m.place)]++);
  const sub = filter === 'clan'
    ? (a.c ? `[${esc(a.c.tag)}] · ${fmt(a.c.member_count)}/${fmt(a.c.member_cap)} members` : '')
    : (a.p ? `${a.p.clan_tag ? `[${esc(a.p.clan_tag)}] · ` : ''}${a.p.total_xp != null ? fmt(a.p.total_xp) + ' XP' : ''}` : '');
  $('dlgBody').innerHTML = `<h3>${esc(a.name)}</h3><div class="muted">${sub} · ID ${esc(id)}</div>
    <div class="dlg-grid"><div>Total medals<b>${meds.length}</b></div><div>Gold / Silver / Bronze<b>${t.g} / ${t.s} / ${t.b}</b></div></div>
    <div class="pd-hist">${meds.map(m => `<div><span>${esc(m.awarded_on)}</span>${catLabel(m)}<b>${ordinal(m.place)}</b></div>`).join('') || '<p class="muted">No medals.</p>'}</div>`;
  $('dlg').showModal();
});
$('dlgClose').onclick = () => $('dlg').close();
$('dlg').addEventListener('click', e => { if (e.target === $('dlg')) $('dlg').close(); });

// ================= LOAD =================
(async () => {
  try {
    const r = await fetch(API);
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
    data = j;
    renderSub(); render();
  } catch (e) {
    console.error(e);
    $('status').innerHTML = `<b>Could not load the podium:</b> ${esc(e.message)}`;
    renderHead();
  }
})();
