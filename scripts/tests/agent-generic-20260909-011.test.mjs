#!/usr/bin/env node
// REQ-20260909-011 契约测试 —— 批量完善/批量开发提示词通用化（不再区分 Agent）+ 设置去 Agent 配置
// 覆盖（test-cases.md A–G）：
//   提示词：单一通用版本（无执行端字样）、调度要素保留、FOLLOW 行措辞通用化
//   账本：新批次 mode/agent 记 subagent；refine 幂等去 Agent 化；直连兼容
//   CLI / 服务端：创建入口固定通用口径；mode/agent 入参忽略；settings POST 忽略 agents/models
//   界面：设置区精简（仅流转开关）、启动区/终态去 Agent 化、概况行新批次通用展示
// 用法：node scripts/tests/agent-generic-20260909-011.test.mjs

import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import * as core from '../lib/core.mjs';
import * as batch from '../lib/batch.mjs';
import * as refine from '../lib/refine-store.mjs';
import * as taskSettings from '../lib/task-settings.mjs';

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const ATB = path.join(pluginRoot, 'scripts', 'atb.mjs');
const source = fs.readFileSync(path.join(pluginRoot, 'scripts', 'web', 'app.js'), 'utf8');

const AGENT_WORDS = /zcode|Zcode|codex|Codex|general-purpose/;

const cases = [];
const t = (name, fn) => cases.push([name, fn]);

// ---------- 脚手架 ----------

function mkProject(prefix = 'atb-ag-') {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  core.initData(root);
  const dataDir = core.dataDirFrom(root);
  return { root, dataDir };
}

function mkPlanned(dataDir, title) {
  const st = core.createItem(dataDir, { type: 'requirement', title, description: 'x', by: 'tester' });
  core.setStatus(dataDir, st.id, 'accepted', { by: 'tester' });
  core.setStatus(dataDir, st.id, 'planned', { by: 'tester' });
  return st.id;
}

function mkAccepted(dataDir, title) {
  const st = core.createItem(dataDir, { type: 'requirement', title, description: 'x', by: 'tester' });
  core.setStatus(dataDir, st.id, 'accepted', { by: 'tester' });
  return st.id;
}

function atbJson(args, cwd) {
  const r = spawnSync(process.execPath, [ATB, ...args, '--dir', cwd, '--json'], { encoding: 'utf8', timeout: 30_000 });
  assert.equal(r.status, 0, `atb ${args.join(' ')} 应成功（${r.stderr || r.stdout}）`);
  return JSON.parse(r.stdout.split('\n').filter(Boolean).pop());
}

// ---------- A 通用提示词（数据层） ----------

t('A1 通用完善提示词：单一版本——不传 agent 与传 zcode/codex 输出完全一致；不含执行端字样', () => {
  const base = { projectRoot: '/tmp/p', batchId: 'RFB-20260909-001', modelSource: 'follow' };
  const plain = refine.buildRefinePrompt(base);
  const asZ = refine.buildRefinePrompt({ ...base, agent: 'zcode' });
  const asC = refine.buildRefinePrompt({ ...base, agent: 'codex' });
  assert.equal(plain, asZ, 'agent=zcode 输出与通用版一致（参数忽略）');
  assert.equal(plain, asC, 'agent=codex 输出与通用版一致（参数忽略）');
  assert.doesNotMatch(plain, AGENT_WORDS, '通用提示词不得出现执行端字样');
});

t('A2 通用完善提示词调度要素保留：路径/批次/CLI 约定/通用领取前缀/回执/硬性约束/核对与 nextAction', () => {
  const p = refine.buildRefinePrompt({ projectRoot: '/tmp/p', batchId: 'RFB-20260909-002', developer: '张三', modelSource: 'follow' });
  assert.ok(p.includes('/tmp/p'), '项目路径');
  assert.ok(p.includes('RFB-20260909-002'), '批次标识');
  // REQ-20260910-027：开发人员设置已移除——传 developer 也不生成会话命名指令（参数忽略）
  assert.ok(!p.includes('请将当前会话名改为'), '开发人员会话命名指令已移除');
  assert.match(p, /CLI 约定：atb 指 node /, 'CLI 约定');
  assert.ok(p.includes('atb refine next --by refine-<批次尾号>-<序号>'), '领取命令使用单一通用前缀');
  assert.ok(!p.includes('zcode-refine') && !p.includes('codex-refine'), '不再出现按 Agent 差异化的领取前缀');
  assert.ok(p.includes('atb refine done'), '完成回执');
  assert.ok(p.includes('atb refine fail'), '失败回执');
  assert.ok(p.includes('保持 accepted'), '硬性约束：条目保持已接受');
  assert.ok(p.includes('atb refine check --batch RFB-20260909-002'), '主会话核对入口');
  assert.ok(p.includes('nextAction=continue'), 'nextAction 处置');
  assert.ok(p.includes('子代理'), '子代理口径描述词');
  assert.ok(p.includes('主调度会话'), '主调度会话描述词');
});

