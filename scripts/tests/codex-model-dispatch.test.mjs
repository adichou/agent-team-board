#!/usr/bin/env node
// REQ-20260906-024 Codex 派发模型配置 —— 调度器集成测试（假 CLI 端到端）
// 覆盖 test-cases：M04（快照稳定）、M05（重启恢复/提供方变化）、M09（模型错误暂停+待处理）、
// M12（新配置重试关联记录）、M13（重复点击至多一次执行）、M14（启动前配置失败不认领）、M17（运行时模型不一致）。
// 用法：node scripts/tests/codex-model-dispatch.test.mjs

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as core from '../lib/core.mjs';
import * as store from '../lib/dispatch-store.mjs';
import { createScheduler, createHub } from '../lib/scheduler.mjs';

const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const FIXTURE = path.join(PLUGIN_ROOT, 'scripts', 'tests', 'fixtures', 'fake-codex.mjs');
const ATB = path.join(PLUGIN_ROOT, 'scripts', 'atb.mjs');

const cases = [];
const t = (name, fn) => cases.push([name, fn]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(cond, timeoutMs = 15_000, label = '') {
  const start = Date.now();
  for (;;) {
    if (cond()) return true;
    if (Date.now() - start > timeoutMs) throw new Error(`等待超时：${label || cond.name}`);
    await sleep(30);
  }
}

function tempProject() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atb-mdisp-'));
  core.initData(root);
  return root;
}

function makeItem(dataDir, { type = 'req', title, accept = true }) {
  const st = core.createItem(dataDir, { type: type === 'bug' ? 'bug' : 'requirement', title, by: 't' });
  // REQ-20260908-010：调度只从 planned（已计划）取单，接受后默认置计划
  if (accept) {
    core.setStatus(dataDir, st.id, 'accepted', { by: 'human' });
    core.setStatus(dataDir, st.id, 'planned', { by: 'human' });
  }
  return st.id;
}

// 隔离本机 codex 配置：CODEX_HOME 指到临时目录（读取与子进程环境一致）
function withCodexHome(home, fn) {
  return async () => {
    const old = process.env.CODEX_HOME;
    process.env.CODEX_HOME = home;
    try {
      await fn();
    } finally {
      if (old === undefined) delete process.env.CODEX_HOME;
      else process.env.CODEX_HOME = old;
    }
  };
}

// modeHolder：可变模式（{} 包一层让闭包读到最新值）；recordDir 按尝试分文件记录 argv
function mkScheduler(root, modeHolder, opts = {}) {
  const dataDir = core.requireDataDir(root);
  return createScheduler({
    projectRoot: root,
    dataDir,
    hub: opts.hub || createHub(),
    atbCliPath: ATB,
    cli: {
      path: opts.cliPath || process.execPath,
      spawnArgs: [FIXTURE],
      envForRun: (run) => ({
        FAKE_MODE: typeof modeHolder.mode === 'function' ? modeHolder.mode(run) : modeHolder.mode,
        FAKE_ATB_CLI: ATB,
        FAKE_ITEM_ID: run.itemId,
        FAKE_RECORD: path.join(store.runDir(dataDir, run.runId), `worker-record-a${run.attempts.length + 1}.json`),
        ...(opts.extraEnv || {}),
      }),
    },
    tickMs: opts.tickMs ?? 40,
    backoffs: opts.backoffs ?? [50, 80],
    cancelGraceMs: opts.cancelGraceMs ?? 200,
    settleMs: opts.settleMs ?? 120,
    maxResumeRounds: opts.maxResumeRounds ?? 2,
    timeoutMs: opts.timeoutMs ?? 60_000,
  });
}

function readRecord(root, runId, n) {
  try {
    return JSON.parse(fs.readFileSync(path.join(store.runDir(core.requireDataDir(root), runId), `worker-record-a${n}.json`), 'utf8'));
  } catch { return null; }
}

