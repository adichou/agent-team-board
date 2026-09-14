#!/usr/bin/env node
// REQ-20260913-003 批量任务去掉批次概念 —— 实时取单单轮执行
// 覆盖：RT-01/02 启动不冻结候选 + 实时队列；RT-03 重复启动拒绝；RT-04 队列取空即结束（无排队接续）；
//       RT-05 调度提示词去批次 + 实时取单指令；RT-06 存量冻结提示词展示归一；RT-07 refine 实时队列；
//       RT-08 服务端响应去批次号；RT-09 前端静态契约；RT-10 暂停/终止/重试/记录不回归
// 用法：node scripts/tests/realtime-round-20260913-003.test.mjs

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import * as core from '../lib/core.mjs';
import * as batch from '../lib/batch.mjs';
import * as refine from '../lib/refine-store.mjs';
import * as taskSettings from '../lib/task-settings.mjs';

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const cases = [];
const t = (name, fn) => cases.push([name, fn]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function mkProject() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'atb-rt003-')));
  const dataDir = core.initData(root);
  batch.ensureDispatch(dataDir);
  refine.ensureRefine(dataDir);
  return { root, dataDir };
}

function mkItem(p, type, title, { accept = true, plan = true, deltaMs = 0 } = {}) {
  const st = core.createItem(p.dataDir, { type, title, description: 'x', by: 'tester' });
  if (accept) core.setStatus(p.dataDir, st.id, 'accepted', { by: 'tester' });
  if (accept && plan) core.setStatus(p.dataDir, st.id, 'planned', { by: 'tester' });
  if (deltaMs) {
    const { dir } = core.resolveItemDir(p.dataDir, st.id);
    const s = JSON.parse(fs.readFileSync(path.join(dir, 'status.json'), 'utf8'));
    s.createdAt = new Date(Date.parse(s.createdAt) - deltaMs).toISOString();
    fs.writeFileSync(path.join(dir, 'status.json'), JSON.stringify(s, null, 2) + '\n');
  }
  return st.id;
}

function cleanup(p) {
  try { fs.rmSync(p.root, { recursive: true, force: true }); } catch {}
}

const W1 = 'zcode-rt003-w1';

// ---------- RT-01 启动不冻结候选，实时取单 ----------

t('RT-01 启动不冻结候选：建轮 candidates 为空；next 实时领取全部已计划条目（最旧优先）', () => {
  const p = mkProject();
  try {
    const ids = [1, 2, 3].map((i) => mkItem(p, 'requirement', `RT01-${i}`, { deltaMs: (3 - i) * 1000 }));
    const { batch: b, created } = batch.createBatch(p.dataDir, { projectRoot: p.root });
    assert.ok(created, '首次启动应创建本轮执行');
    assert.deepEqual(b.candidates, [], '启动不得冻结候选快照（账本候选为空，领取时实时读取）');
    const run1 = batch.nextItem(p.dataDir, b.batchId, { owner: W1 });
    assert.equal(run1.itemId, ids[0], '领取时实时读取已计划队列，最旧优先');
    // 同一时间只有一个实施任务（不变约束）：run1 未收尾时其他执行体不得再领
    assert.throws(
      () => batch.nextItem(p.dataDir, b.batchId, { owner: 'zcode-rt003-w2' }),
      /当前执行未收尾/,
      '在途未收尾时不得创建第二个实施任务',
    );
    core.claim(p.dataDir, ids[0], W1);
    core.report(p.dataDir, ids[0], { summary: 'ok', by: W1, run: { runId: run1.runId } });
    batch.finishRun(p.dataDir, run1.runId, { result: 'reported', reportRef: 'test-report.md' });
    // 收尾后继续实时领取：队列最旧的下一项
    const run2 = batch.nextItem(p.dataDir, b.batchId, { owner: W1 });
    assert.equal(run2.itemId, ids[1], '收尾后仍按实时队列最旧优先领取');
  } finally { cleanup(p); }
});

// ---------- RT-02 实时队列：新移入计划条目立即可领取 ----------

