#!/usr/bin/env node
// REQ-20260907-011 待接受改标题 + 驳回接受（accepted → submitted）
// 用法：node scripts/tests/rename-reject.test.mjs
// 覆盖 test-cases.md 的 R1–R8、U1–U3。
// 模式对齐：core 集成（actor-name）+ 真实服务 HTTP（dispatch-api）+ UI 静态/沙箱（pending-accept-inline / accept-ui）。

import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import * as core from '../lib/core.mjs';

const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SERVER = path.join(PLUGIN_ROOT, 'scripts', 'server.mjs');
const ATB_CLI = fs.readFileSync(path.join(PLUGIN_ROOT, 'scripts', 'atb.mjs'), 'utf8');
const APP_JS = fs.readFileSync(path.join(PLUGIN_ROOT, 'scripts', 'web', 'app.js'), 'utf8');

const cases = [];
const t = (name, fn) => cases.push([name, fn]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function tempProject(tag) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `atb-rename-${tag}-`));
  core.initData(root);
  return { root, dataDir: core.dataDirFrom(root) };
}

const firstLine = (dir, name) => fs.readFileSync(path.join(dir, name), 'utf8').split('\n')[0];

// ---------- core：改标题（R1–R4） ----------

t('R1 submitted 需求改标题：status.title、history 留痕、三份文档首行同步', () => {
  const { dataDir } = tempProject('r1');
  const it = core.createItem(dataDir, { type: 'requirement', title: '旧标题甲', by: 'test' });
  const st = core.renameItem(dataDir, it.id, { title: '新标题乙', by: 'human' });
  assert.equal(st.title, '新标题乙', 'status.title 应更新');
  assert.equal(st.status, 'submitted', '改标题不得变更状态');
  const dir = core.resolveItemDir(dataDir, it.id).dir;
  assert.equal(firstLine(dir, 'README.md'), `# ${it.id} 新标题乙`, 'README 首行同步');
  assert.equal(firstLine(dir, 'design.md'), `# 设计 — ${it.id} 新标题乙`, 'design 首行同步');
  assert.equal(firstLine(dir, 'test-cases.md'), `# 测试用例 — ${it.id} 新标题乙`, 'test-cases 首行同步');
  const tail = st.history.at(-1);
  assert.equal(`${tail.from}->${tail.to}`, 'submitted->submitted', 'history 追加留痕记录');
  assert.match(tail.note, /新标题乙|旧标题甲/, '留痕应能追溯标题变更');
  assert.equal(core.readStatus(dir).title, '新标题乙', '落盘的 status.json 应同步');
});

t('R2 submitted Bug（独立与归属需求）改标题：README 首行同步', () => {
  const { dataDir } = tempProject('r2');
  const req = core.createItem(dataDir, { type: 'requirement', title: '宿主需求', by: 'test' });
  const alone = core.createItem(dataDir, { type: 'bug', title: '独立旧题', by: 'test' });
  const nested = core.createItem(dataDir, { type: 'bug', title: '归属旧题', by: 'test' });
  core.moveBug(dataDir, nested.id, req.id); // REQ-20260908-009：归属 Bug 经 move 构造（存量形态）
  core.renameItem(dataDir, alone.id, { title: '独立新题', by: 'human' });
  core.renameItem(dataDir, nested.id, { title: '归属新题', by: 'human' });
  assert.equal(firstLine(core.resolveItemDir(dataDir, alone.id).dir, 'README.md'), `# ${alone.id} 独立新题`);
  assert.equal(firstLine(core.resolveItemDir(dataDir, nested.id).dir, 'README.md'), `# ${nested.id} 归属新题`);
  assert.equal(core.listItems(dataDir).find((x) => x.id === alone.id).title, '独立新题', '列表口径同步');
});

