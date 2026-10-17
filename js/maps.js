// ================= OFFICIAL MAPS =================
// Image files must match these names EXACTLY (including capitalization): images/maps/<Name>.png
// GitHub Pages is case-sensitive, so "arena.png" will NOT load for "Arena".
const MAPS = ['Arena','Blocktown','Canyon','Favela','Nukeville','Outpost','Prototype','Pyramids','Rooftops','Shipment','SunnyTown'];

// TODO: map detail API. Should return extra info for one map, e.g. { 'Matches played': 123, ... }
async function getMapDetails(name) { return null; }

// ================= CUSTOM MAPS (static list, add new ones at the top) =================
// image: put the picture in images/maps/custom/ (until it exists the placeholder is shown).
// id = mapId from the game (the rooms API calls it customMapId). creator = playerId of the maker.
const CUSTOM_MAPS = [
  { name: 'Silent Mary',            image: 'images/maps/custom/Silent-Mary.png',            id: '39882585-ff3c-41d2-9a56-e5a9fd2f0df3', creator: 'pEyooYhCf-xj', size: [48, 96, 48], ground: 2, created: '2026-10-10T19:48:55.203Z', updated: '2026-10-11T17:52:02.857Z' },
  { name: 'Rocket Launch Facility', image: 'images/maps/custom/Rocket-Launch-Facility.png', id: '32369638-f4d9-4bf4-8ade-381c54d6a4b8', creator: 'pEyooYhCf-xj', size: [48, 96, 48], ground: 2, created: '2026-10-10T20:39:26.895Z', updated: '2026-10-10T20:40:24.878Z' },
  { name: 'Castle Keep',            image: 'images/maps/custom/Castle-Keep.png',            id: 'ff85ff04-c0cd-48b2-87a7-927a2d993aaf', creator: 'pEyooYhCf-xj', size: [48, 96, 48], ground: 2, created: '2026-10-10T20:22:00.053Z', updated: '2026-10-10T20:22:57.036Z' },
  { name: 'Roman Colosseum',        image: 'images/maps/custom/Roman-Colosseum.png',        id: 'b0c63097-40b4-42bb-97fd-dea5a571ff3c', creator: 'pEyooYhCf-xj', size: [48, 96, 48], ground: 2, created: '2026-10-10T20:56:21.331Z', updated: '2026-10-10T20:57:21.242Z' },
];

const API_VOTE = '/api/hourly?mode=vote';          // community tier list results (same call the Weapons page uses)

const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const PH = "this.onerror=null;this.src='images/placeholder.png'";
const day = iso => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
const sizeOf = m => m.size.join(' × ');

$('maps').innerHTML = MAPS.map(m => `
  <article class="map-card">
    <button class="map-thumb" data-map="${esc(m)}" aria-label="Open ${esc(m)}"><img src="images/maps/${esc(m)}.png" alt="${esc(m)}" onerror="${PH}"></button>
    <div class="map-title">${esc(m)}</div>
    <div class="map-sub">Blast Buddies</div>
    <div class="map-val">-</div>
    <div class="map-note">No data yet</div>
    <button class="see-details" data-map="${esc(m)}">See details</button>
  </article>`).join('');

$('customMaps').innerHTML = CUSTOM_MAPS.map(m => `
  <article class="map-card">
    <button class="map-thumb" data-custom="${esc(m.id)}" aria-label="Open ${esc(m.name)}"><img src="${esc(m.image)}" alt="${esc(m.name)}" onerror="${PH}"></button>
    <div class="map-title">${esc(m.name)}</div>
    <div class="map-sub">Custom map · by ${esc(m.creator)}</div>
    <div class="map-val">${esc(sizeOf(m))}</div>
    <div class="map-note">Created ${day(m.created)}</div>
    <button class="see-details" data-custom="${esc(m.id)}">See details</button>
  </article>`).join('');

// ---------- community tier letters ----------
let tiers = {};                                    // tiers['Arena'] = { tier, avg, pct }
function tierMap(d) {                              // same rule as the Weapons page and the Community Vote page: average score -> tier letter
  const T = d.tiers || [], out = {};
  if (!T.length) return out;
  for (const r of d.results?.maps || [])
    if (r.avgScore > 0) out[r.item] = { tier: T[Math.min(T.length - 1, Math.max(0, Math.round(T.length - r.avgScore)))], avg: r.avgScore, pct: r.pctTop };
  return out;
}
function badges() {
  document.querySelectorAll('.map-thumb[data-map]').forEach(t => {
    t.querySelectorAll('.wt-b').forEach(x => x.remove());
    const tr = tiers[t.dataset.map];
    if (tr) t.insertAdjacentHTML('afterbegin', `<b class="wt-b wt-tier t-${tr.tier}" title="Community tier ${tr.tier} (average ${tr.avg}/5)">${tr.tier}</b>`);
  });
}
fetch(API_VOTE).then(r => r.json()).then(d => { if (d.results) { tiers = tierMap(d); badges(); } }).catch(() => {});

// ---------- details popups ----------
$('maps').addEventListener('click', async e => {
  const b = e.target.closest('[data-map]'); if (!b) return;
  const name = b.dataset.map, tr = tiers[name];
  $('dlgBody').innerHTML = `<h3>${esc(name)}</h3><div class="muted">Blast Buddies map</div>
    <div id="mapMeta">${tr ? `Community tier <b>${tr.tier}</b> (average ${tr.avg}/5)<br>${tr.pct}% of voters put it in S or A` : ''}</div>
    <img class="dlg-img" src="images/maps/${esc(name)}.png" alt="${esc(name)}" onerror="${PH}">
    <div class="dlg-section" id="detailsSlot">Loading map details...</div>`;
  $('dlg').showModal();
  renderDetails($('detailsSlot'), await getMapDetails(name));   // TODO: wire to real API
});

$('customMaps').addEventListener('click', e => {
  const b = e.target.closest('[data-custom]'); if (!b) return;
  const m = CUSTOM_MAPS.find(x => x.id === b.dataset.custom); if (!m) return;
  $('dlgBody').innerHTML = `<h3>${esc(m.name)}</h3><div class="muted">Custom map</div>
    <img class="dlg-img" src="${esc(m.image)}" alt="${esc(m.name)}" onerror="${PH}">
    <div class="dlg-grid">
      <div>Size (X × Y × Z)<b>${esc(sizeOf(m))}</b></div><div>Ground height<b>${esc(m.ground)}</b></div>
      <div>Created<b>${day(m.created)}</b></div><div>Last updated<b>${day(m.updated)}</b></div>
      <div style="grid-column:1/-1">Map ID<b style="font-size:14px;word-break:break-all">${esc(m.id)}</b></div>
      <div style="grid-column:1/-1">Creator (player ID)<b style="font-size:14px;word-break:break-all">${esc(m.creator)}</b></div>
    </div>`;
  $('dlg').showModal();
});

// Structure for the map detail response. Add sections here once the API exists.
function renderDetails(el, d) {
  if (!d) { el.textContent = 'Map details are not available yet. They will appear here once the map API is connected.'; return; }
  el.innerHTML = Object.entries(d).map(([k, v]) => `<div><b>${esc(k)}</b>: ${esc(typeof v === 'object' ? JSON.stringify(v) : v)}</div>`).join('');
}
$('dlgClose').onclick = () => $('dlg').close();
$('dlg').addEventListener('click', e => { if (e.target === $('dlg')) $('dlg').close(); });
