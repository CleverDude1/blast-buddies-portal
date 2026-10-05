// Image files must match these names EXACTLY (including capitalization): images/maps/<Name>.png
// GitHub Pages is case-sensitive, so "arena.png" will NOT load for "Arena".
const MAPS = ['Arena','Blocktown','Canyon','Favela','Nukeville','Outpost','Prototype','Pyramids','Rooftops','Shipment','SunnyTown'];

// TODO: map detail API. Should return extra info for one map, e.g. { 'Matches played': 123, ... }
async function getMapDetails(name) { return null; }

const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const PH = "this.onerror=null;this.src='images/placeholder.png'";

$('maps').innerHTML = MAPS.map(m => `
  <article class="map-card">
    <button class="map-thumb" data-map="${esc(m)}" aria-label="Open ${esc(m)}"><img src="images/maps/${esc(m)}.png" alt="${esc(m)}" onerror="${PH}"></button>
    <div class="map-title">${esc(m)}</div>
    <div class="map-sub">Blast Buddies</div>
    <div class="map-val">-</div>
    <div class="map-note">No data yet</div>
    <button class="see-details" data-map="${esc(m)}">See details</button>
  </article>`).join('');

$('maps').addEventListener('click', async e => {
  const b = e.target.closest('[data-map]'); if (!b) return;
  const name = b.dataset.map;
  $('dlgBody').innerHTML = `<h3>${esc(name)}</h3><div class="muted">Blast Buddies map</div>
    <img class="dlg-img" src="images/maps/${esc(name)}.png" alt="${esc(name)}" onerror="${PH}">
    <div class="dlg-section" id="detailsSlot">Loading map details...</div>`;
  $('dlg').showModal();
  renderDetails($('detailsSlot'), await getMapDetails(name));   // TODO: wire to real API
});
// Structure for the map detail response. Add sections here once the API exists.
function renderDetails(el, d) {
  if (!d) { el.textContent = 'Map details are not available yet. They will appear here once the map API is connected.'; return; }
  el.innerHTML = Object.entries(d).map(([k, v]) => `<div><b>${esc(k)}</b>: ${esc(typeof v === 'object' ? JSON.stringify(v) : v)}</div>`).join('');
}
$('dlgClose').onclick = () => $('dlg').close();
$('dlg').addEventListener('click', e => { if (e.target === $('dlg')) $('dlg').close(); });