t('RT-02 实时队列：启动后新移入计划条目立即可领取，无需并入操作；摘要待处理队列实时包含', () => {
  const p = mkProject();
  try {
    const a = mkItem(p, 'requirement', 'RT02-先', { deltaMs: 1000 });
    const { batch: b } = batch.createBatch(p.dataDir, { projectRoot: p.root });
    const fresh = mkItem(p, 'requirement', 'RT02-运行中新计划'); // 启动后新移入计划
    const run1 = batch.nextItem(p.dataDir, b.batchId, { owner: W1 });
    assert.equal(run1.itemId, a);
    core.claim(p.dataDir, a, W1);
    core.report(p.dataDir, a, { summary: 'ok', by: W1, run: { runId: run1.runId } });
    batch.finishRun(p.dataDir, run1.runId, { result: 'reported', reportRef: 'test-report.md' });
    const sum = batch.batchSummary(p.dataDir, b.batchId);
    assert.ok(sum.pending.some((x) => x.id === fresh), '摘要待处理队列应实时包含新移入计划条目');
    const run2 = batch.nextItem(p.dataDir, b.batchId, { owner: W1 });
    assert.equal(run2.itemId, fresh, '新移入计划条目立即可领取（无需并入批次）');
  } finally { cleanup(p); }
});

// ---------- RT-03 重复启动拒绝 ----------

t('RT-03 重复启动拒绝：待启动/执行中/暂停轮次存在时启动被拒且不新建账本对象；空转账本就地收尾', () => {
  const p = mkProject();
  try {
    mkItem(p, 'requirement', 'RT03-A');
    const { batch: b } = batch.createBatch(p.dataDir, { projectRoot: p.root });
    const before = batch.listBatches(p.dataDir).length;
    // 待启动（prepared）重复启动
    assert.throws(() => batch.createBatch(p.dataDir, { projectRoot: p.root }), /已有进行中的任务/, '待启动时重复启动应被拒');
    // 执行中重复启动
    const run = batch.nextItem(p.dataDir, b.batchId, { owner: W1 });
    assert.throws(() => batch.createBatch(p.dataDir, { projectRoot: p.root }), /已有进行中的任务/, '执行中重复启动应被拒');
    // 暂停轮次同样拒绝（须先恢复或终止）
    core.claim(p.dataDir, run.itemId, W1);
    batch.pauseBatch(p.dataDir, b.batchId, true);
    assert.throws(() => batch.createBatch(p.dataDir, { projectRoot: p.root }), /已有进行中的任务/, '暂停轮次存在时启动应被拒');
    assert.equal(batch.listBatches(p.dataDir).length, before, '拒绝路径不得产生新账本对象');
    // 终止后可再次启动
    batch.abortBatch(p.dataDir, b.batchId);
    const b2cand = mkItem(p, 'requirement', 'RT03-B', { deltaMs: 500 });
    const next = batch.createBatch(p.dataDir, { projectRoot: p.root });
    assert.ok(next.created, '终止后可启动新一轮');
    // 空转账本（无在途且无剩余）就地收尾：唯一候选被人工认领后该轮空转——实时队列语义下
    // 新计划条目本就属于当前轮，空转仅发生于候选全部流失时；此时启动按候选口径报错，
    // 且空转旧轮被就地收尾为 finished，不残留未结束账本阻塞下一次启动
    core.claim(p.dataDir, b2cand, 'human');
    assert.throws(() => batch.createBatch(p.dataDir, { projectRoot: p.root }), /没有可实施候选/, '空转且无候选时按候选口径报错');
    assert.equal(batch.getBatch(p.dataDir, next.batch.batchId).status, 'finished', '空转旧轮应被就地收尾');
    mkItem(p, 'requirement', 'RT03-C', { deltaMs: 100 });
    const again = batch.createBatch(p.dataDir, { projectRoot: p.root });
    assert.ok(again.created, '空转账本收尾后应可启动新一轮');
  } finally { cleanup(p); }
});

// ---------- RT-04 队列取空即本轮结束，无排队接续 ----------