const argvModelOf = (rec) => {
  if (!rec) return null;
  const i = rec.argv.indexOf('--model');
  const j = rec.argv.indexOf('-c');
  return { model: i !== -1 ? rec.argv[i + 1] : null, effortArg: j !== -1 ? rec.argv[j + 1] : null };
};

// ---------- M14：启动前配置失败 → 不创建运行、不认领、暂停 + 待处理 ----------

t('M14 本机配置无法解析时不认领条目：无运行、条目保持 accepted、暂停并登记待处理', withCodexHome(path.join(os.tmpdir(), `atb-empty-home-${Date.now()}`), async () => {
  const root = tempProject();
  const d = core.requireDataDir(root);
  const id = makeItem(d, { title: '继承不可解析' });
  const mode = { mode: 'worker-ok' };
  const s = mkScheduler(root, mode);
  s.enable();
  await sleep(600);
  s.stop();
  assert.equal(store.listRuns(d).total, 0, '不得创建任何运行');
  const it = core.getItemDetail(d, id);
  assert.equal(it.status, 'planned', '条目不得被认领');
  assert.ok(s.status().paused, '执行器应暂停');
  assert.match(s.status().pauseReason || '', /模型配置待处理|解析失败/);
  const pend = store.listModelPending(d, { onlyOpen: true });
  assert.equal(pend.length, 1, '应有一条持久待处理记录');
  assert.equal(pend[0].kind, 'config-unresolved');
  assert.equal(pend[0].itemId, id);
  assert.equal(pend[0].runId, null, '启动前失败无 runId');
}));

// ---------- 项目显式选择 + M04 快照稳定 ----------

t('M04a 项目指定模型：运行快照记录所选模型/强度，CLI 收到 --model 与 -c 参数', withCodexHome(path.join(os.tmpdir(), `atb-empty-home-${Date.now()}`), async () => {
  const root = tempProject();
  const d = core.requireDataDir(root);
  makeItem(d, { title: '项目指定' });
  store.saveSettings(d, { codex: { modelSelection: { mode: 'explicit', modelId: 'fake-astra', reasoningEffort: 'high' } } });
  const s = mkScheduler(root, { mode: 'worker-ok' });
  s.enable();
  await waitFor(() => store.listRuns(d).total === 1 && store.listRuns(d).items[0].phase === 'reported');
  s.stop();
  const run = store.listRuns(d).items[0];
  assert.equal(run.modelSnapshot.mode, 'explicit');
  assert.equal(run.modelSnapshot.modelId, 'fake-astra');
  assert.equal(run.modelSnapshot.reasoningEffort, 'high');
  assert.equal(run.modelSnapshot.source, 'project-explicit');
  const rec = argvModelOf(readRecord(root, run.runId, 1));
  assert.equal(rec.model, 'fake-astra');
  assert.equal(rec.effortArg, 'model_reasoning_effort="high"');
}));

t('M04b 运行创建后修改项目设置：续跑轮仍用原快照参数，不重新套用新值', withCodexHome(path.join(os.tmpdir(), `atb-empty-home-${Date.now()}`), async () => {
  const root = tempProject();
  const d = core.requireDataDir(root);
  makeItem(d, { title: '快照固定' });
  store.saveSettings(d, { codex: { modelSelection: { mode: 'explicit', modelId: 'fake-astra', reasoningEffort: 'low' } } });
  const mode = { mode: 'worker-late-report' }; // 首轮不上报 → 触发续跑
  const s = mkScheduler(root, mode);
  s.enable();
  await waitFor(() => store.listRuns(d).total === 1);
  const runId = store.listRuns(d).items[0].runId;
  await waitFor(() => readRecord(root, runId, 1) != null);
  // 第一轮启动后修改项目默认（不应影响本 run 的续跑）
  store.saveSettings(d, { codex: { modelSelection: { mode: 'explicit', modelId: 'fake-mini', reasoningEffort: 'medium' } } });
  await waitFor(() => store.getRun(d, runId).phase === 'reported', 15_000);
  s.stop();
  const fresh = store.getRun(d, runId);
  assert.equal(fresh.modelSnapshot.modelId, 'fake-astra', '账本快照不变');
  assert.equal(fresh.modelSnapshot.reasoningEffort, 'low');
  const r1 = argvModelOf(readRecord(root, runId, 1));
  const r2 = argvModelOf(readRecord(root, runId, 2));
  assert.equal(r2.model, 'fake-astra', '续跑轮仍用原快照模型');
  assert.equal(r2.effortArg, 'model_reasoning_effort="low"');
  assert.equal(r1.model, r2.model);
}));

