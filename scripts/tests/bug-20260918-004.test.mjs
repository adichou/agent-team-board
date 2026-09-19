#!/usr/bin/env node
// BUG-20260918-004 确认闭环全量测试硬编码 600 秒超时，长套件永远无法通过确认 —— 修复回归。
// 用法：node scripts/tests/bug-20260918-004.test.mjs
// 覆盖（README 期望行为 / 验收说明）：
//   · U1 confirmTestTimeoutMs 口径链：run.timeoutMin → settings.timeoutMin → 默认 60 分钟，
//     与批次执行同口径；run 账本缺失 / 无确认记录容错回退（验收 2）；
//   · S1 服务端任务超时随口径（验收 1/2）：POST verify 返回的 task.timeoutMs 按口径取值，
//     设置页调整单项时限后新任务随之生效，run.timeoutMin 优先，账本 tasks.json 同步落账；
//   · S2 源码护栏（期望行为 2/3）：startConfirmTask 不再有 36_000_000 / 600_000 硬编码，
//     runProjectTests(Sync) 默认参数不再 600_000（统一 60 分钟口径）；
//   · S3 回归（验收 3）：短套件默认口径行为不变，无测试脚本项目仍按 skipped 跳过。
// 模式对齐 bug-async-verify-20260915-008.test.mjs（真实 server.mjs + HTTP）。

import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as core from '../lib/core.mjs';
import * as batch from '../lib/batch.mjs';
import * as confirmStates from '../lib/confirm-states.mjs';
import * as confirmStore from '../lib/confirm-store.mjs';
import * as dispatchStore from '../lib/dispatch-store.mjs';

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const cases = [];
const t = (name, fn) => cases.push([name, fn]);

function req(port, method, pathname, body) {
  return new Promise((resolve, reject) => {
    const payload = body == null ? null : JSON.stringify(body);
    const r = http.request({
      hostname: '127.0.0.1', port, path: pathname, method,
      headers: payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {},
      timeout: 60_000,
    }, (rs) => {
      let out = '';
      rs.on('data', (c) => { out += c; });
      rs.on('end', () => { try { resolve({ status: rs.statusCode, json: JSON.parse(out || '{}') }); } catch { resolve({ status: rs.statusCode, json: null, raw: out }); } });
    });
    r.on('error', reject);
    r.on('timeout', () => { r.destroy(); reject(new Error('timeout')); });
    if (payload) r.write(payload);
    r.end();
  });
}

