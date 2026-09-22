#!/usr/bin/env node
// BUG-20260922-004 确认记录被并发写回退：已确认（resolved）的提交挂起被旧进程滞留任务
// 覆盖回 waiting 并抹掉 confirmed 事件 —— 修复回归。
// 用法：node scripts/tests/bug-20260922-004.test.mjs
// 覆盖（README 期望行为）：
//   · C1 核心竞态复现：滞留 continue 任务的测试复验期间，人工经另一入口确认成功（resolved
//     落盘）——滞留任务随后失败/成功，其过期内存副本不得整写回：不回退 waiting、不抹掉
//     confirmed 事件；resolved 后的重复确认幂等拒绝（不复活 waiting）；
//   · C2 合并写回：滞留 verify 任务测试期间服务重启留痕（task-interrupted 事件落盘）——
//     核验结论落账不得抹掉并发留痕事件（仍 waiting 同轮 → 以最新记录为基座合并）；
//   · C3 换轮守卫：测试期间记录已闭环并归档重开新一轮——过期结果拒绝写回，
//     新一轮现场（round/state/events）不被旧副本覆盖；
//   · C4 入口幂等：已 resolved 记录重复核验幂等跳过，不再把核验结果覆写到已闭环记录；
//   · S1 进程生命周期（双服务进程共享同一数据目录，复现「旧进程滞留回调」）：旧进程任务
//     运行中新进程启动（恢复核对标记 interrupted + 留痕），旧进程任务随后完成——
//     任务账本不得被复活成 done，确认记录保留 task-interrupted 留痕且核验结论合并落账。
// 模式对齐 bug-async-verify-20260915-008.test.mjs（同夹具：真实 git 项目 + finishRun 挂起；
// 并发写入经注入的 testRunner 在 await 窗口内触发，服务级用真实 server.mjs + HTTP）。

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
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'atb-stale-write-')));
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
  const item = core.createItem(dataDir, { type: 'bug', title: '过期写回单' });
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

// 人工已在终端补齐（全部入库）：核验/确认将进入测试复验阶段
function terminalSupplement(root, itemId) {
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', `fix: 人工终端补交 ${itemId}`]);
}

const eventKinds = (rec) => (rec.events || []).map((e) => e.kind);

// 人工经「另一入口」（新进程/CLI）确认成功：快速测试复验通过 → resolved 落盘
async function resolveViaFreshPath(dataDir, root, itemId, fingerprint) {
  return confirmStore.confirmCommitContinue(dataDir, itemId, {
    projectRoot: root,
    fingerprint,
    by: 'human',
    testRunner: async () => ({ cmd: 'npm test', exitCode: 0, ok: true }),
  });
}

// ---------- C1：核心竞态复现（resolved 回退 + confirmed 事件被抹） ----------

t('C1 滞留 continue 测试期间人工已确认恢复：过期结果不得回退 waiting/抹掉 confirmed；重复确认幂等拒绝', async () => {
  const root = mkProject();
  const { dataDir, item } = mkDevSuspension(root);
  terminalSupplement(root, item.id);
  const rec0 = confirmStates.confirmOf(dataDir, item.id);
  let inner = null;
  // 滞留任务（旧进程视角）：装载记录 → await 测试复验（分钟级窗口）→ 携过期内存副本写回
  const stale = await confirmStore.confirmCommitContinue(dataDir, item.id, {
    projectRoot: root,
    fingerprint: rec0.fingerprint,
    by: 'board',
    testRunner: async () => {
      // 测试运行期间：人工经重启后的新入口确认成功（resolved + confirmed 事件落盘）
      inner = await resolveViaFreshPath(dataDir, root, item.id, rec0.fingerprint);
      // 滞留任务的测试随后失败 → 尝试写回 confirm-rejected（本次缺陷的覆盖路径）
      return { cmd: 'npm test', exitCode: 3, ok: false };
    },
  });
  assert.equal(inner && inner.ok, true, `并发（新入口）确认应成功：${JSON.stringify(inner)}`);
  assert.equal(stale.ok, true, `滞留确认对已 resolved 记录应幂等成功返回：${JSON.stringify(stale)}`);
  assert.equal(stale.idempotent, true, 'resolved 后的重复确认应幂等拒绝（idempotent），不复活 waiting');
  const rec = confirmStates.confirmOf(dataDir, item.id);
  assert.equal(rec.state, 'resolved', `记录必须保持 resolved（不回退 waiting）：实际 ${rec.state}`);
  assert.ok(rec.resolvedAt, 'resolvedAt 保留');
  const kinds = eventKinds(rec);
  assert.ok(kinds.includes('confirmed'), 'confirmed 事件不得被过期写回抹掉');
  assert.ok(!kinds.includes('confirm-rejected'), '滞留任务的拒绝事件不得写入已 resolved 记录');
});

