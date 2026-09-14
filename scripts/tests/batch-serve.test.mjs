#!/usr/bin/env node
// REQ-20260906-002 Zcode 批量实施 —— Status Board 服务接口测试
// 覆盖：批次接口绑定 project、创建幂等、参数校验、策略校验 400、跨项目账本隔离（Z02/Z03/Z06 接口层）
// 用法：node scripts/tests/batch-serve.test.mjs

import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
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

const runAtb = (args, cwd) => new Promise((resolve) => {
  const p = spawn(process.execPath, [atb, ...args], { cwd, stdio: ['ignore', 'ignore', 'ignore'] });
  p.on('close', (code) => resolve(code));
});

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
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), `atb-bserve-${name}-`)));
  await runAtb(['init'], root);
  const ids = [];
  for (let i = 1; i <= nItems; i++) {
    await runAtb(['new', 'req', `${name}-条目-${i}`], root);
    const dir = path.join(root, 'docs', 'agent-team-board', 'requirements');
    const found = fs.readdirSync(dir).filter((d) => d.startsWith('REQ-'));
    ids.push(found[found.length - 1]);
  }
  for (const id of ids) {
    await runAtb(['status', id, 'accepted'], root);
    await runAtb(['status', id, 'planned'], root); // REQ-20260908-010：选单口径 planned
  }
  return { root, ids };
}

t('批次接口：创建幂等、limit 入参忽略（REQ-20260908-019）、暂停、策略校验、跨项目隔离', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'atb-bserve-'));
  const A = await mkProject('a', 2);
  const B = await mkProject('b', 1);
  const port = 30000 + Math.floor(Math.random() * 20000);
  const server = spawn(process.execPath, [path.join(pluginRoot, 'scripts', 'server.mjs')], {
    cwd: A.root,
    env: { ...process.env, ATB_PORT: String(port), ATB_REGISTRY: path.join(tmp, 'reg.json') },
    stdio: ['ignore', 'ignore', 'ignore'],
  });
  try {
    let up = false;
    for (let i = 0; i < 40; i++) {
      await sleep(150);
      try { await req(port, 'GET', '/api/health'); up = true; break; } catch {}
    }
    assert.ok(up, '服务应启动');

    // REQ-20260908-019：上限设置已移除——body.limit 被忽略（原 0/101 越界 400 校验删除），响应不回显 limit
    let r = await req(port, 'POST', `/api/batch/create?project=${encodeURIComponent(A.root)}`, { limit: 101 });
    assert.equal(r.status, 200, 'limit=101 应被忽略并照常创建');
    assert.equal('limit' in r.json, false, '创建响应不应再回显 limit');
    assert.equal(r.json.counts.candidates, 2, '实时候选全量生效（不按 limit 截断）');
    const { prompt, counts } = r.json;
    assert.ok(prompt.includes(A.root) && prompt.includes('batch check --dir'), '应返回通用调度提示词');
    assert.ok(!prompt.includes('批次'), 'REQ-20260913-003：提示词不含批次口径');
    assert.equal(counts.candidates, 2, `A 项目候选应为 2（得到 ${counts.candidates}）`);
    // REQ-20260913-003：不排队——重复创建被 400 拒绝（limit 入参同样被忽略）
    r = await req(port, 'POST', `/api/batch/create?project=${encodeURIComponent(A.root)}`, { limit: 0 });
    assert.equal(r.status, 400);
    assert.match(String(r.json && r.json.error || ''), /已有进行中的任务/);

    // 重复取提示词不建新批次
    r = await req(port, 'GET', `/api/batch/prompt?project=${encodeURIComponent(A.root)}`);
    assert.equal(r.status, 200);
    assert.equal(r.json.prompt, prompt, '提示词应可重复获取');

    // current 摘要：prepared（待启动），不带 B 项目条目，不回显 limit（REQ-20260908-019）
    r = await req(port, 'GET', `/api/batch/current?project=${encodeURIComponent(A.root)}`);
    assert.equal(r.json.batch.status, 'prepared');
    assert.equal('batchId' in r.json.batch, false, 'REQ-20260913-003：current 批次载荷不再透出批次号');
    assert.equal('limit' in r.json.batch, false, 'current 响应不应再回显 limit');
    // REQ-20260908-026：current 新增 pending 待处理队列（本项目单号）；跨项目单号可同号，隔离按唯一标题校验
    assert.ok(!JSON.stringify(r.json).includes('b-条目'), 'A 项目摘要不得混入 B 项目条目');

    // B 项目独立创建批次：互不串账（批次编号按项目独立计数，跨项目同名属预期）
    r = await req(port, 'POST', `/api/batch/create?project=${encodeURIComponent(B.root)}`, {});
    assert.equal(r.status, 200);
    assert.equal(r.json.counts.candidates, 1);
    r = await req(port, 'GET', `/api/batch/current?project=${encodeURIComponent(B.root)}`);
    assert.ok(!JSON.stringify(r.json).includes('a-条目'), 'B 项目摘要不得混入 A 项目条目');

    // 暂停
    r = await req(port, 'POST', `/api/batch/pause?project=${encodeURIComponent(A.root)}`, { paused: true });
    assert.equal(r.status, 200);
    r = await req(port, 'GET', `/api/batch/current?project=${encodeURIComponent(A.root)}`);
    assert.equal(r.json.batch.pauseRequested, true);

    // 策略：A[0] 依赖不存在的条目 → 400 + errors；合法依赖 → 200；环 → 400
    r = await req(port, 'POST', `/api/item/${A.ids[0]}/policy?project=${encodeURIComponent(A.root)}`, { dependsOn: ['REQ-20990101-999'] });
    assert.equal(r.status, 400, '依赖不存在应 400');
    assert.ok(r.json.errors && r.json.errors.length, '应返回字段级错误');
    r = await req(port, 'POST', `/api/item/${A.ids[0]}/policy?project=${encodeURIComponent(A.root)}`, { dependsOn: [A.ids[1]] });
    assert.equal(r.status, 200);
    r = await req(port, 'GET', `/api/item/${A.ids[0]}/policy?project=${encodeURIComponent(A.root)}`);
    assert.deepEqual(r.json.dependsOn, [A.ids[1]]);
    r = await req(port, 'POST', `/api/item/${A.ids[1]}/policy?project=${encodeURIComponent(A.root)}`, { dependsOn: [A.ids[0]] });
    assert.equal(r.status, 400, '成环应 400');

    // 阻塞计数进入 current
    r = await req(port, 'GET', `/api/batch/current?project=${encodeURIComponent(A.root)}`);
    assert.equal(r.json.counts.blocked, 1, `依赖未满足应计 1 个受阻（得到 ${JSON.stringify(r.json.counts)}）`);
  } finally {
    server.kill();
    for (const x of [tmp, A.root, B.root]) { try { fs.rmSync(x, { recursive: true, force: true }); } catch {} }
  }
});

