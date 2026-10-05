// ESTIMATED XP -> level curve (the exact game formula is unknown).
// Built from known player data points. XP needed to go from level N to N+1 rises in three tiers:
//   levels 1-42: about +527 per level | 43-55: about +1,000 per level | 56+: about +1,800 per level.
// Known anchors: level 61 starts at 1,026,000 XP (45,500 to next level), level 62 starts at 1,071,500.
// To improve it later, just edit LEVEL_COSTS (index 0 = XP needed for level 1 -> 2).
const MAX_LEVEL = 100;
const LEVEL_COSTS = [3,524,1054,1581,2108,2634,3161,3688,4215,4742,5269,5796,6323,6850,7376,7903,8430,8957,9484,10011,10538,11065,11592,12118,12645,13172,13699,14226,14753,15280,15807,16334,16860,17387,17914,18441,18968,19495,20022,20549,21076,21603,22566,23530,24493,25516,26539,27562,28585,29611,30631,31654,32677,33700,34723,36520,38316,40112,41908,43704,45500,47296,49092,50888,52684,54480,56277,58073,59869,61665,63461,65257,67053,68849,70645,72441,74237,76034,77830,79626,81422,83218,85014,86810,88606,90402,92198,93994,95790,97586,99383,101179,102975,104771,106567,108363,110159,111955,113751];
const LEVEL_STARTS = LEVEL_COSTS.reduce((a, c) => (a.push(a[a.length - 1] + c), a), [0]); // LEVEL_STARTS[n-1] = XP where level n begins

function xpToLevel(xp) {
  let lvl = 1;
  while (lvl < MAX_LEVEL && xp >= LEVEL_STARTS[lvl]) lvl++;
  return lvl;
}