// ---------- M02c：本项覆盖优先（调度器端到端） ----------

t('M02c 单项指定优先于项目默认；取消覆盖后新执行回到项目默认', withCodexHome(path.join(os.tmpdir(), `atb-empty-home-${Date.now()}`), async () => {
  const root = tempProject();
  const d = core.requireDataDir(root);
  const id = makeItem(d, { title: '单项覆盖' });
  store.saveSettings(d, { codex: { modelSelection: { mode: 'explicit', modelId: 'fake-astra', reasoningEffort: 'low' } } });
  store.saveItemModelSelection(d, id, { mode: 'explicit', modelId: 'fake-mini', reasoningEffort: 'medium' });
  const s = mkScheduler(root, { mode: 'worker-ok' });
  s.enable();
  await waitFor(() => store.listRuns(d).total === 1 && store.listRuns(d).items[0].phase === 'reported');
  s.stop();
  let run = store.listRuns(d).items[0];
  assert.equal(run.modelSnapshot.source, 'item-explicit');
  assert.equal(run.modelSnapshot.modelId, 'fake-mini');
  // 取消本项覆盖（继承项目）→ 以新配置重试（条目已 in-progress，走重试通道）
  store.saveItemModelSelection(d, id, { mode: 'inherit' });
  const r = s.retryItemWithConfig({ runId: run.runId, modelSelection: { mode: 'inherit' } });
  assert.ok(r.ok, `再次执行失败：${r.error || ''}`);
  await waitFor(() => store.listRuns(d).items[0].phase === 'reported', 15_000);
  s.stop();
  run = store.listRuns(d).items[0];
  assert.equal(run.modelSnapshot.source, 'project-explicit');
  assert.equal(run.modelSnapshot.modelId, 'fake-astra');
}));

// ---------- M09：模型错误暂停派发 + 待处理 + 不连带整个队列 ----------

t('M09a 模型不存在：运行失败、暂停执行器、登记待处理、其余条目不被逐项失败', withCodexHome(path.join(os.tmpdir(), `atb-empty-home-${Date.now()}`), async () => {
  const root = tempProject();
  const d = core.requireDataDir(root);
  const idA = makeItem(d, { title: 'A 先失败' });
  const idB = makeItem(d, { title: 'B 不应被拖垮' });
  store.saveSettings(d, { codex: { modelSelection: { mode: 'explicit', modelId: 'fake-astra', reasoningEffort: 'low' } } });
  const mode = { mode: 'model-missing' };
  const s = mkScheduler(root, mode);
  s.enable();
  await waitFor(() => store.listRuns(d).total === 1 && store.listRuns(d).items[0].phase === 'failed');
  await sleep(300); // 留窗口证明不会继续取 B
  s.stop();
  const runs = store.listRuns(d);
  assert.equal(runs.total, 1, '只应有 A 的一条运行（B 未被连带派发失败）');
  const run = runs.items[0];
  assert.equal(run.result.reason, 'model-missing');
  assert.ok(run.modelSnapshot, '失败运行保留快照');
  const pend = store.listModelPending(d, { onlyOpen: true });
  assert.equal(pend.length, 1);
  assert.equal(pend[0].kind, 'model-missing');
  assert.equal(pend[0].itemId, idA);
  assert.equal(pend[0].runId, run.runId);
  assert.ok(s.status().paused, '执行器应暂停');
  assert.equal(core.getItemDetail(d, idB).status, 'planned', 'B 保持已计划，未被认领');
  assert.equal(core.getItemDetail(d, idA).status, 'in-progress', 'A 业务状态不被回退');
  // 同一问题不重复登记：手动再 tick 一次也不新增
  await s.tick();
  assert.equal(store.listModelPending(d, { onlyOpen: true }).length, 1, '同条目同类待处理应合并');
}));

