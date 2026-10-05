// Shared layout: builds the sidebar + top bar on every page, so edits happen in ONE place.
const CONFIG = {
  siteName: 'Blast Buddies Tracker',
  currentSeason: 1,                                // change this number each season
  discordInvite: 'https://discord.gg/7QWQKTzUDH', // put your invite link here
  languages: [['en','English'],['es','Español'],['fr','Français'],['de','Deutsch'],['pt','Português']]
};
const NAV = [
  ['home','Home','index.html'],
  ['daily','Daily Rankings','daily-rankings.html'],
  ['weekly','Weekly Rankings','weekly-rankings.html'],
  ['season',`Ranked Season ${CONFIG.currentSeason}`,'ranked-season.html'],
  ['clans','Clan Rankings','clan-rankings.html'],
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
  <nav class="nav">
    ${NAV.map(([id,label,href]) => `<a href="${href}" class="${id===page?'active':''}">${icon(id)}${label}</a>`).join('')}
  </nav>
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