t('RT-04 实时队列取空即本轮结束：check stop=finished 且不再携带 nextBatch 排队接续', () => {
  const p = mkProject();
  try {
    const a = mkItem(p, 'requirement', 'RT04-A');
    const { batch: b } = batch.createBatch(p.dataDir, { projectRoot: p.root });
    const run = batch.nextItem(p.dataDir, b.batchId, { owner: W1 });
    core.claim(p.dataDir, a, W1);
    core.report(p.dataDir, a, { summary: 'ok', by: W1, run: { runId: run.runId } });
    batch.finishRun(p.dataDir, run.runId, { result: 'reported', reportRef: 'test-report.md' });
    const chk = batch.checkBatch(p.dataDir, b.batchId);
    assert.equal(chk.nextAction, 'stop', `队列取空应 stop，得到 ${JSON.stringify(chk)}`);
    assert.equal('nextBatch' in chk, false, '不得再携带 nextBatch 排队接续');
    assert.equal(chk.status, 'finished');
    assert.ok(!JSON.stringify(chk).includes('批次'), '核对响应不得出现批次字样');
  } finally { cleanup(p); }
});

// ---------- RT-05 调度提示词去批次 ----------

t('RT-05 调度提示词去批次：开发/完善提示词不含批次、batchId、--batch 与接续；含实时取单指令', () => {
  const dev = batch.generatePrompt({
    projectRoot: '/tmp/rt003 项目',
    batchId: 'batch-20990101-001',
    workerSpecPath: '/tmp/rt003/w.md',
    modelSource: 'follow',
  });
  for (const w of ['批次', 'batchId', '--batch', 'nextBatch', '排队', 'batch-20990101-001']) {
    assert.ok(!dev.includes(w), `开发提示词不得包含「${w}」`);
  }
  assert.ok(dev.includes('实时取单') && dev.includes('最旧优先'), '开发提示词应含实时取单指令（最旧优先）');
  assert.ok(dev.includes('队列取空即本轮结束'), '开发提示词应说明队列取空即本轮结束');
  assert.ok(dev.includes('batch check --dir'), '核对入口不依赖批次标识');

  const rf = refine.buildRefinePrompt({
    projectRoot: '/tmp/rt003 项目',
    batchId: 'RFB-20990101-001',
    modelSource: 'follow',
  });
  for (const w of ['批次', 'batchId', '--batch', 'nextBatch', '排队', 'RFB-20990101-001']) {
    assert.ok(!rf.includes(w), `完善提示词不得包含「${w}」`);
  }
  assert.ok(rf.includes('实时取单'), '完善提示词应含实时取单指令');
  assert.ok(rf.includes('refine check --dir'), '完善核对入口不依赖批次标识');
});

// ---------- RT-06 存量冻结提示词展示归一 ----------

