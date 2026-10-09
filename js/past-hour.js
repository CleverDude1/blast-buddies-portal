// Full "Past hour" report: totals plus every player's / clan's gain and position change. Data: api/hourly.js (mode=summary)
(() => {
  const LABEL = { day: 'Daily', week: 'Weekly', ranked: 'Ranked', clan: 'Clans' };
  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = n => Number(n).toLocaleString();
  const signed = n => (n > 0 ? '+' : n < 0 ? '-' : '') + fmt(Math.abs(n));
  const move = x => x.isNew ? '<span class="mv new">NEW</span>' : x.move > 0 ? `<span class="mv up">▲ ${x.move}</span>` : x.move < 0 ? `<span class="mv down">▼ ${-x.move}</span>` : '<span class="muted">-</span>';
  let data = null, cur = new URLSearchParams(location.search).get('board');
  if (!LABEL[cur]) cur = 'day';

  function draw() {
    document.querySelectorAll('#phTabs button').forEach(b => b.classList.toggle('on', b.dataset.b === cur));
    const b = data.boards[cur], who = cur === 'clan' ? 'clans' : 'players';
    if (!b || !b.ok) { $('phStats').innerHTML = ''; $('phRows').innerHTML = '<p class="muted" style="padding:24px">No hourly data for this board yet. It needs a stored snapshot from about an hour ago.</p>'; return; }
    $('phWhen').textContent = `Live values compared with the snapshot from ${new Date(b.at).toISOString().slice(0, 16).replace('T', ' ')} UTC (${b.elapsedMin} min ago).`;
    $('phGainHead').textContent = b.unit.charAt(0).toUpperCase() + b.unit.slice(1) + ' gained';
    if (b.reset) { $('phStats').innerHTML = ''; $('phRows').innerHTML = '<p class="muted" style="padding:24px">This board just reset, so there are no hourly changes to show yet.</p>'; return; }
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
  $('phTabs').addEventListener('click', e => { const t = e.target.closest('[data-b]'); if (t && data) { cur = t.dataset.b; history.replaceState(null, '', '?board=' + cur); draw(); } });
  fetch('/api/hourly?mode=summary').then(r => r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status)))
    .then(d => { data = d; draw(); })
    .catch(e => { console.error(e); $('phRows').innerHTML = '<p class="muted" style="padding:24px">Could not load the past-hour report.</p>'; });
})();
