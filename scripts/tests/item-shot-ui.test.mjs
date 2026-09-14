#!/usr/bin/env node
// REQ-20260909-009 新建需求 / Bug 描述支持截图 —— 前端测试 U1–U6。
// 加载实际 app.js / index.html（参照 new-item-nav.test.mjs 的 vm + 模拟 DOM 方式）。
// 用法：node scripts/tests/item-shot-ui.test.mjs

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
    dataset: {}, innerHTML: '', textContent: '', value: '', disabled: false, checked: false,
    children: [], listeners: {},
    classList: {
      add: (v) => classes.add(v), remove: (v) => classes.delete(v),
      contains: (v) => classes.has(v), toggle: (v, on) => (on ? classes.add(v) : classes.delete(v)),
    },
    addEventListener(event, fn) { (this.listeners[event] ||= []).push(fn); },
    getAttribute(name) { return attrs.has(name) ? attrs.get(name) : null; },
    setAttribute(name, v) { attrs.set(name, String(v)); },
    removeAttribute(name) { attrs.delete(name); },
    querySelector(selector) { if (!nodes.has(selector)) nodes.set(selector, element()); return nodes.get(selector); },
    querySelectorAll(selector) { if (!qsa.has(selector)) qsa.set(selector, []); return qsa.get(selector); },
    setQsa(selector, list) { qsa.set(selector, list); },
    appendChild(child) { this.children.push(child); },
    replaceChildren(...children) { this.children = children; },
    replaceWith(...replacements) { this.replacedWith = replacements; },
    click() { for (const fn of this.listeners.click || []) fn({ target: this, currentTarget: this }); },
    fire(event) { for (const fn of this.listeners[event] || []) fn({ target: this, currentTarget: this }); },
    focus() {},
  };
}