t('A3 通用开发提示词：单一版本（agent 参数忽略）；无执行端字样；调度要素与 nextBatch 接续保留', () => {
  const base = { projectRoot: '/tmp/p', batchId: 'batch-20260909-001', workerSpecPath: '/tmp/spec.md', modelSource: 'follow' };
  const plain = batch.generatePrompt(base);
  assert.equal(plain, batch.generatePrompt({ ...base, agent: 'zcode' }), 'agent=zcode 输出一致');
  assert.equal(plain, batch.generatePrompt({ ...base, agent: 'codex' }), 'agent=codex 输出一致');
  assert.doesNotMatch(plain, AGENT_WORDS, '通用提示词不得出现执行端字样');
  assert.ok(plain.includes('/tmp/spec.md'), '执行规范路径');
  assert.ok(plain.includes('batch check --batch batch-20260909-001'), '批次摘要入口');
  assert.ok(plain.includes('nextAction=continue'), 'nextAction 处置');
  assert.ok(plain.includes('nextBatch'), '批次排队自动接续说明保留');
  assert.ok(plain.includes('每轮新启动一个子代理'), '子代理派发口径');
  assert.ok(plain.includes('跟随主调度会话'), '跟随模型指令');
});

t('A4 FOLLOW_SESSION_PROMPT_LINE 措辞通用化：不点名执行端参数与设置静态值；保留跟随语义', () => {
  const line = taskSettings.FOLLOW_SESSION_PROMPT_LINE;
  assert.ok(line.includes('跟随主调度会话'), '跟随主调度会话');
  assert.ok(line.includes('与当前主调度会话保持一致'), '要求与会话一致');
  assert.doesNotMatch(line, /codex|exec|--model|model_reasoning_effort/i, '不点名执行端参数');
  assert.doesNotMatch(line, /「批量任务」/, '不再指向设置「批量任务」静态值');
});

// ---------- B 账本 ----------

t('B1 createRefineBatch 新账本：mode/agent 记 subagent、prompt 通用（跟随行 + 通用前缀）；直连显式 mode codex 兼容', () => {
  const p = mkProject('atb-ag-b1-');
  try {
    mkAccepted(p.dataDir, '通用完善');
    const { batch: b } = refine.createRefineBatch(p.dataDir, { projectRoot: p.root, modelSource: 'follow' });
    assert.equal(b.mode, 'subagent', 'mode 记子代理模式标识');
    assert.equal(b.agent, 'subagent', 'agent 记子代理模式标识');
    assert.ok(b.prompt.includes('refine-<批次尾号>-<序号>'), '提示词使用通用领取前缀');
    assert.ok(b.prompt.includes('跟随主调度会话'), '提示词含跟随模型指令');
    assert.doesNotMatch(b.prompt, AGENT_WORDS, '提示词无执行端字样');
    // 领取落账继承子代理模式标识
    const got = refine.nextRefineItem(p.dataDir, b.batchId, { owner: 'w1' });
    assert.equal(refine.getRefineRun(p.dataDir, got.runId).mode, 'subagent', '运行账本 mode 继承 subagent');
    refine.finishRefineRun(p.dataDir, got.runId, { result: 'failed', reason: '收尾' });
    refine.abortRefineBatch(p.dataDir, b.batchId);
    // 直连显式 codex 仍合法（存量语义兼容）
    const c = mkProject('atb-ag-b1c-');
    try {
      mkAccepted(c.dataDir, 'codex 兼容');
      const { batch: cb } = refine.createRefineBatch(c.dataDir, { mode: 'codex', projectRoot: c.root, modelSource: 'follow' });
      assert.equal(cb.mode, 'codex', '显式 mode 直连仍按传入值落账');
      assert.doesNotMatch(cb.prompt, AGENT_WORDS, '显式 codex 提示词亦为通用版');
    } finally { fs.rmSync(c.root, { recursive: true, force: true }); }
  } finally { fs.rmSync(p.root, { recursive: true, force: true }); }
});

