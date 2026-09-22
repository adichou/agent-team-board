#!/usr/bin/env node
// BUG-20260922-005 并发 npm test 互杀 / 瞬时连接偶发 —— run-all 单实例互斥（run-gate）+ 文件级重试
// 覆盖（test-cases.md）：L1 锁原语 / L2 run-all 互斥集成 / L3 文件级重试 / L4 信号释放。
// 用法：node scripts/tests/bug-20260922-005.test.mjs

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  acquireRunLock, lockPathFor, runFileWithRetry, installGateSignalRelease,
} from './lib/run-gate.mjs';

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const cases = [];
const t = (name, fn) => cases.push([name, fn]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const tmpLockDir = () => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'atb-run-gate-')));

// 已死 pid：spawn 一个立即退出的进程取其 pid
function deadPid() {
  const r = spawnSync(process.execPath, ['-e', 'process.exit(0)']);
  return r.pid;
}

// ---------- L1 锁原语 ----------

t('L1 锁原语：无锁创建；存活持有者等待至超时并报 pid 与指引；陈旧锁接管；release 后可再获取；release 不误删他人锁', async () => {
  const dir = tmpLockDir();
  const lock = path.join(dir, 'suite.lock');
  // 无锁创建 + release + 再获取
  const g1 = await acquireRunLock('/suite/a', { lockPath: lock, waitMs: 0 });
  assert.ok(fs.existsSync(lock), '获取后锁文件应存在');
  g1.release();
  assert.ok(!fs.existsSync(lock), 'release 后锁文件应移除');
  const g2 = await acquireRunLock('/suite/a', { lockPath: lock, waitMs: 0 });
  // 存活持有者（本进程 pid）→ 第二次获取在超时上限内失败且报持有者 pid
  const holder = { pid: process.pid, startedAt: '2026-09-22T00:00:00.000Z', suite: '/suite/a' };
  fs.writeFileSync(lock, JSON.stringify(holder));
  const logs = [];
  await assert.rejects(
    acquireRunLock('/suite/a', { lockPath: lock, waitMs: 200, pollMs: 50, log: (m) => logs.push(m) }),
    (e) => String(e.message).includes(String(process.pid)) && /等待其他 npm test 实例超时/.test(e.message),
    '超时报错应含持有者 pid 与指引',
  );
  assert.ok(logs.some((m) => m.includes(String(process.pid))), '等待期间应输出持有者信息');
  // 陈旧锁（pid 已死）→ 接管
  fs.writeFileSync(lock, JSON.stringify({ ...holder, pid: deadPid() }));
  const g3 = await acquireRunLock('/suite/a', { lockPath: lock, waitMs: 0 });
  assert.ok(g3.released !== true, '陈旧锁应被接管成功');
  g3.release();
  assert.ok(!fs.existsSync(lock), '接管后 release 应移除锁');
  // release 不误删他人锁：本实例（以子进程 pid 名义）获取后，锁文件被覆写为另一存活
  // 持有者 → release 不得删除
  const other = spawn(process.execPath, ['-e', 'setInterval(() => {}, 60000)']);
  await sleep(200);
  const g4 = await acquireRunLock('/suite/a', { lockPath: lock, waitMs: 0, pid: other.pid });
  fs.writeFileSync(lock, JSON.stringify(holder)); // 模拟锁已被其他进程接管覆写（pid=本进程 ≠ other.pid）
  g4.release();
  assert.ok(fs.existsSync(lock), '锁已非本实例持有时 release 不应删除他人锁');
  other.kill('SIGKILL');
  fs.rmSync(dir, { recursive: true, force: true });
});

t('L1b lockPathFor：按套件目录分键，不同目录不同锁、同目录稳定一致', () => {
  const p1 = lockPathFor('/repo-a/scripts/tests');
  const p2 = lockPathFor('/repo-b/scripts/tests');
  assert.notEqual(p1, p2, '不同套件目录应不同锁文件');
  assert.equal(p1, lockPathFor('/repo-a/scripts/tests'), '同目录应稳定一致');
  assert.match(path.basename(p1), /^atb-run-all-[0-9a-f]{10}\.lock$/, '锁文件名形态');
});

// ---------- L2 run-all 互斥集成 ----------

