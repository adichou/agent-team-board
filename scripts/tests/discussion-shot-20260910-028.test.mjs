#!/usr/bin/env node
// REQ-20260910-028 新建讨论时支持上传截图 —— 数据层 S1~S3 / 服务层 H1 / 前端 U1~U4。
// 覆盖：createDiscussion 附件落盘与整单拒绝、POST /api/discussion 透传与附件端点、
// 新建表单讨论类型显示截图区并携带附件提交、过旧服务预检、讨论详情背景截图接管。
// 用法：node scripts/tests/discussion-shot-20260910-028.test.mjs

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const appSrc = fs.readFileSync(path.join(pluginRoot, 'scripts', 'web', 'app.js'), 'utf8');
const htmlSrc = fs.readFileSync(path.join(pluginRoot, 'scripts', 'web', 'index.html'), 'utf8');
const oncallSrc = fs.readFileSync(path.join(pluginRoot, 'scripts', 'web', 'oncall.js'), 'utf8');

const cases = [];
const t = (name, fn) => cases.push([name, fn]);

const PNG = 'aXBuZy1ieXRlcw'; // base64 of "ipng-bytes"（内容任意，校验只看形态与大小）
const att = (name, data = PNG) => ({ name, dataBase64: data });

async function mkProject() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'atb-disc-shot-')));
  const { initData } = await import(path.join(pluginRoot, 'scripts', 'lib', 'core.mjs'));
  initData(root);
  const dataDir = path.join(root, 'docs', 'agent-team-board');
  return { root, dataDir };
}

/* ================= 数据层 S1~S3 ================= */

t('S1 创建落盘：附件进 <讨论目录>/attachments/（同名去重）、ticket.json 顶层 attachments、question.md 背景末尾追加引用行；背景空仅截图可创建', async () => {
  const { dataDir } = await mkProject();
  const oncall = await import(path.join(pluginRoot, 'scripts', 'lib', 'oncall-store.mjs'));
  const d = oncall.createDiscussion(dataDir, {
    title: '带截图讨论', background: '背景说明',
    attachments: [att('a.png'), att('a.png'), att('b.jpg')], by: 'board',
  });
  const dir = oncall.ticketDir(dataDir, d.id);
  assert.deepEqual(fs.readdirSync(path.join(dir, 'attachments')).sort(), ['a-2.png', 'a.png', 'b.jpg'], '同名自动去重落盘');
  assert.deepEqual(oncall.getTicket(dataDir, d.id).attachments, ['a.png', 'a-2.png', 'b.jpg'], '顶层 attachments 按添加顺序记最终文件名');
  const q = fs.readFileSync(path.join(dir, 'question.md'), 'utf8');
  assert.ok(q.startsWith('背景说明'), '背景保留');
  assert.match(q, /!\[截图\]\(attachments\/a\.png\)/, '引用行按最终文件名追加');
  assert.match(q, /!\[截图\]\(attachments\/a-2\.png\)/);
  assert.match(q, /!\[截图\]\(attachments\/b\.jpg\)/);
  // 背景留空仅截图
  const e = oncall.createDiscussion(dataDir, { title: '仅截图', attachments: [att('c.png')], by: 'board' });
  const eq = fs.readFileSync(path.join(oncall.ticketDir(dataDir, e.id), 'question.md'), 'utf8');
  assert.doesNotMatch(eq, /^\s+/, '仅截图时 question.md 只含引用行');
  assert.match(eq, /!\[截图\]\(attachments\/c\.png\)/);
  // 全量视图与启动提示词带截图信息
  const full = oncall.discussionFull(dataDir, d.id);
  assert.deepEqual(full.attachments, ['a.png', 'a-2.png', 'b.jpg'], 'discussionFull 暴露 attachments');
  const sp = oncall.buildStartPrompt(dataDir, d.id);
  assert.match(sp, /截图/, '启动提示词应提示截图位置');
  assert.ok(sp.includes(path.join(dir, 'attachments')), '提示词给绝对路径');
});

