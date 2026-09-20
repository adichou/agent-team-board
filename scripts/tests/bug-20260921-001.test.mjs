#!/usr/bin/env node
// BUG-20260921-001 req-20260920-003.test.mjs L4 夹具硬编码当日条目编号，跨日运行必失败 —— 回归
// 用法：node scripts/tests/bug-20260921-001.test.mjs
// 覆盖（见条目 README 现象 / design.md 方案）：
//   · R1 机制复现：core.createItem 编号由 nextId 按本地日期生成（localDateStamp），
//     真实捕获 id 永远可推状态，硬编码历史日期编号（登记日一过）必报「找不到」——
//     夹具只能消费 createItem 返回的真实 id，不能假设编号落在某个固定日期；
//   · R2 源契约：scripts/tests/req-20260920-003.test.mjs L4 夹具不再出现
//     「for (const id of ['REQ-…', …]) → core.setStatus(dataDir, id, …)」硬编码当日编号形态，
//     改为捕获 createItem 返回值并以 .id 推状态、关联版本（同 build-serve.test.mjs
//     reqA/reqB 口径），保证任意日期运行均成立。

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as core from '../lib/core.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const tmpdir = (prefix) => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));

const cases = [];
const t = (name, fn) => cases.push([name, fn]);

t('R1 编号按本地日期生成：捕获的真实 id 可推状态，硬编码历史日期编号报「找不到」', () => {
  const dir = tmpdir('atb-bug-20260921-001-');
  core.initData(dir);
  const dataDir = core.dataDirFrom(dir);
  const it = core.createItem(dataDir, { type: 'requirement', title: '夹具编号机制', by: 'test' });
  // 编号携带登记当日本地日期：跨过该日后，任何硬编码的历史编号都不再命中
  assert.match(it.id, new RegExp(`^REQ-${core.localDateStamp()}-\\d{3}$`), 'createItem 编号按本地日期生成');
  core.setStatus(dataDir, it.id, 'accepted', { by: 'test' }); // 捕获的真实 id 与运行日期无关
  assert.throws(
    () => core.setStatus(dataDir, 'REQ-20000101-001', 'accepted', { by: 'test' }),
    /找不到/,
    '硬编码历史日期编号在跨日运行时报「找不到」（即本 Bug 失败形态）',
  );
});

t('R2 源契约：req-20260920-003.test.mjs L4 夹具消费 createItem 返回的真实 id，不再硬编码当日编号', () => {
  const src = fs.readFileSync(path.join(here, 'req-20260920-003.test.mjs'), 'utf8');
  assert.doesNotMatch(src, /for\s*\(\s*const\s+id\s+of\s*\[\s*'REQ-/, '不得以硬编码编号数组驱动夹具（跨日必失效）');
  assert.match(src, /const\s+\w+\s*=\s*core\.createItem\(/, '夹具应捕获 createItem 返回值');
  assert.match(src, /core\.setStatus\(\s*dataDir\s*,\s*\w+\.id\b/, 'setStatus 消费捕获的真实 id');
});

/* ---------- 执行 ---------- */

let failed = 0;
for (const [name, fn] of cases) {
  try {
    await fn();
    console.log(`✓ ${name}`);
  } catch (e) {
    failed++;
    console.error(`✗ ${name}\n${e && e.stack ? e.stack : e}`);
  }
}
if (failed) {
  console.error(`\n${failed} 个用例失败`);
  process.exit(1);
}
console.log(`\n全部通过（${cases.length} 例）`);
