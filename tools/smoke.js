/* 班牌页面冒烟测试 v3(jsdom)——启动器双通道 + 天气位置长按编辑:
   S1 无桥(浏览器):按钮初始隐藏
   S2 主通道 BanbanApp:列表走桥,点击走桥 launch
   S3 兜底通道 __BANBAN_APPS:列表走兜底,点击走 banbanx:// scheme
   S4 坏桥(有对象无方法):自动回退兜底
   W1 天气卡片快速点击:不弹编辑框(原刷新行为)
   W2 天气卡片长按 600ms:弹出位置编辑弹层
   W3 直填"名称,纬度,经度"保存:写入 localStorage 并关闭弹层 */
const fs = require('fs');
const { JSDOM, VirtualConsole } = require('jsdom');

const html = fs.readFileSync(process.argv[2] || 'index.html', 'utf-8');

let failures = 0;
function assert(cond, name) {
  console.log((cond ? 'PASS' : 'FAIL') + '  ' + name);
  if (!cond) { failures++; }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* jsdom 没有 TouchEvent 构造，手动给 Event 挂 touches/changedTouches */
function touch(win, el, type, x, y) {
  const ev = new win.Event(type, { bubbles: true, cancelable: true });
  const list = [{ clientX: x, clientY: y, pageX: x, pageY: y, target: el }];
  ev.touches = list;
  ev.changedTouches = list;
  el.dispatchEvent(ev);
  return ev;
}

/* jsdom 没有布局，给容器伪造可滚动属性以便测 scrollTop 快照逻辑 */
function makeScrollable(panel) {
  let top = 0;
  Object.defineProperty(panel, 'scrollHeight', { value: 600, configurable: true });
  Object.defineProperty(panel, 'clientHeight', { value: 260, configurable: true });
  Object.defineProperty(panel, 'scrollTop', {
    get: function () { return top; },
    set: function (v) { top = v; },
    configurable: true
  });
  return panel;
}

function boot(opts) {
  const errors = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', (e) => errors.push(String(e && e.message || e)));
  vc.on('error', (m) => errors.push(String(m)));
  const dom = new JSDOM(html, {
    url: 'https://localhost/',
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    virtualConsole: vc,
    beforeParse(window) {
      if (opts.stubXhr) {
        /* 拦截 XHR，记录请求 URL（用于断言类型参数是否带上） */
        window.__urls = [];
        window.XMLHttpRequest = function () {
          this.readyState = 0;
          this.open = function (m, u) { window.__urls.push(String(u)); };
          this.send = function () {};
          this.setRequestHeader = function () {};
          this.abort = function () {};
        };
      }
      if (opts.bridge) {
        window.BanbanApp = {
          getApps: () => JSON.stringify([
            { name: '设置', pkg: 'com.android.settings', icon: '' },
            { name: '计算器', pkg: 'com.calc', icon: 'data:image/png;base64,xxx' }
          ]),
          launch: (pkg) => {
            window.__launched = pkg;
            window.__launchCount = (window.__launchCount || 0) + 1;
            return 'ok';
          }
        };
      }
      if (opts.fallbackApps) {
        window.__BANBAN_APPS = [{ name: '相册', pkg: 'com.gallery', icon: '' }];
      }
    }
  });
  return { window: dom.window, errors };
}

(async function main() {
  /* --- S1 --- */
  const plain = boot({});
  const pbtn = plain.window.document.getElementById('appsBtn');
  assert(!!pbtn && pbtn.style.display === 'none', 'S1 无桥按钮初始隐藏');

  /* --- S2 --- */
  const app = boot({ bridge: true });
  assert(app.errors.length === 0, 'S2 初始化无 JS 错误: ' + JSON.stringify(app.errors));
  const abtn = app.window.document.getElementById('appsBtn');
  abtn.dispatchEvent(new app.window.Event('click', { bubbles: true }));
  const panel = app.window.document.getElementById('appsPanel');
  const items = panel.querySelectorAll('button.aitem');
  assert(items.length === 2, 'S2 列表渲染 2 项(实际 ' + items.length + ')');
  items[0].dispatchEvent(new app.window.Event('click', { bubbles: true }));
  assert(app.window.__launched === items[0].getAttribute('data-pkg'), 'S2 点击走桥 launch');

  /* --- S3 --- */
  const fb = boot({ fallbackApps: true });
  const fbtn = fb.window.document.getElementById('appsBtn');
  fbtn.dispatchEvent(new app.window.Event('click', { bubbles: true }));
  const fitems = fb.window.document.getElementById('appsPanel').querySelectorAll('button.aitem');
  assert(fitems.length === 1, 'S3 兜底数据渲染列表');
  const errBefore = fb.errors.length;
  fitems[0].dispatchEvent(new fb.window.Event('click', { bubbles: true }));
  assert(fb.errors.length > errBefore, 'S3 无桥点击走 banbanx:// scheme');

  /* --- S4 --- */
  const mix = new JSDOM(html, {
    url: 'https://localhost/', runScripts: 'dangerously', pretendToBeVisual: true,
    beforeParse(window) {
      window.BanbanApp = {};
      window.__BANBAN_APPS = [{ name: '时钟', pkg: 'com.clock', icon: '' }];
    }
  }).window;
  mix.document.getElementById('appsBtn').dispatchEvent(new mix.Event('click', { bubbles: true }));
  const mitems = mix.document.getElementById('appsPanel').querySelectorAll('button.aitem');
  assert(mitems.length === 1 && mitems[0].querySelector('.aname').textContent === '时钟', 'S4 坏桥回退兜底');

  /* --- W1: 天气卡片快速点击不弹编辑框 --- */
  const w1 = boot({});
  const card1 = w1.window.document.getElementById('wxCard');
  assert(!!card1, 'W1 天气卡片存在');
  card1.dispatchEvent(new w1.window.Event('touchstart', { bubbles: true }));
  await sleep(30);
  card1.dispatchEvent(new w1.window.Event('touchend', { bubbles: true }));
  card1.dispatchEvent(new w1.window.Event('click', { bubbles: true }));
  await sleep(700);
  assert(w1.window.document.getElementById('wxMask').className.indexOf('open') < 0, 'W1 快速点击不弹编辑框');

  /* --- W2: 长按 600ms 弹出编辑层 --- */
  const w2 = boot({});
  const card2 = w2.window.document.getElementById('wxCard');
  card2.dispatchEvent(new w2.window.Event('touchstart', { bubbles: true }));
  await sleep(750);
  card2.dispatchEvent(new w2.window.Event('touchend', { bubbles: true }));
  assert(w2.window.document.getElementById('wxMask').className.indexOf('open') >= 0, 'W2 长按弹出位置编辑层');
  const dlgDisp = w2.window.getComputedStyle(w2.window.document.getElementById('wxDialog')).display;
  assert(dlgDisp !== 'none', 'W2 弹窗本体可见(display=' + dlgDisp + ')');
  /* 长按后的一次点击应被吞掉(不触发别的),且弹层仍开 */
  card2.dispatchEvent(new w2.window.Event('click', { bubbles: true }));
  assert(w2.window.document.getElementById('wxMask').className.indexOf('open') >= 0, 'W2 长按后点击被吞,弹层仍开');

  /* --- W3: 直填"名称,纬度,经度"保存 --- */
  const inp = w2.window.document.getElementById('wxCityIn');
  inp.value = 'TestCity,39.9,116.4';
  w2.window.document.getElementById('wxOk').dispatchEvent(new w2.window.Event('click', { bubbles: true }));
  await sleep(50);
  assert(w2.window.document.getElementById('wxMask').className.indexOf('open') < 0, 'W3 保存后弹层关闭');
  const saved = w2.window.localStorage.getItem('g34_class4_wxcity');
  assert(saved === 'TestCity|39.9|116.4', 'W3 城市已持久化(实际: ' + saved + ')');

  /* --- W4: 取消按钮关闭且不写存储 --- */
  card2.dispatchEvent(new w2.window.Event('touchstart', { bubbles: true }));
  await sleep(750);
  card2.dispatchEvent(new w2.window.Event('touchend', { bubbles: true }));
  w2.window.document.getElementById('wxNo').dispatchEvent(new w2.window.Event('click', { bubbles: true }));
  await sleep(30);
  assert(w2.window.document.getElementById('wxMask').className.indexOf('open') < 0, 'W4 取消关闭弹层');
  assert(w2.window.localStorage.getItem('g34_class4_wxcity') === 'TestCity|39.9|116.4', 'W4 取消不改动已存城市');

  /* --- T: 触屏 tap 判定（防滚动误开应用） --- */
  /* T1 干净的一次点按 -> 启动，且合成 click 不会二次触发 */
  const t1 = boot({ bridge: true });
  t1.window.document.getElementById('appsBtn').dispatchEvent(new t1.window.Event('click', { bubbles: true }));
  const tItems = t1.window.document.getElementById('appsPanel').querySelectorAll('button.aitem');
  assert(tItems.length === 2, 'T0 列表已渲染(' + tItems.length + ' 项)');
  touch(t1.window, tItems[0], 'touchstart', 100, 300);
  touch(t1.window, tItems[0], 'touchend', 100, 300);
  tItems[0].dispatchEvent(new t1.window.Event('click', { bubbles: true })); /* 浏览器补发的合成 click */
  await sleep(220); /* 新版判定后延迟执行，须等到窗口过去 */
  assert(t1.window.__launchCount === 1, 'T1 点按启动一次且合成 click 被吞(实际 ' + t1.window.__launchCount + ' 次)');
  assert(t1.window.__launched === 'com.android.settings', 'T1 启动的是被点的应用');

  /* T2 滚动式滑动（位移 40px）-> 不启动 */
  const t2 = boot({ bridge: true });
  t2.window.document.getElementById('appsBtn').dispatchEvent(new t2.window.Event('click', { bubbles: true }));
  const it2 = t2.window.document.getElementById('appsPanel').querySelectorAll('button.aitem');
  touch(t2.window, it2[0], 'touchstart', 100, 300);
  touch(t2.window, it2[0], 'touchmove', 104, 340);
  touch(t2.window, it2[0], 'touchend', 104, 340);
  it2[0].dispatchEvent(new t2.window.Event('click', { bubbles: true }));
  assert(t2.window.__launchCount === undefined, 'T2 滑动 40px 不启动应用');

  /* T3 惯性滚动刚停下（scroll 后 <350ms）-> 忽略这一次抬手 */
  const t3 = boot({ bridge: true });
  t3.window.document.getElementById('appsBtn').dispatchEvent(new t3.window.Event('click', { bubbles: true }));
  const panel3 = t3.window.document.getElementById('appsPanel');
  const it3 = panel3.querySelectorAll('button.aitem');
  panel3.dispatchEvent(new t3.window.Event('scroll', { bubbles: true }));
  touch(t3.window, it3[0], 'touchstart', 100, 300);
  touch(t3.window, it3[0], 'touchend', 100, 300);
  assert(t3.window.__launchCount === undefined, 'T3 滚动静默期内点击被忽略');
  await sleep(400); /* 静默期过后 */
  touch(t3.window, it3[0], 'touchstart', 100, 300);
  touch(t3.window, it3[0], 'touchend', 100, 300);
  await sleep(220);
  assert(t3.window.__launchCount === 1, 'T3 静默期过后恢复正常点击');

  /* T4 鼠标环境（无 touch 前置）-> click 兜底仍可用 */
  const t4 = boot({ bridge: true });
  t4.window.document.getElementById('appsBtn').dispatchEvent(new t4.window.Event('click', { bubbles: true }));
  const it4 = t4.window.document.getElementById('appsPanel').querySelectorAll('button.aitem');
  it4[0].dispatchEvent(new t4.window.Event('click', { bubbles: true }));
  assert(t4.window.__launchCount === 1, 'T4 鼠标直接 click 正常启动');

  /* T5 按住过久（>600ms，类似长按）-> 不启动 */
  const t5 = boot({ bridge: true });
  t5.window.document.getElementById('appsBtn').dispatchEvent(new t5.window.Event('click', { bubbles: true }));
  const it5 = t5.window.document.getElementById('appsPanel').querySelectorAll('button.aitem');
  touch(t5.window, it5[0], 'touchstart', 100, 300);
  await sleep(700);
  touch(t5.window, it5[0], 'touchend', 100, 300);
  await sleep(220);
  assert(t5.window.__launchCount === undefined, 'T5 长按不启动应用');

  /* T6 最痛场景：慢起手滚动 —— 主线程收不到足够位移的 touchmove(仅 4px)，
     但面板真的滚动了(scrollTop 变化)，必须靠 scrollTop 快照拦下 */
  const t6 = boot({ bridge: true });
  t6.window.document.getElementById('appsBtn').dispatchEvent(new t6.window.Event('click', { bubbles: true }));
  const panel6 = makeScrollable(t6.window.document.getElementById('appsPanel'));
  const it6 = panel6.querySelectorAll('button.aitem');
  touch(t6.window, it6[0], 'touchstart', 100, 300);
  touch(t6.window, it6[0], 'touchmove', 100, 304); /* 仅 4px < slop：模拟合成器接管后收不到事件 */
  panel6.scrollTop = 30;                           /* 但列表确实滚动了 */
  touch(t6.window, it6[0], 'touchend', 100, 304);
  await sleep(250);
  assert(t6.window.__launchCount === undefined, 'T6 慢起手滚动(位移小但已滚)不误开应用');

  /* T7 延迟执行窗口：抬手后惯性滚动信号滞后到达，应撤销这次点击 */
  const t7 = boot({ bridge: true });
  t7.window.document.getElementById('appsBtn').dispatchEvent(new t7.window.Event('click', { bubbles: true }));
  const panel7 = t7.window.document.getElementById('appsPanel');
  const it7 = panel7.querySelectorAll('button.aitem');
  touch(t7.window, it7[0], 'touchstart', 100, 300);
  touch(t7.window, it7[0], 'touchend', 100, 300);
  panel7.dispatchEvent(new t7.window.Event('scroll', { bubbles: true })); /* 滚动滞后送达 */
  await sleep(250);
  assert(t7.window.__launchCount === undefined, 'T7 延迟窗口内的滚动撤销点击');

  /* T8 慢按犹疑：touchmove 收不全、且时长 450ms > 300ms -> 不启动 */
  const t8 = boot({ bridge: true });
  t8.window.document.getElementById('appsBtn').dispatchEvent(new t8.window.Event('click', { bubbles: true }));
  const it8 = t8.window.document.getElementById('appsPanel').querySelectorAll('button.aitem');
  touch(t8.window, it8[0], 'touchstart', 100, 300);
  await sleep(450);
  touch(t8.window, it8[0], 'touchend', 100, 302);
  await sleep(250);
  assert(t8.window.__launchCount === undefined, 'T8 慢按 450ms 不启动应用');

  /* --- H: 长按一言卡片选类型 --- */
  const h1 = boot({ stubXhr: true });
  const hcard = h1.window.document.getElementById('hitoCard');
  assert(!!hcard, 'H0 一言卡片存在');
  hcard.dispatchEvent(new h1.window.Event('touchstart', { bubbles: true }));
  await sleep(30);
  hcard.dispatchEvent(new h1.window.Event('touchend', { bubbles: true }));
  hcard.dispatchEvent(new h1.window.Event('click', { bubbles: true }));
  await sleep(700);
  assert(h1.window.document.getElementById('hitoMask').className.indexOf('open') < 0,
    'H1 快速点击不弹类型层(仍是换一句)');

  /* H2 长按 600ms 弹出，且含上游全部 12 类 + 全部随机 */
  hcard.dispatchEvent(new h1.window.Event('touchstart', { bubbles: true }));
  await sleep(750);
  hcard.dispatchEvent(new h1.window.Event('touchend', { bubbles: true }));
  assert(h1.window.document.getElementById('hitoMask').className.indexOf('open') >= 0, 'H2 长按弹出类型层');
  const hItems = h1.window.document.querySelectorAll('#hitoTypes button.htitem');
  assert(hItems.length === 13, 'H2 类型齐全(12 类 + 全部随机), 实际 ' + hItems.length);
  const codes = Array.prototype.map.call(hItems, (b) => b.getAttribute('data-k')).join('');
  assert(codes === 'abcdefghijkl', 'H2 覆盖 a~l 全部类型(实际 ' + codes + ')');

  /* H3 点选"动画" -> 持久化 + 关闭弹层 + 请求带 c=a */
  const btnA = h1.window.document.querySelector('#hitoTypes button.htitem[data-k="a"]');
  btnA.dispatchEvent(new h1.window.Event('click', { bubbles: true }));
  await sleep(60);
  assert(h1.window.localStorage.getItem('g34_class4_hitotype') === 'a', 'H3 类型已持久化');
  assert(h1.window.document.getElementById('hitoMask').className.indexOf('open') < 0, 'H3 选完自动关闭弹层');
  const withC = h1.window.__urls.filter((u) => u.indexOf('hitokoto.cn') >= 0 && u.indexOf('c=a') >= 0);
  assert(withC.length > 0, 'H3 请求带上 c=a 参数(实际 ' + JSON.stringify(h1.window.__urls) + ')');

  /* H4 重新打开，选中项高亮（持久化生效） */
  hcard.dispatchEvent(new h1.window.Event('touchstart', { bubbles: true }));
  await sleep(750);
  hcard.dispatchEvent(new h1.window.Event('touchend', { bubbles: true }));
  const again = h1.window.document.querySelector('#hitoTypes button.htitem[data-k="a"]');
  assert(again.className.indexOf('on') >= 0, 'H4 重新打开时当前类型高亮');

  console.log(failures === 0 ? '\nALL PASS' : '\n' + failures + ' FAILURE(S)');
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error('TEST CRASH:', e); process.exit(1); });
