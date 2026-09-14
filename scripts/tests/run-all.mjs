#!/usr/bin/env node
// 测试聚合入口（npm test）：顺序执行 scripts/tests/*.test.mjs，任一失败即非零退出。
// BUG-20260914-013：每个测试文件结束后扫描并清理遗留的测试子进程（server/stub 泄漏兜底），
// 阻断跨文件、跨轮次端口污染；run 结束再兜底一次并在摘要输出清理计数。
// 用法：node scripts/tests/run-all.mjs（或 npm test）

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sweepTestResidue } from './lib/test-process.mjs';

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
for (const f of files) {
  console.log(`\n===== ${f} =====`);
  const r = await runFile(f);
  if (r.status !== 0) {
    failed.push(f);
    console.error(`✗ ${f}（exit=${r.status}${r.signal ? ` signal=${r.signal}` : ''}）`);
  } else {
    console.log(`✓ ${f}`);
  }
  // BUG-20260914-013 聚合层兜底：回收本文件遗留的测试 server/stub（防泄漏累积污染后续轮次）
  sweptTotal += (await sweepTestResidue({ label: f, log: (m) => console.log(m) })).length;
}
sweptTotal += (await sweepTestResidue({ label: 'run-end', log: (m) => console.log(m) })).length;

console.log(`\n共 ${files.length} 个测试文件，失败 ${failed.length}${failed.length ? `：${failed.join('、')}` : ''}${sweptTotal ? `；清理测试残留进程 ${sweptTotal} 个` : ''}`);
process.exit(failed.length ? 1 : 0);
