// Top bar: "New API" and "Old API" buttons. Green = working, amber = problems, red + glowing = not working, grey = not connected.
// Data: /api/hourly?mode=status (see api/_lib/status.js). Checked once a minute while the tab is open. Click a button for details.
// The styles are injected from this file, so the buttons look right even if css/status.css is missing or overridden.
// Preview the red glow without breaking anything: open any page with ?apitest=down (or ?apitest=warn / ?apitest=ok).
(() => {
  const root = document.getElementById('apiStatus');
  if (!root) return;

  // Set ADMIN_ONLY to true to hide the buttons from visitors: open any page once with ?admin=1 and they show in that browser only.
  const ADMIN_ONLY = false;
  const params = new URLSearchParams(location.search);
  try { if (params.get('admin') === '1') localStorage.setItem('bbAdmin', '1'); } catch (e) {}
  if (ADMIN_ONLY) { let ok = false; try { ok = localStorage.getItem('bbAdmin') === '1'; } catch (e) {} if (!ok) return; }
  const FORCE = params.get('apitest') || '';

  const CSS = `
.api-status{display:flex;align-items:center;gap:8px}
.api-wrap{position:relative}
.api-pill{padding:0 14px;gap:9px;font-size:14px}
.api-dot{display:inline-block;width:10px;height:10px;border-radius:50%;background:#6b7360;flex:none}
.api-pill.ok .api-dot{background:#4ade80;box-shadow:0 0 6px rgba(74,222,128,.6)}
.api-pill.warn .api-dot{background:#fbbf24;box-shadow:0 0 6px rgba(251,191,36,.55)}
.api-pill.down{border-color:#ff4d4d !important;background:rgba(120,20,20,.55) !important;color:#fff !important;animation:api-glow 1.4s ease-in-out infinite !important}
.api-pill.down .api-dot{background:#ff4d4d;box-shadow:0 0 8px #ff4d4d}
@keyframes api-glow{0%,100%{box-shadow:0 0 4px 0 rgba(255,60,60,.4),inset 0 0 6px rgba(255,60,60,.3)}50%{box-shadow:0 0 18px 4px rgba(255,60,60,.9),inset 0 0 12px rgba(255,60,60,.6)}}
@media(prefers-reduced-motion:reduce){.api-pill.down{animation:none !important;box-shadow:0 0 12px 2px rgba(255,60,60,.8),inset 0 0 10px rgba(255,60,60,.5) !important}}
.api-pop{position:absolute;right:0;top:52px;z-index:30;width:min(340px,86vw);background:var(--card,#161c11);border:1px solid var(--line,#2a3322);border-radius:12px;padding:14px 16px;text-align:left;color:var(--text,#f1efe6)}
.api-pop[hidden]{display:none}
.api-pop h4{display:flex;align-items:center;justify-content:space-between;gap:10px;font-size:15px}
.api-tag{font-size:12px;font-weight:700;padding:3px 10px;border-radius:999px;background:#2b3524;color:#cfd3c4}
.api-tag.ok{background:#1d4a27;color:#8ff09b}.api-tag.warn{background:#4a3a1d;color:#ffd98b}.api-tag.down{background:#4a1d1d;color:#ff9b9b}
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
  const WORD = { ok: 'working', warn: 'has problems', down: 'is not working', off: 'is not connected', unknown: 'status unavailable' };
  const TAG = { ok: 'Working', warn: 'Problems', down: 'Down', off: 'Not connected', unknown: 'Checking' };
  const OFF = { state: 'off', title: 'Not connected', reason: 'The old API is not connected to this status check yet.', errors: [] };
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const ago = iso => { const m = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 6e4)); return m < 2 ? 'just now' : m < 90 ? `${m} min ago` : `${Math.round(m / 60)} h ago`; };
  const utc = iso => new Date(iso).toISOString().slice(11, 16) + ' UTC';

  let data = null, failed = false, failCode = null, openKey = null, last = '';
  const get = k => {
    if (k === 'new' && ['ok', 'warn', 'down'].includes(FORCE))
      return { state: FORCE, title: 'Preview', reason: `Preview mode (?apitest=${FORCE}). This is not the real status.`, errors: [] };
    if (k === 'old' && !data) return OFF;
    if (failed && k === 'new') {
      if (navigator.onLine === false) return { state: 'unknown', title: 'Offline', reason: 'Your browser looks offline, so the status could not be read.', errors: [] };
      // the site's own API did not answer: the data is not flowing, so this is shown as down
      return { state: 'down', title: 'Not working', reason: `The site's API did not answer${failCode ? ` (error ${failCode})` : ''}, so the status could not be read.`, errors: [] };
    }
    if (!data) return { state: 'unknown', title: 'Checking', reason: 'Checking the status...', errors: [] };
    return data[k] || OFF;
  };

  function pop(k, label, s) {
    return `<h4>${label} API <span class="api-tag ${esc(s.state)}">${TAG[s.state] || ''}</span></h4><p>${esc(s.reason)}</p>`
      + (s.lastRunAt ? `<dl><dt>Last collection</dt><dd>${ago(s.lastRunAt)} (${utc(s.lastRunAt)})</dd>`
          + (s.lastGoodAt ? `<dt>Last success</dt><dd>${ago(s.lastGoodAt)} (${utc(s.lastGoodAt)})</dd>` : '') + '</dl>' : '')
      + (s.errors && s.errors.length ? `<ul class="api-err">${s.errors.map(e => `<li><b>${esc(e.where)}</b>: ${esc(e.message)}</li>`).join('')}</ul>` : '')
      + (k === 'new' ? '<p class="api-note">Checked every minute. The collector runs once an hour.</p>' : '');
  }

  function render() {
    const focused = document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.k : null;
    root.innerHTML = KEYS.map(([k, label]) => {
      const s = get(k), open = openKey === k;
      return `<div class="api-wrap"><button type="button" class="pill api-pill ${esc(s.state)}" data-k="${k}" data-state="${esc(s.state)}" aria-expanded="${open}" aria-haspopup="true" aria-label="${label} API ${WORD[s.state] || ''}">`
        + `<i class="api-dot"></i><span>${label}<span class="api-w"> API</span></span></button>`
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
