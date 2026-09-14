#!/usr/bin/env node
// REQ-20260909-010 —— 完善完成后自动转入计划（配置，默认关闭=手动）契约测试
// 覆盖：默认零回归 / 开启流转（status+history+候选+回执+CLI）/ 条件流转（人工提前移入计划）/
//       其他状态仍拒绝 / 仅 done 触发 / 失败不丢单 / 设置存储 / server 双路径同口径 /
//       设置页 UI / Agent 纪律不变 / 面板记录标注 / 人工操作不回退
// 用法：node scripts/tests/refine-auto-plan-20260909-010.test.mjs

import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import * as core from '../lib/core.mjs';
import * as refine from '../lib/refine-store.mjs';
import * as refineStates from '../lib/refine-states.mjs';
import * as taskSettings from '../lib/task-settings.mjs';
import * as batch from '../lib/batch.mjs';

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const ATB = path.join(pluginRoot, 'scripts', 'atb.mjs');
const source = fs.readFileSync(path.join(pluginRoot, 'scripts', 'web', 'app.js'), 'utf8');
const srv = fs.readFileSync(path.join(pluginRoot, 'scripts', 'server.mjs'), 'utf8');

const cases = [];
const t = (name, fn) => cases.push([name, fn]);

function atb(args, cwd) {
  const r = spawnSync(process.execPath, [ATB, ...args, '--dir', cwd], { encoding: 'utf8', timeout: 30_000 });
  return { code: r.status, out: r.stdout || '', err: r.stderr || '' };
}

function mkProject() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'atb-refine-autoplan-')));
  core.initData(root);
  return { root, dataDir: core.dataDirFrom(root) };
}

const accept = (dataDir, id) => core.setStatus(dataDir, id, 'accepted', { by: 'human' });
const statusOf = (dataDir, id) => core.readStatus(core.resolveItemDir(dataDir, id).dir).status;

// 完善 run 领取后改文档（触发基线变更），返回领取结果
function claimAndEdit(root, dataDir, title, { autoPlan = false } = {}) {
  const req = core.createItem(dataDir, { type: 'requirement', title });
  accept(dataDir, req.id);
  if (autoPlan) taskSettings.saveTaskSettings(dataDir, { refine: { autoPlanAfterDone: true } });
  const { batch } = refine.createRefineBatch(dataDir, { mode: 'zcode', projectRoot: root });
  const got = refine.nextRefineItem(dataDir, batch.batchId, { owner: 'w1' });
  fs.writeFileSync(path.join(got.itemDir, 'README.md'), '# r\n自动流转测试补全的说明文字，长度超过三十个字符的阈值要求。');
  return { req, got, batch };
}

// ---------- A1 默认关闭零回归 ----------

t('A1 默认关闭：done 后条目保持 accepted、账本记已完善；回执 autoPlan.transitioned=false/not-enabled；history 无流转记录', () => {
  const { root, dataDir } = mkProject();
  const { req, got } = claimAndEdit(root, dataDir, '默认关闭');
  const { receipt } = refine.finishRefineRun(dataDir, got.runId, { result: 'done', summary: '补全了描述' });
  assert.equal(receipt.result, 'done');
  assert.deepEqual(receipt.autoPlan, { transitioned: false, reason: 'not-enabled' }, '默认关闭：回执说明未开启');
  assert.equal(statusOf(dataDir, req.id), 'accepted', '条目保持 accepted（现状零回归）');
  assert.equal(refineStates.refineStateOf(dataDir, req.id), 'refined', '完善账本记已完善');
  const st = core.readStatus(core.resolveItemDir(dataDir, req.id).dir);
  assert.ok(!st.history.some((h) => h.to === 'planned'), 'history 不得出现 planned 流转记录');
  // CLI 文本输出：提示行（默认关闭指引人工移入计划）
  const root2 = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'atb-refine-autoplan-cli-')));
  core.initData(root2);
  const dataDir2 = core.dataDirFrom(root2);
  const req2 = core.createItem(dataDir2, { type: 'requirement', title: 'CLI 默认' });
  accept(dataDir2, req2.id);
  atb(['refine', 'create'], root2);
  const nx = JSON.parse(atb(['refine', 'next', '--by', 'w1', '--json'], root2).out.split('\n').filter(Boolean).pop());
  fs.writeFileSync(path.join(nx.itemDir, 'README.md'), '# r\nCLI 默认关闭路径补全的说明文字，超过三十个字符阈值。');
  const r = atb(['refine', 'done', nx.runId, '--summary', '补全'], root2);
  assert.equal(r.code, 0, `done 应成功（${r.err}）`);
  assert.match(r.out, /未开启自动转入计划：需人工移入计划/, 'CLI 输出未开启提示行');
  assert.equal(statusOf(dataDir2, req2.id), 'accepted', 'CLI 路径条目同样保持 accepted');
});