t('REQ-20260910-027 开发人员移除：create 遗留 developer 忽略、响应无 developer、current 的 batch/queue 无字段、无 gitUser 预填', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'atb-bserve-dev-'));
  const A = await mkProject('dev', 2);
  // 原 git 预填项目：仅验证无批次响应不再含预填键（git user.name 配置与否均不应出现）
  const G = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'atb-bserve-git-')));
  await runAtb(['init'], G);
  try {
    spawnSync('git', ['init'], { cwd: G, stdio: 'ignore' });
    spawnSync('git', ['config', 'user.name', '测试开发'], { cwd: G, stdio: 'ignore' });
  } catch {}
  const port = 30000 + Math.floor(Math.random() * 20000);
  const server = spawn(process.execPath, [path.join(pluginRoot, 'scripts', 'server.mjs')], {
    cwd: A.root,
    env: { ...process.env, ATB_PORT: String(port), ATB_REGISTRY: path.join(tmp, 'reg.json') },
    stdio: ['ignore', 'ignore', 'ignore'],
  });
  try {
    let up = false;
    for (let i = 0; i < 40; i++) {
      await sleep(150);
      try { await req(port, 'GET', '/api/health'); up = true; break; } catch {}
    }
    assert.ok(up, '服务应启动');

    // 遗留 developer 入参：忽略不报错（200），响应不再回显，提示词无会话命名指令
    let r = await req(port, 'POST', `/api/batch/create?project=${encodeURIComponent(A.root)}`, { developer: '张三' });
    assert.equal(r.status, 200, '遗留 developer 入参应被忽略（不报错）');
    assert.equal('developer' in r.json, false, 'create 响应不应再带 developer');
    assert.ok(!r.json.prompt.includes('会话名'), '提示词不应含会话命名指令');

    // current：batch 视图无 developer；REQ-20260913-003：排队列表（queue）已整体移除
    r = await req(port, 'GET', `/api/batch/current?project=${encodeURIComponent(A.root)}`);
    assert.equal('developer' in r.json.batch, false, 'current 的 batch 不应带 developer');
    assert.equal('queue' in r.json, false, 'REQ-20260913-003：current 不再携带排队列表');

    // 重复创建（含显式 ids 与超长 developer）被拒；非法值不再 400（校验随功能移除，忽略语义不变）
    await runAtb(['new', 'req', 'dev-重复启动条目'], A.root);
    const reqDir = path.join(A.root, 'docs', 'agent-team-board', 'requirements');
    const found = fs.readdirSync(reqDir).filter((d) => d.startsWith('REQ-'));
    const third = found[found.length - 1];
    await runAtb(['status', third, 'accepted'], A.root);
    await runAtb(['status', third, 'planned'], A.root);
    r = await req(port, 'POST', `/api/batch/create?project=${encodeURIComponent(A.root)}`, { ids: [third], developer: 'x'.repeat(31) });
    assert.equal(r.status, 400, '超长 developer 被忽略；重复启动按 REQ-20260913-003 拒绝');
    assert.match(String(r.json && r.json.error || ''), /已有进行中的任务/);

    // 无批次项目：不再返回 gitUser 预填键（stats 口径不变）
    r = await req(port, 'GET', `/api/batch/current?project=${encodeURIComponent(G)}`);
    assert.equal(r.status, 200);
    assert.ok(!('gitUser' in r.json), '无批次响应不应再含 gitUser 键');
    assert.deepEqual(r.json.stats, { candidates: 0, blocked: 0 }, 'stats 口径不变');
  } finally {
    server.kill();
    for (const x of [tmp, A.root, G]) { try { fs.rmSync(x, { recursive: true, force: true }); } catch {} }
  }
});