t('S2 整单拒绝：非白名单 / 超 8MB / 超 9 张 / 缺数据任一非法抛错，不建目录不消耗 ASK 单号（口径与需求 / Bug 一致）', async () => {
  const { dataDir } = await mkProject();
  const oncall = await import(path.join(pluginRoot, 'scripts', 'lib', 'oncall-store.mjs'));
  const tickets = path.join(dataDir, 'oncall', 'tickets');
  const bads = [
    [{ name: 'x.txt', dataBase64: 'eA==' }],
    [{ name: 'big.png', dataBase64: Buffer.alloc(8 * 1024 * 1024 + 1).toString('base64') }],
    Array.from({ length: 10 }, (_, i) => att(`s${i}.png`)),
    [{ name: 'nodata.png' }],
    'not-array',
  ];
  for (const list of bads) {
    assert.throws(
      () => oncall.createDiscussion(dataDir, { title: 't', background: 'b', attachments: list, by: 'board' }),
      (e) => { assert.match(e.message, /图片|8MB|截图|数组|数据/); return true; },
      `非法附件应整单拒绝：${JSON.stringify(list).slice(0, 60)}`,
    );
  }
  assert.deepEqual(fs.readdirSync(tickets), [], '不留半成品目录');
  const d = oncall.createDiscussion(dataDir, { title: '重试', attachments: [att('ok.png')], by: 'board' });
  assert.match(d.id, /-001$/, '失败的创建不消耗单号');
});

t('S3 兼容：无 attachments 行为与旧版一致（question.md 仅背景、无顶层字段）；旧单轮次附件展示不受影响；无截图启动提示词无截图行', async () => {
  const { dataDir } = await mkProject();
  const oncall = await import(path.join(pluginRoot, 'scripts', 'lib', 'oncall-store.mjs'));
  const d = oncall.createDiscussion(dataDir, { title: '纯文字讨论', background: '纯文字背景', by: 'board' });
  assert.equal(fs.readFileSync(path.join(oncall.ticketDir(dataDir, d.id), 'question.md'), 'utf8'), '纯文字背景', '无附件不追加引用行');
  assert.equal(oncall.getTicket(dataDir, d.id).attachments, undefined, '不写顶层 attachments 字段');
  assert.deepEqual(oncall.discussionFull(dataDir, d.id).attachments, [], '全量视图兜底空数组');
  assert.ok(!oncall.buildStartPrompt(dataDir, d.id).includes('attachments'), '无截图提示词不带截图位置行');
  // 旧单（看板代答时期轮次附件）：列表 / 全量 / 提示词不受影响
  const old = oncall.createTicket(dataDir, { title: '旧单', question: 'q', attachments: [att('old.png')], by: 'board' });
  const cards = oncall.listDiscussions(dataDir);
  assert.equal(cards.length, 2, '新旧单都在讨论列表');
  const oldFull = oncall.discussionFull(dataDir, old.id);
  assert.equal(oldFull.legacyRounds.length, 1, '旧单轮次保留');
  assert.deepEqual(oldFull.legacyRounds[0].attachments, ['old.png'], '旧轮次附件不受顶层字段影响');
});

/* ================= 服务层 H1 ================= */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function httpReq(port, method, pathname, body) {
  return new Promise((resolve, reject) => {
    const payload = body == null ? null : JSON.stringify(body);
    const r = http.request({
      hostname: '127.0.0.1', port, path: pathname, method,
      headers: payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {},
      timeout: 8000,
    }, (rs) => {
      const chunks = [];
      rs.on('data', (c) => chunks.push(c));
      rs.on('end', () => {
        const buf = Buffer.concat(chunks);
        let json = null;
        try { json = JSON.parse(buf.toString() || '{}'); } catch {}
        resolve({ status: rs.statusCode, headers: rs.headers, buf, json });
      });
    });
    r.on('error', reject);
    r.on('timeout', () => { r.destroy(); reject(new Error('timeout')); });
    if (payload) r.write(payload);
    r.end();
  });
}