function git(root, args) {
  const r = spawnSync('git', ['-c', 'user.email=t@example.com', '-c', 'user.name=t', ...args], {
    cwd: root, encoding: 'utf8', timeout: 30_000,
  });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} 失败：${r.stderr || r.stdout}`);
  return r;
}

function mkProject(testScript = 'node -e "process.exit(0)"') {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'atb-confirm-tmo-')));
  git(root, ['init', '-q', '-b', 'main']);
  fs.writeFileSync(path.join(root, 'README.md'), '# t\n');
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({
    name: 'fixture', version: '1.0.0', private: true,
    scripts: { test: testScript },
  }, null, 2));
  core.initData(root);
  git(root, ['add', '.']);
  git(root, ['commit', '-q', '-m', 'chore: 初始化']);
  return root;
}

// 开发侧挂起夹具（对齐 bug-async-verify-20260915-008）：finishRun 触发挂起声明
function mkDevSuspension(root) {
  const dataDir = core.dataDirFrom(root);
  fs.mkdirSync(path.join(root, 'scripts', 'web'), { recursive: true });
  fs.mkdirSync(path.join(root, 'scripts', 'lib'), { recursive: true });
  fs.writeFileSync(path.join(root, 'scripts', 'web', 'build.js'), 'base\n');
  fs.writeFileSync(path.join(root, 'scripts', 'lib', 'impl.mjs'), 'v1\n');
  git(root, ['add', '.']);
  git(root, ['commit', '-q', '-m', 'chore: 被测源码入库']);
  fs.appendFileSync(path.join(root, 'scripts', 'web', 'build.js'), '上一单遗留脏改动\n');
  const item = core.createItem(dataDir, { type: 'bug', title: '确认超时口径单' });
  core.setStatus(dataDir, item.id, 'accepted', { by: 'human' });
  core.setStatus(dataDir, item.id, 'planned', { by: 'human' });
  batch.createBatch(dataDir, { projectRoot: root });
  const nx = batch.nextItem(dataDir, batch.queueHeadBatch(dataDir).batchId, { owner: 'w1' });
  core.claim(dataDir, item.id, 'w1');
  fs.appendFileSync(path.join(root, 'scripts', 'web', 'build.js'), '本单改动\n');
  fs.mkdirSync(path.join(root, 'scripts', 'tests'), { recursive: true });
  fs.writeFileSync(path.join(root, 'scripts', 'tests', 'impl.test.mjs'), 'import assert from "node:assert/strict";\n');
  fs.appendFileSync(path.join(root, 'scripts', 'lib', 'impl.mjs'), 'v2\n');
  core.report(dataDir, item.id, { summary: '完成', by: 'w1', run: { runId: nx.runId } });
  batch.finishRun(dataDir, nx.runId, { result: 'reported', reportRef: 'test-report.md' });
  return { dataDir, item };
}

// 人工已在终端补齐（全部入库）：核验/确认可进入测试复验阶段
function terminalSupplement(root, itemId) {
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', `fix: 人工终端补交 ${itemId}`]);
}

async function startServer(root) {
  const port = 30000 + Math.floor(Math.random() * 20000);
  const server = spawn(process.execPath, [path.join(pluginRoot, 'scripts', 'server.mjs')], {
    cwd: root,
    env: { ...process.env, ATB_PORT: String(port), ATB_REGISTRY: path.join(os.tmpdir(), `atb-tmo-reg-${Date.now()}-${Math.floor(Math.random() * 1e6)}.json`) },
    stdio: ['ignore', 'ignore', 'ignore'],
  });
  for (let i = 0; i < 50; i++) {
    await sleep(150);
    try { await req(port, 'GET', '/api/health'); return { server, port }; } catch {}
  }
  server.kill();
  throw new Error('服务未启动');
}

function runFileOf(dataDir, itemId) {
  const rec = confirmStates.confirmOf(dataDir, itemId);
  assert.ok(rec && rec.runId, `挂起确认记录应关联 runId：${JSON.stringify(rec && rec.runId)}`);
  return path.join(dataDir, 'runtime', 'dispatch', 'runs', rec.runId, 'run.json');
}

function patchRunTimeout(dataDir, itemId, timeoutMin) {
  const f = runFileOf(dataDir, itemId);
  const run = JSON.parse(fs.readFileSync(f, 'utf8'));
  run.timeoutMin = timeoutMin;
  fs.writeFileSync(f, JSON.stringify(run, null, 2));
}

// ---------- U1：confirmTestTimeoutMs 口径链（与批次执行一致） ----------

t('U1a 默认口径：zcode 批次 run 无 timeoutMin、无设置 → 60 分钟（3_600_000）', () => {
  const root = mkProject();
  const { dataDir, item } = mkDevSuspension(root);
  terminalSupplement(root, item.id);
  assert.equal(confirmStore.confirmTestTimeoutMs(dataDir, item.id, null), 3_600_000,
    '无 run.timeoutMin 且无设置时应取默认 60 分钟');
});

t('U1b 设置口径：settings.timeoutMin 生效（5 → 300_000）', () => {
  const root = mkProject();
  const { dataDir, item } = mkDevSuspension(root);
  terminalSupplement(root, item.id);
  dispatchStore.saveSettings(dataDir, { codex: { timeoutMin: 5 } });
  assert.equal(
    confirmStore.confirmTestTimeoutMs(dataDir, item.id, dispatchStore.loadSettings(dataDir).codex.timeoutMin),
    300_000,
    '设置页单项时限应进入确认任务超时口径',
  );
});

t('U1c run 优先：run.timeoutMin=15（设置 5）→ 900_000', () => {
  const root = mkProject();
  const { dataDir, item } = mkDevSuspension(root);
  terminalSupplement(root, item.id);
  dispatchStore.saveSettings(dataDir, { codex: { timeoutMin: 5 } });
  patchRunTimeout(dataDir, item.id, 15);
  assert.equal(confirmStore.confirmTestTimeoutMs(dataDir, item.id, 5), 900_000,
    'run.timeoutMin 应优先于设置（与批次执行链路一致）');
});

t('U1d 容错：run 账本缺失按设置/默认回退；无确认记录不抛错', () => {
  const root = mkProject();
  const { dataDir, item } = mkDevSuspension(root);
  terminalSupplement(root, item.id);
  fs.rmSync(path.dirname(runFileOf(dataDir, item.id)), { recursive: true, force: true });
  assert.equal(confirmStore.confirmTestTimeoutMs(dataDir, item.id, 5), 300_000, 'run 账本缺失应回退设置口径');
  assert.equal(confirmStore.confirmTestTimeoutMs(dataDir, item.id, null), 3_600_000, 'run 账本缺失且无设置应回退默认 60 分钟');
  assert.equal(confirmStore.confirmTestTimeoutMs(dataDir, 'REQ-20990101-001', 9), 540_000, '无确认记录应按传入设置回退');
  assert.equal(confirmStore.confirmTestTimeoutMs(dataDir, 'REQ-20990101-001', null), 3_600_000, '无确认记录且无设置应取默认 60 分钟');
});

// ---------- S1：服务端任务超时随口径（HTTP + 账本） ----------

t('S1 verify 任务 timeoutMs 与批次执行同口径：默认 60 分钟 → 设置 5 分钟生效 → run.timeoutMin 优先；账本同步落账', async () => {
  const root = mkProject();
  const { dataDir, item } = mkDevSuspension(root);
  terminalSupplement(root, item.id);
  const { server, port } = await startServer(root);
  const P = `?project=${encodeURIComponent(root)}`;
  const taskOf = async () => {
    const r = await req(port, 'POST', `/api/confirms/${item.id}/verify${P}`, { runTests: false });
    assert.equal(r.status, 200);
    assert.equal(r.json.accepted, true, `应返回任务句柄：${JSON.stringify(r.json)}`);
    return r.json.task;
  };
  const waitDone = async () => {
    for (let i = 0; i < 100; i++) {
      const tk = await req(port, 'GET', `/api/confirms/${item.id}/task${P}`);
      if (tk.json.task && tk.json.task.status !== 'running') return tk.json.task;
      await sleep(100);
    }
    throw new Error('核验任务未在预期时间内完成');
  };
  try {
    // 默认（zcode 批次 run 无 timeoutMin、无设置）：60 分钟，不再硬编码 600 秒 / 10 小时
    let task = await taskOf();
    assert.equal(task.timeoutMs, 3_600_000, `默认应为 60 分钟口径（实际 ${task.timeoutMs}）`);
    await waitDone();
    let ledger = JSON.parse(fs.readFileSync(path.join(dataDir, 'runtime', 'confirms', 'tasks.json'), 'utf8'));
    assert.equal(ledger.tasks[item.id].timeoutMs, 3_600_000, '账本 tasks.json 应同步落口径值');

    // 设置页调整单项时限（验收 2）：新任务随之生效
    dispatchStore.saveSettings(dataDir, { codex: { timeoutMin: 5 } });
    task = await taskOf();
    assert.equal(task.timeoutMs, 300_000, `设置 5 分钟应对确认任务生效（实际 ${task.timeoutMs}）`);
    await waitDone();

    // run.timeoutMin 优先（codex-exec run 形态）：15 分钟
    patchRunTimeout(dataDir, item.id, 15);
    task = await taskOf();
    assert.equal(task.timeoutMs, 900_000, `run.timeoutMin 应优先于设置（实际 ${task.timeoutMs}）`);
    await waitDone();
  } finally {
    server.kill();
  }
});

// ---------- S2：源码护栏（不再出现硬编码超时常量） ----------

t('S2 startConfirmTask 与测试执行器默认参数不再硬编码超时', () => {
  const serverSrc = fs.readFileSync(path.join(pluginRoot, 'scripts', 'server.mjs'), 'utf8');
  const start = serverSrc.indexOf('function startConfirmTask(');
  const end = serverSrc.indexOf('function recoverConfirmTasks(');
  assert.ok(start > 0 && end > start, 'server.mjs 应包含 startConfirmTask 片段');
  const frag = serverSrc.slice(start, end);
  assert.ok(!frag.includes('36_000_000') && !frag.includes('600_000'),
    `startConfirmTask 不应再含硬编码超时（36_000_000 / 600_000）`);
  assert.ok(frag.includes('confirmTestTimeoutMs'), 'startConfirmTask 应经 confirmTestTimeoutMs 取口径值');

  const storeSrc = fs.readFileSync(path.join(pluginRoot, 'scripts', 'lib', 'confirm-store.mjs'), 'utf8');
  assert.ok(!/timeoutMs = 600_000/.test(storeSrc), 'runProjectTests(Sync) 默认参数不应再为 600_000');
  assert.ok(/timeoutMs = 60 \* 60_000/.test(storeSrc), '默认参数应统一为 60 分钟口径');
});

// ---------- S3：回归（短套件 / 无测试脚本口径不变） ----------

t('S3a 短套件回归：默认口径下快测正常通过', async () => {
  const root = mkProject('node -e "process.exit(0)"');
  const r = await confirmStore.runProjectTestsAsync(root);
  assert.equal(r.ok, true, `快测应通过：${JSON.stringify(r)}`);
  assert.equal(r.exitCode, 0);
  assert.notEqual(r.timedOut, true);
});

t('S3b 无测试脚本口径：无 package.json 仍按 skipped 跳过（不凭空要求）', async () => {
  const none = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'atb-tmo-nopkg-')));
  const rNone = await confirmStore.runProjectTestsAsync(none);
  assert.equal(rNone.skipped, true, '无 package.json 应按无测试脚本口径跳过');
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