t('RT-06 存量冻结提示词展示归一：批次行/摘要入口/接续/完善批次行归一为无批次口径；新版输出幂等', () => {
  const legacyDev = [
    '你是当前项目的批次调度员，只负责派发与接收短回执。',
    '项目：/tmp/p',
    '批次：batch-20260901-001',
    taskSettings.FOLLOW_SESSION_PROMPT_LINE,
    '执行规范：/tmp/w.md',
    '批次摘要入口：node /x/atb.mjs batch check --batch batch-20260901-001 --dir /tmp/p',
    '',
    '每轮新启动一个子代理，按执行规范自行选择本批一个可实施条目，认领、实施、测试并上报。',
    '每个子代理只做一项；子代理会话命名统一为：<条目编号>（与主调度会话区分）。',
    '同一时间只运行一个；不要让子代理再派发子代理。',
    '只传本项目、批次标识与规范路径，不复制本会话的历史实施记录。',
    '',
    '完整需求、代码、测试日志、报告均由子代理按需读取或落盘。',
    '主会话只接收规定的短回执，并调用最小核对入口。',
    'nextAction=continue 时启动下一个新子代理；stop 时结束；',
    'needs_attention 时说明简短原因和记录入口，等待人工处理。',
    'stop 且核对响应携带 nextBatch 时为批次排队自动接续（REQ-20260906-025）：',
    '同一会话不重开，直接以 nextBatch.batchId 替换本提示词中的批次标识与核对入口继续执行下一批。',
    '不要重复读取全队列、完整报告，不逐项输出长总结，不高频轮询。',
    '收尾只给批次计数和异常入口。不得代替人工接受需求或确认完成。',
  ].join('\n');
  const dev = taskSettings.normalizePromptForDisplay(legacyDev);
  for (const w of ['批次', 'batchId', '--batch', 'nextBatch']) assert.ok(!dev.includes(w), `归一后开发提示词仍含「${w}」`);
  assert.ok(dev.includes('调度核对入口') && dev.includes('batch check --dir'), '摘要入口应归一为无批次核对入口');
  assert.ok(dev.includes('批量开发调度员'), '调度员措辞应去批次');

  const legacyRf = [
    '你是当前项目的批量完善调度员，只负责派发与接收短回执。',
    '项目：/tmp/p',
    '完善批次：RFB-20260901-001',
    taskSettings.FOLLOW_SESSION_PROMPT_LINE,
    '',
    '在当前项目的 Agent 会话中执行本提示词：每轮新启动一个子代理，按执行流程完善本批',
    '一个已接受条目的文档。子代理会话命名统一为：<条目编号>（与主调度会话区分）。',
    '每个子代理只做一项；同一时间只运行一个；不要让子代理再派发子代理。',
    '',
    'CLI 约定：atb 指 node /x/atb.mjs（下同）。',
    '',
    '子代理流程（每项一个）：',
    '1. 领取：atb refine next --by refine-<批次尾号>-<序号> --dir "/tmp/p"',
    '   （返回条目、目录、缺失原因；stop 时按提示结束）',
    '   领取/回执命令在子代理会话内执行（工作目录用 --dir 指定）。',
    '2. 阅读条目现有说明与项目代码/文档，直接编辑条目目录下的 markdown 补全：',
    '   需求只补 README：描述 + 验收标准；涉及 UI 时须含界面布局、交互行为、状态反馈与界面展示——',
    '   界面展示节保留布局/交互/状态反馈的文字说明并链接 ./ui-demo.html，同时在条目目录创建 ui-demo.html',
    '   可交互演示：单文件 html（内联 CSS/JS）、无外网依赖、无构建步骤、浏览器直接打开可交互，',
    '   覆盖界面布局/交互行为/状态反馈（正常/空/加载/失败等状态切换；深浅色适配可选，ASCII 线框仅作可选补充）；',
    '   design/test-cases 留待开发阶段；Bug 补现象/复现步骤/期望行为/验收说明——涉及 UI 的 Bug',
    '   （现象为界面问题或修复会改动界面）同样须提供界面展示：界面展示节链接 ./ui-demo.html',
    '   并在条目目录创建 ui-demo.html 可交互演示，质量门槛同需求：单文件 html，',
    '   演示建议对照展示缺陷现象与期望修复后状态（如通过状态切换/开关对比）；',
    '   项目里查不到的事实一律写「待确认」，不要编造。',
    '3. 回执：atb refine done <RUN-ID> --summary "<补全要点>"（须真实改过文档）；',
    '   无法完善用 atb refine fail <RUN-ID> --reason "<短句>"；认领冲突用 atb refine release。',
    '',
    '硬性约束：条目全程保持 accepted（已接受）；不要修改业务源码；不要修改条目 status.json；',
    '不要调用 claim/report、不要写 test-report.md、不要 git commit；只编辑条目目录下 markdown（涉及 UI 的需求或 Bug 可另建约定的 ui-demo.html）。',
    `4. 主会话核对：atb refine check --batch RFB-20260901-001 --dir "/tmp/p"`,
    '   nextAction=continue 时派发下一个子代理；stop 时结束。主会话只接收规定的短回执，不复制子代理的完整文档内容。',
  ].join('\n');
  const rf = taskSettings.normalizePromptForDisplay(legacyRf);
  for (const w of ['批次', 'batchId', '--batch', 'RFB-20260901-001']) assert.ok(!rf.includes(w), `归一后完善提示词仍含「${w}」`);
  assert.ok(rf.includes('--by refine-<序号>'), '领取前缀应去批次尾号');
  assert.ok(rf.includes('refine check --dir'), '完善核对入口应去 --batch');

  // 幂等：新版生成输出经归一逐字不变
  const newDev = batch.generatePrompt({ projectRoot: '/tmp/p', batchId: 'batch-20990101-001', workerSpecPath: '/tmp/w.md' });
  assert.equal(taskSettings.normalizePromptForDisplay(newDev), newDev, '新版开发提示词归一应幂等');
  const newRf = refine.buildRefinePrompt({ projectRoot: '/tmp/p', batchId: 'RFB-20990101-001' });
  assert.equal(taskSettings.normalizePromptForDisplay(newRf), newRf, '新版完善提示词归一应幂等');
});