function setup() {
  const document = element();
  document.createElement = element;
  document.querySelector('#modalWrap').classList.add('hidden');
  const requests = [], notices = [];
  const sandbox = {
    document, URLSearchParams, console, setTimeout: () => 0, clearTimeout() {}, Date,
    location: { pathname: '/', search: '' }, history: { replaceState() {} }, localStorage: { setItem() {} },
    window: { addEventListener() {}, confirm: () => true },
    FileReader: class { readAsDataURL() {} },
    fetch: async (url, opts) => { requests.push({ url, opts }); return { ok: true, json: async () => ({ id: 'REQ-20990101-009', status: 'submitted' }) }; },
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

const fire = (el, event) => {
  for (const fn of el.listeners[event] || []) fn({ target: el, currentTarget: el });
};

const PNG = 'data:image/png;base64,QUJD';

t('U1 静态契约：描述下方存在截图区块（区块/按钮/文件选择/列表/计数/空态/错误），accept 限定图片且多选', () => {
  const shotRow = html.indexOf('id="fShotRow"');
  const descRow = html.indexOf('id="fDescRow"');
  const foot = html.indexOf('class="modal-foot"');
  assert.ok(descRow > 0, '应有描述字段');
  assert.ok(shotRow > descRow, '截图区块应在描述字段下方');
  assert.ok(foot > shotRow, '截图区块应在操作按钮之前');
  for (const id of ['fShotPick', 'fShotFile', 'fShotList', 'fShotCount', 'fShotEmpty', 'fShotError']) {
    assert.ok(html.includes(`id="${id}"`), `缺少 #${id}`);
  }
  const fileTag = html.slice(html.indexOf('id="fShotFile"') - 220, html.indexOf('id="fShotFile"') + 220);
  assert.match(fileTag, /type="file"/, '文件选择 input');
  assert.match(fileTag, /accept="image\/[^"]*"/, 'accept 应限定图片');
  assert.match(fileTag, /multiple/, '应支持一次多选');
  assert.match(css, /\.shot-list/, '样式表应有缩略图列表样式');
  assert.match(css, /\.doc-shot/, '样式表应有 README 内联截图样式');
});

t('U2 类型切换：REQ-20260910-028 起讨论同口径显示截图区块（推翻 REQ-20260909-004 旧口径），需求 / Bug 不变', () => {
  const h = setup();
  h.run("$('#fType').value = 'ask'; syncNewFormFields();");
  assert.equal(h.document.querySelector('#fShotRow').classList.contains('hidden'), false, '讨论应显示截图区块（REQ-20260910-028）');
  h.run("$('#fType').value = 'req'; syncNewFormFields();");
  assert.equal(h.document.querySelector('#fShotRow').classList.contains('hidden'), false, '需求应显示截图区块');
  h.run("$('#fType').value = 'bug'; syncNewFormFields();");
  assert.equal(h.document.querySelector('#fShotRow').classList.contains('hidden'), false, 'Bug 应显示截图区块');
});

t('U3 提交：需求 / Bug 请求体按添加顺序携带 attachments[{name,dataBase64}]；无截图讨论不带该字段；提交期间禁用添加/移除入口', async () => {
  const h = setup();
  h.run(`shotAddFile({ name: 'a.png', size: 3, dataUrl: ${JSON.stringify(PNG)} });`);
  h.run("shotAddFile({ name: 'b.jpg', size: 4, dataUrl: 'data:image/jpeg;base64,Qg==' });");
  h.document.querySelector('#fType').value = 'bug';
  h.document.querySelector('#fTitle').value = '带截图的 Bug';
  h.document.querySelector('#fDesc').value = '现象';
  await h.run("submitNew({ preventDefault() {} })");
  const call = h.requests.find((r) => String(r.url).includes('/api/new'));
  assert.ok(call, '应请求 /api/new');
  const body = JSON.parse(call.opts.body);
  assert.equal(body.type, 'bug');
  assert.deepEqual(body.attachments, [
    { name: 'a.png', dataBase64: 'QUJD' },
    { name: 'b.jpg', dataBase64: 'Qg==' },
  ], '附件应按添加顺序、dataURL 去前缀携带');
  assert.equal(h.run('shotBusy'), false, '提交结束应恢复添加/移除入口');

  h.requests.length = 0;
  h.run("openModal('ask')");
  assert.equal(h.run('newShots.length'), 0, 'openModal 应清空');
  h.document.querySelector('#fType').value = 'ask';
  h.document.querySelector('#fTitle').value = '讨论';
  await h.run("submitNew({ preventDefault() {} })");
  const askCall = h.requests.find((r) => String(r.url).includes('/api/discussion'));
  assert.ok(askCall, '讨论应走 /api/discussion');
  const askBody = JSON.parse(askCall.opts.body);
  assert.equal('attachments' in askBody, false, '无截图讨论不带 attachments（REQ-20260910-028 带截图路径见 discussion-shot 测试）');
  // 静态契约：submitNew 提交期间置 shotBusy（添加/移除入口失效防竞态），收尾复位
  const submitBlock = source.slice(source.indexOf('async function submitNew'), source.indexOf('\n}', source.indexOf('async function submitNew')));
  assert.match(submitBlock, /shotBusy = true/, '提交期间应置 shotBusy');
  assert.match(submitBlock, /shotBusy = false/, '收尾应复位 shotBusy');
});

t('U4 本地即时校验：非图片 / 超 8MB / 达上限被拒并就地提示，不进列表；移除后计数回落', () => {
  const h = setup();
  assert.equal(h.run("shotAddFile({ name: 'evil.txt', size: 1, dataUrl: 'data:text/plain;base64,eA==' })"), false, '非图片应拒绝');
  assert.match(h.document.querySelector('#fShotError').textContent, /仅支持/, '应就地提示白名单口径');
  assert.equal(h.run('newShots.length'), 0, '被拒项不进入列表');

  h.run(`shotAddFile({ name: 'big.png', size: 9 * 1024 * 1024, dataUrl: ${JSON.stringify(PNG)} })`);
  assert.match(h.document.querySelector('#fShotError').textContent, /8MB/, '超限应提示 8MB 上限');
  assert.equal(h.run('newShots.length'), 0);

  for (let i = 0; i < 9; i++) {
    assert.equal(h.run(`shotAddFile({ name: 's${i}.png', size: 1, dataUrl: ${JSON.stringify(PNG)} })`), true, `第 ${i + 1} 张应成功`);
  }
  assert.equal(h.run('newShots.length'), 9);
  assert.match(h.document.querySelector('#fShotCount').textContent, /9 \/ 9/, '计数应显示 n / 上限');
  h.run(`shotAddFile({ name: 'tenth.png', size: 1, dataUrl: ${JSON.stringify(PNG)} })`);
  assert.match(h.document.querySelector('#fShotError').textContent, /最多|上限/, '达上限应明确提示');
  assert.equal(h.run('newShots.length'), 9, '第 10 张不得进入');

  h.run('shotRemove(0)');
  assert.equal(h.run('newShots.length'), 8, '移除后计数回落');
  assert.equal(h.run(`shotAddFile({ name: 'again.png', size: 1, dataUrl: ${JSON.stringify(PNG)} })`), true, '移除后可再添加');
});

t('U5 重新打开弹窗清空上次截图（openModal 重置口径）', () => {
  const h = setup();
  h.run(`shotAddFile({ name: 'left.png', size: 1, dataUrl: ${JSON.stringify(PNG)} });`);
  h.run("openModal('req')");
  assert.equal(h.run('newShots.length'), 0, '重开弹窗应清空截图');
  assert.match(h.document.querySelector('#fShotCount').textContent, /^0 \/ 9$/, '计数应归零');
});

t('U6 抽屉 README 图片接管：相对 attachments/ 改写为条目附件端点；绝对地址不接管；点击放大；加载失败占位', () => {
  const h = setup();
  const view = h.document.createElement();
  const rel = h.document.createElement();  // 相对引用（带编码空格）
  rel.setAttribute('src', 'attachments/a%20b.png');
  const relDot = h.document.createElement(); // ./ 前缀
  relDot.setAttribute('src', './attachments/c.png');
  const sub = h.document.createElement();   // 子目录形态不接管
  sub.setAttribute('src', 'attachments/sub/d.png');
  const http = h.document.createElement();
  http.setAttribute('src', 'https://x.test/a.png');
  const data = h.document.createElement();
  data.setAttribute('src', 'data:image/png;base64,QUJD');
  const rootAbs = h.document.createElement();
  rootAbs.setAttribute('src', '/static/a.png');
  view.setQsa('img', [rel, relDot, sub, http, data, rootAbs]);
  // 模拟 DOM 的 src 属性反射（property ↔ attribute），未接管项便于断言原值不变
  for (const el of [rel, relDot, sub, http, data, rootAbs]) el.src = el.getAttribute('src');
  h.sandbox.__view = view;
  h.run('linkupDocImages(__view, "REQ-20990101-001")');

  const want = (name) => `/api/item/REQ-20990101-001/attachment/${encodeURIComponent(name)}?project=${encodeURIComponent('/project/a')}`;
  assert.equal(rel.src, want('a b.png'), '相对引用应改写为条目附件端点（解码后重新编码）');
  assert.equal(relDot.src, want('c.png'), './ 前缀相对引用应接管');
  assert.equal(sub.src, 'attachments/sub/d.png', '子目录形态不接管');
  assert.equal(http.src, 'https://x.test/a.png', 'http 绝对地址不接管');
  assert.equal(data.src, 'data:image/png;base64,QUJD', 'data: 不接管');
  assert.equal(rootAbs.src, '/static/a.png', '根相对路径不接管');

  // 点击放大：接线 #oncallLightbox
  fire(rel, 'click');
  const box = h.document.querySelector('#oncallLightbox');
  assert.equal(box.classList.contains('hidden'), false, '点击应显示放大层');
  assert.equal(box.querySelector('img').src, rel.src, '放大层应显示同一 URL');

  // 加载失败占位：不渲染空白破图
  fire(relDot, 'error');
  assert.ok(relDot.replacedWith && relDot.replacedWith.length === 1, '失败图应被替换为占位元素');
  assert.match(String(relDot.replacedWith[0].textContent), /无法加载/, '占位应说明加载失败');

  // 渲染接线静态契约：loadDoc 渲染与 docCache 回填都调用图片接管（至少两处）
  const hits = source.match(/linkupDocImages\(view, state\.drawer\.id\)/g) || [];
  assert.ok(hits.length >= 2, `loadDoc 渲染与 docCache 回填都应接管相对图片（命中 ${hits.length} 处）`);
});

t('U7 粘贴命名：剪贴板图片自动获得合法文件名（paste-<时间戳>.<白名单后缀>）', () => {
  const h = setup();
  assert.match(h.run("shotPasteName({ name: 'image.png', type: 'image/png' })"), /^paste-\d+\.png$/);
  assert.match(h.run("shotPasteName({ name: '', type: 'image/jpeg' })"), /^paste-\d+\.jpg$/);
  assert.match(h.run("shotPasteName({ name: '', type: 'image/webp' })"), /^paste-\d+\.webp$/);
  assert.match(h.run("shotPasteName({ name: '', type: '' })"), /^paste-\d+\.png$/, '未知 MIME 兜底 png');
  assert.match(h.run("shotPasteName({ name: 'blob', type: 'image/png' })"), /^paste-\d+\.png$/, '无后缀名取 MIME 后缀');
  // 粘贴入口静态契约：弹窗打开期间监听 paste，读剪贴板图片项
  assert.match(source, /addEventListener\('paste'/, '应监听 paste 事件');
  assert.match(source, /clipboardData/, '应读取剪贴板图片项');
});

// BUG-20260909-010 U8：带截图提交前预检附件端点——服务过旧（旧进程无条目附件路由，静态前端
// 已是新版）时明确拒绝提交并给 atb serve 自愈指引，不再 201 成功 + 截图无痕丢失；判定口径对齐
// BUG-20260909-005 演示链接预检（「未知接口：」JSON 404 = 服务早于该功能上线）。
// 预检响应 mock 等价于「服务进程早于截图功能上线」的版本错配环境（旧进程对该 GET 返回路由
// 兜底 404「未知接口」，新进程对占位条目必返回 400 类业务错误）。
t('U8 提交预检：带截图 + 服务过旧 → 拒绝提交给指引不丢数据；新服务/网络异常 → 放行；无截图不预检', async () => {
  // U8a 过旧：预检 404「未知接口」→ 不发 /api/new，错误 toast 给 atb serve 指引，弹窗与截图保留
  const a = setup();
  a.run("openModal('bug')");
  a.run(`shotAddFile({ name: 'a.png', size: 3, dataUrl: ${JSON.stringify(PNG)} })`);
  a.sandbox.fetch = async (url, opts) => {
    a.requests.push({ url, opts });
    if (String(url).includes('/attachment/')) {
      return { ok: false, status: 404, json: async () => ({ error: '未知接口：GET /api/item/REQ-20990101-999/attachment/probe.png' }) };
    }
    return { ok: true, status: 201, json: async () => ({ id: 'BUG-20990101-001', status: 'submitted' }) };
  };
  a.document.querySelector('#fType').value = 'bug';
  a.document.querySelector('#fTitle').value = '带截图';
  await a.run("submitNew({ preventDefault() {} })");
  assert.ok(!a.requests.some((r) => String(r.url).includes('/api/new')), '过旧时不得发出创建请求（会静默丢截图）');
  assert.ok(a.requests.some((r) => String(r.url).includes('/attachment/')), '应先预检条目附件端点');
  assert.equal(a.notices.length, 1, '应弹一条错误 toast');
  assert.match(String(a.notices[0].message), /创建失败/, '文案保持创建失败口径');
  assert.match(String(a.notices[0].message), /版本过旧/, '应说明服务版本过旧');
  assert.match(String(a.notices[0].message), /atb serve/, '应给出 atb serve 自愈指引');
  assert.match(String(a.notices[0].message), /截图/, '应说明截图会被丢弃');
  assert.equal(a.notices[0].error, true, 'toast 应为错误样式');
  assert.equal(a.run('newShots.length'), 1, '失败应保留截图供重试');
  assert.equal(a.run('shotBusy'), false, '收尾应恢复添加/移除入口');
  assert.equal(a.document.querySelector('#fSubmit').disabled, false, '收尾应恢复创建按钮');
  assert.equal(a.document.querySelector('#modalWrap').classList.contains('hidden'), false, '弹窗应保留（未关闭）');

  // U8b 新服务：预检 400（占位条目不存在，新进程业务错误）→ 照常提交且携带附件
  const b = setup();
  b.run("openModal('req')");
  b.run(`shotAddFile({ name: 'b.png', size: 3, dataUrl: ${JSON.stringify(PNG)} })`);
  b.sandbox.fetch = async (url, opts) => {
    b.requests.push({ url, opts });
    if (String(url).includes('/attachment/')) {
      return { ok: false, status: 400, json: async () => ({ error: '条目不存在：REQ-20990101-999' }) };
    }
    return { ok: true, status: 201, json: async () => ({ id: 'REQ-20990101-011', status: 'submitted' }) };
  };
  b.document.querySelector('#fType').value = 'req';
  b.document.querySelector('#fTitle').value = '带截图';
  await b.run("submitNew({ preventDefault() {} })");
  const call = b.requests.find((r) => String(r.url).includes('/api/new'));
  assert.ok(call, '新服务应照常创建');
  assert.deepEqual(JSON.parse(call.opts.body).attachments, [{ name: 'b.png', dataBase64: 'QUJD' }], '附件应随创建提交');

  // U8c 网络异常：预检失败放行，交由真正的创建请求成败说话
  const c = setup();
  c.run("openModal('req')");
  c.run(`shotAddFile({ name: 'c.png', size: 3, dataUrl: ${JSON.stringify(PNG)} })`);
  c.sandbox.fetch = async (url, opts) => {
    c.requests.push({ url, opts });
    if (String(url).includes('/attachment/')) throw new Error('network down');
    return { ok: true, status: 201, json: async () => ({ id: 'REQ-20990101-012', status: 'submitted' }) };
  };
  c.document.querySelector('#fType').value = 'req';
  c.document.querySelector('#fTitle').value = '带截图';
  await c.run("submitNew({ preventDefault() {} })");
  assert.ok(c.requests.some((r) => String(r.url).includes('/api/new')), '预检网络异常应放行创建');
  assert.equal(c.notices.length, 1, '放行路径只应有创建结果 toast');
  assert.match(String(c.notices[0].message), /已创建/, '预检网络异常不打断创建成功');
  assert.notEqual(c.notices[0].error, true, '创建成功不应为错误样式');

  // U8d 无截图：不做预检请求（旧口径创建不受影响，S5 兼容）
  const d = setup();
  d.run("openModal('req')");
  d.document.querySelector('#fType').value = 'req';
  d.document.querySelector('#fTitle').value = '纯文字';
  await d.run("submitNew({ preventDefault() {} })");
  assert.ok(!d.requests.some((r) => String(r.url).includes('/attachment/')), '无截图不应预检');
  assert.ok(d.requests.some((r) => String(r.url).includes('/api/new')), '无截图应直接创建');

  // U8e 静态契约：submitNew 带附件路径调用预检（防回归静默丢数据）
  const submitBlock = source.slice(source.indexOf('async function submitNew'), source.indexOf('\n}', source.indexOf('async function submitNew')));
  assert.match(submitBlock, /shotServeSupportsAttachments/, 'submitNew 应经预检函数拦截过旧服务');
});

let failed = 0;
for (const [name, fn] of cases) {
  try { await fn(); console.log(`✓ ${name}`); }
  catch (e) { failed++; console.error(`✗ ${name}\n${e.stack}`); }
}
console.log(`\n${cases.length} 个用例，失败 ${failed}`);
process.exitCode = failed ? 1 : 0;
