// Medal points -> rank titles. Load this BEFORE js/statistics.js (it replaces medalBoards / medalIcons / medalCard there).
// Uses globals from statistics.js at call time: podium, podiumErr, card, esc, fmt, tagHtml.

// 10 medals, by place on a board (place 10 or below = last medal). Edit the points freely.
const MEDAL_TIERS = [
  { name: 'Gold',   pts: 1000 },   // 1st
  { name: 'Silver', pts: 950 },    // 2nd
  { name: 'Bronze', pts: 850 },    // 3rd
  { name: 'Glass',  pts: 700 },    // 4th
  { name: 'Copper', pts: 500 },    // 5th
  { name: 'Iron',   pts: 400 },    // 6th  (new)
  { name: 'Stone',  pts: 300 },    // 7th
  { name: 'Clay',   pts: 200 },    // 8th  (new)
  { name: 'Wood',   pts: 100 },    // 9th
  { name: 'Pebble', pts: 50 },     // 10th or below (new)
];
const medalTierIndex = place => Math.min(Math.max(Number(place) || MEDAL_TIERS.length, 1), MEDAL_TIERS.length) - 1;

// 16 titles x 2,000 points each: title N starts at (N-1) x 2,000, so Annihilator starts at 30,000 = 30 gold medals.
const POINTS_PER_TITLE = 2000;
const RANK_TITLES = [
  ['Wild Brawler', '#9aa5b1'], ['Adept Brawler', '#9aa5b1'], ['Skilled Brawler', '#9aa5b1'],
  ['Bounty Hunter', '#4dd0e1'], ['Expert Hunter', '#4dd0e1'], ['Master Hunter', '#4dd0e1'],
  ['Castle Guardian', '#5c9dff'], ['Noble Guardian', '#5c9dff'], ['Throne Guardian', '#5c9dff'],
  ['Gallant Warrior', '#ffb44d'], ['Veteran Warrior', '#ffb44d'], ['Heroic Warrior', '#ffb44d'],
  ['Great Warlord', '#ff6b6b'], ['Supreme Warlord', '#ff6b6b'], ['Ultimate Warlord', '#ff6b6b'],
  ['Annihilator', '#ff3df0'],
];

// Hook for the 30-day season: return false to ignore a medal (e.g. m => m.created_at >= SEASON_START). Default counts everything.
const medalInSeason = m => true;

function rankOf(points) {
  const last = RANK_TITLES.length - 1, i = Math.min(Math.floor(points / POINTS_PER_TITLE), last), max = i === last;
  const into = points - i * POINTS_PER_TITLE;
  return { title: RANK_TITLES[i][0], color: RANK_TITLES[i][1], next: max ? null : RANK_TITLES[i + 1][0],
           pct: max ? 100 : Math.round(into / POINTS_PER_TITLE * 100), toNext: max ? 0 : POINTS_PER_TITLE - into };
}

// Top 3 players and top 3 clans by medal points. A clan = all points of its members (each player's current clan).
function medalBoards() {
  if (!podium) return null;
  const P = new Map(), C = new Map(), clanName = {};
  for (const c of Object.values(podium.clans || {})) if (c?.tag) clanName[c.tag] = c.name;
  const blank = () => ({ counts: Array(MEDAL_TIERS.length).fill(0), points: 0 });
  for (const m of podium.medals || []) {
    if (m.category === 'clan' || !medalInSeason(m)) continue;
    const t = medalTierIndex(m.place), w = MEDAL_TIERS[t].pts, pl = podium.players?.[m.entity_id];
    const a = P.get(m.entity_id) || { id: m.entity_id, ...blank() }; a.counts[t]++; a.points += w; P.set(m.entity_id, a);
    if (pl?.clan_tag) {
      const c = C.get(pl.clan_tag) || { id: pl.clan_tag, tag: pl.clan_tag, color: pl.clan_color, ...blank(), who: new Set() };
      c.counts[t]++; c.points += w; c.who.add(m.entity_id); if (pl.clan_color != null) c.color = pl.clan_color; C.set(pl.clan_tag, c);
    }
  }
  const sort = (x, y) => y.points - x.points || y.counts[0] - x.counts[0];
  return {
    players: [...P.values()].map(a => { const pl = podium.players?.[a.id]; return { ...a, name: pl?.name || a.id, tag: pl?.clan_tag || '', color: pl?.clan_color, rank: rankOf(a.points) }; }).sort(sort).slice(0, 3),
    clans: [...C.values()].map(c => ({ ...c, name: clanName[c.tag] || '', members: c.who.size, rank: rankOf(c.points) })).sort(sort).slice(0, 3),
  };
}

const rankBadge = r => `<span style="color:${r.rank.color};font-weight:800">${esc(r.rank.title)}</span>`;
const rankBar = r => `<div class="bar b-lvl" style="margin-top:5px" title="${r.rank.next ? fmt(r.rank.toNext) + ' pts to ' + esc(r.rank.next) : 'Max title'}"><i style="width:${r.rank.pct}%;background:${r.rank.color}"></i></div>`;
const medalBreakdown = r => MEDAL_TIERS.map((t, i) => r.counts[i] ? `${t.name} ${r.counts[i]}` : '').filter(Boolean).join(' · ') || '—';

function medalCard(key, title, sub, iconId, isClan) {
  const list = medalBoards()?.[isClan ? 'clans' : 'players'] || [];
  if (!list.length) return card(key, { icon: iconId, title, sub, notes: [podium ? 'No medals yet' : podiumErr ? 'Podium API not reachable' : 'Loading...'] });
  const who = r => isClan ? `[${tagHtml(r.tag, r.color)}] <b>${esc(r.name)}</b>` : `<b>${esc(r.name)}</b> ${tagHtml(r.tag, r.color)}`;
  const body = `<div class="st-recs">${list.map((r, i) => `<div class="st-rec"><b class="st-rank r${i + 1}">${i + 1}</b>
      <div class="who">${who(r)}<small class="st-ok">${rankBadge(r)}${isClan ? ' · ' + r.members + ' member' + (r.members === 1 ? '' : 's') : ''}</small>${rankBar(r)}</div>
      <span class="val">${fmt(r.points)}<small style="display:block;font-size:11px;font-weight:400">pts</small></span></div>`).join('')}</div>`;
  return card(key, { icon: iconId, title, sub, body,
    details: () => `<h3>${title}</h3><div class="muted">${sub}. Every medal is worth points (Gold ${MEDAL_TIERS[0].pts} down to ${MEDAL_TIERS[MEDAL_TIERS.length - 1].name} ${MEDAL_TIERS[MEDAL_TIERS.length - 1].pts}). Each title needs ${fmt(POINTS_PER_TITLE)} points, so one gold medal is half a title and ${fmt((RANK_TITLES.length - 1) * POINTS_PER_TITLE)} points (30 golds) makes an Annihilator.${isClan ? ' A clan adds up the points of its members.' : ''}</div>
      <div class="st-list">${list.map((r, i) => `<div class="st-row" style="grid-template-columns:34px 1fr auto"><span class="n">${i + 1}</span>
        <span class="nm" style="white-space:normal">${who(r)}<br>${rankBadge(r)} <small class="muted">· ${r.rank.next ? fmt(r.rank.toNext) + ' pts to ' + esc(r.rank.next) : 'highest title reached'}</small>${rankBar(r)}
        <small class="muted">${isClan ? r.members + ' members with medals · ' : ''}${medalBreakdown(r)}</small></span>
        <span class="r"><b style="color:var(--text);font-size:17px">${fmt(r.points)}</b> pts</span></div>`).join('')}</div>` });
}