t('M09b 强度不支持与无权限分别归类，不降级模型', withCodexHome(path.join(os.tmpdir(), `atb-empty-home-${Date.now()}`), async () => {
  for (const [modeName, kind] of [['effort-unsupported', 'effort-unsupported'], ['model-denied', 'model-denied']]) {
    const root = tempProject();
    const d = core.requireDataDir(root);
    makeItem(d, { title: kind });
    store.saveSettings(d, { codex: { modelSelection: { mode: 'explicit', modelId: 'fake-mini', reasoningEffort: 'medium' } } });
    const s = mkScheduler(root, { mode: modeName });
    s.enable();
    await waitFor(() => store.listRuns(d).total === 1 && store.listRuns(d).items[0].phase === 'failed');
    s.stop();
    const run = store.listRuns(d).items[0];
    assert.equal(run.result.reason, kind, `${modeName} 应归类为 ${kind}`);
    assert.equal(run.modelSnapshot.modelId, 'fake-mini', '不自动降级/换模型');
    assert.equal(store.listModelPending(d, { onlyOpen: true })[0].kind, kind);
  }
}));

// ---------- M12/M13：以新配置重试本项 ----------

t('M12/M13 以新配置重试：建立关联新运行、保留原记录、重复点击只产生一次执行；上报后待处理关闭', withCodexHome(path.join(os.tmpdir(), `atb-empty-home-${Date.now()}`), async () => {
  const root = tempProject();
  const d = core.requireDataDir(root);
  const id = makeItem(d, { title: '换模型重试' });
  store.saveSettings(d, { codex: { modelSelection: { mode: 'explicit', modelId: 'fake-astra', reasoningEffort: 'low' } } });
  const mode = { mode: 'model-missing' };
  const s = mkScheduler(root, mode);
  s.enable();
  await waitFor(() => store.listRuns(d).total === 1 && store.listRuns(d).items[0].phase === 'failed');
  s.stop();
  const oldRun = store.listRuns(d).items[0];
  assert.equal(store.listModelPending(d, { onlyOpen: true }).length, 1);

  // 保存/验证不自动恢复：仅改设置不产生新运行
  store.saveSettings(d, { codex: { modelSelection: { mode: 'explicit', modelId: 'fake-mini', reasoningEffort: 'medium' } } });
  await sleep(150);
  assert.equal(store.listRuns(d).total, 1, '保存设置不得自动启动新执行');

  // 以新配置重试（走守规 worker 模式，完成认领+上报）
  mode.mode = 'worker-ok';
  const retry = s.retryItemWithConfig({
    runId: oldRun.runId,
    modelSelection: { mode: 'explicit', modelId: 'fake-mini', reasoningEffort: 'medium' },
  });
  assert.ok(retry.ok, `重试失败：${retry.error || ''}`);
  // 重复点击（模拟双击/并发）：至多一次执行
  const dup = s.retryItemWithConfig({
    runId: oldRun.runId,
    modelSelection: { mode: 'explicit', modelId: 'fake-mini', reasoningEffort: 'medium' },
  });
  assert.equal(dup.ok, false, '执行中不得重复创建');
  await waitFor(() => store.getRun(d, retry.runId).phase === 'reported', 15_000);
  s.stop();

  const newRun = store.getRun(d, retry.runId);
  assert.equal(newRun.modelSnapshot.modelId, 'fake-mini');
  assert.equal(newRun.modelSnapshot.reasoningEffort, 'medium');
  assert.equal(newRun.supersedes.runId, oldRun.runId, '新运行关联原运行');
  assert.equal(newRun.supersedes.reason, 'model-change');
  const oldFresh = store.getRun(d, oldRun.runId);
  assert.equal(oldFresh.phase, 'failed', '原运行记录保留不覆写');
  assert.equal(oldFresh.modelSnapshot.modelId, 'fake-astra', '原运行保留旧模型信息');
  assert.equal(oldFresh.result.reason, 'model-missing');
  assert.equal(store.listModelPending(d, { onlyOpen: true }).length, 0, '上报成功后待处理应关闭');
  // 过期 runId 请求：以旧 runId 再试 → 拒绝（不启动新任务）
  const stale = s.retryItemWithConfig({ runId: oldRun.runId, modelSelection: { mode: 'inherit' } });
  assert.equal(stale.ok, false, '过期 requestId/runId 不得启动新任务');
  assert.match(stale.error, /更新|刷新/);
}));

