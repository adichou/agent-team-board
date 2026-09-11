#!/usr/bin/env node
// BUG-20260909-001 开发任务终止口径透出 —— /api/batch/current 与 CLI batchPublicView 公开 abortRequested/aborted
// 覆盖：终止批次 HTTP/CLI 字段透出与布尔化、存量缺字段输出 false、自然结束不误判为终止、终止批次不入队
// 用法：node scripts/tests/batch-abort-view.test.mjs

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as core from '../lib/core.mjs';
import * as batch from '../lib/batch.mjs';

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const atb = path.join(pluginRoot, 'scripts', 'atb.mjs');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const runAtb = (args, cwd, timeoutMs = 30000) => new Promise((resolve) => {
  const p = spawn(process.execPath, [atb, ...args], { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  let err = '';
  p.stdout.on('data', (c) => { out += c; });
  p.stderr.on('data', (c) => { err += c; });
  const timer = setTimeout(() => { p.kill(); resolve({ code: 124, out, err }); }, timeoutMs);
  p.on('close', (code) => { clearTimeout(timer); resolve({ code, out, err }); });
});

async function runAtbJson(args, cwd) {
  const r = await runAtb([...args, '--json'], cwd);
  if (r.code !== 0) throw new Error(`atb ${args.join(' ')} 失败：${r.err || r.out}`);
  try {
    return JSON.parse(r.out);
  } catch (e) {
    throw new Error(`--json 输出应只有纯 JSON（atb ${args.join(' ')}）：\n${r.out.slice(0, 300)}`);
  }
}

function req(port, method, pathname, body) {
  return new Promise((resolve, reject) => {
    const payload = body == null ? null : JSON.stringify(body);
    const r = http.request({
      hostname: '127.0.0.1', port, path: pathname, method,
      headers: payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {},
      timeout: 4000,
    }, (rs) => {
      let data = '';
      rs.on('data', (c) => { data += c; });
      rs.on('end', () => {
        try { resolve({ status: rs.statusCode, json: JSON.parse(data) }); }
        catch { resolve({ status: rs.statusCode, json: null, raw: data }); }
      });
    });
    r.on('error', reject);
    r.on('timeout', () => { r.destroy(); reject(new Error('timeout')); });
    if (payload) r.write(payload);
    r.end();
  });
}

const cases = [];
const t = (name, fn) => cases.push([name, fn]);

async function mkProject(name, nItems) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), `atb-babort-${name}-`)));
  await runAtb(['init'], root);
  const ids = [];
  for (let i = 1; i <= nItems; i++) {
    const r = await runAtb(['new', 'req', `${name}-条目-${i}`], root);
    const m = r.out.match(/(REQ-\d{8}-\d{3})/);
    assert.ok(m, `应输出单号：${r.out}`);
    ids.push(m[1]);
  }
  for (const id of ids) {
    await runAtb(['status', id, 'accepted'], root);
    await runAtb(['status', id, 'planned'], root);
  }
  return { root, ids };
}

// 库层驱动批次自然收尾（全部领取 → report → receipt）
async function drainBatch(dataDir, batchId) {
  let got = batch.nextItem(dataDir, batchId, { owner: 'lib-w1' });
  while (got && got.itemId) {
    core.claim(dataDir, got.itemId, 'lib-w1');
    core.report(dataDir, got.itemId, { summary: 'ok', by: 'lib-w1', run: { runId: got.runId } });
    batch.finishRun(dataDir, got.runId, { result: 'reported', reportRef: 'test-report.md' });
    const nx = batch.nextItem(dataDir, batchId, { owner: 'lib-w1' });
    if (!nx || nx.stop) break;
    got = nx;
  }
}