t('B2 refine 幂等去 Agent 化：存在未结束通用批次时再次创建（显式 mode codex）幂等返回，不并行新建', () => {
  const p = mkProject('atb-ag-b2-');
  try {
    mkAccepted(p.dataDir, '幂等候选');
    const first = refine.createRefineBatch(p.dataDir, { projectRoot: p.root, modelSource: 'follow' });
    assert.equal(first.created, true);
    const again = refine.createRefineBatch(p.dataDir, { mode: 'codex', projectRoot: p.root });
    assert.equal(again.created, false, '再次创建幂等返回既有批次');
    assert.equal(again.batch.batchId, first.batch.batchId, '返回同一批次（不再按 mode 分叉）');
  } finally { fs.rmSync(p.root, { recursive: true, force: true }); }
});

t('B3 createBatch 新账本：agent 记 subagent（mode 维持 zcode）、prompt 通用；直连 agent codex 兼容', () => {
  const p = mkProject('atb-ag-b3-');
  try {
    mkPlanned(p.dataDir, '通用开发');
    const { batch: b } = batch.createBatch(p.dataDir, { projectRoot: p.root, modelSource: 'follow' });
    assert.equal(b.agent, 'subagent', 'agent 记子代理模式标识');
    assert.equal(b.mode, 'zcode', 'mode 维持既有队列盘点口径');
    assert.ok(b.prompt.includes('跟随主调度会话'), '提示词含跟随模型指令');
    assert.doesNotMatch(b.prompt, AGENT_WORDS, '提示词无执行端字样');
    const c = mkProject('atb-ag-b3c-');
    try {
      mkPlanned(c.dataDir, 'codex 兼容');
      const { batch: cb } = batch.createBatch(c.dataDir, { projectRoot: c.root, agent: 'codex' });
      assert.equal(cb.agent, 'codex', '显式 agent 直连仍按传入值落账');
      assert.doesNotMatch(cb.prompt, AGENT_WORDS, '显式 codex 提示词亦为通用版');
    } finally { fs.rmSync(c.root, { recursive: true, force: true }); }
  } finally { fs.rmSync(p.root, { recursive: true, force: true }); }
});

// ---------- C CLI ----------

t('C1 CLI refine create：默认与 --mode codex 均生成通用提示词；输出行不再出现「执行 Agent」', () => {
  const p = mkProject('atb-ag-c1-');
  try {
    mkAccepted(p.dataDir, 'CLI 完善通用');
    const j = atbJson(['refine', 'create'], p.root);
    assert.ok(j.prompt.includes('refine-<批次尾号>-<序号>'), '通用领取前缀');
    assert.ok(j.prompt.includes('跟随主调度会话'), '跟随模型指令');
    assert.doesNotMatch(j.prompt, AGENT_WORDS, '提示词无执行端字样');
    const r = spawnSync(process.execPath, [ATB, 'refine', 'create', '--dir', p.root], { encoding: 'utf8', timeout: 30_000 });
    assert.equal(r.status, 0, '幂等再次创建应成功');
    assert.ok(!r.stdout.includes('执行 Agent'), '输出行不再出现「执行 Agent」');
    // --mode 保留但忽略：同样生成通用提示词
    refine.abortRefineBatch(p.dataDir, j.batchId);
    mkAccepted(p.dataDir, 'CLI mode 忽略');
    const j2 = atbJson(['refine', 'create', '--mode', 'codex'], p.root);
    assert.equal(j2.created, true, '--mode 被忽略，可正常创建');
    assert.doesNotMatch(j2.prompt, AGENT_WORDS, '--mode codex 亦输出通用提示词');
  } finally { fs.rmSync(p.root, { recursive: true, force: true }); }
});