// ---------- M05：重启恢复用快照；提供方变化暂停核对 ----------

t('M05 重启后恢复本项：沿用原快照参数；提供方身份变化时拒绝恢复', withCodexHome(path.join(os.tmpdir(), `atb-empty-home-${Date.now()}`), async () => {
  const root = tempProject();
  const d = core.requireDataDir(root);
  const id = makeItem(d, { title: '重启恢复' });
  // 项目层继承（含 provider），避免依赖本机配置
  fs.mkdirSync(path.join(root, '.codex'), { recursive: true });
  fs.writeFileSync(path.join(root, '.codex', 'config.toml'),
    'model = "fake-astra"\nmodel_reasoning_effort = "low"\nmodel_provider = "openai"\n');
  const mode = { mode: 'worker-stuck' }; // 永不上报 → 续跑耗尽 → blocked
  const s1 = mkScheduler(root, mode, { maxResumeRounds: 0 });
  s1.enable();
  await waitFor(() => store.listRuns(d).total === 1 && store.listRuns(d).items[0].phase === 'blocked');
  s1.stop();
  const run = store.listRuns(d).items[0];
  assert.ok(run.modelSnapshot && run.modelSnapshot.modelId === 'fake-astra');
  assert.equal(run.modelSnapshot.provider, 'openai');

  // 模拟服务重启：新调度器实例读同一账本
  mode.mode = 'worker-ok';
  const s2 = mkScheduler(root, mode);
  const resume = s2.resumeItem(run.runId);
  assert.ok(resume.ok, `恢复失败：${resume.error || ''}`);
  await waitFor(() => store.getRun(d, run.runId).phase === 'reported', 15_000);
  s2.stop();
  const rec = argvModelOf(readRecord(root, run.runId, run.attempts.length + 1));
  assert.equal(rec.model, 'fake-astra', '重启恢复沿用原快照模型');
  assert.equal(rec.effortArg, 'model_reasoning_effort="low"');

  // 提供方身份变化：改项目层 provider → 再造一条 blocked run 后拒绝恢复
  fs.writeFileSync(path.join(root, '.codex', 'config.toml'),
    'model = "fake-astra"\nmodel_reasoning_effort = "low"\nmodel_provider = "other-provider"\n');
  const id2 = makeItem(d, { title: '换提供方' });
  mode.mode = 'worker-stuck';
  const s3 = mkScheduler(root, mode, { maxResumeRounds: 0 });
  s3.enable();
  await waitFor(() => {
    const rs = store.listRuns(d).items.filter((r) => r.itemId === id2);
    return rs.length === 1 && rs[0].phase === 'blocked';
  });
  s3.stop();
  const run2 = store.listRuns(d).items.find((r) => r.itemId === id2);
  assert.equal(run2.modelSnapshot.provider, 'other-provider', '快照提供方是创建时的 other-provider（当前配置）');
  fs.writeFileSync(path.join(root, '.codex', 'config.toml'),
    'model = "fake-astra"\nmodel_reasoning_effort = "low"\nmodel_provider = "changed-now"\n');
  const s4 = mkScheduler(root, { mode: 'worker-ok' });
  const blocked = s4.resumeItem(run2.runId);
  assert.equal(blocked.ok, false, '提供方变化应暂停核对，拒绝直接恢复');
  assert.match(blocked.error, /提供方/);
  s4.stop();
}));