t('H1 POST /api/discussion 透传附件 + GET /api/discussion/:id/attachment/:name 原始字节；非法附件 400 整单拒绝；占位编号 400 业务错误', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'atb-disc-shot-serve-'));
  const root = path.join(tmp, 'proj');
  fs.mkdirSync(root);
  await new Promise((resolve) => {
    const p = spawn(process.execPath, [path.join(pluginRoot, 'scripts', 'atb.mjs'), 'init', '--dir', root], { stdio: 'ignore' });
    p.on('close', resolve);
  });
  const dataDir = path.join(root, 'docs', 'agent-team-board');
  const port = 33000 + Math.floor(Math.random() * 20000);
  const server = spawn(process.execPath, [path.join(pluginRoot, 'scripts', 'server.mjs')], {
    cwd: root,
    env: { ...process.env, ATB_PORT: String(port), ATB_REGISTRY: path.join(tmp, 'reg.json') },
    stdio: ['ignore', 'ignore', 'ignore'],
  });
  const P = `?project=${encodeURIComponent(root)}`;
  try {
    let up = false;
    for (let i = 0; i < 40; i++) {
      await sleep(150);
      try { await httpReq(port, 'GET', '/api/health'); up = true; break; } catch {}
    }
    assert.ok(up, '服务应启动');

    // 非法附件：400 整单拒绝，不留半成品
    let r = await httpReq(port, 'POST', `/api/discussion${P}`, { title: '坏附件', background: 'b', attachments: [att('x.txt')] });
    assert.equal(r.status, 400, '非白名单附件应 400');
    assert.match(r.json.error, /图片|附件/);
    assert.deepEqual(fs.readdirSync(path.join(dataDir, 'oncall', 'tickets')), [], '不留半成品讨论目录');

    // 合法创建：响应带 attachments，文件与引用行落盘
    r = await httpReq(port, 'POST', `/api/discussion${P}`, { title: '服务端讨论', background: '背景S', attachments: [att('a.png'), att('b.jpg')] });
    assert.equal(r.status, 200);
    const id = r.json.discussion.id;
    assert.match(id, /-001$/, '失败创建不占号');
    assert.deepEqual(r.json.discussion.attachments, ['a.png', 'b.jpg'], '响应带附件清单');
    assert.match(fs.readFileSync(path.join(dataDir, 'oncall', 'tickets', id, 'question.md'), 'utf8'), /!\[截图\]\(attachments\/a\.png\)/);

    // 附件端点：原始字节 + 白名单 MIME + nosniff + no-store
    const raw = Buffer.from(PNG, 'base64');
    r = await httpReq(port, 'GET', `/api/discussion/${id}/attachment/a.png${P}`);
    assert.equal(r.status, 200);
    assert.equal(r.headers['content-type'], 'image/png');
    assert.equal(r.headers['x-content-type-options'], 'nosniff');
    assert.equal(r.headers['cache-control'], 'no-store');
    assert.ok(r.buf.equals(raw), '返回原始字节');
    r = await httpReq(port, 'GET', `/api/discussion/${id}/attachment/nope.png${P}`);
    assert.equal(r.status, 400, '不存在附件业务错误');
    // 占位编号：新服务必为业务错误（预检探针口径），不得是「未知接口」404
    r = await httpReq(port, 'GET', `/api/discussion/ASK-20990101-999/attachment/probe.png${P}`);
    assert.equal(r.status, 400);
    assert.ok(!String(r.json.error || '').startsWith('未知接口'), '占位编号应为业务错误而非路由兜底 404');

    // 详情全量带附件
    r = await httpReq(port, 'GET', `/api/discussion/${id}${P}`);
    assert.deepEqual(r.json.discussion.attachments, ['a.png', 'b.jpg']);
  } finally {
    server.kill('SIGKILL');
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
  }
});

/* ================= 前端 U1~U3（app.js vm 接缝，item-shot-ui.test.mjs 同法） ================= */

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
    querySelector(selector) { if (!nodes.has(selector)) return nodes.set(selector, element()).get(selector); return nodes.get(selector); },
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