// ---------- A2 开启生效 ----------

t('A2 开启生效：done 核验通过自动 accepted → planned；history 记 by=system 且 note 含 runId；回执 transitioned=true；进入批量开发候选', () => {
  const { root, dataDir } = mkProject();
  const { req, got } = claimAndEdit(root, dataDir, '开启流转', { autoPlan: true });
  const { receipt } = refine.finishRefineRun(dataDir, got.runId, { result: 'done', summary: '补全了描述' });
  assert.equal(receipt.autoPlan.transitioned, true, '回执体现流转成功');
  assert.equal(statusOf(dataDir, req.id), 'planned', '条目自动转入计划（status.json）');
  const st = core.readStatus(core.resolveItemDir(dataDir, req.id).dir);
  const flow = st.history.filter((h) => h.from === 'accepted' && h.to === 'planned');
  assert.equal(flow.length, 1, '恰好一条 accepted → planned 记录');
  assert.equal(flow[0].by, 'system', 'history 标注自动化来源 by=system');
  assert.ok(flow[0].note.includes(got.runId), `note 应关联 runId（得到 ${flow[0].note}）`);
  assert.ok(flow[0].note.includes('完善后自动转入计划'), 'note 标注「完善后自动转入计划」');
  assert.equal(refineStates.refineStateOf(dataDir, req.id), 'refined', '完善账本照记已完善');
  // 批量开发候选（planned 未认领）同步生效
  assert.ok(batch.candidateItems(dataDir).some((x) => x.id === req.id), '自动置计划后条目进入批量开发候选');
  // CLI 文本输出
  const root2 = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'atb-refine-autoplan-cli2-')));
  core.initData(root2);
  const dataDir2 = core.dataDirFrom(root2);
  const req2 = core.createItem(dataDir2, { type: 'requirement', title: 'CLI 开启' });
  accept(dataDir2, req2.id);
  taskSettings.saveTaskSettings(dataDir2, { refine: { autoPlanAfterDone: true } });
  atb(['refine', 'create'], root2);
  const nx = JSON.parse(atb(['refine', 'next', '--by', 'w1', '--json'], root2).out.split('\n').filter(Boolean).pop());
  fs.writeFileSync(path.join(nx.itemDir, 'README.md'), '# r\nCLI 开启路径补全的说明文字，超过三十个字符阈值。');
  const r = atb(['refine', 'done', nx.runId, '--summary', '补全'], root2);
  assert.equal(r.code, 0, `done 应成功（${r.err}）`);
  assert.match(r.out, new RegExp(`已自动转入计划：${req2.id}`), 'CLI 输出「已自动转入计划：<ID>」');
  assert.match(r.out, /"autoPlan":\{"transitioned":true\}/, '回执 JSON 含 autoPlan 字段');
  assert.equal(statusOf(dataDir2, req2.id), 'planned', 'CLI 路径条目转入计划');
});

// ---------- A3 条件流转（人工提前移入计划） ----------

