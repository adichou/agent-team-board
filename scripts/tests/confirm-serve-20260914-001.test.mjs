#!/usr/bin/env node
// REQ-20260914-001 挂起确认 —— Status Board 服务接口 / state-guard 拦截面 / 看板徽标
// 用法：node scripts/tests/confirm-serve-20260914-001.test.mjs
// 覆盖：
//   · 开发侧：/api/confirms 清单与详情（含历史恢复视图）、/diff 差异、/keep 保持挂起、
//     /verify 重新核验、/continue 确认并继续（指纹绑定 + 补交 + 队列恢复编排）；
//   · 分析侧：atb refine hold 声明 → /confirms 卡片 → /answer 作答 → /continue 确认（版本绑定）
//     → 服务端编排续跑（refine 队列恢复、条目队首续跑）；
//   · 看板徽标：挂起期间 /api/board 携带 confirm 字段；
//   · state-guard：人工写接口（verify/keep/answer/continue）Agent 调用被拦，
//     只读（list/show/diff）与 worker 声明（atb refine hold）放行。
// 模式对齐 hold-20260911-007.test.mjs 的 S 组 / G 组（真实 server.mjs + HTTP）。

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

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const ATB = path.join(pluginRoot, 'scripts', 'atb.mjs');
const GUARD = path.join(pluginRoot, 'scripts', 'state-guard.mjs');
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

// BUG-20260915-008：核验/确认为异步任务——轮询任务至终态（done/failed/interrupted）
async function waitConfirmTask(port, P, itemId, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const r = await req(port, 'GET', `/api/confirms/${encodeURIComponent(itemId)}/task${P}`);
    if (r.json && r.json.task && r.json.task.status !== 'running') return r.json.task;
    if (Date.now() > deadline) throw new Error(`核验任务超时未完成：${JSON.stringify(r.json)}`);
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}

function mkProject() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'atb-confirm-sv-')));
  git(root, ['init', '-q', '-b', 'main']);
  fs.writeFileSync(path.join(root, 'README.md'), '# t\n');
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({
    name: 'fixture', version: '1.0.0', private: true,
    scripts: { test: 'node -e "process.exit(0)"' },
  }, null, 2));
  core.initData(root);
  git(root, ['add', '.']);
  git(root, ['commit', '-q', '-m', 'chore: 初始化']);
  return root;
}

function mkPlannedItem(dataDir, title, type = 'bug') {
  const x = core.createItem(dataDir, { type, title });
  core.setStatus(dataDir, x.id, 'accepted', { by: 'human' });
  core.setStatus(dataDir, x.id, 'planned', { by: 'human' });
  return x;
}

function mkAcceptedItem(dataDir, title, desc) {
  const x = core.createItem(dataDir, { type: 'requirement', title, description: desc });
  core.setStatus(dataDir, x.id, 'accepted', { by: 'human' });
  return x;
}

// 开发侧挂起夹具：预留前脏 build.js + 本单改动 + 暂扣 test/biz → finishRun 触发挂起
function mkDevSuspension(root) {
  const dataDir = core.dataDirFrom(root);
  fs.mkdirSync(path.join(root, 'scripts', 'web'), { recursive: true });
  fs.mkdirSync(path.join(root, 'scripts', 'lib'), { recursive: true });
  fs.writeFileSync(path.join(root, 'scripts', 'web', 'build.js'), 'base\n');
  fs.writeFileSync(path.join(root, 'scripts', 'lib', 'impl.mjs'), 'v1\n');
  git(root, ['add', '.']);
  git(root, ['commit', '-q', '-m', 'chore: 被测源码入库']);
  fs.appendFileSync(path.join(root, 'scripts', 'web', 'build.js'), '上一单遗留脏改动\n');
  const item = mkPlannedItem(dataDir, '服务端挂起单');
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

async function startServer(root) {
  const port = 30000 + Math.floor(Math.random() * 20000);
  const server = spawn(process.execPath, [path.join(pluginRoot, 'scripts', 'server.mjs')], {
    cwd: root,
    env: { ...process.env, ATB_PORT: String(port), ATB_REGISTRY: path.join(os.tmpdir(), `atb-confirm-reg-${Date.now()}-${Math.floor(Math.random() * 1e6)}.json`) },
    stdio: ['ignore', 'ignore', 'ignore'],
  });
  for (let i = 0; i < 50; i++) {
    await sleep(150);
    try { await req(port, 'GET', '/api/health'); return { server, port }; } catch {}
  }
  server.kill();
  throw new Error('服务未启动');
}

function runGuard(mode, toolInput, cwd) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [GUARD, mode], {
      cwd: cwd || pluginRoot,
      env: process.env,
      stdio: ['pipe', 'ignore', 'pipe'],
    });
    let err = '';
    p.stderr.on('data', (c) => { err += c; });
    p.on('close', (code) => resolve({ code, err }));
    p.stdin.write(JSON.stringify({ tool_name: mode === 'file' ? 'Write' : 'Bash', cwd: cwd || pluginRoot, tool_input: toolInput }));
    p.stdin.end();
  });
}