t('L2 run-all 互斥：持有者存活时 spawn 真实 run-all → 快速失败（exit=2）且输出持有者 pid，不执行任何测试文件', async () => {
  const testsDir = path.join(pluginRoot, 'scripts', 'tests');
  const lock = lockPathFor(testsDir);
  const holder = { pid: process.pid, startedAt: new Date().toISOString(), suite: testsDir };
  fs.writeFileSync(lock, JSON.stringify(holder));
  try {
    const child = spawn(process.execPath, [path.join(testsDir, 'run-all.mjs')], {
      cwd: pluginRoot,
      env: { ...process.env, ATB_RUNALL_LOCK_WAIT_MS: '1200' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    child.stdout.on('data', (c) => { out += c; });
    child.stderr.on('data', (c) => { out += c; });
    const code = await new Promise((resolve) => child.on('close', resolve));
    assert.equal(code, 2, `互斥失败应 exit=2（实际 ${code}）：${out}`);
    assert.ok(out.includes(String(process.pid)), `输出应含持有者 pid：${out.slice(-400)}`);
    assert.ok(!out.includes('====='), '等待超时前不应执行任何测试文件');
  } finally {
    fs.rmSync(lock, { force: true });
  }
});

// ---------- L3 文件级重试 ----------

t('L3 文件级重试：首跑失败 + sweep + 重试通过 → retried 标记；重试仍失败 → 失败；首跑通过不重试不 sweep', async () => {
  const logs = [];
  const mkSweep = (calls) => async (label) => { calls.push(label); return { length: 0 }; };
  // 首跑失败 → 重试通过
  let n = 0;
  const calls1 = [];
  const r1 = await runFileWithRetry('a.test.mjs', {
    runOnce: async () => { n += 1; return n === 1 ? { status: 1, signal: null } : { status: 0, signal: null }; },
    sweep: mkSweep(calls1),
    log: (m) => logs.push(m),
    errLog: (m) => logs.push(m),
  });
  assert.equal(r1.status, 0);
  assert.equal(r1.retried, true, '重试通过应带 retried 标记');
  assert.deepEqual(calls1, ['a.test.mjs#retry'], '重试前应做一次 sweep（带 #retry 标签）');
  assert.ok(logs.some((m) => m.includes('重试一次')), '应输出重试提示');
  // 重试仍失败
  const r2 = await runFileWithRetry('b.test.mjs', {
    runOnce: async () => ({ status: 1, signal: 'SIGKILL' }),
    sweep: mkSweep([]),
    errLog: () => {},
  });
  assert.equal(r2.status, 1, '重试仍失败应保持失败（不掩盖真实回归）');
  assert.equal(r2.retried, true);
  // 首跑通过：不重试、不 sweep
  const calls3 = [];
  const r3 = await runFileWithRetry('c.test.mjs', {
    runOnce: async () => ({ status: 0, signal: null }),
    sweep: mkSweep(calls3),
    errLog: () => {},
  });
  assert.equal(r3.status, 0);
  assert.equal(r3.retried, false, '首跑通过不应标记重试');
  assert.deepEqual(calls3, [], '首跑通过不应触发 sweep');
});

// ---------- L4 信号释放 ----------

t('L4 信号释放：子进程持锁收到 SIGTERM 退出后，锁随之释放（下一轮立即获取，无需等陈旧接管）', async () => {
  const dir = tmpLockDir();
  const lock = path.join(dir, 'sig.lock');
  const helper = path.join(dir, 'holder.mjs');
  const libPath = path.join(pluginRoot, 'scripts', 'tests', 'lib', 'run-gate.mjs');
  fs.writeFileSync(helper, [
    `import { acquireRunLock, installGateSignalRelease } from ${JSON.stringify(libPath)};`,
    'const gate = await acquireRunLock("/suite/sig", { lockPath: process.env.LOCK_PATH, waitMs: 0 });',
    'installGateSignalRelease(gate);',
    'console.log("held");',
    'setInterval(() => {}, 60000);',
    '',
  ].join('\n'));
  const child = spawn(process.execPath, [helper], {
    env: { ...process.env, LOCK_PATH: lock },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  let held = '';
  child.stdout.on('data', (c) => { held += c; });
  for (let i = 0; i < 40 && !held.includes('held'); i++) await sleep(100);
  assert.ok(held.includes('held'), '子进程应成功持锁');
  assert.ok(fs.existsSync(lock), '持锁期间锁文件存在');
  child.kill('SIGTERM');
  for (let i = 0; i < 40 && child.exitCode === null; i++) await sleep(100);
  assert.notEqual(child.exitCode, null, '子进程应已退出');
  assert.ok(!fs.existsSync(lock), 'SIGTERM 退出后锁应被释放');
  const g = await acquireRunLock('/suite/sig', { lockPath: lock, waitMs: 0 });
  g.release();
  fs.rmSync(dir, { recursive: true, force: true });
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