t('A3 条件流转：人工先移入计划再 done → 回执成功不报错、不重复流转、说明原因；账本仍记已完善', () => {
  const { root, dataDir } = mkProject();
  const { req, got } = claimAndEdit(root, dataDir, '人工先计划', { autoPlan: true });
  core.setStatus(dataDir, req.id, 'planned', { by: 'human' }); // 人工提前移入计划
  const { receipt } = refine.finishRefineRun(dataDir, got.runId, { result: 'done', summary: '补全了描述' });
  assert.equal(receipt.result, 'done', '回执成功（不报错、不阻断）');
  assert.equal(receipt.autoPlan.transitioned, false, '不重复流转');
  assert.equal(receipt.autoPlan.reason, 'not-accepted:planned', '回执说明原因');
  const st = core.readStatus(core.resolveItemDir(dataDir, req.id).dir);
  const flow = st.history.filter((h) => h.from === 'accepted' && h.to === 'planned');
  assert.equal(flow.length, 1, '仅人工那一条流转记录（by=human，无 system 重复流转）');
  assert.equal(flow[0].by, 'human');
  assert.equal(refineStates.refineStateOf(dataDir, req.id), 'refined', '完善账本仍记已完善');
  // CLI 输出原因说明
  const root2 = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'atb-refine-autoplan-a3-')));
  core.initData(root2);
  const dataDir2 = core.dataDirFrom(root2);
  const req2 = core.createItem(dataDir2, { type: 'requirement', title: 'CLI 先计划' });
  accept(dataDir2, req2.id);
  taskSettings.saveTaskSettings(dataDir2, { refine: { autoPlanAfterDone: true } });
  atb(['refine', 'create'], root2);
  const nx = JSON.parse(atb(['refine', 'next', '--by', 'w1', '--json'], root2).out.split('\n').filter(Boolean).pop());
  fs.writeFileSync(path.join(nx.itemDir, 'README.md'), '# r\nCLI 条件流转补全的说明文字，超过三十个字符阈值。');
  core.setStatus(dataDir2, req2.id, 'planned', { by: 'human' });
  const r = atb(['refine', 'done', nx.runId, '--summary', '补全'], root2);
  assert.equal(r.code, 0, `done 应成功（${r.err}）`);
  assert.match(r.out, /未自动转入计划（条目当前为 planned）：无需自动转入/, 'CLI 输出未流转原因');
});

// ---------- A4 其他状态仍拒绝 ----------

t('A4 其他状态仍拒绝：条目被驳回回 submitted 后 done → 沿现状报错（完善结果需人工核对）', () => {
  const { root, dataDir } = mkProject();
  const { got } = claimAndEdit(root, dataDir, '驳回后回执');
  taskSettings.saveTaskSettings(dataDir, { refine: { autoPlanAfterDone: true } }); // 开启也不放宽
  // refining 中人工驳回回待接受被既有保护拦截（REQ-20260908-020），直接落盘模拟极端状态变化
  const dir = core.resolveItemDir(dataDir, got.itemId).dir;
  const st = JSON.parse(fs.readFileSync(path.join(dir, 'status.json'), 'utf8'));
  st.status = 'submitted';
  core.writeStatus(dir, st);
  assert.throws(
    () => refine.finishRefineRun(dataDir, got.runId, { result: 'done', summary: 's' }),
    /已离开已接受状态（当前 submitted）/,
    'submitted 状态 done 仍拒绝（与 accepted/planned 之外的状态口径不变）',
  );
});

// ---------- A5 仅 done 触发 ----------

t('A5 仅 done 触发：开启设置下 fail / release / abort 出局条目均不流转（保持 accepted、未完善）', () => {
  const { root, dataDir } = mkProject();
  const reqs = ['甲', '乙', '丙'].map((n) => {
    const x = core.createItem(dataDir, { type: 'requirement', title: `出局${n}` });
    accept(dataDir, x.id);
    return x;
  });
  taskSettings.saveTaskSettings(dataDir, { refine: { autoPlanAfterDone: true } });
  const { batch } = refine.createRefineBatch(dataDir, { mode: 'zcode', projectRoot: root });
  // fail
  const g1 = refine.nextRefineItem(dataDir, batch.batchId, { owner: 'w1' });
  fs.writeFileSync(path.join(g1.itemDir, 'README.md'), '# r\n失败路径也会修改文档的说明文字，超过三十个字符阈值。');
  refine.finishRefineRun(dataDir, g1.runId, { result: 'failed', reason: '信息不足' });
  // release
  const g2 = refine.nextRefineItem(dataDir, batch.batchId, { owner: 'w2' });
  refine.releaseRefineRun(dataDir, g2.runId, { reason: '认领冲突' });
  // abort（剩余项含丙：出局落账）
  refine.abortRefineBatch(dataDir, batch.batchId);
  for (const x of reqs) {
    assert.equal(statusOf(dataDir, x.id), 'accepted', `${x.id} 不因 fail/release/abort 流转`);
    assert.notEqual(refineStates.refineStateOf(dataDir, x.id), 'refined', `${x.id} 未记已完善`);
  }
});

// ---------- A6 失败不丢单（流转前置异常不抛错） ----------