t('R3 非 submitted 状态拒绝改标题：accepted / in-progress / done', () => {
  const { dataDir } = tempProject('r3');
  // accepted：无认领直接测
  const acc = core.createItem(dataDir, { type: 'requirement', title: '状态accepted', by: 'test' });
  core.setStatus(dataDir, acc.id, 'accepted', { by: 'human' });
  // in-progress：认领占用实施互斥，report 收尾释放（状态保持 in-progress）
  const dev = core.createItem(dataDir, { type: 'requirement', title: '状态in-progress', by: 'test' });
  core.setStatus(dataDir, dev.id, 'accepted', { by: 'human' });
  core.claim(dataDir, dev.id, 'tester');
  core.report(dataDir, dev.id, { summary: '收尾释放实施互斥', by: 'tester' });
  // done：确认完成自动释放实施互斥
  const fin = core.createItem(dataDir, { type: 'requirement', title: '状态done', by: 'test' });
  core.setStatus(dataDir, fin.id, 'accepted', { by: 'human' });
  core.claim(dataDir, fin.id, 'tester');
  core.setStatus(dataDir, fin.id, 'done', { by: 'human' });

  for (const id of [acc.id, dev.id, fin.id]) {
    const st = core.getItemDetail(dataDir, id);
    assert.throws(() => core.renameItem(dataDir, id, { title: '改不掉', by: 'human' }), core.AtbError, `${st.status} 应拒绝`);
    assert.equal(core.getItemDetail(dataDir, id).title, st.title, `${st.status} 标题应保持不变`);
  }
});

t('R4 标题校验：空、超 120 字、与原标题相同均拒绝', () => {
  const { dataDir } = tempProject('r4');
  const it = core.createItem(dataDir, { type: 'requirement', title: '原标题', by: 'test' });
  assert.throws(() => core.renameItem(dataDir, it.id, { title: '   ', by: 'human' }), /标题不能为空/);
  assert.throws(() => core.renameItem(dataDir, it.id, { title: '长'.repeat(121), by: 'human' }), /120/);
  assert.throws(() => core.renameItem(dataDir, it.id, { title: '原标题', by: 'human' }), /相同/);
  assert.equal(core.readStatus(core.resolveItemDir(dataDir, it.id).dir).title, '原标题', '失败请求不得落盘');
});

// ---------- core：驳回接受（R5–R6） ----------

t('R5 驳回接受：accepted → submitted 成功且 history 留痕（需求与 Bug 一致）', () => {
  const { dataDir } = tempProject('r5');
  const req = core.createItem(dataDir, { type: 'requirement', title: '误接受需求', by: 'test' });
  const bug = core.createItem(dataDir, { type: 'bug', title: '误接受 Bug', by: 'test' });
  for (const id of [req.id, bug.id]) core.setStatus(dataDir, id, 'accepted', { by: 'human' });
  for (const id of [req.id, bug.id]) {
    const { changed, status: st } = core.setStatus(dataDir, id, 'submitted', { by: 'human' });
    assert.equal(changed, true);
    assert.equal(st.status, 'submitted');
    const tail = st.history.at(-1);
    assert.equal(`${tail.from}->${tail.to}`, 'accepted->submitted', 'history 记录回退边');
  }
  // 驳回后可再次接受（往返一致）
  const again = core.setStatus(dataDir, req.id, 'accepted', { by: 'human' });
  assert.equal(again.status.status, 'accepted');
});

t('R6 不可跳级驳回：in-progress / done → submitted 拒绝', () => {
  const { dataDir } = tempProject('r6');
  const mkDone = () => {
    const it = core.createItem(dataDir, { type: 'requirement', title: '走到底', by: 'test' });
    core.setStatus(dataDir, it.id, 'accepted', { by: 'human' });
    core.claim(dataDir, it.id, 'tester');
    core.setStatus(dataDir, it.id, 'done', { by: 'human' });
    return it.id;
  };
  const dev = mkDone();
  core.setStatus(dataDir, dev, 'in-progress', { by: 'human' }); // 驳回完成回开发
  assert.throws(() => core.setStatus(dataDir, dev, 'submitted', { by: 'human' }), core.AtbError, 'in-progress 应拒绝');
  const done = mkDone();
  assert.throws(() => core.setStatus(dataDir, done, 'submitted', { by: 'human' }), core.AtbError, 'done 应拒绝');
});