t('BUG-20260908-023 已终止/已结束批次 /api/batch/pause 返回错误而非静默成功；终态与队首口径不被污染', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'atb-bpause-'));
  const A = await mkProject('term', 1);
  const port = 32000 + Math.floor(Math.random() * 20000);
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
    assert.equal('batchId' in r.json, false, 'REQ-20260913-003：创建响应不再透出批次号');
    const batchId = batch.queueHeadBatch(core.dataDirFrom(A.root)).batchId;
    r = await req(port, 'POST', `/api/batch/abort${P}`, { batchId });
    assert.equal(r.status, 200, `abort 应成功（${JSON.stringify(r.json)}）`);
    assert.equal(r.json.aborted, true);

    // 已终止批次暂停：400 错误 + 明确原因，不返回 ok: true
    r = await req(port, 'POST', `/api/batch/pause${P}`, { batchId, paused: true });
    assert.equal(r.status, 400, '已终止批次 pause 应返回错误状态码');
    assert.ok(r.json && r.json.error, '错误响应应带 error 信息');
    assert.match(r.json.error, /不能暂停\/恢复/, `错误信息应说明终态不可暂停（得到 ${r.json && r.json.error}）`);
    assert.notEqual(r.json.ok, true, '不得返回 ok: true');
    // 恢复方向同样拒绝
    r = await req(port, 'POST', `/api/batch/pause${P}`, { batchId, paused: false });
    assert.equal(r.status, 400, '已终止批次恢复 pause 同样返回错误');
    // 批次终态未被改动；current 不再把它当未结束任务派发（缺省解析回退最新仅供面板收尾展示）
    r = await req(port, 'GET', `/api/batch/current${P}`);
    assert.equal(r.json.batch.status, 'finished', '不得复活为 paused');
    assert.equal(r.json.batch.pauseRequested, false, '不得写入暂停请求');
    assert.equal('queue' in r.json, false, 'REQ-20260913-003：current 不再携带排队列表');
    assert.ok(!batch.unfinishedBatches(core.dataDirFrom(A.root)).some((b) => b.batchId === batchId), '终态批次不入未结束队列');

    // 自然收尾（正常结束）批次：新增候选建新批次，库层跑完全部回执后同样拒绝暂停/恢复
    const nr = await new Promise((resolve) => {
      const q = spawn(process.execPath, [atb, 'new', 'req', '自然收尾'], { cwd: A.root, stdio: ['ignore', 'pipe', 'ignore'] });
      let out = '';
      q.stdout.on('data', (c) => { out += c; });
      q.on('close', () => resolve(out));
    });
    const m = String(nr).match(/(REQ-\d{8}-\d{3})/);
    assert.ok(m, `应输出单号：${nr}`);
    await runAtb(['status', m[1], 'accepted'], A.root);
    await runAtb(['status', m[1], 'planned'], A.root);
    r = await req(port, 'POST', `/api/batch/create${P}`, {});
    const dataDir = core.dataDirFrom(A.root);
    const batchId2 = batch.queueHeadBatch(dataDir).batchId;
    // 被终止批次出局的旧候选仍为 planned、重新进入新批次：逐项收尾直至自然结束
    let got = batch.nextItem(dataDir, batchId2, { owner: 'lib-w1' });
    while (got && got.itemId) {
      core.claim(dataDir, got.itemId, 'lib-w1');
      core.report(dataDir, got.itemId, { summary: 'ok', by: 'lib-w1', run: { runId: got.runId } });
      batch.finishRun(dataDir, got.runId, { result: 'reported', reportRef: 'test-report.md' });
      const nx = batch.nextItem(dataDir, batchId2, { owner: 'lib-w1' });
      if (!nx || nx.stop) break;
      got = nx;
    }
    assert.equal(batch.getBatch(dataDir, batchId2).status, 'finished', '全部回执后批次应自然收尾');

    r = await req(port, 'POST', `/api/batch/pause${P}`, { batchId: batchId2, paused: true });
    assert.equal(r.status, 400, '正常结束批次 pause 同样返回错误');
    assert.match(r.json.error, /任务已结束，不能暂停\/恢复/, `错误信息应说明已结束不可暂停（得到 ${r.json && r.json.error}）`);
    r = await req(port, 'POST', `/api/batch/pause${P}`, { batchId: batchId2, paused: false });
    assert.equal(r.status, 400, '正常结束批次恢复方向同样返回错误');
    assert.equal(batch.getBatch(dataDir, batchId2).status, 'finished', '终态保持 finished');
  } finally {
    server.kill();
    for (const x of [tmp, A.root]) { try { fs.rmSync(x, { recursive: true, force: true }); } catch {} }
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