function setupApp() {
  const document = element();
  document.createElement = element;
  document.querySelector('#modalWrap').classList.add('hidden');
  const requests = [], notices = [];
  const sandbox = {
    document, URLSearchParams, console, setTimeout: () => 0, clearTimeout() {}, Date,
    location: { pathname: '/', search: '' }, history: { replaceState() {} }, localStorage: { setItem() {} },
    window: { addEventListener() {}, confirm: () => true },
    FileReader: class { readAsDataURL() {} },
    fetch: async (url, opts) => { requests.push({ url, opts }); return { ok: true, json: async () => ({ id: 'ASK-20990101-001' }) }; },
  };
  vm.createContext(sandbox);
  vm.runInContext(appSrc.split('/* ---------- 事件绑定与启动 ---------- */')[0], sandbox, { filename: 'app.js' });
  const run = (code) => vm.runInContext(code, sandbox);
  const state = run('state');
  state.project = '/project/a';
  state.board = { initialized: true, items: [] };
  sandbox.recordNotice = (message, error) => notices.push({ message, error });
  run('toast = recordNotice; setView = () => {}; poll = async () => {}; renderBoard = () => {}; renderDrawer = () => {}; refreshDrawer = async () => {}; updateBoardTabs = () => {};');
  sandbox.__stub = { reveal: async () => {} };
  run('window.ATBOncall = { reveal: __stub.reveal };');
  return { sandbox, document, run, requests, notices };
}

const DATA_PNG = 'data:image/png;base64,' + PNG;

t('U1 类型切换：讨论显示截图区块（与需求 / Bug 一致）；「创建并接受」讨论仍隐藏；静态契约去除 ask 隐藏分支', () => {
  const h = setupApp();
  h.run("$('#fType').value = 'ask'; syncNewFormFields();");
  assert.equal(h.document.querySelector('#fShotRow').classList.contains('hidden'), false, '讨论应显示截图区块');
  assert.equal(h.document.querySelector('#fSubmitAccept').classList.contains('hidden'), true, '讨论仍不显示创建并接受');
  h.run("$('#fType').value = 'req'; syncNewFormFields();");
  assert.equal(h.document.querySelector('#fShotRow').classList.contains('hidden'), false, '需求显示截图区块');
  assert.equal(h.document.querySelector('#fSubmitAccept').classList.contains('hidden'), false, '需求显示创建并接受');
  h.run("$('#fType').value = 'bug'; syncNewFormFields();");
  assert.equal(h.document.querySelector('#fShotRow').classList.contains('hidden'), false, 'Bug 显示截图区块');
  const fn = appSrc.slice(appSrc.indexOf('function syncNewFormFields'), appSrc.indexOf('function openModal'));
  assert.ok(!/shotRow[^;]*ask/.test(fn), 'syncNewFormFields 不得再按讨论隐藏截图区块');
  assert.match(htmlSrc, /id="fShotRow"/, '截图区块常驻新建表单');
});

t('U2 提交链路：讨论请求体按添加顺序携带 attachments[{name,dataBase64}]；无截图不带该字段（旧口径不变）', async () => {
  const h = setupApp();
  h.run("openModal('ask')");
  h.run(`shotAddFile({ name: 'a.png', size: 3, dataUrl: ${JSON.stringify(DATA_PNG)} });`);
  h.run("shotAddFile({ name: 'b.jpg', size: 4, dataUrl: 'data:image/jpeg;base64,Qg==' });");
  h.document.querySelector('#fType').value = 'ask';
  h.document.querySelector('#fTitle').value = '带截图讨论';
  h.document.querySelector('#fDesc').value = '背景';
  await h.run("submitNew({ preventDefault() {} })");
  const call = h.requests.find((r) => r.opts && r.opts.body && String(r.url).includes('/api/discussion'));
  assert.ok(call, '讨论应 POST /api/discussion');
  const body = JSON.parse(call.opts.body);
  assert.equal(body.title, '带截图讨论');
  assert.equal(body.background, '背景');
  assert.deepEqual(body.attachments, [
    { name: 'a.png', dataBase64: PNG },
    { name: 'b.jpg', dataBase64: 'Qg==' },
  ], '附件按添加顺序、dataURL 去前缀携带');
  assert.equal(h.run('shotBusy'), false, '收尾恢复添加/移除入口');

  // 无截图：不带 attachments 字段
  const g = setupApp();
  g.run("openModal('ask')");
  g.document.querySelector('#fType').value = 'ask';
  g.document.querySelector('#fTitle').value = '纯文字讨论';
  await g.run("submitNew({ preventDefault() {} })");
  const call2 = g.requests.find((r) => r.opts && r.opts.body && String(r.url).includes('/api/discussion'));
  assert.ok(call2, '无截图讨论仍走 /api/discussion');
  assert.equal('attachments' in JSON.parse(call2.opts.body), false, '无截图不带 attachments 字段');
});

