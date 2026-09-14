#!/usr/bin/env node
// 测试聚合入口（npm test）：顺序执行 scripts/tests/*.test.mjs，任一失败即非零退出。
// 用法：node scripts/tests/run-all.mjs（或 npm test）

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const testsDir = path.dirname(fileURLToPath(import.meta.url));
const files = fs.readdirSync(testsDir).filter((f) => f.endsWith('.test.mjs')).sort();

const failed = [];
for (const f of files) {
  console.log(`\n===== ${f} =====`);
  const r = spawnSync(process.execPath, [path.join(testsDir, f)], { stdio: 'inherit', timeout: 180000 });
  if (r.status !== 0) {
    failed.push(f);
    console.error(`✗ ${f}（exit=${r.status}${r.signal ? ` signal=${r.signal}` : ''}）`);
  } else {
    console.log(`✓ ${f}`);
  }
}

console.log(`\n共 ${files.length} 个测试文件，失败 ${failed.length}${failed.length ? `：${failed.join('、')}` : ''}`);
process.exit(failed.length ? 1 : 0);