// ---------- S1：开发侧服务闭环 ----------

t('S1 开发侧：清单/详情/差异/保持挂起/重新核验/确认并继续（补交 + 队列恢复 + 徽标）', async () => {
  const root = mkProject();
  const { dataDir, item } = mkDevSuspension(root);
  const { server, port } = await startServer(root);
  const P = `?project=${encodeURIComponent(root)}`;
  try {
    // 清单：一张提交挂起卡（部分提交徽标）
    let r = await req(port, 'GET', `/api/confirms${P}`);
    assert.equal(r.status, 200);
    assert.equal(r.json.count, 1, `应有一张挂起卡：${JSON.stringify(r.json)}`);
    const card = r.json.items[0];
    assert.equal(card.itemId, item.id);
    assert.equal(card.kind, 'develop');
    assert.equal(card.blockTypeLabel, '待人工确认提交');
    assert.equal(card.partialBadge, true);
    assert.ok(card.pendingCount >= 3, `待人工路径应含 build.js 与暂扣组：${card.pendingCount}`);

    // 看板徽标：挂起期间 /api/board 条目携带 confirm
    let b = await req(port, 'GET', `/api/board${P}`);
    const boardItem = (b.json.items || []).find((x) => x.id === item.id);
    assert.ok(boardItem && boardItem.confirm, '看板条目应携带 confirm 徽标数据');
    assert.equal(boardItem.confirm.blockType, 'commit');

    // 详情：逐文件状态
    r = await req(port, 'GET', `/api/confirms/${item.id}${P}`);
    assert.equal(r.status, 200);
    assert.ok(r.json.files.length >= 3, '详情应展开文件表');
    assert.ok(r.json.files.some((f) => f.path.endsWith('build.js') && f.state === '未提交'));

    // 差异：单文件 diff 文本
    r = await req(port, 'GET', `/api/confirms/${item.id}/diff${P}&path=${encodeURIComponent('scripts/web/build.js')}`);
    assert.equal(r.status, 200);
    assert.ok((r.json.diff || '').includes('本单改动') || (r.json.diff || '').includes('diff'), `差异应含改动内容：${String(r.json.diff).slice(0, 80)}`);

    // 保持挂起
    r = await req(port, 'POST', `/api/confirms/${item.id}/keep${P}`, { note: '服务端保持' });
    assert.equal(r.status, 200);
    assert.equal(confirmStates.confirmOf(dataDir, item.id).keepNote, '服务端保持');

    // 重新核验（未通过，逐项说明）—— BUG-20260915-008 起为异步任务：POST 立即返回
    // 任务句柄（不阻塞服务），轮询任务终态取核验结论
    r = await req(port, 'POST', `/api/confirms/${item.id}/verify${P}`, {});
    assert.equal(r.status, 200);
    assert.equal(r.json.accepted, true, `应立即返回任务句柄：${JSON.stringify(r.json)}`);
    const vTask = await waitConfirmTask(port, P, item.id);
    assert.equal(vTask.status, 'done');
    assert.equal(vTask.result.ok, false);
    assert.ok(vTask.result.reasons.length >= 1, '核验应逐项说明未入库路径');

    // 确认并继续：指纹取自详情（人工所见版本）；服务端编排补交 + 恢复队列（异步任务）
    const detail = await req(port, 'GET', `/api/confirms/${item.id}${P}`);
    r = await req(port, 'POST', `/api/confirms/${item.id}/continue${P}`, { fingerprint: detail.json.fingerprint });
    assert.equal(r.status, 200);
    assert.equal(r.json.accepted, true, `确认应转为异步任务：${JSON.stringify(r.json)}`);
    const cTask = await waitConfirmTask(port, P, item.id);
    assert.equal(cTask.status, 'done');
    assert.ok(cTask.result.ok, `确认应成功：${JSON.stringify(cTask.result)}`);
    assert.ok((cTask.result.supplementCommits || []).length >= 1, '应有补交提交');
    // 队列已恢复：batch/current 不再暂停
    const cur = await req(port, 'GET', `/api/batch/current${P}`);
    assert.equal(cur.json.batch.pauseRequested, false, '确认后队列应恢复领取');
    assert.ok(!confirmStates.confirmOf(dataDir, item.id) || confirmStates.confirmOf(dataDir, item.id).state === 'resolved');
    // 清单回落；徽标消失
    r = await req(port, 'GET', `/api/confirms${P}`);
    assert.equal(r.json.count, 0);
    b = await req(port, 'GET', `/api/board${P}`);
    const after = (b.json.items || []).find((x) => x.id === item.id);
    assert.ok(!after.confirm, '闭环后看板不应再挂徽标');
    // 工作区干净：全部入库
    const st = git(root, ['status', '--porcelain', '-uall']).stdout;
    assert.ok(!st.includes('build.js') && !st.includes('impl'), `补交后工作区应干净：\n${st}`);
  } finally {
    server.kill();
  }
});