t('C2 CLI batch create：生成通用提示词（跟随行 + nextBatch 接续）；复制指引文案不含 Zcode 字样', () => {
  const p = mkProject('atb-ag-c2-');
  try {
    mkPlanned(p.dataDir, 'CLI 开发通用');
    const j = atbJson(['batch', 'create'], p.root);
    assert.ok(j.prompt.includes('跟随主调度会话'), '跟随模型指令');
    assert.ok(j.prompt.includes('nextBatch'), '排队接续说明保留');
    assert.doesNotMatch(j.prompt, AGENT_WORDS, '提示词无执行端字样');
    const r = spawnSync(process.execPath, [ATB, 'batch', 'create', '--dir', p.root], { encoding: 'utf8', timeout: 30_000 });
    assert.equal(r.status, 0, '幂等再次创建应成功');
    assert.ok(!r.stdout.includes('Zcode'), '复制指引文案不含 Zcode 字样');
    assert.ok(!r.stdout.includes('执行 Agent'), '输出行不再出现「执行 Agent」');
  } finally { fs.rmSync(p.root, { recursive: true, force: true }); }
});

// ---------- D 服务端 ----------

async function startServer(root, tmp) {
  const port = 34000 + Math.floor(Math.random() * 20000);
  const server = spawn(process.execPath, [path.join(pluginRoot, 'scripts', 'server.mjs')], {
    cwd: root,
    env: { ...process.env, ATB_PORT: String(port), ATB_REGISTRY: path.join(tmp, 'reg.json') },
    stdio: ['ignore', 'ignore', 'ignore'],
  });
  const req = (method, pth, body) => new Promise((resolve, reject) => {
    const u = new URL(`http://127.0.0.1:${port}${pth}`);
    const payload = body == null ? null : JSON.stringify(body);
    const r = http.request(u, { method, headers: payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {} }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode, json: JSON.parse(data || '{}') }); } catch (e) { reject(e); }
      });
    });
    r.on('error', reject);
    if (payload) r.write(payload);
    r.end();
  });
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 150));
    try { await req('GET', '/api/health'); return { server, req, port }; } catch {}
  }
  throw new Error('服务未启动');
}

