// Clan league page. Needs js/layout.js and js/clan-colors.js (CLAN_COLORS).
const LEAGUE_API = '/api/stats?mode=league';   // served by api/stats.js (league code lives in api/_lib/league.js)

// Same tables as the medal ranks on the Statistics page (must match supabase/league.sql: medal points by place).
const MEDALS = [['Gold', 1000, '#ffd84d'], ['Silver', 950, '#cfd6dd'], ['Bronze', 850, '#cd7f32'], ['Glass', 700, '#8ff7ff'], ['Copper', 500, '#d2763a'],
  ['Iron', 400, '#9aa0a6'], ['Stone', 300, '#8d96a3'], ['Clay', 200, '#b5651d'], ['Wood', 100, '#9b6b3d'], ['Pebble', 50, '#7a7a7a']];
const STEP = 2000;   // points per title; 16 titles, Annihilator at 30,000
const TITLES = [['Wild Brawler', '#9aa5b1'], ['Adept Brawler', '#9aa5b1'], ['Skilled Brawler', '#9aa5b1'], ['Bounty Hunter', '#4dd0e1'], ['Expert Hunter', '#4dd0e1'], ['Master Hunter', '#4dd0e1'],
  ['Castle Guardian', '#5c9dff'], ['Noble Guardian', '#5c9dff'], ['Throne Guardian', '#5c9dff'], ['Gallant Warrior', '#ffb44d'], ['Veteran Warrior', '#ffb44d'], ['Heroic Warrior', '#ffb44d'],
  ['Great Warlord', '#ff6b6b'], ['Supreme Warlord', '#ff6b6b'], ['Ultimate Warlord', '#ff6b6b'], ['Annihilator', '#ff3df0']];
const titleOf = p => { const i = Math.min(Math.floor(p / STEP), TITLES.length - 1); return { i, name: TITLES[i][0], color: TITLES[i][1] }; };

const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = n => Number(n).toLocaleString();
let data = null;

function render() {
  const el = $('lgAreas');
  if (!data) return;
  if (!data.day) { el.innerHTML = '<p class="muted">No league day is open yet. It opens with the first clan snapshot after the league SQL is installed.</p>'; $('lgInfo').textContent = ''; return; }
  $('lgInfo').textContent = `Season ${data.season} · day ${data.day} · numbers from the :55 snapshot${data.updatedAt ? ' at ' + new Date(data.updatedAt).toISOString().slice(11, 16) + ' UTC' : ''}`;
  const by = {};
  for (const c of data.clans) (by[c.area] ||= []).push({ ...c, gain: Math.max(0, c.last_kills - c.start_kills) });
  const down = data.clans.filter(c => c.last_kills < c.start_kills).length;
  const warn = down * 2 > data.clans.length ? '<div class="lg-warn">Clan kills went down for most clans, so a season reset looks to be in progress. Today will not award medals.</div>' : '';
  el.innerHTML = warn + Object.keys(by).sort((a, b) => a - b).map(a => {
    const rows = by[a].sort((x, y) => y.gain - x.gain || y.start_kills - x.start_kills);
    return `<section class="lg-area"><h2>Area ${a}<small>${a == 1 ? 'highest titles' : 'compete for the top 3 to move up'}</small></h2>${rows.map((c, i) => {
      const t = titleOf(c.start_points), m = c.gain > 0 ? MEDALS[i] : null;
      const up = m && titleOf(c.start_points + m[1]).i > t.i;
      return `<div class="lg-row"><span class="lg-title" style="color:${t.color}">${esc(t.name)}<small>${fmt(c.start_points)} pts</small></span>
        <span><span style="color:${CLAN_COLORS[c.color] || '#fff'};font-weight:800">${esc(c.tag || '')}</span> ${esc(c.name)}</span>
        <span class="lg-gain"><b>+${fmt(c.gain)}</b><small>kills today</small></span>
        <span class="lg-medal">${m ? `<i style="--c:${m[2]}"></i>${m[0]}<small>+${m[1]}</small>${up ? '<span class="lg-up" title="Would reach a new title">▲</span>' : ''}` : '<small>no medal</small>'}</span></div>`;
    }).join('')}</section>`;
  }).join('');
}

function tick() {
  const n = new Date(), s = Math.max(0, Math.floor((Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate() + 1) - n) / 1000));
  $('lgCd').textContent = [Math.floor(s / 3600), Math.floor(s % 3600 / 60), s % 60].map(x => String(x).padStart(2, '0')).join(':');
}
async function load() {
  try { const r = await fetch(LEAGUE_API); if (!r.ok) throw new Error('HTTP ' + r.status); data = await r.json(); render(); }
  catch (e) { console.warn('league failed:', e); $('lgInfo').innerHTML = '<b>Could not load the league.</b>'; }
}
tick(); setInterval(tick, 1000);
load(); setInterval(load, 300000);