// ---------- RT-07 refine 实时队列 ----------

t('RT-07 refine 实时队列：建轮不冻结；新接受条目立即可领取；重复启动被拒', () => {
  const p = mkProject();
  try {
    const a = mkItem(p, 'requirement', 'RT07-先', { plan: false, deltaMs: 1000 }); // accepted（完善候选）
    const { batch: b, created } = refine.createRefineBatch(p.dataDir, { projectRoot: p.root });
    assert.ok(created);
    assert.equal(b.candidates.length, 0, '完善建轮不得冻结候选快照');
    const run1 = refine.nextRefineItem(p.dataDir, b.batchId, { owner: W1 });
    assert.equal(run1.itemId, a, '领取时实时读取已接受未完善队列');
    refine.releaseRefineRun(p.dataDir, run1.runId, { reason: '认领冲突' });
    const c = mkItem(p, 'requirement', 'RT07-运行中新接受', { plan: false }); // 启动后新接受
    const run2 = refine.nextRefineItem(p.dataDir, b.batchId, { owner: W1 });
    assert.equal(run2.itemId, c, '新接受的未完善条目立即可领取（无需并入）');
    assert.throws(
      () => refine.createRefineBatch(p.dataDir, { projectRoot: p.root }),
      /已有进行中的完善任务/,
      '完善任务未结束时重复启动应被拒',
    );
  } finally { cleanup(p); }
});

// ---------- RT-08 服务端响应去批次号 ----------

