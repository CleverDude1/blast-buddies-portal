// Shared layout: builds the sidebar + top bar on every page, so edits happen in ONE place.
const CONFIG = {
  siteName: 'Blast Buddies Tracker',
  currentSeason: 3,                                // change this number each season
  discordInvite: 'https://discord.gg/YOUR-INVITE', // put your invite link here
  languages: [['en','English'],['es','Español'],['fr','Français'],['de','Deutsch'],['pt','Português']]
};
const NAV = [
  ['home','Home','index.html'],
  ['daily','Daily Rankings','daily-rankings.html'],
  ['weekly','Weekly Rankings','weekly-rankings.html'],
  ['season',`Ranked Season ${CONFIG.currentSeason}`,'ranked-season.html'],
  ['clans','Clan Rankings','clan-rankings.html'],
  ['podium','Podium','podium.html'],
  ['compare','Compare','compare.html'],
  ['player-updates','Player Updates','player-updates.html'],
  ['clan-updates','Clan Updates','clan-updates.html'],
  ['statistics','Statistics','statistics.html'],
  ['maps','Maps','maps.html'],
  ['weapons','Weapons','weapons.html'],
  ['abilities','Abilities','abilities.html'],
  ['updates','Updates','updates.html']
];
const page = document.body.dataset.page;
const icon = id => `<img src="images/icons/${id}.png" alt="" onerror="this.onerror=null;this.src='images/placeholder.png'">`;
const flag = c => `images/flags/${c}.png`;

document.body.insertAdjacentHTML('afterbegin', `
<aside class="sidebar">
  <a class="brand" href="index.html">
    <img src="images/logo.png" alt="${CONFIG.siteName}" onerror="this.onerror=null;this.src='images/placeholder.png'">
  </a>
  <div class="side-scroll">
    <nav class="nav">
      ${NAV.map(([id,label,href]) => `<a href="${href}" class="${id===page?'active':''}">${icon(id)}${label}</a>`).join('')}
    </nav>
    <section class="hr" id="hr"><h4>PAST HOUR <small id="hrAt"></small></h4><div id="hrBody"><p class="hr-note">Loading...</p></div></section>
  </div>
</aside>
<div class="main">
  <header class="topbar">
    <button class="toggle" id="toggle" aria-label="Toggle menu">✕</button>
    <div class="spacer"></div>
    <a class="pill" href="${CONFIG.discordInvite}" target="_blank" rel="noopener">${icon('discord')}Discord</a>
    <a class="pill hide-sm" href="about.html">${icon('about')}About</a>
    <a class="pill hide-sm" href="api.html">${icon('api')}API</a>
    <div class="lang" id="lang">
      <button class="pill" id="langBtn" aria-haspopup="true"><img id="langFlag" src="${flag('en')}" alt="Language">▾</button>
      <div class="lang-menu">
        ${CONFIG.languages.map(([c,n]) => `<button data-lang="${c}"><img src="${flag(c)}" alt="">${n}</button>`).join('')}
      </div>
    </div>
  </header>
  <main class="content" id="content"></main>
</div>`);

document.getElementById('content').append(document.getElementById('page-content').content);

const toggle = document.getElementById('toggle');
toggle.onclick = () => {
  document.body.classList.toggle('collapsed');
  toggle.textContent = document.body.classList.contains('collapsed') ? '☰' : '✕';
};
if (innerWidth <= 800) { document.body.classList.add('collapsed'); toggle.textContent = '☰'; }

const lang = document.getElementById('lang');
document.getElementById('langBtn').onclick = e => { e.stopPropagation(); lang.classList.toggle('open'); };
document.addEventListener('click', () => lang.classList.remove('open'));
const setFlag = c => document.getElementById('langFlag').src = flag(c);
lang.querySelectorAll('[data-lang]').forEach(b => b.onclick = () => {
  setFlag(b.dataset.lang);
  try { localStorage.setItem('lang', b.dataset.lang); } catch (e) {} // hook up real translations later
});
try { const s = localStorage.getItem('lang'); if (s) setFlag(s); } catch (e) {}

// Home page grid reuses the same buttons as the sidebar
const grid = document.getElementById('explore');
if (grid) grid.innerHTML = NAV.filter(n => n[0] !== 'home')
  .map(([id,label,href]) => `<a class="card-link" href="${href}">${icon(id)}${label}<i>›</i></a>`).join('');

// ---- "Past hour" panel under the menu (inside a function so its names cannot clash with page scripts) ----
(() => {
  const BOARD_LABEL = { day: 'Daily', week: 'Weekly', ranked: 'Ranked', clan: 'Clans' };
  const e = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const short = n => { const a = Math.abs(n); return a >= 1e6 ? (n / 1e6).toFixed(2).replace(/\.?0+$/, '') + 'M' : a >= 1e3 ? (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'k' : String(Math.round(n)); };
  const signed = n => (n > 0 ? '+' : n < 0 ? '-' : '') + short(Math.abs(n));
  const mv = x => x.isNew ? '<span class="mv new">NEW</span>' : x.move > 0 ? `<span class="mv up">▲${x.move}</span>` : x.move < 0 ? `<span class="mv down">▼${-x.move}</span>` : '';
  let data = null, cur = 'day';
  const body = document.getElementById('hrBody');
  function draw() {
    const tabs = `<div class="hr-tabs">${Object.entries(BOARD_LABEL).map(([k, l]) => `<button data-hr="${k}" class="${k === cur ? 'on' : ''}">${l}</button>`).join('')}</div>`;
    const b = data.boards[cur];
    if (!b || !b.ok) { body.innerHTML = tabs + '<p class="hr-note">No hourly data for this board yet.</p>'; return; }
    if (b.reset) { body.innerHTML = tabs + '<p class="hr-note">This board just reset, so there are no hourly changes to show yet.</p>'; return; }
    const gainers = b.all.filter(x => x.gain > 0).sort((p, q) => q.gain - p.gain).slice(0, 5);
    const movers = b.all.filter(x => x.move !== 0).sort((p, q) => Math.abs(q.move) - Math.abs(p.move)).slice(0, 4);
    document.getElementById('hrAt').textContent = b.elapsedMin ? `last ${b.elapsedMin >= 50 && b.elapsedMin <= 70 ? '1h' : b.elapsedMin + 'm'}` : '';
    body.innerHTML = tabs
      + `<div class="hr-big"><div><b>${signed(b.totalGain)}</b><span>Total ${e(b.unit)}</span></div><div><b>${b.moved}</b><span>Position changes</span></div></div>`
      + `<div class="hr-sub">Top gains</div><div class="hr-list">${gainers.map(x => `<div><span>${e(x.name)}</span><span class="dlt up" style="margin:0">+${short(x.gain)}</span></div>`).join('') || '<span class="hr-note">Nobody gained.</span>'}</div>`
      + `<div class="hr-sub">Position changes</div><div class="hr-list">${movers.map(x => `<div><span>${e(x.name)}</span>${mv(x)}</div>`).join('') || '<span class="hr-note">No one moved.</span>'}</div>`
      + `<a href="past-hour.html?board=${cur}">Full report &rarr;</a>`;
  }
  body.addEventListener('click', ev => { const t = ev.target.closest('[data-hr]'); if (t && data) { cur = t.dataset.hr; draw(); } });
  fetch('/api/hourly?mode=summary').then(r => r.ok ? r.json() : Promise.reject()).then(d => { data = d; draw(); })
    .catch(() => { body.innerHTML = '<p class="hr-note">No hourly data yet.</p>'; });
})();