// ---------- C2：合并写回（并发留痕事件不丢） ----------

t('C2 滞留 verify 测试期间服务重启留痕：核验结论合并落账，task-interrupted 留痕不被抹掉', async () => {
  const root = mkProject();
  const { dataDir, item } = mkDevSuspension(root);
  terminalSupplement(root, item.id);
  const r = await confirmStore.verifyCommitConfirm(dataDir, item.id, {
    projectRoot: root,
    runTests: true,
    by: 'board',
    testRunner: async () => {
      // 测试运行期间服务重启：新进程恢复逻辑对确认记录留痕中断事件（独立落盘）
      const noted = confirmStore.noteConfirmTaskInterrupted(dataDir, item.id, '服务重启，运行中的核验/确认任务已中断');
      assert.equal(noted, true, '并发留痕应成功写入');
      return { cmd: 'npm test', exitCode: 0, ok: true };
    },
  });
  assert.equal(r.ok, true, `核验应通过：${JSON.stringify(r)}`);
  const rec = confirmStates.confirmOf(dataDir, item.id);
  assert.equal(rec.state, 'waiting', '未人工确认保持 waiting');
  assert.equal(rec.verify.ok, true, '核验结论照常落账');
  const kinds = eventKinds(rec);
  const ti = kinds.indexOf('task-interrupted');
  const vf = kinds.indexOf('verified');
  assert.ok(ti >= 0, '并发留痕 task-interrupted 不得被过期整写抹掉');
  assert.ok(vf >= 0, '本次核验事件应落账');
  assert.ok(ti < vf, '并发事件先于本次核验事件（顺序保留）');
});

// ---------- C3：换轮守卫（新一轮现场不被旧副本覆盖） ----------

t('C3 滞留 verify 测试期间记录已闭环归档重开新一轮：过期结果拒绝写回，新一轮现场不被覆盖', async () => {
  const root = mkProject();
  const { dataDir, item } = mkDevSuspension(root);
  terminalSupplement(root, item.id);
  const rec0 = confirmStates.confirmOf(dataDir, item.id);
  const r = await confirmStore.verifyCommitConfirm(dataDir, item.id, {
    projectRoot: root,
    runTests: true,
    by: 'board',
    testRunner: async () => {
      await resolveViaFreshPath(dataDir, root, item.id, rec0.fingerprint);
      // 闭环后旧轮归档、新一轮挂起声明（模拟下一单再次提交失败挂起）
      confirmStore.declareCommitConfirm(dataDir, {
        run: { itemId: item.id, runId: rec0.runId, batchId: rec0.batchId, owner: 'w2' },
        autoCommit: { status: 'failed', reason: '模拟新一轮自动提交失败' },
        projectRoot: root,
      });
      return { cmd: 'npm test', exitCode: 0, ok: true };
    },
  });
  assert.equal(r.ok, false, '过期结果应拒绝（不写回）');
  assert.ok((r.reasons || []).some((x) => /新一轮/.test(x)), `拒绝原因应说明新一轮：${JSON.stringify(r.reasons)}`);
  const rec = confirmStates.confirmOf(dataDir, item.id);
  assert.equal(rec.round, 2, `新一轮记录保持现场（实际第 ${rec.round} 轮）`);
  assert.equal(rec.state, 'waiting');
  const kinds = eventKinds(rec);
  assert.ok(!kinds.includes('verified'), '滞留任务的核验事件不得写入新一轮记录');
  assert.ok(!kinds.includes('confirm-rejected'), '滞留任务的拒绝事件不得写入新一轮记录');
});

// ---------- C4：入口幂等（resolved 后重复核验不再覆写） ----------

