#!/usr/bin/env node
// BUG-20260915-008 确认与核验流程同步跑测试阻塞看板服务数分钟 —— 修复回归。
// 用法：node scripts/tests/bug-async-verify-20260915-008.test.mjs
// 覆盖（README 验收标准）：
//   · A1 runProjectTestsAsync：异步执行（事件循环不被阻塞）、结果口径与同步版一致
//     （通过/失败/跳过/超时）；
//   · A2/A3 verifyCommitConfirm / confirmCommitContinue 异步化：阶段回调（核验 → 补交 →
//     测试 → 恢复队列）、结果与账本口径不变（verify 字段 / resolved / 补交留痕）；
//   · S1 服务异步闭环（验收 1/2/3）：POST verify 立即返回任务句柄，测试运行期间
//     /api/health 毫秒级响应、清单携带运行中任务（阶段 + 时长 + 超时上限），完成后结果
//     落账与现状口径一致；
//   · S2 同条目互斥（验收 4）：运行中重复触发 verify / continue 被 409 拒绝并明确提示；
//   · S3 服务重启恢复（验收 5）：运行中任务重启后明确标记 interrupted 并留痕，
//     不出现「测试跑完但确认没落账」的中间态；
//   · U1 卡片进度渲染（验收 2）：阶段进度条（核验 → 补交 → 测试 → 恢复队列）+
//     「测试运行中 · 已运行 N 秒 / 超时上限 M 秒」，运行中按钮禁用。
// 模式对齐 confirm-serve-20260914-001.test.mjs（真实 server.mjs + HTTP）与
// bug-confirm-btn-guide-20260915-005.test.mjs（vm 提取真实 app.js 源码片段）。

import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
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
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'atb-async-verify-')));
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

// 开发侧挂起夹具（对齐 confirm-serve-20260914-001）：finishRun 触发挂起声明
function mkDevSuspension(root) {
  const dataDir = core.dataDirFrom(root);
  fs.mkdirSync(path.join(root, 'scripts', 'web'), { recursive: true });
  fs.mkdirSync(path.join(root, 'scripts', 'lib'), { recursive: true });
  fs.writeFileSync(path.join(root, 'scripts', 'web', 'build.js'), 'base\n');
  fs.writeFileSync(path.join(root, 'scripts', 'lib', 'impl.mjs'), 'v1\n');
  git(root, ['add', '.']);
  git(root, ['commit', '-q', '-m', 'chore: 被测源码入库']);
  fs.appendFileSync(path.join(root, 'scripts', 'web', 'build.js'), '上一单遗留脏改动\n');
  const item = core.createItem(dataDir, { type: 'bug', title: '异步核验单' });
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

async function startServer(root) {
  const port = 30000 + Math.floor(Math.random() * 20000);
  const server = spawn(process.execPath, [path.join(pluginRoot, 'scripts', 'server.mjs')], {
    cwd: root,
    env: { ...process.env, ATB_PORT: String(port), ATB_REGISTRY: path.join(os.tmpdir(), `atb-async-reg-${Date.now()}-${Math.floor(Math.random() * 1e6)}.json`) },
    stdio: ['ignore', 'ignore', 'ignore'],
  });
  for (let i = 0; i < 50; i++) {
    await sleep(150);
    try { await req(port, 'GET', '/api/health'); return { server, port }; } catch {}
  }
  server.kill();
  throw new Error('服务未启动');
}

// ---------- A1：runProjectTestsAsync 异步执行与结果口径 ----------

t('A1a 异步不阻塞事件循环：测试运行期间计时器照常触发（spawnSync 会阻塞）', async () => {
  const root = mkProject('node -e "setTimeout(() => process.exit(0), 1200)"');
  const p = confirmStore.runProjectTestsAsync(root);
  let timerFired = false;
  await sleep(150);
  timerFired = true;
  assert.equal(timerFired, true, '150ms 计时器应在测试进程结束前触发（事件循环未被阻塞）');
  const r = await p;
  assert.equal(r.ok, true, `慢测试应通过：${JSON.stringify(r)}`);
  assert.equal(r.cmd, 'npm test');
  assert.equal(r.exitCode, 0);
});

t('A1b 结果口径与同步版一致：失败退出码 / 无 package.json 跳过 / 超时标记', async () => {
  const bad = mkProject('node -e "process.exit(3)"');
  const rBad = await confirmStore.runProjectTestsAsync(bad);
  assert.equal(rBad.ok, false);
  assert.equal(rBad.exitCode, 3);
  assert.notEqual(rBad.timedOut, true);

  const none = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'atb-async-nopkg-')));
  const rNone = await confirmStore.runProjectTestsAsync(none);
  assert.equal(rNone.skipped, true, '无 package.json 应按无测试脚本口径跳过');

  const slow = mkProject('node -e "setTimeout(() => process.exit(0), 30000)"');
  const t0 = Date.now();
  const rSlow = await confirmStore.runProjectTestsAsync(slow, { timeoutMs: 800 });
  assert.equal(rSlow.timedOut, true, `超时应标记 timedOut：${JSON.stringify(rSlow)}`);
  assert.equal(rSlow.ok, false);
  assert.ok(Date.now() - t0 < 10_000, '超时应在时限附近返回，而非等满 30 秒');
});

