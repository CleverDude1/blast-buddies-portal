// Top bar: "New API" and "Old API" buttons.
//   New API: green (soft glow) = in use and working, even if it has problems: then a small amber "!" badge shows on the button.
//            red + glowing = not working.
//   Old API: yellow (soft glow) = on standby while the New API works, GREEN = it has taken over because the New API is down,
//            amber = it took over but only partly works, red + glowing = both APIs are down, grey = status not available.
// Data: /api/hourly?mode=status (see api/_lib/status.js). Checked once a minute while the tab is open. Click a button for details.
// The styles are injected from this file, so the buttons look right even if css/status.css is missing or overridden.
// Preview without breaking anything: open any page with ?apitest=down (or warn / ok). Add &oldtest=ok|warn|down to preview the Old API's health.
(() => {
  const root = document.getElementById('apiStatus');
  if (!root) return;

  // Set ADMIN_ONLY to true to hide the buttons from visitors: open any page once with ?admin=1 and they show in that browser only.
  const ADMIN_ONLY = false;
  const params = new URLSearchParams(location.search);
  try { if (params.get('admin') === '1') localStorage.setItem('bbAdmin', '1'); } catch (e) {}
  if (ADMIN_ONLY) { let ok = false; try { ok = localStorage.getItem('bbAdmin') === '1'; } catch (e) {} if (!ok) return; }
  const FORCE = params.get('apitest') || '';
  const OLDFORCE = ['ok', 'warn', 'down'].includes(params.get('oldtest')) ? params.get('oldtest') : '';

  const CSS = `
.api-status{display:flex;align-items:center;gap:8px}
.api-wrap{position:relative}
.api-pill{padding:0 14px;gap:9px;font-size:14px}
.api-dot{display:inline-block;width:10px;height:10px;border-radius:50%;background:#6b7360;flex:none}
.api-pill.ok .api-dot{background:#4ade80;box-shadow:0 0 6px rgba(74,222,128,.6)}
.api-pill.ok{border-color:#4ade80 !important;animation:api-glow-g 3s ease-in-out infinite !important}
.api-bang{position:absolute;top:-7px;right:-7px;width:19px;height:19px;border-radius:50%;background:#fbbf24;color:#1a1400;font-weight:800;font-size:13px;line-height:19px;text-align:center;box-shadow:0 0 8px rgba(251,191,36,.85);pointer-events:none;z-index:2}
.api-pill.warn .api-dot{background:#fbbf24;box-shadow:0 0 6px rgba(251,191,36,.55)}
.api-pill.standby{border-color:#fbbf24 !important;animation:api-glow-y 2.6s ease-in-out infinite !important}
.api-pill.standby .api-dot{background:#fbbf24;box-shadow:0 0 8px #fbbf24}
.api-pill.down{border-color:#ff4d4d !important;background:rgba(120,20,20,.55) !important;color:#fff !important;animation:api-glow 1.4s ease-in-out infinite !important}
.api-pill.down .api-dot{background:#ff4d4d;box-shadow:0 0 8px #ff4d4d}
@keyframes api-glow{0%,100%{box-shadow:0 0 4px 0 rgba(255,60,60,.4),inset 0 0 6px rgba(255,60,60,.3)}50%{box-shadow:0 0 18px 4px rgba(255,60,60,.9),inset 0 0 12px rgba(255,60,60,.6)}}
@keyframes api-glow-g{0%,100%{box-shadow:0 0 3px 0 rgba(74,222,128,.25),inset 0 0 5px rgba(74,222,128,.15)}50%{box-shadow:0 0 13px 3px rgba(74,222,128,.6),inset 0 0 8px rgba(74,222,128,.3)}}
@keyframes api-glow-y{0%,100%{box-shadow:0 0 3px 0 rgba(251,191,36,.3),inset 0 0 5px rgba(251,191,36,.2)}50%{box-shadow:0 0 14px 3px rgba(251,191,36,.7),inset 0 0 9px rgba(251,191,36,.4)}}
@media(prefers-reduced-motion:reduce){
  .api-pill.down{animation:none !important;box-shadow:0 0 12px 2px rgba(255,60,60,.8),inset 0 0 10px rgba(255,60,60,.5) !important}
  .api-pill.standby{animation:none !important;box-shadow:0 0 10px 2px rgba(251,191,36,.6) !important}
  .api-pill.ok{animation:none !important;box-shadow:0 0 9px 2px rgba(74,222,128,.55) !important}}
.api-pop{position:absolute;right:0;top:52px;z-index:30;width:min(340px,86vw);background:var(--card,#161c11);border:1px solid var(--line,#2a3322);border-radius:12px;padding:14px 16px;text-align:left;color:var(--text,#f1efe6)}
.api-pop[hidden]{display:none}
.api-pop h4{display:flex;align-items:center;justify-content:space-between;gap:10px;font-size:15px}
.api-tag{font-size:12px;font-weight:700;padding:3px 10px;border-radius:999px;background:#2b3524;color:#cfd3c4}
.api-tag.ok{background:#1d4a27;color:#8ff09b}.api-tag.warn,.api-tag.standby{background:#4a3a1d;color:#ffd98b}.api-tag.down{background:#4a1d1d;color:#ff9b9b}
.api-pop p{margin-top:8px;font-size:13px;line-height:1.5;color:#cfd3c4}
.api-pop dl{display:grid;grid-template-columns:auto 1fr;gap:4px 12px;margin-top:10px;font-size:13px}
.api-pop dt{color:var(--muted,#9aa38c)}
.api-pop dd{text-align:right;font-weight:600}
.api-err{list-style:none;margin-top:10px;display:grid;gap:6px}
.api-err li{background:#0b0f08;border-radius:8px;padding:8px 10px;font-size:12px;color:#ffb3b3;word-break:break-word}
.api-err b{color:var(--text,#f1efe6)}
.api-pop .api-note{margin-top:10px;font-size:11px;color:#7d8671}
@media(max-width:800px){.api-pill{padding:0 10px}.api-w{display:none}}`;
  if (!document.getElementById('api-status-css')) document.head.insertAdjacentHTML('beforeend', `<style id="api-status-css">${CSS}</style>`);

  const KEYS = [['new', 'New'], ['old', 'Old']];
  const WORD = { ok: 'working', warn: 'has problems', down: 'is not working', standby: 'is on standby', off: 'is not connected', unknown: 'status unavailable' };
  const TAG = { ok: 'Working', warn: 'Problems', down: 'Down', standby: 'Standby', off: 'Not connected', unknown: 'Checking' };
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const ago = iso => { const m = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 6e4)); return m < 2 ? 'just now' : m < 90 ? `${m} min ago` : `${Math.round(m / 60)} h ago`; };
  const utc = iso => new Date(iso).toISOString().slice(11, 16) + ' UTC';

  let data = null, failed = false, failCode = null, openKey = null, last = '';

  function newState() {
    if (['ok', 'warn', 'down'].includes(FORCE))
      return { state: FORCE, title: 'Preview', reason: `Preview mode (?apitest=${FORCE}). This is not the real status.`, errors: [] };
    if (failed) {
      if (navigator.onLine === false) return { state: 'unknown', title: 'Offline', reason: 'Your browser looks offline, so the status could not be read.', errors: [] };
      // the site's own API did not answer: the data is not flowing, so this is shown as down
      return { state: 'down', title: 'Not working', reason: `The site's API did not answer${failCode ? ` (error ${failCode})` : ''}, so the status could not be read.`, errors: [] };
    }
    if (!data) return { state: 'unknown', title: 'Checking', reason: 'Checking the status...', errors: [] };
    return data.new || { state: 'unknown', title: 'Checking', reason: 'No status for the New API yet.', errors: [] };
  }

  // The Old API is the backup. Its button depends on the New API:
  function oldState() {
    const n = newState(), real = data && data.old;
    // how healthy the old API itself is, as measured by the server (null = not measured)
    const health = OLDFORCE ? { state: OLDFORCE } : (real && ['ok', 'warn', 'down'].includes(real.state) ? real : null);
    const base = { lastRunAt: real?.lastRunAt, lastGoodAt: real?.lastGoodAt, errors: real?.errors || [] };
    if (n.state === 'unknown') return { ...base, state: 'unknown', title: 'Checking', reason: 'Waiting for the New API status...' };
    if (n.state === 'ok' || n.state === 'warn') {
      const extra = health && health.state === 'down' ? ' Note: the Old API itself is not answering right now, so there is no backup at the moment.' : '';
      return { ...base, state: 'standby', title: 'On standby',
        reason: (n.state === 'ok'
          ? 'Not needed right now: the New API is working. The Old API takes over automatically if it stops answering.'
          : 'The New API has some problems. The Old API fills in any board it could not deliver.') + extra };
    }
    // the New API is down: the Old API is expected to be providing the data
    if (!health) return { ...base, state: 'warn', tag: 'Unverified', title: 'Unverified',
      reason: 'The New API is down, so the Old API should be providing the data, but its own status could not be confirmed.' };
    if (health.state === 'ok') return { ...base, state: 'ok', tag: 'Active', title: 'Active',
      reason: 'The New API is down, so the Old API has taken over and is providing the data.' };
    if (health.state === 'warn') return { ...base, state: 'warn', tag: 'Problems', title: 'Problems',
      reason: 'The New API is down and the Old API is only partly working, so some data may be missing.' };
    return { ...base, state: 'down', tag: 'Down', title: 'Not working',
      reason: 'Both the New API and the Old API are not working, so no new data is coming in.' };
  }
  const get = k => (k === 'new' ? newState() : oldState());

  function pop(k, label, s) {
    return `<h4>${label} API <span class="api-tag ${esc(s.state)}">${esc(s.tag || TAG[s.state] || '')}</span></h4><p>${esc(s.reason)}</p>`
      + (k === 'old'
          ? (s.lastRunAt ? `<dl><dt>Last used as backup</dt><dd>${ago(s.lastRunAt)} (${utc(s.lastRunAt)})</dd></dl>` : '<dl><dt>Last used as backup</dt><dd>not yet</dd></dl>')
          : (s.lastRunAt ? `<dl><dt>Last collection</dt><dd>${ago(s.lastRunAt)} (${utc(s.lastRunAt)})</dd>`
              + (s.lastGoodAt ? `<dt>Last success</dt><dd>${ago(s.lastGoodAt)} (${utc(s.lastGoodAt)})</dd>` : '') + '</dl>' : ''))
      + (s.errors && s.errors.length ? `<ul class="api-err">${s.errors.map(e => `<li><b>${esc(e.where)}</b>: ${esc(e.message)}</li>`).join('')}</ul>` : '')
      + (k === 'new' ? '<p class="api-note">Checked every minute. The collector runs once an hour.</p>'
        : '<p class="api-note">The Old API is the backup: yellow while the New API works, green when it has taken over.</p>');
  }

  function render() {
    const focused = document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.k : null;
    root.innerHTML = KEYS.map(([k, label]) => {
      const s = get(k), open = openKey === k;
      // the New API is green whenever it is the one in use, even with problems: those are shown as a "!" badge instead of a colour change
      const bang = k === 'new' && s.state === 'warn', vis = bang ? 'ok' : s.state;
      return `<div class="api-wrap"><button type="button" class="pill api-pill ${esc(vis)}" data-k="${k}" data-state="${esc(vis)}" aria-expanded="${open}" aria-haspopup="true" aria-label="${label} API ${WORD[vis] || ''}${bang ? ' with problems' : ''}${s.tag ? ' (' + esc(s.tag) + ')' : ''}">`
        + `<i class="api-dot"></i><span>${label}<span class="api-w"> API</span></span></button>`
        + (bang ? '<b class="api-bang" aria-hidden="true" title="Working, but with problems. Click for details.">!</b>' : '')
        + `<div class="api-pop"${open ? '' : ' hidden'}>${pop(k, label, s)}</div></div>`;
    }).join('');
    if (focused) { const b = root.querySelector(`[data-k="${focused}"]`); if (b) b.focus(); }
  }

  async function load() {
    try {
      const r = await fetch('/api/hourly?mode=status');
      if (!r.ok) { const err = new Error('http'); err.status = r.status; throw err; }
      data = await r.json(); failed = false; failCode = null;
    } catch (e) { failed = true; failCode = e.status || null; }
    const sig = JSON.stringify([data && [data.new, data.old], failed, failCode]);
    if (sig !== last || openKey) { last = sig; render(); }   // re-draw only when something changed (or a details box is open, so its times stay fresh)
  }

  root.addEventListener('click', e => {
    const b = e.target.closest('[data-k]');
    if (!b) return;
    e.stopPropagation();
    openKey = openKey === b.dataset.k ? null : b.dataset.k;
    render();
  });
  document.addEventListener('click', e => { if (openKey && !e.target.closest('.api-wrap')) { openKey = null; render(); } });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && openKey) { openKey = null; render(); } });

  render();
  load();
  setInterval(() => { if (!document.hidden) load(); }, 60000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) load(); });
})();