// ---------- server HTTP 集成（R7） ----------

function httpRequest(port, method, p, body) {
  return new Promise((resolve, reject) => {
    const payload = body == null ? null : JSON.stringify(body);
    const rq = http.request({
      hostname: '127.0.0.1', port, path: p, method,
      headers: payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {},
      timeout: 5000,
    }, (rs) => {
      let out = '';
      rs.on('data', (c) => { out += c; });
      rs.on('end', () => resolve({ code: rs.statusCode, body: out }));
    });
    rq.on('error', reject);
    rq.on('timeout', () => { rq.destroy(); reject(new Error('request timeout')); });
    if (payload) rq.write(payload);
    rq.end();
  });
}

t('R7 服务端：POST /api/item/:id/title 成功与拒绝；accepted → submitted 放行、in-progress → submitted 拒绝', async () => {
  const { root, dataDir } = tempProject('r7');
  const sub = core.createItem(dataDir, { type: 'requirement', title: '待接受标题', by: 'test' });
  const acc = core.createItem(dataDir, { type: 'bug', title: '已接受标题', by: 'test' });
  const dev = core.createItem(dataDir, { type: 'requirement', title: '开发中标题', by: 'test' });
  core.setStatus(dataDir, acc.id, 'accepted', { by: 'human' });
  core.setStatus(dataDir, dev.id, 'accepted', { by: 'human' });
  core.claim(dataDir, dev.id, 'tester');

  const port = 24000 + Math.floor(Math.random() * 8000);
  const registry = path.join(os.tmpdir(), `atb-reg-${process.pid}-${Math.random().toString(16).slice(2)}.json`);
  const child = spawn(process.execPath, [SERVER], {
    cwd: root,
    env: { ...process.env, ATB_PORT: String(port), ATB_HOST: '127.0.0.1', ATB_REGISTRY: registry },
    stdio: ['ignore', 'ignore', 'ignore'],
  });
  try {
    let up = false;
    for (let i = 0; i < 50 && !up; i++) {
      await sleep(100);
      up = await httpRequest(port, 'GET', '/api/health').then((r) => r.code === 200).catch(() => false);
    }
    assert.ok(up, '测试服务应启动');

    const ok = await httpRequest(port, 'POST', `/api/item/${sub.id}/title`, { title: '改后标题' });
    assert.equal(ok.code, 200, `待接受改标题应成功：${ok.body}`);
    assert.equal(core.readStatus(core.resolveItemDir(dataDir, sub.id).dir).title, '改后标题', '服务端写入生效');

    const badState = await httpRequest(port, 'POST', `/api/item/${acc.id}/title`, { title: '不应生效' });
    assert.equal(badState.code, 400, '非 submitted 改标题应按业务错误返回 400');
    const badTitle = await httpRequest(port, 'POST', `/api/item/${sub.id}/title`, { title: '' });
    assert.equal(badTitle.code, 400, '空标题应返回 400');

    const reject = await httpRequest(port, 'POST', `/api/item/${acc.id}/status`, { to: 'submitted' });
    assert.equal(reject.code, 200, `驳回接受应放行：${reject.body}`);
    assert.equal(core.readStatus(core.resolveItemDir(dataDir, acc.id).dir).status, 'submitted');

    const blocked = await httpRequest(port, 'POST', `/api/item/${dev.id}/status`, { to: 'submitted' });
    assert.equal(blocked.code, 403, '网页端 in-progress → submitted 应被网页流转白名单拒绝');
  } finally {
    child.kill();
    try { fs.rmSync(root, { recursive: true, force: true }); } catch {}
    try { fs.rmSync(registry, { force: true }); } catch {}
  }
});

// ---------- CLI 静态契约（R8） ----------

