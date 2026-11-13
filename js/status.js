// Top bar: "New API" and "Old API" buttons. Green = working, amber = problems, red + glowing = not working, grey = not connected.
// Data: /api/hourly?mode=status (see api/_lib/status.js). Checked once a minute while the tab is open. Click a button for details.
(() => {
  const root = document.getElementById('apiStatus');
  if (!root) return;

  // Set ADMIN_ONLY to true to hide the buttons from visitors: open any page once with ?admin=1 and they show in that browser only.
  const ADMIN_ONLY = false;
  try { if (new URLSearchParams(location.search).get('admin') === '1') localStorage.setItem('bbAdmin', '1'); } catch (e) {}
  if (ADMIN_ONLY) { let ok = false; try { ok = localStorage.getItem('bbAdmin') === '1'; } catch (e) {} if (!ok) return; }

  const KEYS = [['new', 'New'], ['old', 'Old']];
  const WORD = { ok: 'working', warn: 'has problems', down: 'is not working', off: 'is not connected', unknown: 'status unavailable' };
  const TAG = { ok: 'Working', warn: 'Problems', down: 'Down', off: 'Not connected', unknown: 'Checking' };
  const OFF = { state: 'off', title: 'Not connected', reason: 'The old API is not connected to this status check yet.', errors: [] };
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const ago = iso => { const m = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 6e4)); return m < 2 ? 'just now' : m < 90 ? `${m} min ago` : `${Math.round(m / 60)} h ago`; };
  const utc = iso => new Date(iso).toISOString().slice(11, 16) + ' UTC';

  let data = null, failed = false, openKey = null, last = '';
  const get = k => {
    if (k === 'old' && !data) return OFF;
    if (failed && k === 'new') return { state: 'unknown', title: 'Status unavailable', reason: 'Could not read the status right now.', errors: [] };
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
      return `<div class="api-wrap"><button type="button" class="pill api-pill ${esc(s.state)}" data-k="${k}" aria-expanded="${open}" aria-haspopup="true" aria-label="${label} API ${WORD[s.state] || ''}">`
        + `<i class="api-dot"></i><span>${label}<span class="api-w"> API</span></span></button>`
        + `<div class="api-pop"${open ? '' : ' hidden'}>${pop(k, label, s)}</div></div>`;
    }).join('');
    if (focused) { const b = root.querySelector(`[data-k="${focused}"]`); if (b) b.focus(); }
  }

  async function load() {
    try { const r = await fetch('/api/hourly?mode=status'); if (!r.ok) throw new Error(); data = await r.json(); failed = false; }
    catch (e) { failed = true; }
    const sig = JSON.stringify([data && [data.new, data.old], failed]);
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