// ---------- M17：运行时返回模型与请求不一致 → 记录确认值并暂停 ----------

t('M17 运行时确认值：一致时如实保存；不一致时暂停并登记待处理', withCodexHome(path.join(os.tmpdir(), `atb-empty-home-${Date.now()}`), async () => {
  // 一致：CLI 回显同模型
  {
    const root = tempProject();
    const d = core.requireDataDir(root);
    makeItem(d, { title: '回显一致' });
    store.saveSettings(d, { codex: { modelSelection: { mode: 'explicit', modelId: 'fake-astra', reasoningEffort: 'low' } } });
    const s = mkScheduler(root, { mode: 'ok' }, { extraEnv: { FAKE_RUNTIME_MODEL: 'fake-astra' } });
    s.enable();
    await waitFor(() => store.listRuns(d).total === 1 && store.listRuns(d).items[0].phase !== 'running' && store.listRuns(d).items[0].phase !== 'reserved');
    s.stop();
    const run = store.listRuns(d).items[0];
    assert.equal(run.modelConfirmed, 'fake-astra', '运行时确认值单独保存');
  }
  // 不一致：暂停派发 + 待处理
  {
    const root = tempProject();
    const d = core.requireDataDir(root);
    makeItem(d, { title: '回显不一致' });
    store.saveSettings(d, { codex: { modelSelection: { mode: 'explicit', modelId: 'fake-astra', reasoningEffort: 'low' } } });
    const s = mkScheduler(root, { mode: 'ok' }, { extraEnv: { FAKE_RUNTIME_MODEL: 'actually-other-model' } });
    s.enable();
    await waitFor(() => store.listRuns(d).total === 1);
    await waitFor(() => store.getRun(d, store.listRuns(d).items[0].runId).modelConfirmed != null);
    await sleep(300);
    s.stop();
    const st = s.status();
    assert.ok(st.paused || store.listModelPending(d, { onlyOpen: true }).length === 1, '不一致应暂停或登记待处理');
    const pend = store.listModelPending(d, { onlyOpen: true });
    assert.equal(pend.length, 1);
    assert.equal(pend[0].kind, 'model-mismatch');
    assert.match(pend[0].summary, /fake-astra.*actually-other-model|actually-other-model.*fake-astra/);
  }
}));

// ---------- M03 后端拒绝非法组合（调度器入口） ----------

t('M03 后端拒绝：已知模型 + 不支持强度 → 不创建运行并给出原因', withCodexHome(path.join(os.tmpdir(), `atb-empty-home-${Date.now()}`), async () => {
  const root = tempProject();
  const d = core.requireDataDir(root);
  const id = makeItem(d, { title: '非法组合' });
  store.saveItemModelSelection(d, id, { mode: 'explicit', modelId: 'fake-mini', reasoningEffort: 'ultra' }); // fake-mini 仅支持 medium
  const s = mkScheduler(root, { mode: 'worker-ok' });
  s.enable();
  await sleep(500);
  s.stop();
  assert.equal(store.listRuns(d).total, 0, '非法组合不得创建运行');
  const pend = store.listModelPending(d, { onlyOpen: true });
  assert.equal(pend.length, 1, '应登记待处理说明原因');
  assert.match(pend[0].summary, /不支持/);
  assert.equal(core.getItemDetail(d, id).status, 'planned', '条目未被认领');
}));

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