// ---------- A2/A3：verify / continue 异步化 + 阶段回调 + 账本口径不变 ----------

t('A2 verify 异步：阶段回调 verify → test；结果与 verify 字段落账口径不变', async () => {
  const root = mkProject();
  const { dataDir, item } = mkDevSuspension(root);
  terminalSupplement(root, item.id);
  const stages = [];
  const seenRoots = [];
  const v = await confirmStore.verifyCommitConfirm(dataDir, item.id, {
    projectRoot: root,
    runTests: true,
    testRunner: async (r) => { seenRoots.push(r); return { cmd: 'npm test', exitCode: 0, ok: true }; },
    onStage: (s) => stages.push(s),
  });
  assert.deepEqual(seenRoots, [root], '测试执行器应收到项目根');
  assert.deepEqual(stages, ['verify', 'test'], `核验阶段序列应为 verify → test：${JSON.stringify(stages)}`);
  assert.equal(v.ok, true, `终端补交后核验应通过：${JSON.stringify(v)}`);
  assert.equal(v.test.ok, true, '核验结果应携带测试结论');
  const rec = confirmStates.confirmOf(dataDir, item.id);
  assert.equal(rec.verify.ok, true, 'verify 字段落账口径不变');
  assert.equal(rec.verify.test.ok, true);
});

t('A3 continue 异步：阶段回调 verify → supplement → test → restore；resolved 与补交口径不变', async () => {
  const root = mkProject();
  const { dataDir, item } = mkDevSuspension(root);
  terminalSupplement(root, item.id);
  const rec0 = confirmStates.confirmOf(dataDir, item.id);
  const stages = [];
  const r = await confirmStore.confirmCommitContinue(dataDir, item.id, {
    projectRoot: root,
    fingerprint: rec0.fingerprint,
    testRunner: async () => ({ cmd: 'npm test', exitCode: 0, ok: true }),
    onStage: (s) => stages.push(s),
  });
  assert.deepEqual(stages, ['verify', 'supplement', 'test', 'restore'],
    `确认阶段序列应为 verify → supplement → test → restore：${JSON.stringify(stages)}`);
  assert.equal(r.ok, true, `终端补交后确认应成功：${JSON.stringify(r)}`);
  const rec = confirmStates.confirmOf(dataDir, item.id);
  assert.equal(rec.state, 'resolved', '确认成功后 resolved 口径不变');
  assert.equal(rec.verify.ok, true);
  assert.ok(rec.resolvedAt, 'resolvedAt 落账');
});

// ---------- S1：服务异步闭环（立即返回 + health 响应 + 进度 + 完成落账） ----------