t('C4 已 resolved 记录重复核验：幂等跳过，不再把核验结果覆写到已闭环记录', async () => {
  const root = mkProject();
  const { dataDir, item } = mkDevSuspension(root);
  terminalSupplement(root, item.id);
  const rec0 = confirmStates.confirmOf(dataDir, item.id);
  const done = await resolveViaFreshPath(dataDir, root, item.id, rec0.fingerprint);
  assert.equal(done.ok, true);
  const before = confirmStates.confirmOf(dataDir, item.id);
  const r = await confirmStore.verifyCommitConfirm(dataDir, item.id, {
    projectRoot: root, runTests: true, by: 'human',
  });
  assert.equal(r.ok, true, `resolved 后核验应幂等成功：${JSON.stringify(r)}`);
  assert.equal(r.idempotent, true, '应标记 idempotent（重复核验幂等拒绝）');
  const after = confirmStates.confirmOf(dataDir, item.id);
  assert.equal(after.state, 'resolved');
  assert.deepEqual(after.events, before.events, '已闭环记录的事件不得被覆写（无新增 verified 事件）');
});

// ---------- S1：进程生命周期（双服务进程，任务账本与确认记录双守卫） ----------

let serverSeq = 0;
async function startServer(root) {
  const port = 30000 + Math.floor(Math.random() * 20000);
  serverSeq += 1;
  const server = spawn(process.execPath, [path.join(pluginRoot, 'scripts', 'server.mjs')], {
    cwd: root,
    env: {
      ...process.env,
      ATB_PORT: String(port),
      ATB_REGISTRY: path.join(os.tmpdir(), `atb-stale-reg-${Date.now()}-${serverSeq}-${Math.floor(Math.random() * 1e6)}.json`),
    },
    stdio: ['ignore', 'ignore', 'ignore'],
  });
  for (let i = 0; i < 50; i++) {
    await sleep(150);
    try { await req(port, 'GET', '/api/health'); return { server, port }; } catch {}
  }
  server.kill();
  throw new Error('服务未启动');
}

t('S1 旧进程滞留任务在重启标记 interrupted 后完成：任务账本不复活成 done，确认记录留痕不被抹掉', async () => {
  const root = mkProject('node -e "setTimeout(() => process.exit(0), 3500)"');
  const { dataDir, item } = mkDevSuspension(root);
  terminalSupplement(root, item.id);
  const s1 = await startServer(root); // 旧进程：任务在其事件循环内运行
  const P = `?project=${encodeURIComponent(root)}`;
  try {
    const post = await req(s1.port, 'POST', `/api/confirms/${item.id}/verify${P}`, {});
    assert.equal(post.json.accepted, true, `旧进程应接受核验任务：${JSON.stringify(post.json)}`);
    const taskId = post.json.task.taskId;

    // 新进程启动（同项目数据目录）：恢复核对把遗留 running 任务标记 interrupted 并留痕
    const s2 = await startServer(root);
    try {
      const t2 = await req(s2.port, 'GET', `/api/confirms/${item.id}/task${P}`);
      assert.equal(t2.json.task.status, 'interrupted', `新进程应标记中断：${JSON.stringify(t2.json.task)}`);

      // 等旧进程滞留任务真正完成：其核验结论合并落账（verified 事件出现）即完成信号
      let sawVerified = false;
      for (let i = 0; i < 80 && !sawVerified; i++) {
        const rec = confirmStates.confirmOf(dataDir, item.id);
        if (eventKinds(rec).includes('verified')) sawVerified = true;
        else await sleep(250);
      }
      assert.ok(sawVerified, '旧进程任务的核验结论应在时限内落账');
      await sleep(500); // 留出落账后任务 touch（完成/被拒）的余量

      // 任务账本：旧进程的滞留回调不得把 interrupted 复活成 done
      const tEnd = await req(s2.port, 'GET', `/api/confirms/${item.id}/task${P}`);
      assert.equal(tEnd.json.task.taskId, taskId, '应是同一任务');
      assert.equal(tEnd.json.task.status, 'interrupted',
        `旧进程滞留回调不得复活任务账本（期望 interrupted，实际 ${tEnd.json.task.status}）`);

      // 确认记录：未人工确认保持 waiting；重启留痕不被滞留写回抹掉；核验结论合并落账
      const rec = confirmStates.confirmOf(dataDir, item.id);
      assert.equal(rec.state, 'waiting');
      const kinds = eventKinds(rec);
      assert.ok(kinds.includes('task-interrupted'), '重启留痕事件不得被抹掉');
      assert.ok(kinds.includes('verified'), '滞留任务的核验结论仍应合并落账（waiting 未变时）');
    } finally {
      s2.server.kill();
    }
  } finally {
    s1.server.kill();
  }
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