t('U3 过旧服务预检：带截图 +「未知接口」404 → 拒绝提交给 atb serve 指引、弹窗与截图保留；新服务业务错误放行；无截图不预检', async () => {
  // U3a 过旧：预检 404「未知接口」→ 不发创建请求
  const a = setupApp();
  a.run("openModal('ask')");
  a.run(`shotAddFile({ name: 'a.png', size: 3, dataUrl: ${JSON.stringify(DATA_PNG)} })`);
  a.sandbox.fetch = async (url, opts) => {
    a.requests.push({ url, opts });
    if (String(url).includes('/api/discussion/') && String(url).includes('/attachment/')) {
      return { ok: false, status: 404, json: async () => ({ error: '未知接口：GET /api/discussion/ASK-20990101-999/attachment/probe.png' }) };
    }
    return { ok: true, status: 200, json: async () => ({ discussion: { id: 'ASK-20990101-001' } }) };
  };
  a.document.querySelector('#fType').value = 'ask';
  a.document.querySelector('#fTitle').value = '带截图';
  await a.run("submitNew({ preventDefault() {} })");
  assert.ok(!a.requests.some((r) => r.opts && r.opts.body), '过旧时不得发出创建请求（会静默丢截图）');
  assert.ok(a.requests.some((r) => String(r.url).includes('/attachment/')), '应先预检讨论附件端点');
  assert.equal(a.notices.length, 1, '应弹一条错误 toast');
  assert.match(String(a.notices[0].message), /创建失败/, '文案保持创建失败口径');
  assert.match(String(a.notices[0].message), /版本过旧/, '应说明服务版本过旧');
  assert.match(String(a.notices[0].message), /atb serve/, '应给出 atb serve 自愈指引');
  assert.equal(a.run('newShots.length'), 1, '失败保留截图供重试');
  assert.equal(a.run('shotBusy'), false, '收尾恢复添加/移除入口');
  assert.equal(a.document.querySelector('#fSubmit').disabled, false, '收尾恢复创建按钮');
  assert.equal(a.document.querySelector('#modalWrap').classList.contains('hidden'), false, '弹窗保留（未关闭）');

  // U3b 新服务：预检 400 业务错误 → 照常提交且携带附件
  const b = setupApp();
  b.run("openModal('ask')");
  b.run(`shotAddFile({ name: 'b.png', size: 3, dataUrl: ${JSON.stringify(DATA_PNG)} })`);
  b.sandbox.fetch = async (url, opts) => {
    b.requests.push({ url, opts });
    if (String(url).includes('/api/discussion/') && String(url).includes('/attachment/')) {
      return { ok: false, status: 400, json: async () => ({ error: '找不到咨询单：ASK-20990101-999' }) };
    }
    return { ok: true, status: 200, json: async () => ({ discussion: { id: 'ASK-20990101-002' } }) };
  };
  b.document.querySelector('#fType').value = 'ask';
  b.document.querySelector('#fTitle').value = '带截图';
  await b.run("submitNew({ preventDefault() {} })");
  const call = b.requests.find((r) => r.opts && r.opts.body);
  assert.ok(call, '新服务应照常创建');
  assert.deepEqual(JSON.parse(call.opts.body).attachments, [{ name: 'b.png', dataBase64: PNG }], '附件随创建提交');

  // U3c 网络异常：预检抛错放行，交由创建请求成败说话
  const c = setupApp();
  c.run("openModal('ask')");
  c.run(`shotAddFile({ name: 'c.png', size: 3, dataUrl: ${JSON.stringify(DATA_PNG)} })`);
  c.sandbox.fetch = async (url, opts) => {
    c.requests.push({ url, opts });
    if (String(url).includes('/attachment/')) throw new Error('network down');
    return { ok: true, status: 200, json: async () => ({ discussion: { id: 'ASK-20990101-003' } }) };
  };
  c.document.querySelector('#fType').value = 'ask';
  c.document.querySelector('#fTitle').value = '带截图';
  await c.run("submitNew({ preventDefault() {} })");
  assert.ok(c.requests.some((r) => r.opts && r.opts.body), '预检网络异常应放行创建');
  assert.match(String(c.notices[0].message), /已创建/, '创建成功不被预检打断');

  // U3d 无截图：不做预检请求（旧口径创建不受影响）
  const d = setupApp();
  d.run("openModal('ask')");
  d.document.querySelector('#fType').value = 'ask';
  d.document.querySelector('#fTitle').value = '纯文字';
  await d.run("submitNew({ preventDefault() {} })");
  assert.ok(!d.requests.some((r) => String(r.url).includes('/attachment/')), '无截图不应预检');
  assert.ok(d.requests.some((r) => r.opts && r.opts.body), '无截图直接创建');

  // U3e 静态契约：submitNew 讨论路径调用预检（防回归静默丢数据）
  const fn = appSrc.slice(appSrc.indexOf('async function submitNew'), appSrc.indexOf('/* ---------- 批量开发抽屉'));
  assert.match(fn, /discussionServeSupportsAttachments/, '讨论提交应经预检函数拦截过旧服务');
});

