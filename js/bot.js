// Top bar: BOT CONCENTRATION buttons, one per region (NA / EU / AS), built from /api/rooms.
// In a room, empty seats are filled by bots: bots = maxPlayers - players (2 / 10 means 2 real players and 8 bots).
// Bot share of a region = all bots / all seats in its rooms.
//   green  = mostly real players      (bots under WARN_AT %)
//   yellow = a mixed population       (WARN_AT % up to DOWN_AT %)
//   red    = mostly bots, glowing     (DOWN_AT % or more)
//   grey   = that region's room list could not be read
// Click a button for rooms, players, bots, a breakdown by mode and the most bot-heavy rooms.
// Checked once a minute while the tab is open. Preview the colours: add ?bottest=ok (or warn / down) to any page address.
// This script builds its own container (right after the API status buttons) and injects its own styles, so layout.js only needs to load it.
(() => {
  // ---- tweak here ----
  const WARN_AT = 40;                  // bot share (%) where green turns yellow
  const DOWN_AT = 70;                  // bot share (%) where yellow turns red
  const ONLY_STATES = null;            // e.g. [2] to count only rooms whose gameState is 2 (in progress?). null = count every room.
                                       // Use this if rooms waiting in a lobby (empty seats that are not bots) turn out to skew the numbers.
  const REGIONS = [['na', 'NA', 'North America'], ['eu', 'EU', 'Europe'], ['as', 'AS', 'Asia']];
  const REFRESH_MS = 60000;
  // --------------------
  const bar = document.querySelector('.topbar');
  if (!bar) return;
  const anchor = document.getElementById('apiStatus');
  const root = document.createElement('div');
  root.className = 'bot-status'; root.id = 'botStatus';
  if (anchor) anchor.after(root); else bar.append(root);

  const FORCE = new URLSearchParams(location.search).get('bottest') || '';
  const FORCE_PCT = { ok: 18, warn: 55, down: 86 };

  const CSS = `
.bot-status{display:flex;align-items:center;gap:8px}
.bot-wrap{position:relative}
.bot-pill{padding:0 12px;gap:8px;font-size:14px}
.bot-dot{display:inline-block;width:10px;height:10px;border-radius:50%;background:#6b7360;flex:none}
.bot-pill b{font-weight:700;font-variant-numeric:tabular-nums}
.bot-pill.ok{border-color:#4ade80 !important;animation:bot-glow-g 3.4s ease-in-out infinite !important}
.bot-pill.ok .bot-dot{background:#4ade80;box-shadow:0 0 6px rgba(74,222,128,.6)}
.bot-pill.warn{border-color:#fbbf24 !important;animation:bot-glow-y 3s ease-in-out infinite !important}
.bot-pill.warn .bot-dot{background:#fbbf24;box-shadow:0 0 7px rgba(251,191,36,.7)}
.bot-pill.down{border-color:#ff4d4d !important;background:rgba(120,20,20,.55) !important;color:#fff !important;animation:bot-glow-r 1.5s ease-in-out infinite !important}
.bot-pill.down .bot-dot{background:#ff4d4d;box-shadow:0 0 8px #ff4d4d}
@keyframes bot-glow-g{0%,100%{box-shadow:0 0 3px 0 rgba(74,222,128,.22),inset 0 0 5px rgba(74,222,128,.12)}50%{box-shadow:0 0 12px 3px rgba(74,222,128,.55),inset 0 0 8px rgba(74,222,128,.25)}}
@keyframes bot-glow-y{0%,100%{box-shadow:0 0 3px 0 rgba(251,191,36,.28),inset 0 0 5px rgba(251,191,36,.18)}50%{box-shadow:0 0 13px 3px rgba(251,191,36,.65),inset 0 0 9px rgba(251,191,36,.35)}}
@keyframes bot-glow-r{0%,100%{box-shadow:0 0 4px 0 rgba(255,60,60,.4),inset 0 0 6px rgba(255,60,60,.3)}50%{box-shadow:0 0 18px 4px rgba(255,60,60,.9),inset 0 0 12px rgba(255,60,60,.6)}}
@media(prefers-reduced-motion:reduce){.bot-pill.ok,.bot-pill.warn,.bot-pill.down{animation:none !important}
  .bot-pill.ok{box-shadow:0 0 8px 1px rgba(74,222,128,.5)}.bot-pill.warn{box-shadow:0 0 9px 1px rgba(251,191,36,.55)}.bot-pill.down{box-shadow:0 0 12px 2px rgba(255,60,60,.8)}}
.bot-pop{position:absolute;right:0;top:52px;z-index:30;width:min(360px,88vw);background:var(--card,#161c11);border:1px solid var(--line,#2a3322);border-radius:12px;padding:14px 16px;text-align:left;color:var(--text,#f1efe6)}
.bot-pop[hidden]{display:none}
.bot-pop h4{display:flex;align-items:center;justify-content:space-between;gap:10px;font-size:15px}
.bot-tag{font-size:12px;font-weight:700;padding:3px 10px;border-radius:999px;background:#2b3524;color:#cfd3c4}
.bot-tag.ok{background:#1d4a27;color:#8ff09b}.bot-tag.warn{background:#4a3a1d;color:#ffd98b}.bot-tag.down{background:#4a1d1d;color:#ff9b9b}
.bot-pop p{margin-top:8px;font-size:13px;line-height:1.5;color:#cfd3c4}
.bot-pop dl{display:grid;grid-template-columns:auto 1fr;gap:4px 12px;margin-top:10px;font-size:13px}
.bot-pop dt{color:var(--muted,#9aa38c)}
.bot-pop dd{text-align:right;font-weight:600}
.bot-bar{height:8px;border-radius:999px;background:#2b3524;overflow:hidden;margin-top:10px}
.bot-bar i{display:block;height:100%;background:linear-gradient(90deg,#4ade80,#fbbf24,#ff4d4d);background-size:var(--w,100%) 100%;border-radius:999px}
.bot-pop h5{margin:12px 0 4px;font-size:12px;letter-spacing:.04em;text-transform:uppercase;color:var(--muted,#9aa38c)}
.bot-rows{display:grid;gap:3px;font-size:12.5px}
.bot-rows div{display:flex;justify-content:space-between;gap:10px}
.bot-rows span:last-child{font-weight:600;white-space:nowrap}
.bot-pop .bot-note{margin-top:10px;font-size:11px;color:#7d8671}
@media(max-width:800px){.bot-pill{padding:0 9px}}`;
  if (!document.getElementById('bot-status-css')) document.head.insertAdjacentHTML('beforeend', `<style id="bot-status-css">${CSS}</style>`);

  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pretty = s => { const t = String(s ?? '').replace(/_/g, ' ').trim(); return t.length <= 3 ? t.toUpperCase() : t.toLowerCase().replace(/(^|\s)\S/g, c => c.toUpperCase()); };
  const hhmm = iso => { const d = new Date(iso); return isNaN(d) ? '' : d.toISOString().slice(11, 16) + ' UTC'; };
  const stateOf = pct => pct >= DOWN_AT ? 'down' : pct >= WARN_AT ? 'warn' : 'ok';
  const WORD = { ok: 'mostly real players', warn: 'a mixed crowd', down: 'mostly bots', off: 'unavailable' };
  const TAG = { ok: 'Mostly players', warn: 'Mixed', down: 'Mostly bots', off: 'Unavailable' };

  // ---- the numbers for one region ----
  function statsOf(rooms) {
    const out = { rooms: 0, slots: 0, humans: 0, botOnly: 0, byMode: new Map(), byGame: new Map(), list: [] };
    const bump = (m, key, slots, humans) => { const e = m.get(key) || { rooms: 0, slots: 0, humans: 0 }; e.rooms++; e.slots += slots; e.humans += humans; m.set(key, e); };
    for (const r of rooms) {
      const max = Number(r.maxPlayers) || 0;
      if (!max || (ONLY_STATES && !ONLY_STATES.includes(r.gameState))) continue;
      const humans = Math.min(Math.max(Number(r.players) || 0, 0), max);
      out.rooms++; out.slots += max; out.humans += humans;
      if (humans === 0) out.botOnly++;
      bump(out.byMode, r.mode || 'unknown', max, humans);
      bump(out.byGame, r.gameMode || 'unknown', max, humans);
      out.list.push({ map: r.map || 'Unknown map', mode: r.mode, humans, max, bots: max - humans });
    }
    out.bots = out.slots - out.humans;
    out.pct = out.slots ? out.bots / out.slots * 100 : 0;
    out.list.sort((a, b) => b.bots / b.max - a.bots / a.max || b.max - a.max);
    return out;
  }

  let data = null, failed = false, openKey = null, last = '';
  const regionState = key => {
    if (FORCE && FORCE_PCT[FORCE] != null) {
      const pct = FORCE_PCT[FORCE], slots = 100;
      return { state: stateOf(pct), pct, stats: { rooms: 10, slots, humans: Math.round(slots - pct), bots: Math.round(pct), botOnly: 0, byMode: new Map(), byGame: new Map(), list: [], pct }, preview: true };
    }
    const r = data && data.regions && data.regions[key];
    if (!r) return { state: 'off', error: failed ? 'The rooms API did not answer.' : data ? 'No data for this region.' : 'Checking...' };
    const rooms = Array.isArray(r.data) ? r.data : (Array.isArray(r.data?.rooms) ? r.data.rooms : null);
    if (!r.success || !rooms) return { state: 'off', error: r.error || (r.blastBuddiesStatus ? `The game server returned HTTP ${r.blastBuddiesStatus}.` : 'The room list could not be read.') };
    const stats = statsOf(rooms);
    if (!stats.slots) return { state: 'off', error: 'No rooms are open in this region right now.' };
    return { state: stateOf(stats.pct), pct: stats.pct, stats };
  };

  function rowsOf(map) {
    return [...map.entries()].sort((a, b) => b[1].rooms - a[1].rooms).slice(0, 5)
      .map(([k, e]) => `<div><span>${esc(pretty(k))}</span><span>${e.rooms} room${e.rooms === 1 ? '' : 's'} · ${Math.round((e.slots - e.humans) / e.slots * 100)}% bots</span></div>`).join('');
  }
  function pop(label, name, s) {
    if (s.state === 'off') return `<h4>${esc(name)} <span class="bot-tag">${TAG.off}</span></h4><p>${esc(s.error)}</p>`;
    const st = s.stats, pct = Math.round(s.pct);
    return `<h4>${esc(name)} <span class="bot-tag ${s.state}">${TAG[s.state]}</span></h4>
      <p>About <b>${pct}%</b> of the seats in ${esc(label)} rooms are filled by bots.</p>
      <div class="bot-bar"><i style="width:${Math.max(2, pct)}%;--w:${pct ? (10000 / Math.max(pct, 1)).toFixed(0) : 100}%"></i></div>
      <dl><dt>Open rooms</dt><dd>${st.rooms}</dd><dt>Real players</dt><dd>${st.humans}</dd><dt>Bots</dt><dd>${st.bots}</dd>
      <dt>Rooms with no real players</dt><dd>${st.botOnly}</dd></dl>`
      + (st.byMode.size ? `<h5>By mode</h5><div class="bot-rows">${rowsOf(st.byMode)}</div>` : '')
      + (st.byGame.size ? `<h5>By game mode</h5><div class="bot-rows">${rowsOf(st.byGame)}</div>` : '')
      + (st.list.length ? `<h5>Most bot-heavy rooms</h5><div class="bot-rows">${st.list.slice(0, 4).map(r => `<div><span>${esc(r.map)}${r.mode === 'custom' ? ' (custom)' : ''}</span><span>${r.humans} / ${r.max}</span></div>`).join('')}</div>` : '')
      + `<p class="bot-note">Bots = empty seats (max players − players).${data?.retrievedAt ? ` Updated ${hhmm(data.retrievedAt)}.` : ''}${s.preview ? ' Preview mode (?bottest), not real data.' : ''}</p>`;
  }

  function render() {
    root.innerHTML = REGIONS.map(([key, short, name]) => {
      const s = regionState(key), open = openKey === key, txt = s.state === 'off' ? '--' : `${Math.round(s.pct)}%`;
      return `<div class="bot-wrap"><button type="button" class="pill bot-pill ${s.state}" data-b="${key}" aria-expanded="${open}" aria-haspopup="true"
          aria-label="${esc(name)} bots: ${s.state === 'off' ? WORD.off : txt + ', ' + WORD[s.state]}" title="${esc(name)}: ${s.state === 'off' ? 'unavailable' : txt + ' of seats are bots'}">
          <i class="bot-dot"></i><span>${short} <b>${txt}</b></span></button>
        <div class="bot-pop"${open ? '' : ' hidden'}>${pop(name, name + ' bots', s)}</div></div>`;
    }).join('');
  }

  async function load() {
    try {
      const r = await fetch('/api/rooms');
      if (!r.ok) throw new Error('http ' + r.status);
      data = await r.json(); failed = false;
    } catch (e) { failed = true; data = null; }
    const sig = JSON.stringify([data && data.regions && Object.fromEntries(Object.entries(data.regions).map(([k, v]) => [k, v && v.data])), failed]);
    if (sig !== last || openKey) { last = sig; render(); }       // re-draw only when something changed (or a details box is open)
  }

  root.addEventListener('click', e => {
    const b = e.target.closest('[data-b]'); if (!b) return;
    e.stopPropagation();
    openKey = openKey === b.dataset.b ? null : b.dataset.b;
    render();
  });
  document.addEventListener('click', e => { if (openKey && !e.target.closest('.bot-wrap')) { openKey = null; render(); } });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && openKey) { openKey = null; render(); } });

  render();
  load();
  setInterval(() => { if (!document.hidden) load(); }, REFRESH_MS);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) load(); });
})();
