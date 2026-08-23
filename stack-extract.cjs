const fs = require('fs');
const code = fs.readFileSync(process.env.TEMP + '/dev-stat.js', 'utf8');

// 完整的排行榜 v-if 链（从骨架屏到列表）
const start = code.indexOf('$setup.leaderboardLoading');
const end = code.indexOf('is-me is-sticky', start);
console.log(code.slice(start - 200, Math.min(end + 100, start + 4200)));