t('A6 失败不丢单：autoPlanRefinedItem 前置读取失败返回 transitioned=false 不抛错；done 回执仍成功、账本照记已完善', () => {
  const { root, dataDir } = mkProject();
  const { req, got } = claimAndEdit(root, dataDir, '目录损坏', { autoPlan: true });
  // 条目目录损坏（status.json 不可读）→ 流转函数返回 status-read-failed，不抛错
  const dir = core.resolveItemDir(dataDir, req.id).dir;
  const backup = fs.readFileSync(path.join(dir, 'status.json'), 'utf8');
  fs.unlinkSync(path.join(dir, 'status.json'));
  const plan = refine.autoPlanRefinedItem(dataDir, req.id, got.runId);
  assert.equal(plan.transitioned, false);
  assert.equal(plan.reason, 'status-read-failed', '前置读取失败给明确 reason');
  // 恢复 status.json 后 done 回执仍成功（完善完成事实不丢失）——核验需要 status.json，恢复后基线仍可比对
  fs.writeFileSync(path.join(dir, 'status.json'), backup);
  const { receipt } = refine.finishRefineRun(dataDir, got.runId, { result: 'done', summary: '补全了描述' });
  assert.equal(receipt.result, 'done');
  assert.equal(receipt.autoPlan.transitioned, true, '恢复后正常流转（函数级失败分支已单独覆盖）');
  assert.equal(refineStates.refineStateOf(dataDir, req.id), 'refined');
});

// ---------- A7 设置存储 ----------

t('A7 设置存储：refine 分区保存/读取往返；非法值整体拒绝；存量无字段回退 false；助手缺省 false', () => {
  const { dataDir } = mkProject();
  // 默认值
  let s = taskSettings.loadTaskSettings(dataDir);
  assert.equal(taskSettings.autoPlanAfterRefineDone(s), false, '默认关闭');
  assert.deepEqual(s.refine, { autoPlanAfterDone: false }, '默认结构含 refine 分区');
  // 保存 true 往返
  s = taskSettings.saveTaskSettings(dataDir, { refine: { autoPlanAfterDone: true } });
  assert.equal(s.refine.autoPlanAfterDone, true);
  const re = taskSettings.loadTaskSettings(dataDir);
  assert.equal(taskSettings.autoPlanAfterRefineDone(re), true, '持久化可读');
  // 局部合并不清空：agents-only patch 保留 refine 开关
  s = taskSettings.saveTaskSettings(dataDir, { agents: { refine: ['zcode'] } });
  assert.equal(s.refine.autoPlanAfterDone, true, 'agents-only patch 不重置流转开关');
  // 非法值整体拒绝（不产生半截配置）
  for (const bad of ['yes', 1, null, undefined]) {
    assert.throws(() => taskSettings.saveTaskSettings(dataDir, { refine: { autoPlanAfterDone: bad } }),
      /autoPlanAfterDone/, `非法值 ${JSON.stringify(bad)} 应整体拒绝`);
  }
  assert.equal(taskSettings.loadTaskSettings(dataDir).refine.autoPlanAfterDone, true, '拒绝后既有值不被破坏');
  // 存量存储无 refine 分区 → 回退 false
  fs.writeFileSync(path.join(dataDir, 'tasks', 'settings.json'), JSON.stringify({ version: 1 }));
  assert.equal(taskSettings.autoPlanAfterRefineDone(taskSettings.loadTaskSettings(dataDir)), false, '存量缺字段按关闭回退');
});

// ---------- A8 server 双路径同口径 ----------

