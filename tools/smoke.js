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
      if (opts.badStorage) {
        /* 模拟存储写不进去（空间满 / DOM storage 被关）：读正常、写必抛 */
        const mem = {};
        Object.defineProperty(window, 'localStorage', {
          configurable: true,
          value: {
            getItem: (k) => (Object.prototype.hasOwnProperty.call(mem, k) ? mem[k] : null),
            setItem: () => { throw new Error('QuotaExceededError'); },
            removeItem: (k) => { delete mem[k]; }
          }
        });
      }
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

  /* ============ P 系列：应用隐藏 + 密码锁 ============ */
  function click(win, el) { el.dispatchEvent(new win.Event('click', { bubbles: true, cancelable: true })); }
  function hidList(win) { return JSON.parse(win.localStorage.getItem('g34_class4_hidden') || '[]'); }

  /* T9 滑动列表项时不能误触发长按（否则滚动就会弹「隐藏」确认，比误启动更烦） */
  const t9 = boot({ bridge: true });
  click(t9.window, t9.window.document.getElementById('appsBtn'));
  const pn9 = t9.window.document.getElementById('appsPanel');
  makeScrollable(pn9);
  const it9 = pn9.querySelectorAll('button.aitem')[0];
  touch(t9.window, it9, 'touchstart', 100, 300);
  await sleep(80);
  touch(t9.window, it9, 'touchmove', 100, 344);
  await sleep(650);
  assert(t9.window.document.getElementById('askMask').className.indexOf('open') < 0, 'T9 滑动列表项不触发长按隐藏');
  assert(t9.window.localStorage.getItem('g34_class4_hidden') === null, 'T9 滑动不会写入隐藏记录');

  function keys(win) { return win.document.querySelectorAll('#pwdPad .pwdkey'); }
  function tapKey(win, k) {
    const ks = keys(win);
    for (let i = 0; i < ks.length; i++) {
      if (ks[i].getAttribute('data-k') === k) { click(win, ks[i]); return; }
    }
  }
  function typePwd(win, s) { for (let i = 0; i < s.length; i++) { tapKey(win, s.charAt(i)); } }

  /* --- P0 长按列表项 → 确认隐藏 --- */
  const p1 = boot({ bridge: true });
  const pv1 = p1.window;
  click(pv1, pv1.document.getElementById('appsBtn'));
  const pn1 = pv1.document.getElementById('appsPanel');
  const itA = pn1.querySelectorAll('button.aitem')[0];
  touch(pv1, itA, 'touchstart', 100, 200);
  await sleep(700);
  const askM = pv1.document.getElementById('askMask');
  assert(askM.className.indexOf('open') >= 0, 'P0 长按列表项弹出确认层');
  assert(pv1.document.getElementById('askTitle').textContent === '隐藏应用', 'P0 确认层标题为「隐藏应用」');
  assert(pv1.__launchCount === undefined, 'P0 长按不会启动应用');
  click(pv1, pv1.document.getElementById('askOk'));
  await sleep(60);
  assert(hidList(pv1).length === 1 && hidList(pv1)[0] === 'com.android.settings',
    'P0 隐藏包名写入 localStorage: ' + JSON.stringify(hidList(pv1)));
  assert(pn1.querySelectorAll('button.aitem').length === 1, 'P0 隐藏后列表少一项');

  /* --- P1 无密码时：长按 ▦ 直接进入管理模式，隐藏项可见 --- */
  touch(pv1, pv1.document.getElementById('appsBtn'), 'touchstart', 3800, 2000);
  await sleep(700);
  assert(pn1.className.indexOf('open') >= 0, 'P1 长按 ▦ 打开应用列表');
  assert(pv1.document.getElementById('appsTitle').textContent.indexOf('管理') >= 0, 'P1 进入管理模式');
  const mItems = pn1.querySelectorAll('button.aitem');
  assert(mItems.length === 2 && mItems[0].className.indexOf('ahidden') >= 0, 'P1 管理模式显示隐藏项并带标记');
  assert(mItems[0].innerHTML.indexOf('已隐藏') >= 0, 'P1 隐藏项有「已隐藏」角标');

  /* --- P2 管理模式长按隐藏项 → 恢复 --- */
  touch(pv1, mItems[0], 'touchstart', 100, 200);
  await sleep(700);
  assert(pv1.document.getElementById('askTitle').textContent === '恢复应用', 'P2 长按隐藏项弹出恢复确认');
  click(pv1, pv1.document.getElementById('askOk'));
  await sleep(60);
  assert(hidList(pv1).length === 0, 'P2 恢复后隐藏列表清空');
  assert(pn1.querySelectorAll('button.aitem').length === 2, 'P2 恢复后列表恢复 2 项');

  /* --- P3 密码开启：长按 ▦ 需校验，错密码拦截、对密码放行 --- */
  const p3 = boot({ bridge: true });
  const pv3 = p3.window;
  pv3.localStorage.setItem('g34_class4_pwd', '1234');
  pv3.localStorage.setItem('g34_class4_pwdOn', '1');
  touch(pv3, pv3.document.getElementById('appsBtn'), 'touchstart', 3800, 2000);
  await sleep(700);
  assert(pv3.document.getElementById('pwdMask').className.indexOf('open') >= 0, 'P3 长按 ▦ 弹出内置密码键盘');
  assert(keys(pv3).length === 12, 'P3 键盘 12 个键（0-9 + 清空 + 删除）');
  typePwd(pv3, '1111');
  click(pv3, pv3.document.getElementById('pwdOk'));
  await sleep(40);
  assert(pv3.document.getElementById('pwdTip').textContent.indexOf('密码不对') >= 0, 'P3 错误密码有提示');
  assert(pv3.document.getElementById('pwdMask').className.indexOf('open') >= 0, 'P3 错误密码不关闭键盘');
  assert(pv3.document.getElementById('appsPanel').className.indexOf('open') < 0, 'P3 错误密码不放行管理模式');
  typePwd(pv3, '1234');
  click(pv3, pv3.document.getElementById('pwdOk'));
  await sleep(140);
  assert(pv3.document.getElementById('pwdMask').className.indexOf('open') < 0, 'P3 正确密码关闭键盘');
  assert(pv3.document.getElementById('appsTitle').textContent.indexOf('管理') >= 0, 'P3 正确密码进入管理模式');

  /* ============ S 系列：设置面板分类 ============ */
  const p4 = boot({ bridge: true });
  const pv4 = p4.window;
  assert(pv4.document.getElementById('themeBtn').textContent.indexOf('设置') >= 0, 'S0 顶栏按钮标题为「设置」');
  const segs = pv4.document.querySelectorAll('#setSeg .seg-b');
  assert(segs.length === 3, 'S1 设置分三类（实际 ' + segs.length + '）');
  click(pv4, pv4.document.getElementById('themeBtn'));
  assert(pv4.document.getElementById('paneTheme').className.indexOf('on') >= 0, 'S1 默认显示主题分类');
  click(pv4, segs[2]);
  assert(pv4.document.getElementById('panePriv').className.indexOf('on') >= 0 &&
         pv4.document.getElementById('paneTheme').className.indexOf('on') < 0, 'S2 切到隐私分类');
  assert(pv4.document.getElementById('hideCntTxt').textContent.indexOf('没有隐藏') >= 0, 'S2 隐私页显示隐藏数量');

  /* S3 未设密码时点开关 → 引导设置密码（含长度校验 + 二次确认） */
  click(pv4, pv4.document.getElementById('pwdSw'));
  await sleep(60);
  assert(pv4.document.getElementById('pwdMask').className.indexOf('open') >= 0, 'S3 未设密码点开关弹出设置键盘');
  assert(pv4.document.getElementById('pwdTitle').textContent.indexOf('设置新密码') >= 0, 'S3 第一步：设置新密码');
  typePwd(pv4, '12');
  click(pv4, pv4.document.getElementById('pwdOk'));
  await sleep(40);
  assert(pv4.document.getElementById('pwdTip').textContent.indexOf('至少') >= 0, 'S3 密码太短被拦下');
  typePwd(pv4, '1234');
  click(pv4, pv4.document.getElementById('pwdOk'));
  await sleep(140);
  assert(pv4.document.getElementById('pwdTitle').textContent.indexOf('再输一次') >= 0, 'S3 第二步：再输一次');
  typePwd(pv4, '5678');
  click(pv4, pv4.document.getElementById('pwdOk'));
  await sleep(40);
  assert(pv4.document.getElementById('pwdTip').textContent.indexOf('不一致') >= 0, 'S3 两次不一致被拦下');
  typePwd(pv4, '1234');
  click(pv4, pv4.document.getElementById('pwdOk'));
  await sleep(140);
  assert(pv4.localStorage.getItem('g34_class4_pwd') === '1234', 'S3 密码写入 localStorage');
  assert(pv4.localStorage.getItem('g34_class4_pwdOn') === '1', 'S3 首次设置密码自动开启密码锁');
  assert(pv4.document.getElementById('pwdSw').className.indexOf('on') >= 0, 'S3 开关回显为开启');

  /* S4 忘记密码：长按「修改」3 秒 → 清除密码（自救，否则忘密码会锁死管理入口） */
  const p5 = boot({ bridge: true });
  const w5 = p5.window;
  w5.localStorage.setItem('g34_class4_pwd', '4321');
  w5.localStorage.setItem('g34_class4_pwdOn', '1');
  w5.localStorage.setItem('g34_class4_hidden', '["com.calc"]');
  const chg = w5.document.getElementById('pwdChangeBtn');
  assert(!!chg, 'S4 隐私页有修改密码按钮');
  touch(w5, chg, 'touchstart', 200, 400);
  await sleep(3200);
  assert(w5.document.getElementById('pwdMask').className.indexOf('open') < 0, 'S4 长按修改不弹密码键盘');
  assert(w5.document.getElementById('askMask').className.indexOf('open') >= 0, 'S4 长按修改 3 秒弹出清除确认');
  assert(w5.document.getElementById('askTitle').textContent === '忘记密码', 'S4 确认层标题为「忘记密码」');
  click(w5, w5.document.getElementById('askOk'));
  await sleep(60);
  assert(w5.localStorage.getItem('g34_class4_pwd') === '', 'S4 密码被清除');
  assert(w5.localStorage.getItem('g34_class4_pwdOn') === '0', 'S4 密码锁同时关闭');
  assert(JSON.parse(w5.localStorage.getItem('g34_class4_hidden')).length === 1, 'S4 隐藏列表不受影响');

  /* ============ B 系列：返回键关弹层 ============ */
  const b1 = boot({ bridge: true });
  const wb = b1.window;
  assert(typeof wb.__banbanCloseTop === 'function', 'B0 页面提供 __banbanCloseTop');
  assert(wb.__banbanCloseTop() === false, 'B1 没有弹层时返回 false');
  click(wb, wb.document.getElementById('themeBtn'));
  assert(wb.__banbanCloseTop() === true, 'B2 设置面板打开时返回键能关掉');
  assert(wb.document.getElementById('panel').className.indexOf('open') < 0, 'B2 面板确已关闭');
  click(wb, wb.document.getElementById('appsBtn'));
  /* 打开密码层 + 应用列表两层，closeTop 应先关最上面的密码层 */
  wb.document.getElementById('pwdMask').className = 'wxmask open';
  assert(wb.__banbanCloseTop() === true, 'B3 有密码层时先关密码层');
  assert(wb.document.getElementById('pwdMask').className.indexOf('open') < 0, 'B3 密码层已关');
  assert(wb.document.getElementById('appsPanel').className.indexOf('open') >= 0, 'B3 应用列表仍开着（未被连带关闭）');
  assert(wb.__banbanCloseTop() === true, 'B4 再按一次关掉应用列表');
  assert(wb.document.getElementById('appsPanel').className.indexOf('open') < 0, 'B4 应用列表已关');

  /* ============ R 系列：隐藏后的撤销兜底 ============ */
  const r0 = boot({ bridge: true });
  const wr = r0.window;
  click(wr, wr.document.getElementById('appsBtn'));
  const pnR = wr.document.getElementById('appsPanel');
  const itR = pnR.querySelectorAll('button.aitem')[0];
  touch(wr, itR, 'touchstart', 100, 200);
  await sleep(700);
  click(wr, wr.document.getElementById('askOk'));
  await sleep(60);
  assert(hidList(wr).length === 1, 'R0 隐藏生效');
  const toastBox = wr.document.getElementById('banbanToast');
  assert(!!toastBox, 'R0 出现提示条');
  const undoBtn = toastBox.getElementsByTagName('button')[0];
  assert(!!undoBtn && undoBtn.textContent === '撤销', 'R0 提示条带「撤销」按钮');
  click(wr, undoBtn);
  await sleep(60);
  assert(hidList(wr).length === 0, 'R0 撤销后隐藏列表清空');
  assert(pnR.querySelectorAll('button.aitem').length === 2, 'R0 撤销后列表恢复 2 项');

  /* ============ L 系列：「隐藏需密码」开关（默认关，保持免密长按即藏） ============ */
  const l1 = boot({ bridge: true });
  const wl = l1.window;
  wl.localStorage.setItem('g34_class4_pwd', '2468');
  wl.localStorage.setItem('g34_class4_hideLock', '1');
  click(wl, wl.document.getElementById('appsBtn'));
  const pnL = wl.document.getElementById('appsPanel');
  const itL = pnL.querySelectorAll('button.aitem')[0];
  touch(wl, itL, 'touchstart', 100, 200);
  await sleep(700);
  assert(wl.document.getElementById('pwdMask').className.indexOf('open') >= 0, 'L1 开启后长按先弹密码键盘');
  assert(wl.document.getElementById('askMask').className.indexOf('open') < 0, 'L1 未验证前不弹隐藏确认');
  typePwd(wl, '2468');
  click(wl, wl.document.getElementById('pwdOk'));
  await sleep(140);
  assert(wl.document.getElementById('askMask').className.indexOf('open') >= 0, 'L1 密码正确后才弹隐藏确认');
  click(wl, wl.document.getElementById('askOk'));
  await sleep(60);
  assert(hidList(wl).length === 1, 'L1 隐藏生效');

  /* L2 开关开着但没设密码 → 降级免密，不能把自己锁在外面 */
  const l2 = boot({ bridge: true });
  const wl2 = l2.window;
  wl2.localStorage.setItem('g34_class4_hideLock', '1');
  click(wl2, wl2.document.getElementById('appsBtn'));
  const itL2 = wl2.document.getElementById('appsPanel').querySelectorAll('button.aitem')[0];
  touch(wl2, itL2, 'touchstart', 100, 200);
  await sleep(700);
  assert(wl2.document.getElementById('pwdMask').className.indexOf('open') < 0, 'L2 无密码时降级免密（不弹键盘）');
  assert(wl2.document.getElementById('askMask').className.indexOf('open') >= 0, 'L2 直接弹隐藏确认');

  /* L3 开关默认关闭 → 有密码也不拦隐藏 */
  const l3 = boot({ bridge: true });
  const wl3 = l3.window;
  wl3.localStorage.setItem('g34_class4_pwd', '2468');
  click(wl3, wl3.document.getElementById('appsBtn'));
  const itL3 = wl3.document.getElementById('appsPanel').querySelectorAll('button.aitem')[0];
  touch(wl3, itL3, 'touchstart', 100, 200);
  await sleep(700);
  assert(wl3.document.getElementById('pwdMask').className.indexOf('open') < 0, 'L3 默认关闭时不拦隐藏');
  assert(wl3.document.getElementById('askTitle').textContent === '隐藏应用', 'L3 直接弹隐藏确认');

  /* ============ G 系列：存储异常 & 卸载残留 ============ */
  /* G0 存储写不进去时不能"假成功"（否则提示已隐藏、刷新后应用又回来） */
  const g0 = boot({ bridge: true, badStorage: true });
  const wg0 = g0.window;
  click(wg0, wg0.document.getElementById('appsBtn'));
  const itG = wg0.document.getElementById('appsPanel').querySelectorAll('button.aitem')[0];
  touch(wg0, itG, 'touchstart', 100, 200);
  await sleep(700);
  click(wg0, wg0.document.getElementById('askOk'));
  await sleep(80);
  const toastG = wg0.document.getElementById('banbanToast');
  assert(!!toastG && toastG.textContent.indexOf('保存失败') >= 0, 'G0 存储失败时提示保存失败');
  assert(wg0.document.getElementById('appsPanel').querySelectorAll('button.aitem').length === 2,
    'G0 没写成功就不该把应用从列表里去掉');

  /* G1 应用卸载后残留的"幽灵隐藏项"应被自动清理 */
  const g1 = boot({ bridge: true });
  const wg1 = g1.window;
  wg1.localStorage.setItem('g34_class4_hidden', '["com.android.settings","com.ghost.removed"]');
  click(wg1, wg1.document.getElementById('appsBtn'));
  await sleep(60);
  const left1 = JSON.parse(wg1.localStorage.getItem('g34_class4_hidden'));
  assert(left1.length === 1 && left1[0] === 'com.android.settings',
    'G1 已卸载的包名被清理: ' + JSON.stringify(left1));
  assert(wg1.document.getElementById('hideCntTxt').textContent.indexOf('1') >= 0, 'G1 计数同步更新');

  /* G2 列表变短（原生数据不全）时绝不能把还装着的隐藏应用误清掉 */
  const g2 = boot({ bridge: true });
  const wg2 = g2.window;
  const btnG2 = wg2.document.getElementById('appsBtn');
  click(wg2, btnG2);                 /* 第一次打开：建立"完整列表"基准（2 个应用） */
  await sleep(50);
  click(wg2, btnG2);                 /* 关掉 */
  await sleep(30);
  wg2.localStorage.setItem('g34_class4_hidden', '["com.calc"]');
  wg2.BanbanApp.getApps = () => JSON.stringify([{ name: '设置', pkg: 'com.android.settings', icon: '' }]);
  click(wg2, btnG2);                 /* 再打开：这次只拿到 1 个应用 */
  await sleep(50);
  assert(JSON.parse(wg2.localStorage.getItem('g34_class4_hidden')).length === 1,
    'G2 列表变短时不清隐藏项（避免误判为已卸载）');

  /* G3 站在密码键盘前忘密码时，当场就能看到自救方法（设新密码时不该显示） */
  const g3 = boot({ bridge: true });
  const wg3 = g3.window;
  wg3.localStorage.setItem('g34_class4_pwd', '1357');
  wg3.localStorage.setItem('g34_class4_pwdOn', '1');
  touch(wg3, wg3.document.getElementById('appsBtn'), 'touchstart', 3800, 2000);
  await sleep(700);
  const hint3 = wg3.document.getElementById('pwdHint');
  assert(hint3.style.display !== 'none', 'G3 验证密码时显示「忘记密码」提示');
  assert(hint3.textContent.indexOf('长按') >= 0, 'G3 提示里写明了自救操作');
  /* G4 设置 → 隐私 → 修改密码：验证旧密码时给提示，进入设新密码步骤后收起 */
  const g4 = boot({ bridge: true });
  const wg4 = g4.window;
  wg4.localStorage.setItem('g34_class4_pwd', '1357');
  wg4.localStorage.setItem('g34_class4_pwdOn', '1');
  click(wg4, wg4.document.getElementById('pwdChangeBtn'));
  await sleep(60);
  assert(wg4.document.getElementById('pwdTitle').textContent.indexOf('输入当前密码') >= 0, 'G4 先验证旧密码');
  assert(wg4.document.getElementById('pwdHint').style.display !== 'none', 'G4 验证旧密码时显示自救提示');
  typePwd(wg4, '1357');
  click(wg4, wg4.document.getElementById('pwdOk'));
  await sleep(140);
  assert(wg4.document.getElementById('pwdTitle').textContent.indexOf('设置新密码') >= 0, 'G4 进入设新密码步骤');
  assert(wg4.document.getElementById('pwdHint').style.display === 'none', 'G4 设新密码时收起「忘记密码」提示');

  console.log(failures === 0 ? '\nALL PASS' : '\n' + failures + ' FAILURE(S)');
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error('TEST CRASH:', e); process.exit(1); });