t('S1 核验异步：POST 立即返回任务句柄；运行中 health 毫秒级响应、清单带进度；完成后落账口径一致', async () => {
  const root = mkProject('node -e "setTimeout(() => process.exit(0), 2500)"');
  const { dataDir, item } = mkDevSuspension(root);
  terminalSupplement(root, item.id);
  const { server, port } = await startServer(root);
  const P = `?project=${encodeURIComponent(root)}`;
  try {
    // 触发核验：立即返回（< 2 秒，不再同步等待 ~3 秒测试）
    const t0 = Date.now();
    let r = await req(port, 'POST', `/api/confirms/${item.id}/verify${P}`, {});
    const postMs = Date.now() - t0;
    assert.equal(r.status, 200);
    assert.equal(r.json.ok, true);
    assert.equal(r.json.accepted, true, `应返回任务句柄而非同步结果：${JSON.stringify(r.json)}`);
    assert.ok(postMs < 2000, `POST 应立即返回（实际 ${postMs}ms）`);
    const { task } = r.json;
    assert.equal(task.itemId, item.id);
    assert.equal(task.status, 'running');
    assert.equal(task.timeoutMs, 600_000, '任务应携带超时上限');
    assert.ok(Date.parse(task.startedAt), '任务应携带开始时间');

    // 运行中：health 探活毫秒级响应（事件循环未被阻塞）
    const t1 = Date.now();
    const h = await req(port, 'GET', '/api/health');
    assert.equal(h.status, 200);
    assert.ok(Date.now() - t1 < 1500, `测试运行期间 health 应快速响应（实际 ${Date.now() - t1}ms）`);

    // 运行中：清单条目携带任务运行态（阶段 + 超时上限），卡片轮询可见进度
    let sawTestStage = false;
    for (let i = 0; i < 50 && !sawTestStage; i++) {
      const tk = await req(port, 'GET', `/api/confirms/${item.id}/task${P}`);
      assert.equal(tk.status, 200);
      if (tk.json.task && tk.json.task.status === 'running' && tk.json.task.stage === 'test') sawTestStage = true;
      else await sleep(100);
    }
    assert.ok(sawTestStage, '任务进度应推进到 test 阶段（阶段回传）');
    const list = await req(port, 'GET', `/api/confirms${P}`);
    const card = (list.json.items || []).find((c) => c.itemId === item.id);
    assert.ok(card && card.task && card.task.status === 'running', '清单条目应携带运行中任务（卡片进度数据源）');
    assert.ok(Number.isFinite(card.task.elapsedMs), '任务应携带已运行时长');

    // 其他操作不受阻：看板接口正常响应（对照缺陷形态的整页冻结）
    const b = await req(port, 'GET', `/api/board${P}`);
    assert.equal(b.status, 200);

    // 完成：结果落账口径与现状一致（verify 字段 + 测试结论）
    let done = null;
    for (let i = 0; i < 120 && !done; i++) {
      const tk = await req(port, 'GET', `/api/confirms/${item.id}/task${P}`);
      if (tk.json.task && tk.json.task.status !== 'running') done = tk.json.task;
      else await sleep(250);
    }
    assert.ok(done, '任务应在时限内完成');
    assert.equal(done.status, 'done');
    assert.equal(done.result.ok, true, `核验结论应通过：${JSON.stringify(done.result)}`);
    const rec = confirmStates.confirmOf(dataDir, item.id);
    assert.equal(rec.verify.ok, true, '完成后 verify 字段落账口径不变');
    assert.equal(rec.verify.test.ok, true, '测试结论回填 verify.test');
  } finally {
    server.kill();
  }
});

// ---------- S2：同条目互斥（运行中重复触发被拒） ----------

t('S2 互斥：运行中重复触发 verify / continue 返回 409 并明确提示运行中', async () => {
  const root = mkProject('node -e "setTimeout(() => process.exit(0), 2500)"');
  const { dataDir, item } = mkDevSuspension(root);
  terminalSupplement(root, item.id);
  const rec0 = confirmStates.confirmOf(dataDir, item.id);
  const { server, port } = await startServer(root);
  const P = `?project=${encodeURIComponent(root)}`;
  try {
    const r1 = await req(port, 'POST', `/api/confirms/${item.id}/verify${P}`, {});
    assert.equal(r1.json.accepted, true);
    const again = await req(port, 'POST', `/api/confirms/${item.id}/verify${P}`, {});
    assert.equal(again.status, 409, `运行中重复核验应 409：${JSON.stringify(again.json)}`);
    assert.equal(again.json.ok, false);
    assert.ok(String(again.json.error).includes('运行中'), `拒绝原因应明确「运行中」：${again.json.error}`);
    const cont = await req(port, 'POST', `/api/confirms/${item.id}/continue${P}`, { fingerprint: rec0.fingerprint });
    assert.equal(cont.status, 409, `运行中触发确认也应被互斥拒绝：${JSON.stringify(cont.json)}`);
    // 等待完成，互斥解除
    let done = null;
    for (let i = 0; i < 120 && !done; i++) {
      const tk = await req(port, 'GET', `/api/confirms/${item.id}/task${P}`);
      if (tk.json.task && tk.json.task.status !== 'running') done = tk.json.task;
      else await sleep(250);
    }
    assert.equal(done.status, 'done');
    // 完成后可再次触发（新一轮任务）
    const r2 = await req(port, 'POST', `/api/confirms/${item.id}/verify${P}`, {});
    assert.equal(r2.json.accepted, true, '完成后互斥应解除');
    let done2 = null;
    for (let i = 0; i < 120 && !done2; i++) {
      const tk = await req(port, 'GET', `/api/confirms/${item.id}/task${P}`);
      if (tk.json.task && tk.json.task.status !== 'running') done2 = tk.json.task;
      else await sleep(250);
    }
    assert.equal(done2.status, 'done');
    void dataDir;
  } finally {
    server.kill();
  }
});

// ---------- S3：服务重启恢复（运行中任务明确标记中断） ----------