t('D1 服务端 /api/batch/create：不带 agent 可创建（agent=subagent、通用提示词）；带 agent 参数不报错（忽略）', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'atb-ag-srv1-'));
  const root = path.join(tmp, 'proj');
  fs.mkdirSync(root, { recursive: true });
  core.initData(root);
  const dataDir = core.dataDirFrom(root);
  const { server, req } = await startServer(root, tmp);
  const P = `?project=${encodeURIComponent(root)}`;
  try {
    mkPlanned(dataDir, '服务端通用开发');
    let r = await req('POST', `/api/batch/create${P}`, {});
    assert.equal(r.status, 200, `不带 agent 应成功（${JSON.stringify(r.json)}）`);
    assert.equal(r.json.agent, 'subagent', '返回 agent=subagent');
    assert.doesNotMatch(r.json.prompt, AGENT_WORDS, '提示词无执行端字样');
    // 带 agent（旧客户端）：忽略不报错，仍为通用口径
    mkPlanned(dataDir, '服务端忽略 agent');
    r = await req('POST', `/api/batch/create${P}`, { agent: 'codex' });
    assert.equal(r.status, 200, '携带 agent 参数不报错（忽略）');
    assert.equal(r.json.agent, 'subagent', 'agent 入参被忽略');
    assert.doesNotMatch(r.json.prompt, AGENT_WORDS, '提示词仍为通用版');
  } finally {
    server.kill();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

t('D2 服务端 /api/refine/create：不带 mode / 带 mode 均可创建，返回通用提示词', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'atb-ag-srv2-'));
  const root = path.join(tmp, 'proj');
  fs.mkdirSync(root, { recursive: true });
  core.initData(root);
  const dataDir = core.dataDirFrom(root);
  const { server, req } = await startServer(root, tmp);
  const P = `?project=${encodeURIComponent(root)}`;
  try {
    mkAccepted(dataDir, '服务端通用完善');
    let r = await req('POST', `/api/refine/create${P}`, {});
    assert.equal(r.status, 200, `不带 mode 应成功（${JSON.stringify(r.json)}）`);
    assert.ok(r.json.prompt.includes('refine-<批次尾号>-<序号>'), '通用领取前缀');
    assert.doesNotMatch(r.json.prompt, AGENT_WORDS, '提示词无执行端字样');
    mkAccepted(dataDir, '服务端忽略 mode');
    r = await req('POST', `/api/refine/create${P}`, { mode: 'codex' });
    assert.equal(r.status, 200, '携带 mode 参数不报错（忽略）');
    assert.doesNotMatch(r.json.prompt, AGENT_WORDS, '提示词仍为通用版');
    // 非法 mode 值同样忽略（不再 400）
    r = await req('POST', `/api/refine/create${P}`, { mode: 'gpt' });
    assert.equal(r.status, 200, '任意 mode 值均按通用子代理模式创建');
  } finally {
    server.kill();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

t('D3 服务端 /api/tasks/settings POST：agents/models 键被忽略（不落盘），仅 refine.autoPlanAfterDone 生效；GET 结构原样', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'atb-ag-srv3-'));
  const root = path.join(tmp, 'proj');
  fs.mkdirSync(root, { recursive: true });
  core.initData(root);
  const { server, req } = await startServer(root, tmp);
  const P = `?project=${encodeURIComponent(root)}`;
  try {
    let r = await req('POST', `/api/tasks/settings${P}`, { agents: { refine: ['zcode'] }, models: { refine: { zcode: { source: 'manual', model: 'glm-x' } } }, refine: { autoPlanAfterDone: true } });
    assert.equal(r.status, 200);
    assert.equal(r.json.settings.refine.autoPlanAfterDone, true, '流转开关生效');
    assert.deepEqual(r.json.settings.agents.refine, ['zcode', 'codex'], 'agents 提交被忽略（保持缺省）');
    assert.equal(r.json.settings.models.refine.zcode.source, 'follow', 'models 提交被忽略（保持缺省）');
    r = await req('GET', `/api/tasks/settings${P}`);
    assert.equal(r.json.settings.refine.autoPlanAfterDone, true, 'GET 原样返回生效的开关');
    assert.deepEqual(r.json.settings.agents.refine, ['zcode', 'codex'], 'GET 原样返回未变的 agents');
  } finally {
    server.kill();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// ---------- E 界面（app.js vm 契约） ----------

function element() {
  const nodes = new Map();
  const classes = new Set();
  return {
    nodes, dataset: {}, innerHTML: '', textContent: '', title: '', value: '', disabled: false, checked: false,
    tagName: 'DIV', __match: null, children: [], listeners: {},
    classList: { add: (v) => classes.add(v), remove: (v) => classes.delete(v), contains: (v) => classes.has(v), toggle: (v, on) => on ? classes.add(v) : classes.delete(v) },
    addEventListener(event, fn) { this.listeners[event] = fn; },
    querySelector(selector) { if (!nodes.has(selector)) nodes.set(selector, element()); return nodes.get(selector); },
    querySelectorAll(selector) { return Array.from(nodes.values()).filter((el) => el.__match && el.__match(selector)); },
    appendChild() {}, prepend() {}, replaceChildren() {}, setAttribute() {}, removeAttribute() {},
    fire(event) { const e = { target: this, currentTarget: this, stopped: false, stopPropagation() { this.stopped = true; } }; return { e, result: this.listeners[event]?.(e) }; },
  };
}

function setupUi() {
  const document = element();
  document.createElement = element;
  const seed = (selector, el) => document.nodes.set(selector, el);
  const posted = [];
  const resp = (ok, body, status = ok ? 200 : 500) => ({ ok, status, statusText: ok ? 'OK' : 'ERR', json: async () => body });
  const saved = {
    version: 1,
    agents: { refine: ['zcode', 'codex'], develop: ['zcode', 'codex'] },
    models: {
      refine: { zcode: { source: 'follow', model: '', level: 'high' }, codex: { source: 'follow', model: '', level: 'high' } },
      develop: { zcode: { source: 'follow', model: '', level: 'medium' }, codex: { source: 'follow', model: '', level: 'medium' } },
    },
    refine: { autoPlanAfterDone: false },
  };
  const sandbox = { document, URLSearchParams, console, setTimeout: () => 0, clearTimeout() {},
    location: { pathname: '/', search: '' }, history: { replaceState() {} }, localStorage: { setItem() {}, getItem: () => null, removeItem() {} },
    window: { addEventListener() {}, confirm: () => true },
    fetch: async (url, opts) => {
      const p = String(url).split('?')[0];
      const method = opts && opts.method;
      if (method === 'POST') posted.push({ url: p, body: JSON.parse(opts.body || '{}') });
      if (p === '/api/tasks/settings') {
        if (method === 'POST') return resp(true, { ok: true, settings: saved });
        return resp(true, { settings: saved });
      }
      if (p === '/api/dispatch/settings') return resp(true, { settings: { codex: { cliPath: null, timeoutMin: 60, retries: 2 } } });
      return resp(true, {});
    },
  };
  sandbox.__posted = posted;
  vm.createContext(sandbox);
  vm.runInContext(source.split('/* ---------- 启动 ---------- */')[0], sandbox, { filename: 'app.js' });
  const run = (code) => vm.runInContext(code, sandbox);
  const state = run('state');
  state.project = '/project/a';
  run('toast = () => {}; poll = async () => {}; refreshDrawer = async () => {}; refreshBatch = async () => {}; renderBatchDrawer = () => {};');
  return { sandbox, document, state, run, seed, posted };
}

t('E1 设置区精简：仅标题 + 通用说明（子代理模式/提示词通用/跟随主调度会话）+ 流转开关 + 保存；无 Agent 表格与隐藏/来源控件', () => {
  const h = setupUi();
  const out = h.run(`taskSettingsHtml(${JSON.stringify({ refine: { autoPlanAfterDone: false } })})`);
  assert.match(out, /<h4>批量任务<\/h4>/, '分区标题保留');
  assert.match(out, /子代理模式/, '说明含子代理模式口径');
  assert.match(out, /跟随主调度会话/, '说明含默认跟随主调度会话');
  assert.match(out, /id="tsAutoPlan"/, '完善完成后自动转入计划开关保留');
  assert.match(out, /id="tsSave"/, '保存按钮保留');
  assert.match(out, /id="tsStatus"/, '就近状态反馈保留');
  assert.doesNotMatch(out, /<table/, '无表格');
  for (const id of ['tsHidden-', 'tsSource-', 'tsModel-', 'tsLevel-', 'tsEmpty-']) {
    assert.ok(!out.includes(id), `不得出现 ${id} 控件`);
  }
  assert.doesNotMatch(out, /执行 Agent/, '设置区不再出现执行 Agent 维度');
});

t('E2 设置保存载荷：仅提交 refine 流转开关（不含 agents/models）；草稿反馈与防重复提交保留', async () => {
  const h = setupUi();
  const view = element();
  view.nodes.set('#tsStatus', element());
  const saveBtn = element();
  view.nodes.set('#tsSave', saveBtn);
  const autoPlan = element();
  autoPlan.checked = true;
  view.nodes.set('#tsAutoPlan', autoPlan);
  h.seed('#settingsView', view);
  await h.run('renderSettingsView()');
  autoPlan.fire('change');
  assert.match(view.nodes.get('#tsStatus').textContent, /有未保存的更改/, '草稿变更就近提示');
  h.posted.length = 0;
  await saveBtn.fire('click').result;
  const post = h.posted.find((p) => p.url === '/api/tasks/settings');
  assert.ok(post, '应发起任务设置保存请求');
  assert.deepEqual(post.body, { refine: { autoPlanAfterDone: true } }, '保存载荷仅含 refine 开关');
  assert.equal(saveBtn.textContent, '保存批量任务设置', '完成后按钮文案恢复');
});

t('E3 开发启动区与终态：无执行 Agent 下拉与隐藏禁用提示；无候选禁用并说明；启动请求体不带 agent', () => {
  const h = setupUi();
  // 有候选：可直接启动
  h.run('plannedQueue = () => [{ id: "REQ-1", title: "t" }];');
  const bar = h.run('renderDevStartBar()');
  assert.doesNotMatch(bar, /id="devMode"/, '启动区不得出现执行 Agent 下拉');
  assert.doesNotMatch(bar, /选择执行 Agent/, '无空占位校验文案');
  assert.doesNotMatch(bar, /已隐藏全部执行 Agent/, '无全部隐藏禁用提示');
  assert.doesNotMatch(bar, /子代理模型：/, '无生效模型口径行');
  assert.match(bar, /id="devStart"/, '启动按钮保留');
  assert.doesNotMatch(bar, /id="devStart"[^>]*disabled/, '有候选时启动可点');
  // 无候选：禁用并说明原因
  h.run('plannedQueue = () => [];');
  const emptyBar = h.run('renderDevStartBar()');
  assert.match(emptyBar, /id="devStart"[^>]*disabled/, '无候选时启动禁用');
  assert.match(emptyBar, /暂无已计划候选/, '禁用时说明原因');
  // 终态启动新一轮：同样去 Agent 化
  h.state.batchData = {
    batch: { batchId: 'B-1', mode: 'zcode', agent: 'subagent', status: 'finished', aborted: false, abortRequested: false, pauseRequested: false, developer: null, createdAt: '2026-01-01T00:00:00.000Z', lastActivityAt: '2026-01-01T00:00:00.000Z', candidates: [], prompt: 'p' },
    counts: { total: 1, reported: 1, failed: 0, blockedRuns: 0, interrupted: 0, remaining: 0 },
    current: null, records: [], recordsTotal: 0, pending: [], nextAction: 'stop', notice: null, queue: [], stats: { candidates: 0, blocked: 0 },
  };
  h.run('plannedQueue = () => [{ id: "REQ-2", title: "t" }];');
  const done = h.run('renderZcodeBatchPanel()');
  assert.match(done, /id="batchNext"/, '终态保留启动新一轮');
  assert.doesNotMatch(done, /id="devNextMode"/, '终态不得出现执行 Agent 下拉');
  assert.doesNotMatch(done, /选择执行 Agent/, '终态无空占位文案');
  assert.doesNotMatch(done, /已隐藏全部执行 Agent/, '终态无全部隐藏提示');
  // 创建请求体不带 agent（源码契约：JSON.stringify 载荷无 agent 键）
  const fn = source.match(/async function createBatchAndCopy[\s\S]{0,2200}/)[0];
  assert.doesNotMatch(fn, /JSON\.stringify\(\{[^}]*agent/, '创建请求体不得携带 agent');
});

t('E4 完善启动区与终态：#refineMode/#refineNextMode 不存在；无候选禁用并说明；创建请求体不带 mode', () => {
  const h = setupUi();
  h.state.refine.data = { batch: null, candidates: [{ id: 'REQ-1', type: 'requirement', title: 't', reasons: [] }] };
  const create = h.run('renderRefinePanel()');
  assert.match(create, /id="refineCreate"/, '启动按钮保留');
  assert.doesNotMatch(create, /id="refineMode"/, '启动区不得出现执行 Agent 下拉');
  assert.doesNotMatch(create, /选择执行 Agent/, '无空占位文案');
  assert.doesNotMatch(create, /已隐藏全部执行 Agent/, '无全部隐藏提示');
  assert.doesNotMatch(create, /id="refineCreate"[^>]*disabled/, '有候选时启动可点');
  h.state.refine.data = { batch: null, candidates: [] };
  const empty = h.run('renderRefinePanel()');
  assert.match(empty, /暂无可完善候选/, '无候选禁用并说明原因');
  // 终态
  h.state.refine.data = {
    batch: { batchId: 'RFB-1', mode: 'subagent', agent: 'subagent', status: 'finished', aborted: false, abortRequested: false, pauseRequested: false, developer: null, createdAt: '2026-01-01T00:00:00.000Z', lastActivityAt: '2026-01-01T00:00:00.000Z', candidates: [], prompt: 'p' },
    counts: { total: 1, done: 1, failed: 0, skipped: 0, interrupted: 0, remaining: 0 },
    current: null, records: [], candidates: [{ id: 'REQ-2', type: 'requirement', title: 't', reasons: [] }],
  };
  const done = h.run('renderRefinePanel()');
  assert.match(done, /id="refineNext"/, '终态保留启动新一轮');
  assert.doesNotMatch(done, /id="refineNextMode"/, '终态不得出现执行 Agent 下拉');
  const fn = source.match(/async function createRefineBatchAndCopy[\s\S]{0,1800}/)[0];
  assert.doesNotMatch(fn, /mode/, '创建请求体不得携带 mode');
});

t('E5 运行概况行：新批次（subagent）仅展示「子代理模式」；存量批次（zcode/codex）保持执行 Agent 展示', () => {
  const h = setupUi();
  const mkData = (agent) => ({
    batch: { batchId: 'B-1', mode: 'zcode', agent, status: 'running', aborted: false, abortRequested: false, pauseRequested: false, developer: null, createdAt: '2026-01-01T00:00:00.000Z', lastActivityAt: '2026-01-01T00:00:00.000Z', candidates: [], prompt: 'p' },
    counts: { total: 1, reported: 0, failed: 0, blockedRuns: 0, interrupted: 0, remaining: 1 },
    current: null, records: [], recordsTotal: 0, pending: [], nextAction: 'continue', notice: null, queue: [], stats: { candidates: 0, blocked: 0 },
  });
  h.run('plannedQueue = () => [];');
  h.state.batchData = mkData('subagent');
  const html = h.run('renderZcodeBatchPanel()');
  assert.match(html, /子代理模式/, '新批次展示子代理模式');
  assert.doesNotMatch(html, /执行 Agent subagent/, '新批次不得展示「执行 Agent subagent」');
  h.state.batchData = mkData('zcode');
  const legacy = h.run('renderZcodeBatchPanel()');
  assert.match(legacy, /执行 Agent zcode（子代理模式）/, '存量批次保持执行 Agent 展示（不回溯）');
});

// ---------- F/G 存量兼容与直连回归 ----------

t('F1 存量数据层兼容：loadTaskSettings 读存量 agents/models（手动值/全隐藏）不报错；保存局部合并不变', () => {
  const p = mkProject('atb-ag-f1-');
  try {
    taskSettings.saveTaskSettings(p.dataDir, { agents: { refine: [] }, models: { refine: { zcode: { source: 'manual', model: 'glm-x', level: 'low' } } } });
    const s = taskSettings.loadTaskSettings(p.dataDir);
    assert.deepEqual(s.agents.refine, [], '存量全隐藏可读');
    assert.equal(s.models.refine.zcode.model, 'glm-x', '存量手动值保留');
    // 仅保存 refine 开关不重置 agents/models
    const r = taskSettings.saveTaskSettings(p.dataDir, { refine: { autoPlanAfterDone: true } });
    assert.deepEqual(r.agents.refine, [], 'agents 不受 refine 保存影响');
    assert.equal(r.models.refine.zcode.model, 'glm-x', 'models 不受 refine 保存影响');
    assert.equal(r.refine.autoPlanAfterDone, true, '流转开关生效');
  } finally { fs.rmSync(p.root, { recursive: true, force: true }); }
});

t('G1 直连兼容回归：提示词生成函数不传模型信息不注入行；developer 参数忽略（REQ-20260910-027 移除）', () => {
  const bare = batch.generatePrompt({ projectRoot: '/tmp/p', batchId: 'b-1', workerSpecPath: '/s.md' });
  assert.ok(!bare.includes('跟随主调度会话'), '直连无模型信息不注入跟随行');
  assert.ok(!bare.includes('子代理模型配置：'), '直连无模型信息不注入固定行');
  const rb = refine.buildRefinePrompt({ projectRoot: '/tmp/p', batchId: 'RFB-1' });
  assert.ok(!rb.includes('跟随主调度会话') && !rb.includes('子代理模型配置：'), '完善直连无模型信息不注入行');
  // REQ-20260910-027：开发人员设置已移除——developer 入参保留但忽略，输出与不传一致
  const withDev = batch.generatePrompt({ projectRoot: '/tmp/p', batchId: 'b-2', workerSpecPath: '/s.md', developer: '李四' });
  const noDev = batch.generatePrompt({ projectRoot: '/tmp/p', batchId: 'b-2', workerSpecPath: '/s.md' });
  assert.equal(withDev, noDev, 'developer 入参被忽略，输出与不传逐字一致');
  assert.ok(!withDev.includes('请将当前会话名改为'), '会话命名指令不再生成');
});

// ---------- 执行 ----------

let failed = 0;
for (const [name, fn] of cases) {
  try {
    await fn();
    console.log(`✓ ${name}`);
  } catch (e) {
    failed++;
    console.error(`✗ ${name}\n    ${String(e.message).split('\n')[0]}`);
  }
}
console.log(failed ? `\n${failed} 个用例未通过` : '\n全部通过');
process.exit(failed ? 1 : 0);
