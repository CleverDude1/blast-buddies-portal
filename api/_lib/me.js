// Home page: "Who are you in the game?" -> search by name, remember the player id in this browser, show the dashboard.
// Data: /api/hourly?mode=me&q=NAME (search) and /api/hourly?mode=me&id=ID (dashboard), see api/_lib/me.js
(() => {
  const hero = document.querySelector('.hero'), input = document.getElementById('meSearch'),
        list = document.getElementById('meList'), root = document.getElementById('me');
  if (!hero || !input || !list || !root) return;
  const KEY = 'bbMe', h2 = hero.querySelector('h2'), H2 = h2.textContent, PLACEHOLDER = input.placeholder;

  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = n => Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 });
  const store = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch (e) {} };
  const saved = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  const icon = id => `<img src="images/icons/${id}.png" alt="" onerror="this.onerror=null;this.src='images/placeholder.png'">`;
  const ago = iso => { const m = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 6e4)); return m < 2 ? 'just now' : m < 90 ? `${m} min ago` : `${Math.round(m / 60)} h ago`; };
  const pctOf = (v, top) => (top > 0 && v != null ? Math.max(0, Math.min(100, v / top * 100)) : 0);
  const pctText = p => (p > 0 && p < 10 ? p.toFixed(1) : Math.round(p)) + '%';
  const bar = (p, label) => `<div class="me-bar" role="img" aria-label="${esc(label)}"><i style="--w:${p.toFixed(1)}%"></i></div>`;
  const card = (ico, title, body, cls = 's2') => `<section class="me-card ${cls}"><h3 class="me-title">${icon(ico)}<span>${title}</span></h3>${body}</section>`;

  // ---------- search ----------
  let timer, seq = 0, results = [];
  const close = () => { list.hidden = true; input.setAttribute('aria-expanded', 'false'); };
  function showList(items, msg) {
    list.innerHTML = items.length
      ? items.map(r => `<li><button type="button" data-id="${esc(r.id)}"><span>${esc(r.name)}${r.tag ? `<span class="tag">[${esc(r.tag)}]</span>` : ''}</span>`
          + `<small>${[r.level != null ? 'Level ' + r.level : '', r.kills != null ? num(r.kills) + ' kills' : ''].filter(Boolean).join(', ')}</small></button></li>`).join('')
      : `<li class="none">${msg}</li>`;
    list.hidden = false; input.setAttribute('aria-expanded', 'true');
  }
  async function search(q) {
    const n = ++seq;
    try {
      const r = await fetch(`/api/hourly?mode=me&q=${encodeURIComponent(q)}`); if (!r.ok) throw new Error();
      const d = await r.json(); if (n !== seq) return;
      results = d.results || [];
      showList(results, 'No player with that name yet. Players are added once they appear on a leaderboard.');
    } catch (e) { if (n === seq) { results = []; showList([], 'Search is not available right now. Please try again later.'); } }
  }
  input.addEventListener('input', () => {
    clearTimeout(timer); const v = input.value.trim();
    if (v.length < 2) { seq++; results = []; close(); return; }
    timer = setTimeout(() => search(v), 250);
  });
  input.addEventListener('keydown', e => {
    if (e.key === 'Escape') close();
    if (e.key === 'Enter' && !list.hidden && results[0]) { e.preventDefault(); pick(results[0].id); }
  });
  list.addEventListener('click', e => { const b = e.target.closest('[data-id]'); if (b) pick(b.dataset.id); });
  document.addEventListener('click', e => { if (!e.target.closest('.me-find')) close(); });
  const pick = id => { close(); input.value = ''; results = []; load(id); };

  const compact = on => {
    hero.classList.toggle('compact', on);
    h2.textContent = on ? 'Switch player' : H2;
    input.placeholder = on ? 'Search for another player' : PLACEHOLDER;
  };

  // ---------- cards ----------
  function boardCard(ico, title, b, note) {
    if (!b) return card(ico, title, '<p class="me-note">No snapshot stored yet.</p>');
    const p = pctOf(b.value, b.top), lead = `<p class="me-foot">Leader: <b>${esc(b.topName)}</b> with ${num(b.top)} kills</p>`;
    return card(ico, title, (b.on
      ? `<div class="me-big">${num(b.value)}</div><p class="me-sub">Rank #${b.rank} of the top ${b.size}</p>${bar(p, `${pctText(p)} of the leader's kills`)}<p class="me-pct">${pctText(p)} of the leader's kills</p>`
      : `<div class="me-big dim">Not listed</div><p class="me-sub">You are outside the top ${b.size} right now.</p>${bar(0, 'Not on the board')}<p class="me-pct">Place ${b.size} has ${num(b.cutoff)} kills</p>`)
      + lead + `<p class="me-upd">${note} Updated ${ago(b.at)}</p>`);
  }

  function spark(vals) {
    if (vals.length < 2) return '';
    const W = 300, H = 56, max = Math.max(...vals), min = Math.min(...vals), span = (max - min) || 1;
    const line = vals.map((v, i) => `${i ? 'L' : 'M'}${(i / (vals.length - 1) * W).toFixed(1)} ${(H - 4 - (v - min) / span * (H - 12)).toFixed(1)}`).join('');
    return `<svg class="me-spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true"><path class="area" d="${line}L${W} ${H}L0 ${H}Z"/><path class="line" d="${line}"/></svg>`;
  }

  function monthCard(d) {
    const ms = d.months || [];
    if (!ms.length) return card('statistics', 'Kills this month', '<p class="me-note">No monthly kills stored for you. They are tracked for players in the top 20 clans.</p>');
    const cur = ms[ms.length - 1], prev = ms[ms.length - 2];
    let sub = cur.current ? `${esc(cur.label)} so far` : `Latest month tracked: ${esc(cur.label)}`;
    if (prev) {
      if (cur.current) sub += `<br>${esc(prev.label)}: ${num(prev.kills)}`;
      else { const diff = cur.kills - prev.kills, pc = prev.kills ? Math.abs(diff / prev.kills * 100).toFixed(1) + '%' : '';
        sub += `<br><span class="${diff >= 0 ? 'up' : 'down'}">${diff >= 0 ? '▲' : '▼'} ${num(Math.abs(diff))}${pc ? ` (${pc})` : ''}</span> vs ${esc(prev.label)}`; }
    }
    return card('statistics', 'Kills this month',
      `<div class="me-big">${num(cur.kills)}</div><p class="me-sub">${sub}</p>${spark(ms.map(m => m.kills))}`
      + (cur.current ? '' : '<p class="me-upd">This month has not been recorded yet.</p>'));
  }

  function clanCard(d) {
    const c = d.clan, m = d.members, p = d.player;
    if (!c) return card('league', 'My clan', p.tag
      ? `<div class="me-clan-name"><span class="tag">[${esc(p.tag)}]</span></div><p class="me-note">This clan is not on the stored clan list yet, so its score is not available.</p>`
      : '<p class="me-note">You are not in a clan right now.</p>', 's3');
    const pc = pctOf(c.kills, c.top);
    const rows = `<div class="me-row"><span>Clan score</span><div class="me-val">${num(c.kills)}`
        + `<small>${c.rank ? `kills this month, #${c.rank} of ${c.of} clans` : 'kills, last seen (not on the clan list now)'}</small>`
        + (c.top ? bar(pc, `${pctText(pc)} of the top clan`) + `<small>${pctText(pc)} of ${esc(c.topName)}</small>` : '') + `</div></div>`
      + (c.members != null ? `<div class="me-row"><span>Members</span><div class="me-val">${c.members}${c.cap ? ' / ' + c.cap : ''}</div></div>` : '')
      + (m?.leader ? `<div class="me-row"><span>Leader</span><div class="me-val">${esc(m.leader)}</div></div>` : '')
      + (m?.place ? `<div class="me-row"><span>My place</span><div class="me-val">#${m.place}<small>of ${m.count} in ${esc(m.label)}</small></div></div>` : '');
    const line = (r, i) => `<div class="${r.id === p.id ? 'you' : ''}"><span class="n">${i}</span><span class="who">${esc(r.name)}</span><span class="k">${num(r.kills)}</span></div>`;
    const top = m
      ? `<h4 class="me-top-title">${m.current ? 'Biggest kills this month' : 'Biggest kills in ' + esc(m.label)}</h4><div class="me-top">${m.top.map((r, i) => line(r, i + 1)).join('')}`
        + (m.me ? `<div class="gap">…</div>${line({ ...m.me, id: p.id }, m.place)}` : '') + `</div>`
        + (m.current ? '' : '<p class="me-upd">This month has not been recorded yet.</p>')
      : '<p class="me-note" style="margin-top:14px">Monthly kills are only tracked for the top 20 clans, so there is no member list for this clan.</p>';
    return card('league', 'My clan', `<div class="me-clan-name"><span class="tag">[${esc(c.tag || p.tag)}]</span> ${esc(c.name)}</div><div style="margin-top:12px">${rows}</div>${top}`, 's3');
  }

  function perfCard(list) {
    if (!list || !list.length) return card('performance', 'Player Performance', '<p class="me-note">No performance records stored yet.</p>', 's3');
    return card('performance', 'Player Performance', list.map(r => {
      const has = r.value != null, p = pctOf(r.value, r.top), plus = r.id.startsWith('gain_') ? '+' : '';
      const rank = has ? `<b>#${r.rank}${r.rankApprox ? '+' : ''}</b>${r.total ? ` of ${num(r.total)}` : ''}` : 'No record yet';
      return `<div class="me-perf"><div class="top"><span class="name">${esc(r.title)}</span>`
        + `<span class="val">${has ? plus + num(r.value) + ` <small>${esc(r.unit)}</small>` : '–'}</span></div>`
        + bar(p, has ? `${pctText(p)} of the best` : 'No record yet')
        + `<div class="meta"><span>${rank}</span><span>Best: ${esc(r.topName || '')} ${plus}${num(r.top)}</span></div></div>`;
    }).join(''), 's3');
  }

  function render(d) {
    const p = d.player;
    const chips = [['Level', p.level], ['Lifetime kills', p.kills], ['KDR', p.kdr], ['Games played', p.games]]
      .filter(([, v]) => v != null).map(([l, v]) => `<li><small>${l}</small><b>${num(v)}</b></li>`).join('');
    root.innerHTML = `<div class="me-head"><div><h2 class="me-name">${p.tag ? `<span class="tag">[${esc(p.tag)}]</span> ` : ''}${esc(p.name)}</h2>`
      + `<ul class="me-chips">${chips}</ul></div><button class="pill" id="meChange" type="button">Not you?</button></div>`
      + `<div class="me-grid">${monthCard(d)}${boardCard('daily', "Today's kills", d.today, 'Counts since 00:00 UTC.')}`
      + `${boardCard('podium', 'Weekly kills', d.week, 'Resets every week.')}${clanCard(d)}${perfCard(d.performance)}</div>`;
    document.getElementById('meChange').onclick = () => { store(KEY, null); root.innerHTML = ''; compact(false); input.focus(); };
  }

  async function load(id) {
    store(KEY, id); compact(true);
    root.innerHTML = '<p class="me-note me-load">Loading your dashboard…</p>';
    try {
      const r = await fetch(`/api/hourly?mode=me&id=${encodeURIComponent(id)}`); if (!r.ok) throw new Error();
      const d = await r.json();
      if (!d.found) { store(KEY, null); compact(false); root.innerHTML = '<p class="me-note">That player is no longer in the data. Search for your name again.</p>'; return; }
      render(d);
    } catch (e) { root.innerHTML = '<p class="me-note">Could not load your stats. Please try again later.</p>'; }
  }

  const id = saved(KEY);
  if (id) load(id);
})();