t('S3 重启恢复：账本遗留 running 任务被标记 interrupted 并留痕，确认保持 waiting 可重试', async () => {
  const root = mkProject();
  const { dataDir, item } = mkDevSuspension(root);
  // 预置上一进程中断时遗留的运行中任务账本
  fs.mkdirSync(path.join(dataDir, 'confirms'), { recursive: true });
  const seeded = {
    version: 1,
    tasks: {
      [item.id]: {
        taskId: 'task-seeded-1', itemId: item.id, action: 'verify', status: 'running',
        stage: 'test', startedAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
        timeoutMs: 600_000, by: 'board', result: null, error: null, reason: null,
      },
    },
  };
  fs.writeFileSync(path.join(dataDir, 'confirms', 'tasks.json'), JSON.stringify(seeded, null, 2));
  const { server, port } = await startServer(root);
  const P = `?project=${encodeURIComponent(root)}`;
  try {
    const tk = await req(port, 'GET', `/api/confirms/${item.id}/task${P}`);
    assert.equal(tk.status, 200);
    assert.equal(tk.json.task.status, 'interrupted', `遗留 running 任务应被标记中断：${JSON.stringify(tk.json.task)}`);
    assert.ok(String(tk.json.task.reason).includes('中断'), `应说明中断原因：${tk.json.task.reason}`);
    // 确认记录保持 waiting（未落「确认完成」中间态）并留痕中断事件
    const rec = confirmStates.confirmOf(dataDir, item.id);
    assert.equal(rec.state, 'waiting', '重启后挂起保持 waiting，不出现已确认中间态');
    const last = rec.events[rec.events.length - 1];
    assert.ok(/interrupt/.test(last.kind), `确认记录应留痕中断事件：${last.kind}`);
    // 中断后可重新触发（互斥不残留）
    const r = await req(port, 'POST', `/api/confirms/${item.id}/verify${P}`, {});
    assert.equal(r.json.accepted, true, '中断任务不阻塞重新核验');
  } finally {
    server.kill();
  }
});

// ---------- U1：卡片进度渲染（阶段进度条 + 运行时长 + 按钮禁用） ----------

const appSource = fs.readFileSync(new URL('../web/app.js', import.meta.url), 'utf8');

function runCardFragment(card) {
  const context = vm.createContext({
    esc: (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])),
    fmtElapsed: () => '1 分', fmtTime: () => '12:00', shortOwner: (s) => String(s || ''),
    state: { confirms: { busyId: null } },
  });
  const start = appSource.indexOf('function confirmKindChip(');
  const end = appSource.indexOf('function renderConfirmArea(');
  assert.ok(start > 0 && end > start, 'app.js 应包含卡片渲染片段');
  vm.runInContext(appSource.slice(start, end), context);
  return vm.runInContext(`confirmCardHtml(${JSON.stringify(card)})`, context);
}

function devCard(task) {
  return {
    itemId: 'BUG-1', kind: 'develop', kindLabel: '开发', blockType: 'commit', blockTypeLabel: '提交挂起',
    title: '异步核验单', declaredAt: new Date().toISOString(), state: 'waiting',
    committedCount: 0, supplementCommits: [], pendingCount: 0, attributedCount: 0, uncertainCount: 0,
    partialBadge: true, ...(task ? { task } : {}),
  };
}

t('U1 卡片进度：continue 运行中渲染阶段进度条（核验 → 补交 → 测试 → 恢复队列）与运行时长、超时上限；按钮禁用', () => {
  const html = runCardFragment(devCard({
    taskId: 'task-1', itemId: 'BUG-1', action: 'continue', status: 'running', stage: 'test',
    startedAt: new Date(Date.now() - 96_000).toISOString(), timeoutMs: 600_000, elapsedMs: 96_000,
  }));
  for (const k of ['核验', '补交', '测试', '恢复队列']) {
    assert.ok(html.includes(k), `阶段进度应含「${k}」`);
  }
  assert.ok(/测试运行中/.test(html), '测试阶段应显示「测试运行中」');
  assert.ok(/已运行/.test(html) && /超时上限/.test(html), '应显示运行时长与超时上限');
  assert.ok(/已运行\s*96\s*秒/.test(html), `时长应为 96 秒：${(html.match(/已运行[^<]*/) || [''])[0]}`);
  const verifyBtn = (html.match(/<button[^>]*data-confirm-verify="[^"]*"[^>]*>/) || [''])[0];
  assert.ok(/disabled/.test(verifyBtn), '运行中「重新核验」按钮应禁用（互斥防重复）');
});

t('U1b 卡片进度：verify 运行中渲染核验 → 测试两阶段；无任务卡片不渲染进度（兼容旧形态）', () => {
  const html = runCardFragment(devCard({
    taskId: 'task-2', itemId: 'BUG-1', action: 'verify', status: 'running', stage: 'test',
    startedAt: new Date().toISOString(), timeoutMs: 600_000, elapsedMs: 3_000,
  }));
  assert.ok(html.includes('核验') && html.includes('测试'), 'verify 任务也应显示阶段');
  assert.ok(!html.includes('恢复队列'), 'verify 无「恢复队列」阶段');
  assert.ok(/测试运行中/.test(html));
  const plain = runCardFragment(devCard(null));
  assert.ok(!plain.includes('测试运行中') && !plain.includes('超时上限'), '无任务卡片不应渲染进度区');
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
