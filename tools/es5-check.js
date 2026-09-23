/* eslint-disable */
/* 老内核语法体检：页面跑在 Crosswalk 23（Chromium 53, 2016）上，
   任何一处 ES6 语法都会让整段内联脚本解析失败 -> 白屏。
   这个脚本在打包前扫一遍，把风险拦在本地，不用等上机才发现。

   用法：node tools/es5-check.js app/src/main/assets/index.html
   退出码 0 = 干净，1 = 发现风险
*/
const fs = require('fs');

const file = process.argv[2] || 'app/src/main/assets/index.html';
const html = fs.readFileSync(file, 'utf-8');

/* 内联脚本 + 内联样式都检查：JS 看语法代，CSS 看布局属性代 */
const scripts = (html.match(/<script>([\s\S]*?)<\/script>/g) || [])
  .map((s) => s.replace(/^<script>/, '').replace(/<\/script>$/, ''))
  .join('\n');
const styles = (html.match(/<style>([\s\S]*?)<\/style>/g) || [])
  .map((s) => s.replace(/^<style>/, '').replace(/<\/style>$/, ''))
  .join('\n');

const JS_RULES = [
  ['箭头函数 =>', /=>/],
  ['let 声明', /\blet\s+[A-Za-z_$]/],
  ['const 声明', /\bconst\s+[A-Za-z_$]/],
  ['模板字符串（反引号）', /`/],
  ['class 关键字', /\bclass\s+[A-Za-z]/],
  ['扩展/剩余运算符 ...', /\.\.\./],
  ['Promise', /\bPromise\b/],
  ['Object.assign', /Object\.assign/],
  ['Array.prototype.includes', /\.includes\(/],
  ['String.prototype.padStart', /\.padStart\(/],
  ['String.prototype.startsWith', /\.startsWith\(/],
  ['函数默认参数', /function\s*\([^)]*=[^)]*\)/],
  ['for...of', /\bfor\s*\([^)]*\bof\b/],
  ['new Map / new Set', /\bnew\s+(Map|Set)\b/],
  ['fetch()', /\bfetch\(/],
  ['async / await', /\b(async|await)\b/]
];

const CSS_RULES = [
  ['display:flex', /display\s*:\s*flex/],
  ['display:grid', /display\s*:\s*grid/],
  ['gap 属性', /\bgap\s*:/],
  ['CSS 自定义属性 var(--x)', /var\(--/],
  ['position:sticky', /position\s*:\s*sticky/],
  ['clamp()', /clamp\(/],
  ['@supports', /@supports/]
];

let bad = 0;
function check(label, src, rules) {
  console.log('== ' + label + ' ==');
  let found = 0;
  rules.forEach(function (r) {
    const hits = src.match(new RegExp(r[1].source, 'g'));
    if (hits) {
      found++;
      bad++;
      console.log('  [风险] ' + r[0] + '  x' + hits.length);
    }
  });
  if (!found) { console.log('  干净 (๑•̀ㅂ•́)و✧'); }
}

console.log('语法体检：' + file);
console.log('内联脚本 ' + scripts.split('\n').length + ' 行 / 内联样式 ' + styles.split('\n').length + ' 行\n');
check('JS（须为 ES5）', scripts, JS_RULES);
check('CSS（避免 flex/grid/自定义属性）', styles, CSS_RULES);

if (bad > 0) {
  console.log('\n发现 ' + bad + ' 类风险：老内核上可能整段脚本失效，请改回 ES5 写法');
  process.exit(1);
}
console.log('\nOK：可以放心打包给 Android 5.x 的班牌');