/* ================= 前端 U4（oncall.js vm 接缝，discussion-ui.test.mjs 同法） ================= */

// 详情容器桩：querySelectorAll('img') 按当前 innerHTML 解析 <img src="…"> 并缓存
// （innerHTML 不变期间返回同一批元素，linkupDiscImages 的改写 / 监听可被后续断言读到）
function detailElement() {
  const el = element();
  let parsedFor = null;
  let parsedImgs = [];
  el.querySelectorAll = (sel) => {
    if (sel !== 'img') return [];
    if (parsedFor !== el.innerHTML) {
      parsedFor = el.innerHTML;
      parsedImgs = [];
      const re = /<img\s[^>]*?src="([^"]*)"[^>]*>/g;
      let m;
      while ((m = re.exec(el.innerHTML || ''))) {
        const img = element();
        img.setAttribute('src', m[1]);
        img.src = m[1];
        parsedImgs.push(img);
      }
    }
    return parsedImgs;
  };
  return el;
}

function setupOncall({ board, detail }) {
  const document = element();
  document.createElement = element;
  document.body = element();
  const nodeMap = new Map();
  document.querySelector = (sel) => nodeMap.get(sel) ?? null;
  document.addEventListener = () => {};
  const wrap = detailElement();
  const sandbox = {
    document, console, URLSearchParams, CustomEvent: class { constructor(type, o) { this.type = type; this.detail = o && o.detail; } },
    setTimeout: () => 0, clearTimeout() {},
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    marked: { parse: (s) => String(s || '') },
    fetch: async (url) => {
      if (String(url).includes('/api/discussion/board')) return { ok: true, json: async () => board };
      if (detail && String(url).includes('/api/discussion/')) return { ok: true, json: async () => ({ discussion: detail }) };
      return { ok: true, json: async () => ({}) };
    },
    navigator: { clipboard: { writeText: async () => {} } },
  };
  sandbox.dispatchEvent = () => {}; // window.dispatchEvent（openItem 快照广播接缝）
  sandbox.window = sandbox;
  nodeMap.set('#oncallView', element());
  nodeMap.set('#ocList', element());
  nodeMap.set('#ocDetail', wrap);
  nodeMap.set('#discMask', element());
  nodeMap.set('#oncallLightbox', element());
  vm.createContext(sandbox);
  vm.runInContext(oncallSrc, sandbox, { filename: 'oncall.js' });
  return { sandbox, wrap };
}

