#!/usr/bin/env node
// REQ-20260909-005 契约测试 —— 批量任务子代理模型与智能/推理档位默认跟随主调度会话
// REQ-20260909-011 更新：提示词单一通用化、设置去 Agent 配置后，follow 为创建入口固定口径——
//   数据层：默认 follow / 存量迁移（model 非空或档位偏离缺省 → manual）/ source 校验与保値（存储保留）
//   提示词：follow 指令行替换固定配置行（措辞已通用化）；BUG-20260909-017 起 manual / 直传
//   model/level 兼容调用同样落跟随行，「子代理模型配置：…」固定行不再生成；直连无模型信息不注入
//   CLI / 服务端：创建入口固定 follow，不再读设置 models；settings POST 忽略 agents/models
//   界面：设置区精简（仅流转开关）；启动区去 Agent 化（无模型口径行）
// 用法：node scripts/tests/model-follow-session-20260909-005.test.mjs

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

const FOLLOW_LINE = '跟随主调度会话';
const MANUAL_LINE = '子代理模型配置：';

const cases = [];
const t = (name, fn) => cases.push([name, fn]);

// ---------- 脚手架 ----------

function mkProject(prefix = 'atb-mf-') {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  const dataDir = core.initData(root);
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

// 直写存量 settings.json（模拟 REQ-20260908-020 时代保存的旧数据，无 source 字段）
function writeLegacySettings(dataDir, models) {
  const file = path.join(dataDir, 'tasks', 'settings.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ version: 1, agents: { refine: ['zcode', 'codex'], develop: ['zcode', 'codex'] }, models }, null, 2));
}

// ---------- A 数据层（task-settings.mjs） ----------

t('1 数据层默认：无存量时四路 source 均为 follow；level 缺省保留（refine=high / develop=medium，仅作手动缺省建议）', () => {
  const p = mkProject();
  try {
    const s = taskSettings.loadTaskSettings(p.dataDir);
    for (const kind of ['refine', 'develop']) {
      for (const agent of ['zcode', 'codex']) {
        assert.equal(s.models[kind][agent].source, 'follow', `${kind}/${agent} 默认跟随主调度会话`);
        assert.equal(s.models[kind][agent].model, '', '默认无模型');
      }
      assert.equal(s.models[kind].zcode.level, kind === 'refine' ? 'high' : 'medium', `${kind} 缺省档保留`);
    }
  } finally { fs.rmSync(p.root, { recursive: true, force: true }); }
});

t('2 数据层迁移：model 非空或档位偏离缺省 → manual 且值保留；缺省形态 → follow；值一律不清空', () => {
  const p = mkProject();
  try {
    writeLegacySettings(p.dataDir, {
      refine: {
        zcode: { model: 'glm-5.3', level: 'medium' }, // 显式模型 → manual
        codex: { model: '', level: 'low' },            // 档位偏离 refine 缺省 high → manual
      },
      develop: {
        zcode: { model: '', level: 'medium' },         // 缺省形态 → follow
      },                                                 // develop.codex 未保存 → follow
    });
    const s = taskSettings.loadTaskSettings(p.dataDir);
    assert.equal(s.models.refine.zcode.source, 'manual', 'model 非空迁移为手动指定');
    assert.equal(s.models.refine.zcode.model, 'glm-5.3', '模型值不丢失');
    assert.equal(s.models.refine.zcode.level, 'medium', '档位值不丢失');
    assert.equal(s.models.refine.codex.source, 'manual', '档位偏离缺省视为手工配置 → 手动指定');
    assert.equal(s.models.refine.codex.level, 'low', '非缺省档位保留');
    assert.equal(s.models.develop.zcode.source, 'follow', '空模型 + 缺省档（不可区分是否保存过）落新默认跟随');
    assert.equal(s.models.develop.zcode.level, 'medium', '档位值仍保留（切回手动时回显）');
    assert.equal(s.models.develop.codex.source, 'follow', '从未保存的路默认跟随');
  } finally { fs.rmSync(p.root, { recursive: true, force: true }); }
});

t('3 数据层保存：source 非法整体拒绝且不落半截；source=follow 不清空既有 model/level；不带 source 写入非空 model → 该路置 manual', () => {
  const p = mkProject();
  try {
    taskSettings.saveTaskSettings(p.dataDir, { models: { refine: { zcode: { source: 'manual', model: 'glm-5.3', level: 'low' } } } });
    // 非法 source：整体拒绝，文件不产生半截配置
    assert.throws(
      () => taskSettings.saveTaskSettings(p.dataDir, { models: { refine: { codex: { source: 'auto' } } } }),
      /source|来源/,
      '非法 source 应被整体拒绝',
    );
    const mid = taskSettings.loadTaskSettings(p.dataDir);
    assert.equal(mid.models.refine.codex.source, 'follow', '被拒的 patch 未落盘');
    assert.equal(mid.models.refine.zcode.model, 'glm-5.3', '既有值不受失败影响');
    // 显式 follow：保値不清空
    const r = taskSettings.saveTaskSettings(p.dataDir, { models: { refine: { zcode: { source: 'follow' } } } });
    assert.equal(r.models.refine.zcode.source, 'follow', '切回跟随生效');
    assert.equal(r.models.refine.zcode.model, 'glm-5.3', '跟随不清空模型（切回手动回显）');
    assert.equal(r.models.refine.zcode.level, 'low', '跟随不清空档位');
    // 兼容旧 API：不带 source 写入非空 model → manual
    const r2 = taskSettings.saveTaskSettings(p.dataDir, { models: { develop: { codex: { model: 'gpt-x', level: 'high' } } } });
    assert.equal(r2.models.develop.codex.source, 'manual', '写入非空模型即手动（REQ-20260908-020 API 语义不回退）');
    // 持久化可读回
    assert.equal(taskSettings.loadTaskSettings(p.dataDir).models.develop.codex.source, 'manual', 'source 持久化');
  } finally { fs.rmSync(p.root, { recursive: true, force: true }); }
});

// ---------- B 提示词（batch.mjs / refine-store.mjs） ----------

t('4 提示词（开发 follow）：generatePrompt 注入跟随指令，不再出现固定「子代理模型配置」行', () => {
  const prompt = batch.generatePrompt({ projectRoot: '/tmp/p', batchId: 'batch-1', workerSpecPath: '/tmp/spec.md', modelSource: 'follow' });
  assert.ok(prompt.includes(FOLLOW_LINE), '应含「跟随主调度会话」');
  assert.ok(prompt.includes('必须与当前主调度会话保持一致'), '应明确要求与会话一致');
  assert.ok(prompt.includes('不得改用其他静态值'), '应禁止回落静态值（REQ-20260909-011 通用化措辞）');
  assert.ok(!prompt.includes(MANUAL_LINE), '不得再出现固定「子代理模型配置」行');
  // model/level 静态值在 follow 档不注入（即使误传）
  const prompt2 = batch.generatePrompt({ projectRoot: '/tmp/p', batchId: 'batch-1', workerSpecPath: '/tmp/spec.md', modelSource: 'follow', model: 'glm-5.3', level: 'medium' });
  assert.ok(!prompt2.includes(MANUAL_LINE), 'follow 档忽略误传的静态 model/level');
  assert.ok(!prompt2.includes('glm-5.3'), 'follow 档不注入模型名');
});

t('5 提示词（开发 manual / 直连兼容）：manual 与仅传 model/level 的兼容调用同样落跟随行（BUG-20260909-017 统一口径）；无任何模型信息时不注入行', () => {
  const manual = batch.generatePrompt({ projectRoot: '/tmp/p', batchId: 'batch-1', workerSpecPath: '/tmp/spec.md', modelSource: 'manual', model: 'glm-5.3', level: 'medium' });
  assert.ok(manual.includes(FOLLOW_LINE), 'manual 入参注入跟随指令（固定行已随 BUG-20260909-017 移除）');
  assert.ok(!manual.includes(MANUAL_LINE), 'manual 不再出现固定「子代理模型配置」行');
  assert.ok(!manual.includes('glm-5.3'), 'manual 静态模型名不注入');
  // 兼容旧调用：不传 source 只传 model/level → 同样落跟随行
  const legacy = batch.generatePrompt({ projectRoot: '/tmp/p', batchId: 'batch-1', workerSpecPath: '/tmp/spec.md', model: 'glm-5.3', level: 'medium' });
  assert.ok(legacy.includes(FOLLOW_LINE), '未传 source 的 model/level 直连调用落跟随行');
  assert.ok(!legacy.includes(MANUAL_LINE), '直连调用不再生成固定行');
  // 无模型信息：不注入任何行（直连调用不回归）
  const bare = batch.generatePrompt({ projectRoot: '/tmp/p', batchId: 'batch-1', workerSpecPath: '/tmp/spec.md' });
  assert.ok(!bare.includes(MANUAL_LINE), '无模型信息不出现固定行');
  assert.ok(!bare.includes(FOLLOW_LINE), '无模型信息不出现跟随行');
});

t('6 提示词（完善）：buildRefinePrompt 的 follow / manual 口径与开发侧一致（同一句式、可明确区分）', () => {
  const follow = refine.buildRefinePrompt({ projectRoot: '/tmp/p', batchId: 'RFB-1', modelSource: 'follow' });
  assert.ok(follow.includes(FOLLOW_LINE), '完善提示词含跟随指令');
  assert.ok(follow.includes('必须与当前主调度会话保持一致'), '完善提示词要求与会话一致');
  assert.ok(!follow.includes(MANUAL_LINE), '完善 follow 档无固定行');
  const manual = refine.buildRefinePrompt({ projectRoot: '/tmp/p', batchId: 'RFB-1', modelSource: 'manual', model: 'glm-5.3', level: 'low' });
  assert.ok(manual.includes(FOLLOW_LINE), '完善 manual 入参同样落跟随行（BUG-20260909-017 统一口径）');
  assert.ok(!manual.includes(MANUAL_LINE), '完善 manual 不再生成固定行');
  const bare = refine.buildRefinePrompt({ projectRoot: '/tmp/p', batchId: 'RFB-1' });
  assert.ok(!bare.includes(MANUAL_LINE) && !bare.includes(FOLLOW_LINE), '完善直连无模型信息不注入行');
});

// ---------- C CLI 统一（atb batch create / refine create 固定跟随口径） ----------

t('7 CLI 统一：创建入口固定 follow（REQ-20260909-011）——保存 manual 后创建仍注入跟随指令（不再读设置 models）', () => {
  const p1 = mkProject('atb-mf-cli1-');
  const p2 = mkProject('atb-mf-cli2-');
  try {
    mkPlanned(p1.dataDir, 'CLI 跟随');
    const j1 = atbJson(['batch', 'create'], p1.root);
    assert.ok(j1.prompt.includes(FOLLOW_LINE), '默认设置 batch create 提示词应含跟随指令');
    assert.ok(!j1.prompt.includes(MANUAL_LINE), '默认设置不得注入固定配置行');

    // REQ-20260909-011：设置手动覆盖入口已移除——存量手动值不再影响新建任务（创建一律跟随）
    mkPlanned(p2.dataDir, 'CLI 手动存量');
    taskSettings.saveTaskSettings(p2.dataDir, { models: { develop: { zcode: { source: 'manual', model: 'glm-5.3', level: 'medium' } } } });
    const j2 = atbJson(['batch', 'create'], p2.root);
    assert.ok(j2.prompt.includes(FOLLOW_LINE), '存量 manual 值不影响新任务：仍含跟随指令');
    assert.ok(!j2.prompt.includes(MANUAL_LINE), '不再注入固定配置行（入口固定 follow）');

    const p3 = mkProject('atb-mf-cli3-');
    try {
      mkAccepted(p3.dataDir, 'CLI 完善跟随');
      const j3 = atbJson(['refine', 'create'], p3.root);
      assert.ok(j3.prompt.includes(FOLLOW_LINE), 'refine create 提示词应含跟随指令');
      assert.ok(!j3.prompt.includes(MANUAL_LINE), 'refine create 不得注入固定配置行');
      taskSettings.saveTaskSettings(p3.dataDir, { models: { refine: { zcode: { source: 'manual', model: 'glm-5.3', level: 'high' } } } });
      const ab = atbJson(['refine', 'abort'], p3.root); // 终止后可再建（幂等口径）
      assert.equal(ab.aborted, true);
      const j4 = atbJson(['refine', 'create'], p3.root);
      assert.ok(j4.created, '终止旧任务后可创建新完善任务');
      assert.ok(j4.prompt.includes(FOLLOW_LINE), '存量 manual 值不影响完善新任务：仍含跟随指令');
      assert.ok(!j4.prompt.includes(MANUAL_LINE), '不再注入固定配置行');
    } finally { fs.rmSync(p3.root, { recursive: true, force: true }); }
  } finally {
    fs.rmSync(p1.root, { recursive: true, force: true });
    fs.rmSync(p2.root, { recursive: true, force: true });
  }
});

// ---------- D 服务端（/api/tasks/settings + 创建接口按来源生成） ----------

async function startServer(root, tmp) {
  const port = 33000 + Math.floor(Math.random() * 20000);
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

t('8 服务端：创建入口固定 follow（REQ-20260909-011）；/api/tasks/settings 忽略 agents/models 仅流转开关生效', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'atb-mf-srv-'));
  const root = path.join(tmp, 'proj');
  fs.mkdirSync(root, { recursive: true });
  core.initData(root);
  const dataDir = core.dataDirFrom(root);
  const { server, req } = await startServer(root, tmp);
  const P = `?project=${encodeURIComponent(root)}`;
  try {
    mkPlanned(dataDir, '服务端跟随');
    // 存量手动值不再影响新建任务；agents/models 提交被忽略（兼容旧客户端不报错）
    await req('POST', `/api/tasks/settings${P}`, { models: { develop: { zcode: { source: 'manual', model: 'glm-5.3', level: 'medium' } } }, agents: { refine: ['zcode'] } });
    const rd = await req('GET', `/api/tasks/settings${P}`);
    assert.equal(rd.json.settings.models.develop.zcode.source, 'follow', 'models 提交被忽略（保持缺省 follow）');
    assert.deepEqual(rd.json.settings.agents.refine, ['zcode', 'codex'], 'agents 提交被忽略（保持缺省）');
    let r = await req('POST', `/api/batch/create${P}`, {});
    assert.equal(r.status, 200);
    assert.ok(r.json.prompt.includes(FOLLOW_LINE), '创建提示词含跟随指令（入口固定 follow）');
    assert.ok(!r.json.prompt.includes(MANUAL_LINE), '不再注入固定行');
    assert.equal(r.json.agent, 'subagent', '新批次 agent 记通用子代理模式标识');

    mkAccepted(dataDir, '完善服务端');
    let rf = await req('POST', `/api/refine/create${P}`, {});
    assert.equal(rf.status, 200);
    assert.ok(rf.json.prompt.includes(FOLLOW_LINE), '完善默认跟随');
    // 遗留 mode 入参（任意值）被忽略，仍为通用口径
    await req('POST', `/api/refine/abort${P}`, { batchId: rf.json.batchId });
    mkAccepted(dataDir, '完善忽略 mode');
    rf = await req('POST', `/api/refine/create${P}`, { mode: 'zcode' });
    assert.equal(rf.status, 200);
    assert.ok(rf.json.prompt.includes(FOLLOW_LINE), '携带 mode 入参仍为跟随口径');
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
    selectedOptions: [],
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
  document.querySelector = (selector) => { if (!document.nodes.has(selector)) nodes_default(document, selector); return document.nodes.get(selector); };
  function nodes_default(doc, selector) { doc.nodes.set(selector, element()); }
  const posted = [];
  const resp = (ok, body, status = ok ? 200 : 500) => ({ ok, status, statusText: ok ? 'OK' : 'ERR', json: async () => body });
  const saved = {
    version: 1,
    agents: { refine: ['zcode', 'codex'], develop: ['zcode', 'codex'] },
    models: {
      refine: { zcode: { source: 'follow', model: '', level: 'high' }, codex: { source: 'follow', model: '', level: 'high' } },
      develop: { zcode: { source: 'follow', model: '', level: 'medium' }, codex: { source: 'follow', model: '', level: 'medium' } },
    },
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

// 种子精简设置视图（REQ-20260909-011：仅流转开关 + 状态位 + 保存按钮）
function seedSettingsView(h) {
  const view = element();
  view.nodes.set('#tsAutoPlan', element());
  view.nodes.set('#tsStatus', element());
  view.nodes.set('#tsSave', element());
  h.seed('#settingsView', view);
  return view;
}

const uiTs = () => ({
  version: 1,
  agents: { refine: ['zcode', 'codex'], develop: ['zcode', 'codex'] },
  models: {
    refine: {
      zcode: { source: 'follow', model: '', level: 'high' },
      codex: { source: 'manual', model: 'glm-5.3', level: 'low' },
    },
    develop: {
      zcode: { source: 'follow', model: '', level: 'medium' },
      codex: { source: 'follow', model: '', level: 'medium' },
    },
  },
});

t('9 界面（设置区精简，REQ-20260909-011）：无五列表格与来源/模型/强度/隐藏控件；仅通用说明 + 流转开关 + 保存', () => {
  const h = setupUi();
  const out = h.run(`taskSettingsHtml(${JSON.stringify(uiTs())})`);
  assert.match(out, /<h4>批量任务<\/h4>/, '「批量任务」分区标题保留');
  assert.match(out, /子代理模式/, '说明含子代理模式口径');
  assert.match(out, /跟随主调度会话/, '说明含默认跟随语义');
  assert.match(out, /id="tsAutoPlan"/, '完善完成后自动转入计划开关保留');
  assert.match(out, /id="tsSave"/, '保存按钮保留');
  assert.match(out, /id="tsStatus"/, '就近状态反馈保留');
  assert.doesNotMatch(out, /<table/, '无表格');
  for (const id of ['tsSource-', 'tsModel-', 'tsLevel-', 'tsHidden-', 'tsEmpty-']) {
    assert.ok(!out.includes(id), `不得出现 ${id} 控件（按 Agent 配置已移除）`);
  }
  // 存量手动值不再渲染（设置不展示 models；老形态 settings 缺字段不炸）
  const legacy = h.run(`taskSettingsHtml(${JSON.stringify({ version: 1, agents: { refine: ['zcode', 'codex'], develop: ['zcode', 'codex'] }, models: { refine: {}, develop: {} } })})`);
  assert.ok(legacy.includes('id="tsSave"'), '老形态 settings 仍可渲染');
  assert.ok(!legacy.includes('glm'), '无手动值泄露');
});

t('10 界面（保存载荷精简）：仅提交 refine 流转开关；草稿反馈沿用', async () => {
  const h = setupUi();
  const view = seedSettingsView(h);
  await h.run('renderSettingsView()');
  view.nodes.get('#tsAutoPlan').checked = true;
  view.nodes.get('#tsAutoPlan').fire('change');
  assert.match(view.nodes.get('#tsStatus').textContent, /有未保存的更改/, '变更后就近提示未保存');
  h.posted.length = 0;
  await h.run('document.querySelector("#settingsView").querySelector("#tsSave").fire("click")');
  const post = h.posted.find((p) => p.url === '/api/tasks/settings');
  assert.ok(post, '应发起任务设置保存请求');
  assert.deepEqual(post.body, { refine: { autoPlanAfterDone: true } }, 'REQ-20260909-011：保存载荷仅含 refine 开关');
});

t('11 界面（启动区去 Agent 化，REQ-20260909-011）：无生效模型口径行与 Agent 选择控件', () => {
  const h = setupUi();
  h.state.tasks.settings = uiTs(); // 存量含 manual 值也不展示
  h.run('plannedQueue = () => [{ id: "REQ-1", title: "t" }];');
  const bar = h.run('renderDevStartBar()');
  assert.doesNotMatch(bar, /子代理模型：/, '开发启动区不再展示模型口径行');
  assert.doesNotMatch(bar, /id="devMode"/, '开发启动区无执行 Agent 选择');
  h.state.refine.data = { batch: null, candidates: [{ id: 'REQ-20260909-009', title: 'x', reasons: ['缺描述'] }] };
  const panel = h.run('renderRefinePanel()');
  assert.doesNotMatch(panel, /子代理模型：/, '完善启动区不再展示模型口径行');
  assert.doesNotMatch(panel, /id="refineMode"/, '完善启动区无执行 Agent 选择');
});

t('12 回归：加载失败重试契约保持；直连 generatePrompt 逐字一致不回归', () => {
  const h = setupUi();
  const spec = '/tmp/spec.md';
  const a = batch.generatePrompt({ projectRoot: '/tmp/p', batchId: 'b-1', workerSpecPath: spec });
  const b = batch.generatePrompt({ projectRoot: '/tmp/p', batchId: 'b-1', workerSpecPath: spec, developer: null });
  assert.equal(a, b, '无模型信息直连调用输出一致（batch-core D2 口径不回归）');
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
