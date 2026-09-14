#!/usr/bin/env node
// REQ-20260910-017 新建条目截图双击放大预览 —— 前端测试 U1–U8。
// 加载实际 app.js / index.html / style.css（vm + 模拟 DOM，参照 item-shot-ui.test.mjs）。
// 用法：node scripts/tests/new-shot-preview-20260910-017.test.mjs

import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../web/app.js', import.meta.url), 'utf8');
const html = fs.readFileSync(new URL('../web/index.html', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../web/style.css', import.meta.url), 'utf8');

const cases = [];
const t = (name, fn) => cases.push([name, fn]);

// DOM 接缝：记录控件属性、事件与内容；布局由界面检查覆盖。
function element() {
  const nodes = new Map();
  const classes = new Set();
  const attrs = new Map();
  const qsa = new Map();
  return {
    tagName: '', dataset: {}, innerHTML: '', textContent: '', value: '', disabled: false, checked: false,
    children: [], listeners: {}, isConnected: true,
    classList: {
      add: (v) => classes.add(v), remove: (v) => classes.delete(v),
      contains: (v) => classes.has(v), toggle: (v, on) => (on ? classes.add(v) : classes.delete(v)),
    },
    addEventListener(event, fn) { (this.listeners[event] ||= []).push(fn); },
    removeEventListener(event, fn) {
      this.listeners[event] = (this.listeners[event] || []).filter((f) => f !== fn);
    },
    getAttribute(name) { return attrs.has(name) ? attrs.get(name) : null; },
    setAttribute(name, v) { attrs.set(name, String(v)); },
    removeAttribute(name) { attrs.delete(name); },
    closest() { return null; },
    querySelector(selector) { if (!nodes.has(selector)) nodes.set(selector, element()); return nodes.get(selector); },
    querySelectorAll(selector) { if (!qsa.has(selector)) qsa.set(selector, []); return qsa.get(selector); },
    setQsa(selector, list) { qsa.set(selector, list); },
    appendChild(child) { this.children.push(child); },
    replaceChildren(...children) { this.children = children; },
    replaceWith(...replacements) { this.replacedWith = replacements; },
    click() { for (const fn of this.listeners.click || []) fn({ target: this, currentTarget: this }); },
    fire(event) { for (const fn of this.listeners[event] || []) fn({ target: this, currentTarget: this }); },
    focus() { (this.focusLog ||= []).push('focus'); },
  };
}

function setup() {
  const document = element();
  document.createElement = element;
  document.querySelector('#modalWrap').classList.add('hidden');
  document.querySelector('#projModalWrap').classList.add('hidden'); // 初始常驻隐藏态（Esc 链会检查）
  document.querySelector('#shortcutHelpWrap').classList.add('hidden'); // 初始常驻隐藏态
  document.querySelector('#editModalWrap').classList.add('hidden'); // REQ-20260911-001 编辑面板初始隐藏态（Esc 链会检查）
document.querySelector('#holdPanel').classList.add('hidden'); // REQ-20260911-007 决策面板初始隐藏态（Esc 链会检查）
document.querySelector('#confirmPanel').classList.add('hidden'); // REQ-20260914-001 挂起确认面板初始隐藏态（Esc 链会检查）
  const requests = [], notices = [];
  const sandbox = {
    document, URLSearchParams, console, setTimeout: () => 0, clearTimeout() {}, Date,
    location: { pathname: '/', search: '' }, history: { replaceState() {} }, localStorage: { setItem() {} },
    window: { addEventListener() {}, removeEventListener() {}, confirm: () => true },
    FileReader: class { readAsDataURL() {} },
    fetch: async (url, opts) => { requests.push({ url, opts }); return { ok: true, json: async () => ({ id: 'REQ-20990101-017', status: 'submitted' }) }; },
  };
  vm.createContext(sandbox);
  vm.runInContext(source.split('/* ---------- 事件绑定与启动 ---------- */')[0], sandbox, { filename: 'app.js' });
  const run = (code) => vm.runInContext(code, sandbox);
  const state = run('state');
  state.project = '/project/a';
  state.board = { initialized: true, items: [] };
  sandbox.recordNotice = (message, error) => notices.push({ message, error });
  run('toast = recordNotice; setView = () => {}; poll = async () => {}; renderBoard = () => {}; renderDrawer = () => {}; refreshDrawer = async () => {}; updateBoardTabs = () => {};');
  return { sandbox, document, state, run, requests, notices };
}

const fire = (el, event, ev = {}) => {
  for (const fn of el.listeners[event] || []) fn({ target: el, currentTarget: el, ...ev });
};

const PNG_A = 'data:image/png;base64,QQ==';
const JPG_B = 'data:image/jpeg;base64,Qg==';

// 构造缩略图卡片 / 按钮注入 renderShots 的查询接缝（模拟 DOM 不解析 innerHTML）
function mkShotNode(i, kind) {
  const el = element();
  if (kind === 'item') el.dataset.shotI = String(i);
  if (kind === 'view') el.dataset.shotView = String(i);
  if (kind === 'x') el.dataset.shotI = String(i);
  return el;
}

function addTwoShots(h) {
  h.run(`shotAddFile({ name: 'a.png', size: 3, dataUrl: ${JSON.stringify(PNG_A)} })`);
  h.run(`shotAddFile({ name: 'b.jpg', size: 4, dataUrl: ${JSON.stringify(JPG_B)} })`);
}

// 注入列表节点并渲染，返回卡片与按钮
function rigList(h) {
  const list = h.document.querySelector('#fShotList');
  const items = [mkShotNode(0, 'item'), mkShotNode(1, 'item')];
  const views = [mkShotNode(0, 'view'), mkShotNode(1, 'view')];
  const xs = [mkShotNode(0, 'x'), mkShotNode(1, 'x')];
  list.setQsa('.shot-item', items);
  list.setQsa('.shot-view', views);
  list.setQsa('.shot-x', xs);
  h.run('renderShots()');
  return { list, items, views, xs };
}

const zIndexOf = (cssText, sel) => {
  const m = new RegExp(`${sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*{[^}]*z-index:\\s*(\\d+)`).exec(cssText);
  return m ? Number(m[1]) : null;
};

t('U1 静态契约：预览层节点与样式（覆盖新建面板、文件名截断、等比适应视口）；缩略图渲染查看大图按钮与双击提示', () => {
  // index.html：预览层常驻节点（dialog 语义），名称 / 关闭 / 内容区三件套
  const idx = html.indexOf('id="shotPreview"');
  assert.ok(idx > 0, '应有 #shotPreview 预览层');
  const tag = html.slice(idx - 200, idx + 700);
  assert.match(tag, /role="dialog"/, '预览层应为 dialog 角色');
  assert.match(tag, /aria-modal="true"/, '预览层应声明 aria-modal（背景表单不可达）');
  assert.ok(tag.indexOf('id="shotPreviewName"') > 0, '缺少 #shotPreviewName');
  assert.ok(tag.indexOf('id="shotPreviewClose"') > 0, '缺少 #shotPreviewClose');
  assert.ok(tag.indexOf('id="shotPreviewBody"') > 0, '缺少 #shotPreviewBody');
  assert.ok(html.includes('双击查看大图'), '截图区应有「双击查看大图」提示');

  // style.css：全屏遮罩盖过新建侧拉面板（z-index 更高）、文件名截断、关闭按钮不收缩、图片等比不超视口
  assert.match(css, /\.shot-preview\s*{[^}]*position:\s*fixed/, '预览层应 fixed 全屏');
  assert.match(css, /\.shot-preview\s*{[^}]*inset:\s*0/, '预览层应铺满视口');
  const zPreview = zIndexOf(css, '.shot-preview');
  const zPanel = zIndexOf(css, '.side-panel');
  assert.ok(zPreview != null && zPanel != null && zPreview > zPanel, `预览层级应高于新建面板（${zPreview} > ${zPanel}）`);
  assert.match(css, /\.shot-preview-name\s*{[^}]*text-overflow:\s*ellipsis/, '窄窗口文件名应截断');
  assert.match(css, /\.shot-preview-close\s*{[^}]*flex-shrink:\s*0/, '关闭按钮不应被挤压（始终可见）');
  assert.match(css, /\.shot-preview-body img\s*{[^}]*max-width/, '大图宽不超可视区域');
  assert.match(css, /\.shot-preview-body img\s*{[^}]*max-height/, '大图高不超可视区域');
  assert.match(css, /\.shot-preview-body img\s*{[^}]*object-fit:\s*contain/, '大图保持比例完整展示');

  // renderShots 模板：每张缩略图带「查看大图」按钮（type=button 不提交）与双击提示
  const h = setup();
  addTwoShots(h);
  h.run('renderShots()');
  const markup = h.document.querySelector('#fShotList').innerHTML;
  assert.ok(markup.includes('data-shot-view="0"') && markup.includes('data-shot-view="1"'), '每张缩略图应有查看大图入口');
  const viewTag = markup.slice(markup.indexOf('data-shot-view="0"') - 160, markup.indexOf('data-shot-view="0"') + 160);
  assert.match(viewTag, /type="button"/, '查看大图应为 type=button（不提交表单）');
  assert.match(viewTag, /查看大图/, '按钮文案');
  assert.match(markup, /双击查看大图/, '缩略图应提示双击查看大图');
});

t('U2 双击打开与一一对应：双击第 N 张开第 N 张；双击落在按钮上不触发；单击不开预览不提交', () => {
  const h = setup();
  h.run("openModal('req')");
  addTwoShots(h);
  const { items, views, xs } = rigList(h);
  assert.ok(items[1].listeners.dblclick, '缩略图应绑定双击');
  assert.ok(views[0].listeners.click, '查看大图按钮应绑定点击');
  assert.ok(xs[0].listeners.click, '移除按钮既有绑定不回退');
  assert.equal(items[0].listeners.click, undefined, '单击缩略图不得绑定行为（单击不开预览不提交）');

  // 双击第 2 张（target 为图片 → 非按钮）：打开 b.jpg 且 dataUrl 一一对应
  fire(items[1], 'dblclick', { target: { closest: () => null } });
  const box = h.document.querySelector('#shotPreview');
  assert.equal(box.classList.contains('hidden'), false, '双击应打开预览');
  assert.equal(h.document.querySelector('#shotPreviewName').textContent, 'b.jpg', '预览文件名应与被双击图一致');
  const body = h.document.querySelector('#shotPreviewBody');
  const img = body.children[0];
  assert.equal(img.src, JPG_B, '预览大图应与被双击图一一对应');
  h.run('shotPreviewClose()');

  // 双击第 1 张：打开 a.png
  fire(items[0], 'dblclick', { target: { closest: () => null } });
  assert.equal(h.document.querySelector('#shotPreviewName').textContent, 'a.png', '另一张应打开对应文件');
  assert.equal(h.document.querySelector('#shotPreviewBody').children[0].src, PNG_A, 'dataUrl 一一对应');
  h.run('shotPreviewClose()');

  // 双击落在移除 / 查看按钮上：不打开预览
  fire(items[0], 'dblclick', { target: { closest: (sel) => (sel.includes('shot-x') ? {} : null) } });
  assert.equal(box.classList.contains('hidden'), true, '双击移除按钮不得打开预览');
  assert.equal(h.run('newShots.length'), 2, '附件数量不变');
  fire(items[0], 'dblclick', { target: { closest: (sel) => (sel.includes('shot-view') ? {} : null) } });
  assert.equal(box.classList.contains('hidden'), true, '双击查看大图按钮不重复触发预览');

  // 粘贴自动命名入列同走 newShots：第 3 张也可双击预览（共用渲染路径）
  h.run(`shotAddFile({ name: 'paste-1.png', size: 2, dataUrl: 'data:image/png;base64,Qw==' })`);
  const item2 = mkShotNode(2, 'item');
  h.document.querySelector('#fShotList').setQsa('.shot-item', [item2]);
  h.run('renderShots()');
  fire(item2, 'dblclick', { target: { closest: () => null } });
  assert.equal(h.document.querySelector('#shotPreviewName').textContent, 'paste-1.png', '粘贴截图同样可预览');
});

t('U3 键盘入口与焦点：按钮打开后焦点进关闭按钮；Tab 在预览内循环；关闭恢复触发点', () => {
  const h = setup();
  h.run("openModal('req')");
  addTwoShots(h);
  const { views } = rigList(h);

  // 「查看大图」按钮 click 打开（原生 button 的 Enter/Space 等价 click），焦点进入关闭按钮
  const closeBtn = h.document.querySelector('#shotPreviewClose');
  closeBtn.focusLog = [];
  views[1].click();
  assert.equal(h.document.querySelector('#shotPreview').classList.contains('hidden'), false, '按钮应打开预览');
  assert.equal(h.document.querySelector('#shotPreviewBody').children[0].src, JPG_B, '按钮打开对应图片');
  assert.ok(closeBtn.focusLog.length >= 1, '打开后焦点应进入关闭按钮');

  // Tab 圈定：焦点已在内（关闭按钮）→ preventDefault 且留在预览内
  let prevented = 0;
  h.document.querySelector('#shotPreview').setQsa('button', [closeBtn]);
  h.document.activeElement = closeBtn;
  h.run('trapShotPreviewFocus({ key: "Tab", shiftKey: false, preventDefault() { __prevented = true; } })');
  assert.equal(h.run('__prevented'), true, '预览内 Tab 应被圈定（不落背景表单）');
  assert.ok(closeBtn.focusLog.length >= 2, 'Tab 应回绕到预览内控件');

  // 关闭恢复触发点（查看大图按钮）焦点
  views[1].focusLog = [];
  h.run('shotPreviewClose()');
  assert.equal(views[1].focusLog.length, 1, '关闭应恢复触发点焦点');
});

t('U4 关闭行为：关闭 / 遮罩空白 / Esc 只关预览且图片本身不关闭；Esc 不关新建面板；表单字段与附件保持', async () => {
  const h = setup();
  h.run("openModal('bug')");
  h.document.querySelector('#fTitle').value = '核对截图';
  h.document.querySelector('#fDesc').value = '放大后继续填写';
  addTwoShots(h);
  const { items } = rigList(h);
  fire(items[0], 'dblclick', { target: { closest: () => null } });

  // Esc（全局链）：预览与新建面板同时开 → 只关预览一层
  h.run("onGlobalKeydown({ key: 'Escape', ctrlKey: false, metaKey: false, altKey: false, repeat: false, isComposing: false, preventDefault() {} })");
  assert.equal(h.document.querySelector('#shotPreview').classList.contains('hidden'), true, 'Esc 应关闭预览');
  assert.equal(h.document.querySelector('#modalWrap').classList.contains('hidden'), false, 'Esc 不得连带关闭新建面板');
  // 再按一次 Esc：才走既有链关闭新建面板（一次只关一层）
  h.run("onGlobalKeydown({ key: 'Escape', ctrlKey: false, metaKey: false, altKey: false, repeat: false, isComposing: false, preventDefault() {} })");
  assert.equal(h.document.querySelector('#modalWrap').classList.contains('hidden'), true, '预览关闭后 Esc 恢复既有关闭链');

  // 关闭后字段 / 类型 / 附件数量与顺序保持
  assert.equal(h.document.querySelector('#fTitle').value, '核对截图', '标题保持');
  assert.equal(h.document.querySelector('#fDesc').value, '放大后继续填写', '描述保持');
  assert.equal(h.document.querySelector('#fType').value, 'bug', '类型保持');
  assert.equal(h.run('JSON.stringify(newShots.map(s => s.name))'), JSON.stringify(['a.png', 'b.jpg']), '附件数量与顺序保持');

  // 绑定段静态契约：关闭按钮、遮罩空白关闭、点击图片 / 按钮本身不关闭
  const wiring = source.slice(source.indexOf('/* ---------- 事件绑定与启动 ---------- */'));
  assert.match(wiring, /\$\('#shotPreviewClose'\)\?\.addEventListener\('click'/, '关闭按钮应接线');
  const maskIdx = wiring.indexOf("$('#shotPreview')?.addEventListener('click'");
  assert.ok(maskIdx > 0, '预览层应接线遮罩点击关闭');
  const maskBlock = wiring.slice(maskIdx, maskIdx + 300);
  assert.match(maskBlock, /closest\('button, img'\)/, '点击按钮 / 图片本身不触发关闭');
  assert.match(maskBlock, /shotPreviewClose\(\)/, '遮罩空白点击应关闭预览');

  // Esc 窗口捕获处理器存在（预览打开时拦截，不外溢关闭背景面板）
  assert.match(source, /addEventListener\('keydown',\s*\w+,\s*true\)/, '预览期 Esc/Tab 应走窗口捕获拦截');
});

t('U5 迟到结果忽略：关闭 / 切换后旧 load 结果不回写新预览', () => {
  const h = setup();
  h.run("openModal('req')");
  addTwoShots(h);
  const { items } = rigList(h);

  fire(items[0], 'dblclick', { target: { closest: () => null } }); // 打开 a（未完成加载）
  const imgA = h.document.querySelector('#shotPreviewBody').children[0];
  h.run('shotPreviewClose()'); // 关闭：a 的加载结果应失效
  fire(items[1], 'dblclick', { target: { closest: () => null } }); // 打开 b
  const body = h.document.querySelector('#shotPreviewBody');
  const imgB = body.children[0];

  fire(imgA, 'load'); // a 的迟到 load 到达
  assert.equal(body.children.length, 2, '迟到结果不得回写（b 仍在加载态）');
  assert.equal(body.children[0], imgB, '显示的仍是当前图片 b');
  assert.equal(imgB.classList.contains('hidden'), true, 'b 尚未加载完成不显示');
  fire(imgB, 'load'); // b 正常完成
  assert.deepEqual(body.children, [imgB], '当前图片加载完成后显示');
  assert.equal(imgB.classList.contains('hidden'), false, '完成后去除隐藏');
});

t('U6 加载与失败反馈：打开即加载中且保留关闭；失败显示无法加载与重试 / 关闭；重试只重载不新增附件', () => {
  const h = setup();
  h.run("openModal('req')");
  h.run(`shotAddFile({ name: 'a.png', size: 3, dataUrl: ${JSON.stringify(PNG_A)} })`);
  rigList(h);
  h.run('shotPreviewShow(0)');

  // 打开即进入加载态，顶部关闭入口保留
  let body = h.document.querySelector('#shotPreviewBody');
  assert.equal(body.children.length, 2, '加载中：图片 + 提示');
  assert.match(String(body.children[1].textContent), /图片加载中/, '应显示图片加载中');
  assert.equal(h.document.querySelector('#shotPreviewClose').disabled, false, '加载中保留关闭入口');

  // 加载失败：图片无法加载 + 重试 + 关闭
  fire(body.children[0], 'error');
  assert.equal(body.children.length, 3, '失败态：提示 + 重试 + 关闭');
  assert.match(String(body.children[0].textContent), /图片无法加载/, '应显示图片无法加载');
  assert.match(String(body.children[1].textContent), /重试/, '应有重试按钮');
  assert.match(String(body.children[2].textContent), /关闭/, '失败态应保留关闭按钮');
  fire(body.children[2], 'click'); // 失败态关闭按钮
  assert.equal(h.document.querySelector('#shotPreview').classList.contains('hidden'), true, '失败态可关闭');
  assert.equal(h.run('newShots.length'), 1, '关闭不清空已添加附件');

  // 重试：仅重载当前图片（回加载态），不新增附件
  h.run('shotPreviewShow(0)');
  body = h.document.querySelector('#shotPreviewBody');
  fire(body.children[0], 'error');
  fire(body.children[1], 'click'); // 重试
  body = h.document.querySelector('#shotPreviewBody');
  assert.equal(body.children.length, 2, '重试回到加载态');
  assert.equal(h.run('newShots.length'), 1, '重试不得新增附件');
  fire(body.children[0], 'load'); // 重试后成功
  assert.equal(body.children.length, 1, '重试成功后显示大图');
});

t('U7 表单退出清理：closeModal / openModal 同步关闭预览，无遗留遮罩', () => {
  const h = setup();
  h.run("openModal('req')");
  addTwoShots(h);
  const { items } = rigList(h);
  fire(items[0], 'dblclick', { target: { closest: () => null } });
  assert.equal(h.document.querySelector('#shotPreview').classList.contains('hidden'), false, '预览应打开');

  h.run('closeModal()'); // 退出整个新建面板
  assert.equal(h.document.querySelector('#shotPreview').classList.contains('hidden'), true, '退出新建面板应同步关闭预览');

  // 预览未关而面板被代码关闭后重开：openModal 兜底清理
  h.run('shotPreviewShow(0)');
  h.run("openModal('req')");
  assert.equal(h.document.querySelector('#shotPreview').classList.contains('hidden'), true, '重开面板不应遗留预览遮罩');
  assert.equal(h.run('newShots.length'), 0, '重开面板清空截图（既有口径不回退）');

  // 静态契约：closeModal / openModal 都调用清理
  const closeBlock = source.slice(source.indexOf('function closeModal'), source.indexOf('function closeModal') + 400);
  assert.match(closeBlock, /shotPreviewClose/, 'closeModal 应清理预览');
});

t('U8 空态与既有口径：无截图不渲染预览入口；讨论显示截图区（REQ-20260910-028）；提交附件仍按顺序携带', async () => {
  const h = setup();
  h.run("openModal('req')"); // 打开即清空
  h.run('renderShots()');
  assert.equal(h.document.querySelector('#fShotList').classList.contains('hidden'), true, '无截图不显示缩略图列表');
  assert.equal(h.document.querySelector('#fShotList').innerHTML.includes('data-shot-view'), false, '无截图不渲染预览入口');
  assert.equal(h.document.querySelector('#fShotEmpty').classList.contains('hidden'), false, '无截图保留添加提示');

  // 讨论类型同口径显示截图区（REQ-20260910-028 推翻 REQ-20260909-004「讨论不回加」旧口径）
  h.run("$('#fType').value = 'ask'; syncNewFormFields();");
  assert.equal(h.document.querySelector('#fShotRow').classList.contains('hidden'), false, '讨论应显示截图区');
  h.run("$('#fType').value = 'req'; syncNewFormFields();");

  // 预览开关一轮后提交：attachments 仍按添加顺序、不重复
  addTwoShots(h);
  const { items } = rigList(h);
  fire(items[1], 'dblclick', { target: { closest: () => null } });
  fire(h.document.querySelector('#shotPreviewBody').children[0], 'load');
  h.run('shotPreviewClose()');
  h.document.querySelector('#fTitle').value = '带截图提交';
  await h.run("submitNew({ preventDefault() {} })");
  const call = h.requests.find((r) => String(r.url).includes('/api/new'));
  assert.ok(call, '应请求 /api/new');
  assert.deepEqual(JSON.parse(call.opts.body).attachments, [
    { name: 'a.png', dataBase64: 'QQ==' },
    { name: 'b.jpg', dataBase64: 'Qg==' },
  ], '提交附件按顺序携带且不因预览重复');
});

let failed = 0;
for (const [name, fn] of cases) {
  try { await fn(); console.log(`✓ ${name}`); }
  catch (e) { failed++; console.error(`✗ ${name}\n${e.stack}`); }
}
console.log(`\n${cases.length} 个用例，失败 ${failed}`);
process.exitCode = failed ? 1 : 0;