// ---------- S2：分析侧服务闭环（CLI 声明 → 作答 → 确认续跑编排） ----------

t('S2 分析侧：atb refine hold 声明 → 卡片 → answer 草稿 → continue 版本绑定 → 队列续跑编排', async () => {
  const root = mkProject();
  const dataDir = core.dataDirFrom(root);
  const item = mkAcceptedItem(dataDir, '服务端分析单', '涉及界面布局与按钮交互的分析单');
  const { batch } = (await import('../lib/refine-store.mjs')).createRefineBatch(dataDir, { projectRoot: root });
  const refineStore = await import('../lib/refine-store.mjs');
  const run = refineStore.nextRefineItem(dataDir, batch.batchId, { owner: 'rw1' });
  assert.equal(run.itemId, item.id);

  // worker 经 CLI 声明（state-guard 放行的 worker 通道）
  const h = spawnSync(process.execPath, [ATB, 'refine', 'hold', run.runId,
    '--reason', '方案待选择', '--question', '请选择方案 A 或 B', '--question', '请补充频率',
    '--background', '两个交互走向', '--dir', root], { encoding: 'utf8', timeout: 60_000 });
  assert.equal(h.status, 0, `refine hold 应成功：${h.stderr || h.stdout}`);
  assert.ok(confirmStates.confirmOf(dataDir, item.id), '声明应落账');

  const { server, port } = await startServer(root);
  const P = `?project=${encodeURIComponent(root)}`;
  try {
    let r = await req(port, 'GET', `/api/confirms${P}`);
    assert.equal(r.json.count, 1);
    const card = r.json.items[0];
    assert.equal(card.blockTypeLabel, '待人工确认分析');
    assert.equal(card.total, 2);

    // 部分作答（草稿）
    r = await req(port, 'POST', `/api/confirms/${item.id}/answer${P}`, {
      answers: [{ q: 'q1', text: '方案 A' }],
    });
    assert.equal(r.status, 200);
    assert.deepEqual(r.json.missing, ['q2']);

    // 缺必答确认 → 拒绝
    const d1 = await req(port, 'GET', `/api/confirms/${item.id}${P}`);
    r = await req(port, 'POST', `/api/confirms/${item.id}/continue${P}`, { version: d1.json.questionsVersion });
    assert.equal(r.json.ok, false);
    assert.ok(r.json.reasons.some((x) => x.includes('必答')));

    // 补齐 + 确认：服务端编排续跑（队列恢复、当前运行 interrupted、条目队首）
    await req(port, 'POST', `/api/confirms/${item.id}/answer${P}`, { answers: [{ q: 'q2', text: '每天' }] });
    const d2 = await req(port, 'GET', `/api/confirms/${item.id}${P}`);
    r = await req(port, 'POST', `/api/confirms/${item.id}/continue${P}`, { version: d2.json.questionsVersion });
    assert.equal(r.json.ok, true, `分析确认应成功：${JSON.stringify(r.json)}`);
    const cur = await req(port, 'GET', `/api/refine/current${P}`);
    assert.equal(cur.json.batch.pauseRequested, false, '确认后完善队列应恢复');
    assert.equal(refineStore.getRefineRun(dataDir, run.runId).phase, 'interrupted', '声明运行应转 interrupted 续跑');
    // 下一次领取回传答案
    const nx = refineStore.nextRefineItem(dataDir, batch.batchId, { owner: 'rw2' });
    assert.equal(nx.itemId, item.id);
    assert.ok(nx.continuation && nx.continuation.questions.length === 2, '续跑应携带人工答案');
  } finally {
    server.kill();
  }
});