t('R8 CLI：atb rename 子命令登记于 usage 并调用 core.renameItem', () => {
  assert.match(ATB_CLI, /atb rename <ID> <新标题>/, 'usage 应登记 rename');
  assert.match(ATB_CLI, /cmd === 'rename'/, '应分发 rename 子命令');
  assert.match(ATB_CLI, /core\.renameItem\(/, '应调用 core.renameItem');
});

// ---------- UI 静态契约（U1/U2/U3 前半） ----------

t('U1 UI 静态：submitted 卡片与详情页渲染改标题按钮（REQ-20260908-011 起为标题/描述编辑入口）', () => {
  const row = APP_JS.match(/function reqRowEl\(it\) \{[\s\S]*?\n\}/)?.[0] || '';
  assert.match(row, /\$\{it\.status === 'submitted' \? `[^`]*data-rename-id=/, 'submitted 卡片应有改标题按钮');
  const drawerBtn = APP_JS.match(/function drawerActionsButtonHtml\(it\) \{[\s\S]*?\n\}/)?.[0] || '';
  assert.match(drawerBtn, /case 'submitted':[\s\S]*data-act="accepted"[\s\S]*data-rename-id=/, '详情页 submitted 应有改标题按钮');
  // REQ-20260908-011：前端入口升级为标题 + 描述编辑，提交走 /content（editItem 详见 edit-content.test.mjs；
  // REQ-20260911-001 起容器为 #editModalWrap 侧拉面板，editItem 增加 opener 焦点锚点参数）
  assert.match(APP_JS, /async function editItem\(/, '应存在编辑提交函数');
  assert.match(APP_JS, /\/api\/item\/\$\{encodeURIComponent\(id\)\}\/content/, '提交应走 /api/item/:id/content');
});

t('U2 UI 静态：详情页 accepted 渲染驳回接受按钮；标签与撤销覆盖 accepted → submitted', () => {
  const drawerBtn = APP_JS.match(/function drawerActionsButtonHtml\(it\) \{[\s\S]*?\n\}/)?.[0] || '';
  assert.match(drawerBtn, /case 'accepted':[\s\S]*data-act="submitted"/, '详情页 accepted 应有驳回接受按钮');
  assert.match(APP_JS, /'submitted': '驳回接受/, 'ACTION_LABEL 应含驳回接受');
  assert.match(APP_JS, /ACTION_UNDO = \{[\s\S]*?accepted: \{ to: 'submitted' \}/, '接受操作应支持撤销为驳回');
});

t('U3 UI 静态：页内异步输入面板（不用同步 window.prompt），非 submitted 无改标题按钮', () => {
  // REQ-20260908-011 页内自绘双字段表单；REQ-20260911-001 容器迁 #editModalWrap 右侧侧拉面板（居中 uiEditForm 下线）
  assert.match(APP_JS, /\$\('#editModalWrap'\)/, '应提供页面内编辑侧拉面板');
  assert.ok(!APP_JS.includes('uiEditForm'), '居中编辑弹窗应随 REQ-20260911-001 下线');
  assert.doesNotMatch(APP_JS, /window\.prompt\(/, 'IAB 内禁用同步 prompt');
  const row = APP_JS.match(/function reqRowEl\(it\) \{[\s\S]*?\n\}/)?.[0] || '';
  const onlySubmitted = row.match(/\$\{it\.status === 'submitted' \? `([^`]*)` : ''\}/g) || [];
  assert.ok(onlySubmitted.some((s) => s.includes('data-rename-id')), '改标题按钮应在 submitted 条件分支内');
});

// ---------- UI 沙箱（U1 后半：提交流程） ----------

function element() {
  const nodes = new Map();
  const classes = new Set();
  return {
    dataset: {}, innerHTML: '', textContent: '', value: '', disabled: false, checked: false,
    children: [], listeners: {},
    classList: { add: (v) => classes.add(v), remove: (v) => classes.delete(v), contains: (v) => classes.has(v), toggle: (v, on) => on ? classes.add(v) : classes.delete(v) },
    addEventListener(event, fn) { this.listeners[event] = fn; },
    removeEventListener() {},
    querySelector(selector) { if (!nodes.has(selector)) nodes.set(selector, element()); return nodes.get(selector); },
    querySelectorAll() { return []; },
    appendChild(child) { this.children.push(child); },
    remove() {},
    replaceChildren(...children) { this.children = children; },
    setAttribute() {}, removeAttribute() {}, focus() {},
    fire(event) { const e = { target: this, currentTarget: this, stopped: false, stopPropagation() { this.stopped = true; } }; return { e, result: this.listeners[event]?.(e) }; },
  };
}

function uiSetup() {
  const source = APP_JS;
  const document = element();
  document.createElement = element;
  document.body = element();
  const requests = [];
  const sandbox = { document, URLSearchParams, console, setTimeout: () => 0, clearTimeout() {},
    location: { pathname: '/', search: '' }, history: { replaceState() {} }, localStorage: { setItem() {} },
    window: { addEventListener() {}, removeEventListener() {}, confirm: () => true },
    fetch: async (url, opts) => { requests.push({ url, opts }); return { ok: true, json: async () => ({}) }; },
  };
  vm.createContext(sandbox);
  vm.runInContext(source.split('/* ---------- 事件绑定与启动 ---------- */')[0], sandbox, { filename: 'app.js' });
  const run = (code) => vm.runInContext(code, sandbox);
  const state = run('state');
  state.project = '/project/a';
  state.board = { initialized: true, items: [
    { id: 'REQ-20990101-001', type: 'requirement', status: 'submitted', title: '旧标题' },
    { id: 'REQ-20990101-002', type: 'requirement', status: 'accepted', title: '已接受' },
  ] };
  run('toast = () => {}; updateBoardTabs = () => {}; markActiveTab = () => {}; refreshHealth = async () => {}; refreshDrawer = async () => {}; poll = async () => {};');
  return { sandbox, state, run, requests };
}

t('U1/U3 沙箱：editItem 开侧拉面板、提交 title + description 到专属端点；取消与空值不发请求', async () => {
  const h = uiSetup();
  // REQ-20260908-011：renameItem 升级为 editItem（双字段表单）；REQ-20260911-001 容器迁 #editModalWrap 侧拉面板；
  // 预填描述先 GET README 全文，stub 需返回含「## 描述」节的文档
  const DOC = '# REQ-20990101-001 旧标题\n\n## 描述\n\n旧描述\n\n## 验收标准\n';
  h.sandbox.fetch = async (url, opts) => {
    h.requests.push({ url: String(url), opts });
    const json = String(url).includes('/doc/README.md') ? { content: DOC } : {};
    return { ok: true, json: async () => json };
  };
  await h.run("editItem('REQ-20990101-001')");
  assert.equal(h.run("$('#eTitle').value"), '旧标题', '面板应预填当前标题');
  assert.equal(h.run("$('#eDesc').value"), '旧描述', '面板应预填 README 描述节');
  h.run("$('#eTitle').value = '新标题-R'");
  h.run("$('#eDesc').value = '新描述'");
  await h.run('submitEditPanel()');
  const writes = h.requests.filter((r) => String(r.url).includes('/content'));
  assert.equal(writes.length, 1, '确认后应发一次写请求');
  const req = writes[0];
  assert.match(req.url, /\/api\/item\/REQ-20990101-001\/content\?project=%2Fproject%2Fa$/);
  assert.equal(req.opts.method, 'POST');
  assert.equal(JSON.parse(req.opts.body).title, '新标题-R', '应提交输入的新标题');

  await h.run("editItem('REQ-20990101-001')"); // 重新打开读取当前已保存内容
  h.run('closeEditPanel()'); // 取消：不发写请求
  await h.run("editItem('REQ-20990101-001')");
  h.run("$('#eTitle').value = ''"); // 空标题确认：面板内拦截
  await h.run('submitEditPanel()');
  assert.equal(h.run("$('#editMsg').textContent"), '标题不能为空', '空标题应面板内提示');
  assert.equal(h.requests.filter((r) => String(r.url).includes('/content')).length, 1, '取消与空输入不应发写请求');
});

let failed = 0;
for (const [name, fn] of cases) {
  try { await fn(); console.log(`✓ ${name}`); }
  catch (e) { failed++; console.error(`✗ ${name}\n${e.stack}`); }
}
console.log(`\n${cases.length} 个用例，失败 ${failed}`);
process.exitCode = failed ? 1 : 0;
