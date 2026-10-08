// Full "Past hour" report: totals plus every player's / clan's gain and position change. Data: api/hourly.js (mode=summary)
(() => {
  const LABEL = { day: 'Daily', week: 'Weekly', ranked: 'Ranked', clan: 'Clans' };
  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = n => Number(n).toLocaleString();
  const signed = n => (n > 0 ? '+' : n < 0 ? '-' : '') + fmt(Math.abs(n));
  const move = x => x.isNew ? '<span class="mv new">NEW</span>' : x.move > 0 ? `<span class="mv up">▲ ${x.move}</span>` : x.move < 0 ? `<span class="mv down">▼ ${-x.move}</span>` : '<span class="muted">-</span>';
  const getSpan = () => { try { return localStorage.getItem('hrSpan') === 'day' ? 'day' : 'hour'; } catch (e) { return 'hour'; } };
  const q = new URLSearchParams(location.search);
  if (q.get('span') === 'day' || q.get('span') === 'hour') { try { localStorage.setItem('hrSpan', q.get('span')); } catch (e) {} }
  let span = getSpan(), data = null, cur = q.get('board');
  if (!LABEL[cur]) cur = 'day';

  function draw() {
    document.querySelectorAll('#phTabs button').forEach(b => b.classList.toggle('on', b.dataset.b === cur));
    document.querySelectorAll('#phSpan button').forEach(b => b.classList.toggle('on', b.dataset.span === span));
    $('phTitle').textContent = span === 'day' ? 'Last day' : 'Past hour';
    if (data === null) { $('phStats').innerHTML = ''; $('phRows').innerHTML = '<p class="muted" style="padding:24px">No data for this period yet.</p>'; return; }
    const b = data.boards[cur], who = cur === 'clan' ? 'clans' : 'players';
    if (!b || !b.ok) { $('phStats').innerHTML = ''; $('phRows').innerHTML = `<p class="muted" style="padding:24px">${span === 'day' ? 'No snapshot since 00:00 UTC yet.' : 'No hourly data for this board yet. It needs a stored snapshot from about an hour ago.'}</p>`; return; }
    const at = new Date(b.at).toISOString().slice(0, 16).replace('T', ' ');
    $('phWhen').textContent = span === 'day' ? `Live values compared with the first snapshot after 00:00 UTC today (${at} UTC).` : `Live values compared with the snapshot from ${at} UTC (${b.elapsedMin} min ago).`;
    $('phGainHead').textContent = b.unit.charAt(0).toUpperCase() + b.unit.slice(1) + ' gained';
    if (b.reset) { $('phStats').innerHTML = ''; $('phRows').innerHTML = '<p class="muted" style="padding:24px">This board just reset, so there are no changes to show yet.</p>'; return; }
    const card = (big, label, sub = '') => `<div class="ph-card"><b>${big}</b><span>${label}</span>${sub ? `<small>${sub}</small>` : ''}</div>`;
    $('phStats').innerHTML =
      card(signed(b.totalGain), `Total ${b.unit} gained`, `${b.gainers} of ${b.count} ${who} gained`)
      + card(b.moved, 'Position changes', `${b.up} up · ${b.down} down`)
      + card(b.entered, `New in the top ${b.count}`)
      + card(b.biggestClimb ? `▲ ${b.biggestClimb.move}` : '-', 'Biggest climb', b.biggestClimb ? esc(b.biggestClimb.name) : '')
      + card(b.biggestDrop ? `▼ ${-b.biggestDrop.move}` : '-', 'Biggest drop', b.biggestDrop ? esc(b.biggestDrop.name) : '');
    $('phRows').innerHTML = b.all.map(x => `<div class="lb-row ph-row"><span class="rank">${x.rank}</span>
      <span class="pname">${esc(x.name)}${x.tag ? ` <small class="muted">[${esc(x.tag)}]</small>` : ''}</span>
      <span class="dlt ${x.gain > 0 ? 'up' : x.gain < 0 ? 'down' : 'zero'}" style="margin:0;font-size:16px">${x.gain == null ? 'N/A' : signed(x.gain)}</span>
      <span class="muted">${x.prevRank != null ? '#' + x.prevRank : '-'}</span>${move(x)}</div>`).join('');
  }
  const cache = {};
  async function load() {
    const sp = span;
    if (cache[sp] === undefined) {
      try { const r = await fetch(`/api/hourly?mode=summary&span=${sp}`); if (!r.ok) throw new Error('HTTP ' + r.status); cache[sp] = await r.json(); }
      catch (e) { console.error(e); cache[sp] = null; }
    }
    if (sp !== span) return;
    data = cache[sp];
    draw();
  }
  $('phTabs').addEventListener('click', e => { const t = e.target.closest('[data-b]'); if (t) { cur = t.dataset.b; history.replaceState(null, '', '?board=' + cur); if (data) draw(); } });
  $('phSpan').addEventListener('click', e => { const t = e.target.closest('[data-span]'); if (t && t.dataset.span !== span) { try { localStorage.setItem('hrSpan', t.dataset.span); } catch (x) {} window.dispatchEvent(new Event('hr-span')); } });
  window.addEventListener('hr-span', () => { span = getSpan(); load(); });
  load();
})();