t('A8 server：/api/tasks/settings POST 透传 refine 分区；settle done 核验对齐 accepted 并接入 autoPlanRefinedItem（源码口径）', async () => {
  assert.match(srv, /refine: body\.refine \?\? undefined/, '设置保存接口透传 refine 分区（省略即保留既有值）');
  assert.match(srv, /if \(st && st\.status === 'accepted' && changed\)/, 'settle done 核验对齐 accepted（与 finishRefineRun 同口径）');
  assert.match(srv, /autoPlanRefinedItem\(dataDir, run\.itemId, runId\)/, 'settle done 分支接入自动流转');
  assert.match(srv, /if \(st\.status !== 'accepted'\) return \{ out: `状态已变化/, 'precheck 出局核验对齐 accepted');
  assert.doesNotMatch(srv, /st\.status === 'submitted'/, 'codex 完善路径不再残留 submitted 旧口径');
  assert.doesNotMatch(srv, /st\.status !== 'submitted'/, 'precheck 不再按 submitted 出局');
  // 真实 server：POST refine 分区 → GET 回读
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'atb-refine-autoplan-srv-'));
  const root = path.join(tmp, 'proj');
  fs.mkdirSync(root);
  core.initData(root);
  const port = 33000 + Math.floor(Math.random() * 20000);
  const server = spawn(process.execPath, [path.join(pluginRoot, 'scripts', 'server.mjs')], {
    cwd: root,
    env: { ...process.env, ATB_PORT: String(port), ATB_REGISTRY: path.join(tmp, 'reg.json') },
    stdio: ['ignore', 'ignore', 'ignore'],
  });
  const P = `?project=${encodeURIComponent(root)}`;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const reqq = (method, pathname, body) => new Promise((resolve, reject) => {
    const payload = body == null ? null : JSON.stringify(body);
    const r = http.request({ hostname: '127.0.0.1', port, path: pathname, method, headers: payload ? { 'Content-Type': 'application/json' } : {} }, (rs) => {
      let out = '';
      rs.on('data', (c) => { out += c; });
      rs.on('end', () => resolve({ status: rs.statusCode, json: JSON.parse(out || '{}') }));
    });
    r.on('error', reject);
    if (payload) r.write(payload);
    r.end();
  });
  try {
    let up = false;
    for (let i = 0; i < 40; i++) {
      await sleep(150);
      try { await reqq('GET', '/api/health'); up = true; break; } catch {}
    }
    assert.ok(up, '服务应启动');
    let r = await reqq('POST', `/api/tasks/settings${P}`, { refine: { autoPlanAfterDone: true } });
    assert.equal(r.status, 200, `保存 refine 分区应 200（${JSON.stringify(r.json)}）`);
    assert.equal(r.json.settings.refine.autoPlanAfterDone, true, '保存响应回显开启');
    r = await reqq('GET', `/api/tasks/settings${P}`);
    assert.equal(r.json.settings.refine.autoPlanAfterDone, true, 'GET 回读开启');
    // 非法值整体拒绝
    r = await reqq('POST', `/api/tasks/settings${P}`, { refine: { autoPlanAfterDone: 'yes' } });
    assert.equal(r.status, 400, `非法值应 400（得到 ${r.status}）`);
    r = await reqq('GET', `/api/tasks/settings${P}`);
    assert.equal(r.json.settings.refine.autoPlanAfterDone, true, '拒绝后既有值不被破坏');
  } finally {
    server.kill('SIGKILL');
  }
});

// ---------- A9 设置页 UI（vm 沙箱） ----------

// DOM 接缝：控件级 stub（task-settings-simplify-20260909-001 同法）
function element() {
  const nodes = new Map();
  const classes = new Set();
  return {
    nodes,
    dataset: {}, innerHTML: '', textContent: '', title: '', value: '', disabled: false, checked: false,
    tagName: 'DIV', __match: null,
    children: [], listeners: {},
    classList: { add: (v) => classes.add(v), remove: (v) => classes.delete(v), contains: (v) => classes.has(v), toggle: (v, on) => on ? classes.add(v) : classes.delete(v) },
    addEventListener(event, fn) { this.listeners[event] = fn; },
    querySelector(selector) { if (!nodes.has(selector)) nodes.set(selector, element()); return nodes.get(selector); },
    querySelectorAll(selector) { return Array.from(nodes.values()).filter((el) => el.__match && el.__match(selector)); },
    setAttribute() {}, removeAttribute() {},
    fire(event) { const e = { target: this, currentTarget: this, stopped: false, stopPropagation() { this.stopped = true; } }; return { e, result: this.listeners[event]?.(e) }; },
  };
}

const defaultTs = () => ({
  version: 1,
  agents: { refine: ['zcode', 'codex'], develop: ['zcode', 'codex'] },
  models: {
    refine: { zcode: { model: '', level: 'high' }, codex: { model: '', level: 'high' } },
    develop: { zcode: { model: '', level: 'medium' }, codex: { model: '', level: 'medium' } },
  },
  refine: { autoPlanAfterDone: false },
});

function setup() {
  const document = element();
  document.createElement = element;
  const seed = (selector, el) => document.nodes.set(selector, el);
  document.querySelector = (selector) => { if (!document.nodes.has(selector)) document.nodes.set(selector, element()); return document.nodes.get(selector); };
  const posted = [];
  const resp = (ok, body, status = ok ? 200 : 500) => ({ ok, status, statusText: ok ? 'OK' : 'ERR', json: async () => body });
  const ctl = { saved: defaultTs() };
  const sandbox = { document, URLSearchParams, console, setTimeout: () => 0, clearTimeout() {},
    location: { pathname: '/', search: '' }, history: { replaceState() {} }, localStorage: { setItem() {}, getItem: () => null, removeItem() {} },
    window: { addEventListener() {}, confirm: () => true },
    fetch: async (url, opts) => {
      const p = String(url).split('?')[0];
      const method = opts && opts.method;
      if (method === 'POST') posted.push({ url: p, body: JSON.parse(opts.body || '{}') });
      if (p === '/api/tasks/settings') {
        if (method === 'POST') {
          if (posted[posted.length - 1].body.refine) ctl.saved = { ...ctl.saved, refine: posted[posted.length - 1].body.refine };
          return resp(true, { ok: true, settings: ctl.saved });
        }
        return resp(true, { settings: ctl.saved });
      }
      if (p === '/api/dispatch/settings') return resp(true, { settings: { codex: { cliPath: null, timeoutMin: 60, retries: 2 } } });
      return resp(true, {});
    },
  };
  sandbox.__posted = posted;
  sandbox.__ctl = ctl;
  vm.createContext(sandbox);
  vm.runInContext(source.split('/* ---------- 启动 ---------- */')[0], sandbox, { filename: 'app.js' });
  const run = (code) => vm.runInContext(code, sandbox);
  const state = run('state');
  state.project = '/project/a';
  run('toast = () => {}; poll = async () => {}; refreshDrawer = async () => {}; refreshBatch = async () => {}; renderBatchDrawer = () => {};');
  return { sandbox, document, state, run, seed, posted, ctl };
}

function readyView(h) {
  const view = element();
  view.nodes.set('#tsStatus', element());
  view.nodes.set('#tsSave', element());
  view.nodes.set('#tsAutoPlan', element());
  h.seed('#settingsView', view);
  return view;
}

t('A9 设置页 UI：开关渲染（默认不勾选 / 已开启回显）、保存携带 refine 分区、草稿提示、成功 toast 口径', async () => {
  const h = setup();
  // 默认关闭：开关存在且不勾选（REQ-20260909-011：设置区仅剩该开关，无按 Agent 分块）
  let out = h.run(`taskSettingsHtml(${JSON.stringify(defaultTs())})`);
  assert.match(out, /id="tsAutoPlan"/, '设置页含「完善完成后自动转入计划」开关');
  assert.doesNotMatch(out, /id="tsAutoPlan"[^>]*checked/, '默认关闭不勾选');
  assert.ok(out.indexOf('tsAutoPlan') > out.indexOf('<h4>批量任务</h4>'), '开关位于分区标题之后的设置区内');
  assert.match(out, /完善完成后自动转入计划/, '开关文案');
  assert.match(out, /默认关闭 ?[=＝] ?人工移入计划/, '说明文字含默认关闭口径（BUG-20260909-016 精简为全角＝短句）');
  // 已开启回显勾选
  const on = defaultTs();
  on.refine.autoPlanAfterDone = true;
  out = h.run(`taskSettingsHtml(${JSON.stringify(on)})`);
  assert.match(out, /id="tsAutoPlan"[^>]*checked/, '已开启回显勾选');
  // 草稿：切换开关提示未保存
  const view = readyView(h);
  await h.run('renderSettingsView()');
  const sw = view.nodes.get('#tsAutoPlan');
  const statusEl = view.nodes.get('#tsStatus');
  sw.checked = true;
  sw.fire('change');
  assert.match(statusEl.textContent, /有未保存的更改/, '切换开关就近提示未保存');
  // 保存：body 携带 refine.autoPlanAfterDone（REQ-20260909-011：载荷仅含该开关）
  h.posted.length = 0;
  await view.nodes.get('#tsSave').fire('click').result;
  const post = h.posted.find((p) => p.url === '/api/tasks/settings');
  assert.ok(post, '应发起任务设置保存请求');
  assert.deepEqual(post.body, { refine: { autoPlanAfterDone: true } }, '保存仅携带 refine 分区（草稿勾选值）');
  // 成功 toast 口径（源码契约）
  assert.match(source, /toast\('✓ 已保存批量任务设置（流转开关仅对后续完善回执生效）'\)/, '成功 toast 说明生效时机');
});

// ---------- A10 Agent 纪律不变 ----------

t('A10 Agent 纪律不变：HUMAN_ONLY_TO 语义与 state-guard 拦截规则零改动', () => {
  const lib = fs.readFileSync(path.join(pluginRoot, 'scripts', 'lib', 'core.mjs'), 'utf8');
  assert.match(lib, /HUMAN_ONLY_TO = new Set\(\['accepted', 'planned', 'done'\]\)/, 'HUMAN_ONLY_TO 集合不变');
  const guard = fs.readFileSync(path.join(pluginRoot, 'scripts', 'state-guard.mjs'), 'utf8');
  assert.match(guard, /v === 'accepted' \|\| v === 'planned' \|\| v === 'done'/, 'bash 模式仍拦截 atb status <ID> planned');
  assert.match(guard, /path\.basename\(norm\) === 'status\.json'/, 'file 模式仍拦截 status.json 直写');
});

// ---------- A11 面板记录标注 ----------

t('A11 面板记录标注：runAttemptsHtml 对 done+transitioned 显示「已自动转入计划」；未开启不显示；listRefineRuns 透传 autoPlan', async () => {
  const h = setup();
  const rec = (autoPlan) => JSON.stringify([
    { runId: 'run-20990101-000000-0001', itemId: 'REQ-20990101-001', title: 'x', result: 'done', summary: 'ok', attempt: 1, at: '2026-09-09T00:00:00Z', ...(autoPlan ? { autoPlan } : {}) },
  ]);
  let out = h.run(`runAttemptsHtml(${rec({ transitioned: true })}, 1, 'refine')`);
  assert.match(out, /已自动转入计划（planned）/, '流转成功的 done 记录带标注');
  out = h.run(`runAttemptsHtml(${rec({ transitioned: false, reason: 'not-enabled' })}, 1, 'refine')`);
  assert.doesNotMatch(out, /未自动转入计划/, '未开启（默认）不显示标注（与现状输出一致）');
  out = h.run(`runAttemptsHtml(${rec({ transitioned: false, reason: 'not-accepted:planned' })}, 1, 'refine')`);
  assert.match(out, /未自动转入计划（条目当前为 planned）：无需自动转入/, '有原因的未流转显示原因标注');
  out = h.run(`runAttemptsHtml(${rec(null)}, 1, 'develop')`);
  assert.doesNotMatch(out, /自动转入计划/, '无字段的记录（develop 共用渲染）不受影响');
  // listRefineRuns 透传（数据层）
  const { root, dataDir } = mkProject();
  const { got, batch } = claimAndEdit(root, dataDir, '记录标注', { autoPlan: true });
  refine.finishRefineRun(dataDir, got.runId, { result: 'done', summary: '补全' });
  const { records } = refine.listRefineRuns(dataDir, batch.batchId);
  const row = records.find((r) => r.runId === got.runId);
  assert.ok(row, '记录存在');
  assert.deepEqual(row.autoPlan, { transitioned: true }, 'records 透传 autoPlan（面板数据源）');
});

// ---------- A12 人工操作不回退 ----------

t('A12 人工操作不回退：自动置计划的条目可「移出计划」回 accepted（回接受钩子重置未完善——沿既有口径）', () => {
  const { root, dataDir } = mkProject();
  const { req, got } = claimAndEdit(root, dataDir, '移出计划', { autoPlan: true });
  refine.finishRefineRun(dataDir, got.runId, { result: 'done', summary: '补全' });
  assert.equal(statusOf(dataDir, req.id), 'planned', '自动转入计划');
  core.setStatus(dataDir, req.id, 'accepted', { by: 'human' }); // 人工移出计划
  assert.equal(statusOf(dataDir, req.id), 'accepted', '移出计划仍可用');
  assert.equal(refineStates.refineStateOf(dataDir, req.id), 'unrefined', '回已接受钩子重置未完善（既有口径不变）');
  assert.ok(!batch.candidateItems(dataDir).some((x) => x.id === req.id), '移出后退出批量开发候选（与人工置计划无差别）');
});

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