const discShot = (id, over = {}) => ({
  id, title: `t-${id}`, status: 'discussing',
  createdAt: '2026-09-10T00:00:00.000Z', updatedAt: '2026-09-10T01:00:00.000Z',
  phase: 'none', waiting: false, draftCount: 0, createdCount: 0, roundCount: 0,
  minutes: { content: null, version: 0, updatedAt: null, stale: false },
  rounds: [], legacyRounds: [], created: [], candidates: [],
  outcome: { state: 'waiting', reason: null }, history: [],
  startPrompt: '', finishPrompt: '', continuePrompt: '', organizePrompt: '',
  ...over,
});

t('U4 讨论详情背景截图接管：相对 attachments/ 改写为讨论附件端点、点击放大、加载失败占位；绝对地址不接管；旧讨论无相对图不受影响', async () => {
  const id = 'ASK-20260910-001';
  const detail = discShot(id, {
    background: '<img src="attachments/a%20b.png"><img src="https://x.test/a.png">',
    attachments: ['a b.png'],
  });
  const board = { initialized: true, discussions: [discShot(id)] };
  const { sandbox: h, wrap } = setupOncall({ board, detail });
  await h.ATBOncall.poll('/project/d', true);
  h.ATBOncall.openItem(id);
  await new Promise((r) => setTimeout(r, 30)); // 等 refreshDetail → renderDetail → linkupDiscImages

  const imgs = wrap.querySelectorAll('img');
  assert.equal(imgs.length, 2, '背景 markdown 渲染出两张图');
  const rel = imgs[0];
  const httpImg = imgs[1];
  const want = `/api/discussion/${id}/attachment/${encodeURIComponent('a b.png')}?project=${encodeURIComponent('/project/d')}`;
  assert.equal(rel.src, want, '相对引用改写为讨论附件端点（解码后重新编码）');
  assert.equal(rel.classList.contains('doc-shot'), true, '接管图加 doc-shot 样式类');
  assert.equal(httpImg.src, 'https://x.test/a.png', 'http 绝对地址不接管');

  // 点击放大：#oncallLightbox
  for (const fn of rel.listeners.click || []) fn({ target: rel });
  const box = h.document.querySelector('#oncallLightbox');
  assert.equal(box.classList.contains('hidden'), false, '点击应显示放大层');
  assert.equal(box.querySelector('img').src, rel.src, '放大层显示同一 URL');

  // 加载失败占位：不渲染空白破图
  for (const fn of rel.listeners.error || []) fn({ target: rel });
  assert.ok(rel.replacedWith && rel.replacedWith.length === 1, '失败图应被替换为占位元素');
  assert.match(String(rel.replacedWith[0].textContent), /无法加载/, '占位应说明加载失败');

  // 旧讨论（背景无引用行）：渲染无相对 img 可接管，流程不报错
  const oldId = 'ASK-20260901-001';
  const oldBoard = { initialized: true, discussions: [discShot(oldId)] };
  const oldDetail = discShot(oldId, { background: '纯文字背景', attachments: [] });
  const o = setupOncall({ board: oldBoard, detail: oldDetail });
  await o.sandbox.ATBOncall.poll('/project/d', true);
  o.sandbox.ATBOncall.openItem(oldId);
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(o.wrap.querySelectorAll('img').length, 0, '旧讨论无图不受影响');

  // 静态契约：renderDetail 渲染后调用接管（背景 markdown 相对图必经此路径）
  assert.match(oncallSrc, /function linkupDiscImages/, 'oncall.js 应提供讨论截图接管函数');
  const rd = oncallSrc.slice(oncallSrc.indexOf('function renderDetail'), oncallSrc.indexOf('function minutesHtml'));
  assert.match(rd, /linkupDiscImages/, 'renderDetail 应调用接管函数');
});

let failed = 0;
for (const [name, fn] of cases) {
  try {
    await fn();
    console.log(`✓ ${name}`);
  } catch (e) {
    failed++;
    console.error(`✗ ${name}\n  ${e && e.stack ? e.stack.split('\n').slice(0, 6).join('\n  ') : e}`);
  }
}
console.log(failed ? `\n${failed} 个用例未通过` : '\n全部通过');
process.exitCode = failed ? 1 : 0;
