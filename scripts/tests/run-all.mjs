#!/usr/bin/env node
// 测试聚合入口（npm test）：顺序执行 scripts/tests/*.test.mjs，任一失败即非零退出。
// BUG-20260914-013：每个测试文件结束后扫描并清理遗留的测试子进程（server/stub 泄漏兜底），
// 阻断跨文件、跨轮次端口污染；run 结束再兜底一次并在摘要输出清理计数。
// BUG-20260922-005：A. 单实例互斥（run-gate 锁，第二实例等待而非并发——并发实例的文件级
// sweep 会互杀对方在用测试 server，ECONNREFUSED 偶发根因）；D. 单文件首跑失败先 sweep
// 再重试一次（瞬时偶发缓解；重试通过标注可观测，真实回归两次仍失败照常报红）。
// 用法：node scripts/tests/run-all.mjs（或 npm test；等待上限可用 ATB_RUNALL_LOCK_WAIT_MS 调整）

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sweepTestResidue } from './lib/test-process.mjs';
import { acquireRunLock, installGateSignalRelease, runFileWithRetry } from './lib/run-gate.mjs';

const testsDir = path.dirname(fileURLToPath(import.meta.url));
const files = fs.readdirSync(testsDir).filter((f) => f.endsWith('.test.mjs')).sort();

const FILE_TIMEOUT_MS = 180_000;

// 等价原 spawnSync 语义：stdio inherit + 180s 超时强杀（超时按 exit=124 记）
function runFile(f) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [path.join(testsDir, f)], { stdio: 'inherit' });
    const timer = setTimeout(() => { try { p.kill('SIGKILL'); } catch {} }, FILE_TIMEOUT_MS);
    p.on('close', (code, signal) => {
      clearTimeout(timer);
      resolve({ status: p.killed || code === null ? 124 : code, signal });
    });
    p.on('error', () => { clearTimeout(timer); resolve({ status: 1, signal: null }); });
  });
}

const failed = [];
let sweptTotal = 0;
let retryPassed = 0;

// BUG-20260922-005 A：单实例互斥——等待先行实例结束（默认上限 20 分钟）；超时 exit=2
// （区别于测试失败 exit=1），消息含持有者 pid 与指引，不执行任何测试文件。
let gate;
try {
  gate = await acquireRunLock(testsDir, {
    waitMs: Number(process.env.ATB_RUNALL_LOCK_WAIT_MS || 20 * 60_000),
    log: (m) => console.log(`⚠ ${m}`),
  });
} catch (e) {
  console.error(`✗ ${e.message}`);
  process.exit(2);
}
installGateSignalRelease(gate);

try {
  for (const f of files) {
    console.log(`\n===== ${f} =====`);
    const r = await runFileWithRetry(f, {
      runOnce: runFile,
      sweep: async (label) => {
        sweptTotal += (await sweepTestResidue({ label, log: (m) => console.log(m) })).length;
      },
      errLog: (m) => console.error(m),
    });
    if (r.status !== 0) {
      failed.push(f);
      console.error(`✗ ${f}（exit=${r.status}${r.signal ? ` signal=${r.signal}` : ''}${r.retried ? '，重试后仍失败' : ''}）`);
    } else if (r.retried) {
      retryPassed += 1;
      console.log(`✓ ${f}（重试 1 次后通过，瞬时偶发 BUG-20260922-005）`);
    } else {
      console.log(`✓ ${f}`);
    }
    // BUG-20260914-013 聚合层兜底：回收本文件遗留的测试 server/stub（防泄漏累积污染后续轮次）
    sweptTotal += (await sweepTestResidue({ label: f, log: (m) => console.log(m) })).length;
  }
  sweptTotal += (await sweepTestResidue({ label: 'run-end', log: (m) => console.log(m) })).length;
} finally {
  try { gate.release(); } catch { /* 尽力而为；残留陈旧锁由下一轮 pid 存活判定自愈 */ }
}

console.log(`\n共 ${files.length} 个测试文件，失败 ${failed.length}${failed.length ? `：${failed.join('、')}` : ''}${retryPassed ? `；重试后通过 ${retryPassed} 个（瞬时偶发）` : ''}${sweptTotal ? `；清理测试残留进程 ${sweptTotal} 个` : ''}`);
process.exit(failed.length ? 1 : 0);