// ---------- G1/G2：state-guard 拦截面 ----------

t('G1 钩子拦截：Agent 执行 confirm 人工闭环与 curl 写接口 → exit 2', async () => {
  const root = mkProject();
  const { item } = mkDevSuspension(root);
  const node = process.execPath;
  for (const args of [
    ['confirm', 'verify', item.id],
    ['confirm', 'keep', item.id],
    ['confirm', 'answer', item.id],
    ['confirm', 'continue', item.id],
  ]) {
    const r = await runGuard('bash', { command: `${node} ${ATB} ${args.join(' ')} --dir ${root}` }, root);
    assert.equal(r.code, 2, `Agent 执行 atb ${args.join(' ')} 应被拦截\n${r.err}`);
    assert.ok(r.err.includes('人工'), '拦截原因应说明人工专属');
  }
  const curl = await runGuard('bash', { command: `curl -s -X POST http://127.0.0.1:8888/api/confirms/${item.id}/continue?project=${encodeURIComponent(root)}` }, root);
  assert.equal(curl.code, 2, `Agent curl 确认 API 应被拦截\n${curl.err}`);
  const curl2 = await runGuard('bash', { command: `curl -s -X POST -H 'Content-Type: application/json' -d '{"answers":[]}' 'http://127.0.0.1:8888/api/confirms/${item.id}/answer?project=${encodeURIComponent(root)}'` }, root);
  assert.equal(curl2.code, 2, `Agent curl 作答 API 应被拦截\n${curl2.err}`);
});

t('G2 钩子放行：confirm list / show 只读与 refine hold worker 声明不被拦', async () => {
  const root = mkProject();
  const { dataDir, item } = mkDevSuspension(root);
  void dataDir;
  const node = process.execPath;
  for (const args of [
    ['confirm', 'list'],
    ['confirm', 'list', '--json'],
    ['confirm', 'show', item.id],
  ]) {
    const r = await runGuard('bash', { command: `${node} ${ATB} ${args.join(' ')} --dir ${root}` }, root);
    assert.equal(r.code, 0, `atb ${args.join(' ')} 不应被拦：${r.err}`);
  }
  const curl = await runGuard('bash', { command: `curl -s 'http://127.0.0.1:8888/api/confirms?project=${encodeURIComponent(root)}'` }, root);
  assert.equal(curl.code, 0, '只读清单接口不应被拦');
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
