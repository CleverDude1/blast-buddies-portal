// Level curve = the game's OFFICIAL XP table, stored offline (no API needed). Index 0 = level 1. Level 100 is the cap; XP above it is surplus.
// This one file is used by every page that loads js/level.js and by the XP Calculator (xp.html).
window.BB_XP = {
  maxLevel: 100,
  table: [
  0, 500, 1500, 3000, 5000, 7500, 10500, 14000, 18000, 22500,
  27500, 33000, 39000, 45500, 52500, 60000, 68000, 76500, 85500, 95000,
  105000, 115500, 126500, 138000, 150000, 162500, 175500, 189000, 203000, 217500,
  232500, 248000, 264000, 280500, 297500, 315000, 333000, 351500, 370500, 390000,
  410500, 431500, 453500, 476000, 499500, 523500, 548500, 574500, 601500, 629500,
  658500, 689000, 720500, 753500, 788000, 823500, 860500, 899500, 940000, 982000,
  1026000, 1071500, 1119000, 1168500, 1220000, 1273500, 1329000, 1386500, 1446500, 1508500,
  1573000, 1640000, 1709000, 1781000, 1855500, 1932500, 2012000, 2094500, 2179500, 2267500,
  2358500, 2452500, 2549500, 2649500, 2753000, 2859500, 2969500, 3082500, 3199000, 3319000,
  3443000, 3571000, 3703500, 3840500, 3981500, 4126500, 4276000, 4430000, 4588000, 4750000
  ],
  // level (1-100) from total XP
  levelFromXp(xp) {
    const T = this.table; xp = Math.max(0, Number(xp) || 0);
    let lo = 1, hi = T.length;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (T[mid - 1] <= xp) lo = mid; else hi = mid - 1; }
    return lo;
  },
  // total XP needed to reach a level
  xpForLevel(level) {
    const L = Math.min(this.table.length, Math.max(1, Math.floor(Number(level) || 1)));
    return this.table[L - 1];
  }
};

// ---- names the older pages and scripts already use ----
const LEVEL_STARTS = window.BB_XP.table;          // LEVEL_STARTS[n - 1] = XP where level n begins (LEVEL_STARTS[99] = level 100 = 4,750,000)
const MAX_LEVEL = window.BB_XP.maxLevel;          // 100
function xpToLevel(xp) { return window.BB_XP.levelFromXp(xp); }
