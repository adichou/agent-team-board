#!/usr/bin/env node
// BUG-20260907-012 —— run receipt 用法提示须与实现一致：
// reported 回执必带 --report-ref、blocked/failed 必带 --reason，不得再用可选参数样式误导。
// 覆盖：atb 主 USAGE / BATCH_USAGE / finishRun 报错给出修正命令示例 / SKILL.md CLI 速查。
// 用法：node scripts/tests/receipt-usage-hint.test.mjs

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const atb = path.join(pluginRoot, 'scripts', 'atb.mjs');

const runAtb = (args, cwd, timeoutMs = 20000) => new Promise((resolve) => {
  const p = spawn(process.execPath, [atb, ...args], { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  let err = '';
  p.stdout.on('data', (c) => { out += c; });
  p.stderr.on('data', (c) => { err += c; });
  const timer = setTimeout(() => { p.kill(); resolve({ code: 124, out, err }); }, timeoutMs);
  p.on('close', (code) => { clearTimeout(timer); resolve({ code, out, err }); });
});

const cases = [];
const t = (name, fn) => cases.push([name, fn]);

// 主 USAGE：--result reported 的 --report-ref 按（按场景）必填呈现，不再整体可选样式
t('H1 主 USAGE（--help）：run receipt 分支展示 reported 必带 --report-ref、blocked|failed 必带 --reason', async () => {
  const r = await runAtb(['--help'], pluginRoot);
  assert.equal(r.code, 0);
  const usage = r.out;
  assert.ok(!usage.includes('[--report-ref'), '不得再把 --report-ref 标为可选（[--report-ref 样式）');
  assert.match(usage, /atb run receipt <RUN-ID> --result reported --report-ref/, '应展示 reported 分支必带 --report-ref');
  assert.match(usage, /atb run receipt <RUN-ID> --result blocked\|failed --reason/, '应展示 blocked|failed 分支必带 --reason');
});

// BATCH_USAGE：run 子命令缺参时输出，同样按 result 分支标注必填项
t('H2 BATCH_USAGE（run 缺参）：不再用 [选项] 一刀切样式，reported/--report-ref、blocked|failed/--reason 成对出现', async () => {
  const r = await runAtb(['run'], pluginRoot);
  assert.notEqual(r.code, 0);
  const usage = r.out + r.err;
  assert.ok(!/run receipt[^\n]*reported\|blocked\|failed \[选项\]/.test(usage), '不得再用「--result reported|blocked|failed [选项]」误导样式');
  assert.match(usage, /atb run receipt <RUN-ID> --result reported --report-ref/, '应展示 reported 必带 --report-ref');
  assert.match(usage, /--result blocked\|failed --reason/, '应展示 blocked|failed 必带 --reason');
});

// 报错即教修复：reported 缺 --report-ref 的错误信息给出修正后的完整命令示例
t('H3 CLI 报错示例：reported 缺 --report-ref 被拒时，错误信息含修正后的完整命令', async () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'atb-receipthint-')));
  try {
    assert.equal((await runAtb(['init'], root)).code, 0);
    const nreq = await runAtb(['new', 'req', '回执提示'], root);
    assert.equal(nreq.code, 0);
    const id = nreq.out.match(/(REQ-\d{8}-\d{3})/)[0];
    assert.equal((await runAtb(['status', id, 'accepted'], root)).code, 0);
    assert.equal((await runAtb(['status', id, 'planned'], root)).code, 0); // REQ-20260908-010：选单口径 planned
    assert.equal((await runAtb(['batch', 'create'], root)).code, 0);
    const next = await runAtb(['batch', 'next', '--by', 'w1', '--json'], root);
    assert.equal(next.code, 0, `领取应成功：${next.err}`);
    const runId = JSON.parse(next.out).runId;

    const bad = await runAtb(['run', 'receipt', runId, '--result', 'reported'], root);
    assert.notEqual(bad.code, 0, 'reported 缺 --report-ref 应被拒');
    const msg = bad.out + bad.err;
    assert.match(msg, /reportRef/, '错误信息应说明缺 reportRef');
    assert.match(msg, /--result reported --report-ref/, '错误信息应给出修正后的完整命令示例');
  } finally {
    try { fs.rmSync(root, { recursive: true, force: true }); } catch {}
  }
});

// SKILL.md CLI 速查：同步按必填呈现，不再「[…]」可选样式
t('H4 SKILL.md 速查：run receipt 行写明 reported 必带 --report-ref，去掉 […] 可选样式', async () => {
  const skill = fs.readFileSync(path.join(pluginRoot, 'skills', 'agent-team-board', 'SKILL.md'), 'utf8');
  assert.ok(!skill.includes('run receipt <RUN-ID> --result reported|blocked|failed'), '速查不得再用三态合一可选样式');
  assert.match(skill, /run receipt <RUN-ID> --result reported --report-ref/, '速查应展示 reported 必带 --report-ref');
  assert.match(skill, /blocked\/failed 必带 --reason/, '速查应说明 blocked/failed 必带 --reason');
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