t('HTTP：终止批次 /api/batch/current 透出 abortRequested/aborted=true；存量与自然结束为 false；终止批次不入队', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'atb-babort-http-'));
  const A = await mkProject('http', 1);
  const port = 30000 + Math.floor(Math.random() * 20000);
  const server = spawn(process.execPath, [path.join(pluginRoot, 'scripts', 'server.mjs')], {
    cwd: A.root,
    env: { ...process.env, ATB_PORT: String(port), ATB_REGISTRY: path.join(tmp, 'reg.json') },
    stdio: ['ignore', 'ignore', 'ignore'],
  });
  const P = `?project=${encodeURIComponent(A.root)}`;
  try {
    let up = false;
    for (let i = 0; i < 40; i++) {
      await sleep(150);
      try { await req(port, 'GET', '/api/health'); up = true; break; } catch {}
    }
    assert.ok(up, '服务应启动');

    let r = await req(port, 'POST', `/api/batch/create${P}`, {});
    const batchId = r.json.batchId;

    // 存量缺字段（未终止批次）：两个字段按 Boolean 归一化输出 false（布尔型，不是 undefined）
    r = await req(port, 'GET', `/api/batch/current${P}`);
    assert.equal(r.json.batch.batchId, batchId);
    assert.equal(typeof r.json.batch.abortRequested, 'boolean', 'abortRequested 应为布尔型');
    assert.equal(typeof r.json.batch.aborted, 'boolean', 'aborted 应为布尔型');
    assert.equal(r.json.batch.abortRequested, false, '未终止批次 abortRequested 应为 false');
    assert.equal(r.json.batch.aborted, false, '未终止批次 aborted 应为 false');

    // 终止后：字段透出真实终止态
    r = await req(port, 'POST', `/api/batch/abort${P}`, { batchId });
    assert.equal(r.status, 200, `abort 应成功（${JSON.stringify(r.json)}）`);
    r = await req(port, 'GET', `/api/batch/current${P}`);
    assert.equal(r.json.batch.batchId, batchId, '无后续批次时 current 回退展示同一终止批次');
    assert.equal(r.json.batch.status, 'finished', '终止批次终态为 finished');
    assert.equal(r.json.batch.abortRequested, true, '终止批次应透出 abortRequested=true');
    assert.equal(r.json.batch.aborted, true, '终止批次应透出 aborted=true');
    assert.equal(typeof r.json.batch.abortRequested, 'boolean', 'abortRequested 应为布尔型');
    assert.equal(typeof r.json.batch.aborted, 'boolean', 'aborted 应为布尔型');
    assert.ok(r.json.queue.every((q) => q.batchId !== batchId), '终止批次不得回到未结束队列');

    // 自然结束批次：字段为 false，不误判为人工终止
    const nr = await runAtb(['new', 'req', '自然收尾'], A.root);
    const m = nr.out.match(/(REQ-\d{8}-\d{3})/);
    assert.ok(m, `应输出单号：${nr.out}`);
    await runAtb(['status', m[1], 'accepted'], A.root);
    await runAtb(['status', m[1], 'planned'], A.root);
    r = await req(port, 'POST', `/api/batch/create${P}`, {});
    const batchId2 = r.json.batchId;
    const dataDir = core.dataDirFrom(A.root);
    await drainBatch(dataDir, batchId2);
    assert.equal(batch.getBatch(dataDir, batchId2).status, 'finished', '全部回执后批次应自然收尾');
    r = await req(port, 'GET', `/api/batch/current${P}`);
    assert.equal(r.json.batch.batchId, batchId2, 'current 回退展示最新自然结束批次');
    assert.equal(r.json.batch.status, 'finished');
    assert.equal(r.json.batch.abortRequested, false, '自然结束不得误判为人工终止（abortRequested）');
    assert.equal(r.json.batch.aborted, false, '自然结束不得误判为人工终止（aborted）');
  } finally {
    server.kill();
    for (const x of [tmp, A.root]) { try { fs.rmSync(x, { recursive: true, force: true }); } catch {} }
  }
});

t('CLI：batch summary --json 公开视图透出布尔化终止字段（终止 true / 自然结束与运行中 false）', async () => {
  const p = await mkProject('cli', 2);
  try {
    const created = await runAtbJson(['batch', 'create'], p.root);
    const batchId = created.batchId;

    // 运行中（prepared 待启动）：false 且为布尔型
    let sum = await runAtbJson(['batch', 'summary', '--batch', batchId], p.root);
    assert.equal(typeof sum.batch.abortRequested, 'boolean', 'summary batch.abortRequested 应为布尔型');
    assert.equal(typeof sum.batch.aborted, 'boolean', 'summary batch.aborted 应为布尔型');
    assert.equal(sum.batch.abortRequested, false, '待启动批次 abortRequested=false');
    assert.equal(sum.batch.aborted, false, '待启动批次 aborted=false');

    // 终止后：true
    assert.equal((await runAtb(['batch', 'abort', '--batch', batchId], p.root)).code, 0, 'abort 应成功');
    sum = await runAtbJson(['batch', 'summary', '--batch', batchId], p.root);
    assert.equal(sum.batch.status, 'finished');
    assert.equal(sum.batch.abortRequested, true, '终止批次 summary 应透出 abortRequested=true');
    assert.equal(sum.batch.aborted, true, '终止批次 summary 应透出 aborted=true');

    // batch pause --json 同用 batchPublicView：正常批次视图字段为 false
    const nr = await runAtb(['new', 'req', 'CLI自然收尾'], p.root);
    const m = nr.out.match(/(REQ-\d{8}-\d{3})/);
    await runAtb(['status', m[1], 'accepted'], p.root);
    await runAtb(['status', m[1], 'planned'], p.root);
    const created2 = await runAtbJson(['batch', 'create'], p.root);
    const batchId2 = created2.batchId;
    assert.notEqual(batchId2, batchId, '终态批次不占队列，应创建新批次');
    const paused = await runAtbJson(['batch', 'pause', '--batch', batchId2], p.root);
    assert.equal(paused.batch.abortRequested, false, '正常批次 pause 视图 abortRequested=false');
    assert.equal(paused.batch.aborted, false, '正常批次 pause 视图 aborted=false');
    // 恢复领取后再驱动自然收尾（暂停中 next 一律 stop=paused，无法领取）
    assert.equal((await runAtb(['batch', 'pause', '--batch', batchId2, '--off'], p.root)).code, 0, '恢复领取应成功');

    // 自然结束：false，不误判
    const dataDir = core.dataDirFrom(p.root);
    await drainBatch(dataDir, batchId2);
    sum = await runAtbJson(['batch', 'summary', '--batch', batchId2], p.root);
    assert.equal(sum.batch.status, 'finished', '自然收尾终态 finished');
    assert.equal(sum.batch.abortRequested, false, '自然结束 summary abortRequested=false');
    assert.equal(sum.batch.aborted, false, '自然结束 summary aborted=false');
  } finally {
    try { fs.rmSync(p.root, { recursive: true, force: true }); } catch {}
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