function req(port, method, pathname, body) {
  return new Promise((resolve, reject) => {
    const payload = body == null ? null : JSON.stringify(body);
    const r = http.request({
      hostname: '127.0.0.1', port, path: pathname, method,
      headers: payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {},
      timeout: 5000,
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

t('RT-08 服务端响应去批次号：create/current/prompt/全局简报无 batchId 与 queue；board 无 batchEntry；重复启动 400', async () => {
  const p = mkProject();
  const a = mkItem(p, 'requirement', 'RT08-A', { deltaMs: 1000 });
  mkItem(p, 'requirement', 'RT08-B');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'atb-rt003-serve-'));
  const port = 30000 + Math.floor(Math.random() * 20000);
  const server = spawn(process.execPath, [path.join(pluginRoot, 'scripts', 'server.mjs')], {
    cwd: p.root,
    env: { ...process.env, ATB_PORT: String(port), ATB_REGISTRY: path.join(tmp, 'reg.json') },
    stdio: ['ignore', 'ignore', 'ignore'],
  });
  try {
    let up = false;
    for (let i = 0; i < 40 && !up; i++) {
      await sleep(150);
      try { await req(port, 'GET', '/api/health'); up = true; } catch {}
    }
    assert.ok(up, '服务应启动');
    const qs = `?project=${encodeURIComponent(p.root)}`;

    let r = await req(port, 'POST', `/api/batch/create${qs}`, {});
    assert.equal(r.status, 200, `创建应成功：${JSON.stringify(r.json)}`);
    assert.equal('batchId' in r.json, false, '创建响应不得透出批次号');
    assert.equal('queued' in r.json, false, '创建响应不得透出排队字段');
    assert.ok(!JSON.stringify(r.json).includes('批次'), '创建响应不得出现批次字样');
    assert.ok(!r.json.prompt.includes('批次') && !r.json.prompt.includes('--batch'), '创建返回提示词不得含批次口径');

    r = await req(port, 'POST', `/api/batch/create${qs}`, {});
    assert.equal(r.status, 400, '重复启动应被拒');
    assert.match(String(r.json && r.json.error || ''), /已有进行中的任务/, '重复启动应给出明确提示');

    r = await req(port, 'GET', `/api/batch/current${qs}`);
    assert.equal(r.status, 200);
    assert.equal('batchId' in r.json.batch, false, 'current 批次载荷不得透出批次号');
    assert.equal('queue' in r.json, false, 'current 不得再携带排队批次列表');
    assert.ok(Array.isArray(r.json.pending) && r.json.pending.length === 2, '待处理队列应实时包含全部已计划条目');

    r = await req(port, 'GET', `/api/batch/prompt${qs}`);
    assert.equal(r.status, 200);
    assert.equal('batchId' in r.json, false, 'prompt 响应不得透出批次号');

    // 运行中新移入计划条目立即可见（current.pending）
    const fresh = mkItem(p, 'requirement', 'RT08-运行中新计划');
    r = await req(port, 'GET', `/api/batch/current${qs}`);
    assert.ok(r.json.pending.some((x) => x.id === fresh), '新移入计划条目应立即出现在待处理队列');

    r = await req(port, 'GET', `/api/board${qs}`);
    const row = (r.json.items || []).find((x) => x.id === a);
    assert.ok(row, 'board 应含条目');
    assert.equal('batchEntry' in row, false, '条目详情数据不得再附加已入批次');

    r = await req(port, 'GET', `/api/batch/global`);
    assert.equal(r.status, 200);
    // root 挂在项目行上（前端再把它附到任务行），按项目行定位本项目任务
    const task = (r.json.projects || []).filter((x) => x.root === p.root).flatMap((x) => x.tasks || [])[0];
    assert.ok(task, '全局视图应含本项目任务');
    assert.equal('batchId' in task, false, '全局任务简报不得透出批次号');
    assert.equal('queued' in task, false, '全局任务简报不得透出排队标记');
  } finally {
    try { server.kill('SIGKILL'); } catch {}
    cleanup(p);
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
  }
});

// ---------- RT-09 前端静态契约 ----------

t('RT-09 前端静态契约：面板/全局视图/条目详情/搜索/i18n 无批次号渲染与排队批次入口', () => {
  const js = fs.readFileSync(path.join(pluginRoot, 'scripts', 'web', 'app.js'), 'utf8');
  const html = fs.readFileSync(path.join(pluginRoot, 'scripts', 'web', 'index.html'), 'utf8');
  const i18n = fs.readFileSync(path.join(pluginRoot, 'scripts', 'web', 'i18n.js'), 'utf8');
  // 已移除的批次 UI 概念（渲染片段 / 绑定 / 函数）
  for (const w of ['已入批次', '排队新批次', '删除本批次', 'deleteBatchById', 'data-del-batch', 'queueNewBatch', '排队批次（', 'batchEntryIndex', 'batchEntry']) {
    assert.ok(!js.includes(w), `app.js 不得残留「${w}」`);
  }
  // 概况与全局视图不得渲染批次号
  assert.ok(!/class="cid">\$\{esc\(b\.batchId\)\}/.test(js), '运行概况不得渲染批次号 chip');
  assert.ok(!/class="cid">\$\{esc\(task\.batchId\)\}/.test(js), '全局任务行不得渲染批次号');
  // 状态词表不得再有「排队中」
  const statusFn = js.match(/function batchStatusLabel[\s\S]{0,400}/);
  assert.ok(statusFn, '应有状态映射');
  assert.ok(!statusFn[0].includes('排队中'), '状态映射不得再有排队中');
  // 全局汇总条不再统计排队中
  const summaryFn = js.match(/function globalSummaryText[\s\S]{0,400}/);
  assert.ok(summaryFn && !summaryFn[0].includes('排队'), '全局汇总条不得再统计排队中');
  // 全局搜索占位去批次号
  assert.match(html, /搜项目 \/ 条目编号…/, '全局搜索占位应去批次号');
  assert.ok(!html.includes('批次号'), 'index.html 不得残留批次号字样');
  // i18n 词表整体去批次
  assert.ok(!i18n.includes('批次'), 'i18n.js 不得残留批次相关词条');
});

// ---------- RT-10 暂停/终止/重试/记录不回归 ----------

t('RT-10 既有能力不回归：暂停/恢复、终止出局账、重新执行、本轮处理记录照常工作', () => {
  const p = mkProject();
  try {
    const a = mkItem(p, 'requirement', 'RT10-A', { deltaMs: 3000 });
    const b = mkItem(p, 'requirement', 'RT10-B', { deltaMs: 2000 });
    const c = mkItem(p, 'requirement', 'RT10-C', { deltaMs: 1000 });
    const { batch: bt } = batch.createBatch(p.dataDir, { projectRoot: p.root });
    // 暂停后续领取：当前项继续、不再领取下一项
    const run = batch.nextItem(p.dataDir, bt.batchId, { owner: W1 });
    assert.equal(run.itemId, a);
    core.claim(p.dataDir, a, W1);
    batch.pauseBatch(p.dataDir, bt.batchId, true);
    core.report(p.dataDir, a, { summary: 'ok', by: W1, run: { runId: run.runId } });
    batch.finishRun(p.dataDir, run.runId, { result: 'reported', reportRef: 'test-report.md' });
    const stopped = batch.nextItem(p.dataDir, bt.batchId, { owner: W1 });
    assert.equal(stopped.stop, 'paused', '暂停后不再领取下一项');
    batch.pauseBatch(p.dataDir, bt.batchId, false);
    // 记录保留可查（不以批次分组暴露：记录含条目/结果/次数）
    let recs = batch.listRuns(p.dataDir, bt.batchId, {});
    assert.equal(recs.total, 1);
    assert.equal(recs.records[0].itemId, a);
    assert.equal(recs.records[0].result, 'reported');
    // 重新执行：异常记录核验后回队列重领（条目须先经人工处理回到已计划，不自动改业务状态）
    const run2 = batch.nextItem(p.dataDir, bt.batchId, { owner: W1 });
    assert.equal(run2.itemId, b);
    core.claim(p.dataDir, b, W1);
    batch.finishRun(p.dataDir, run2.runId, { result: 'failed', reason: '测试失败', safeToContinue: true });
    const { dir: bDir } = core.resolveItemDir(p.dataDir, b);
    const st = JSON.parse(fs.readFileSync(path.join(bDir, 'status.json'), 'utf8'));
    st.status = 'planned';
    st.owner = '';
    fs.writeFileSync(path.join(bDir, 'status.json'), JSON.stringify(st, null, 2) + '\n');
    // 认领锁随人工处理一并清理（真实路径由看板/终端流转释放；状态机无 in-progress→planned 边，只能手工模拟）
    fs.rmSync(path.join(p.dataDir, '.locks', `${b}.lock`), { force: true });
    const retry = batch.retryRun(p.dataDir, run2.runId);
    assert.equal(retry.ok, true, `重新执行应成功：${JSON.stringify(retry)}`);
    const run3 = batch.nextItem(p.dataDir, bt.batchId, { owner: W1 });
    assert.equal(run3.itemId, b, '重新执行后同一条目重新领取');
    core.claim(p.dataDir, b, W1); // 领取不自动认领：上报前须先认领（RT-02 同口径）
    core.report(p.dataDir, b, { summary: 'ok', by: W1, run: { runId: run3.runId } });
    batch.finishRun(p.dataDir, run3.runId, { result: 'reported', reportRef: 'test-report.md' });
    // 运行中新移入计划条目立即可领取
    const d = mkItem(p, 'requirement', 'RT10-运行中新计划');
    const run4 = batch.nextItem(p.dataDir, bt.batchId, { owner: W1 });
    assert.equal(run4.itemId, c, '队列按最旧优先领取');
    core.claim(p.dataDir, c, W1);
    core.report(p.dataDir, c, { summary: 'ok', by: W1, run: { runId: run4.runId } });
    batch.finishRun(p.dataDir, run4.runId, { result: 'reported', reportRef: 'test-report.md' });
    const run5 = batch.nextItem(p.dataDir, bt.batchId, { owner: W1 });
    assert.equal(run5.itemId, d, '运行中新计划条目立即可领取');
    // 终止时留一项从未领取的剩余条目（验证剩余项出局记账）
    mkItem(p, 'requirement', 'RT10-剩余出局');
    // 终止：停止派发、剩余项出局、记录保留
    const ab = batch.abortBatch(p.dataDir, bt.batchId);
    assert.equal(ab.aborted, true);
    recs = batch.listRuns(p.dataDir, bt.batchId, {});
    assert.ok(recs.total >= 5, `终止后记录保留：${recs.total}`);
    assert.ok(recs.records.some((x) => x.result === 'skipped'), '剩余项应出局记账');
    const after = batch.nextItem(p.dataDir, bt.batchId, { owner: W1 });
    assert.equal(after.stop, 'aborted', '终止后不再派发');
  } finally { cleanup(p); }
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
