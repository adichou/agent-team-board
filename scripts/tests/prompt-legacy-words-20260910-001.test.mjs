#!/usr/bin/env node
// BUG-20260910-001 契约测试 —— 存量批次冻结提示词的执行端专属字样（zcode / Zcode / codex /
// general-purpose / 旧领取前缀 zcode-refine）在展示/回显层归一为通用口径，账本不回写；
// 批量开发两条透出接口与批量完善对齐；插件源 worker-spec / SKILL / dev 命令文档通用化。
// 覆盖（design.md 方案 1–3）：
//   归一函数：normalizePromptForDisplay 处理三变体存量完善 prompt（A 最老 general-purpose 头 /
//           B zcode 执行段 / C codex 执行段）与两类存量开发 prompt 旧行（旧模型行 / 点名
//           codex exec 的旧跟随行 / general-purpose 段）；现行输出幂等；非字符串透传
//   透出链路：完善侧 publicView/summary/CLI create（幂等回显）与开发侧 /api/batch/create、
//           /api/batch/prompt、/api/batch/current、CLI batch create / batch summary 均不透出
//   插件源：skills worker-spec / SKILL / commands dev 不含执行端绑定字样（存量冻结快照除外）
//   流程回归：旧前缀 owner（zcode-refine-*）领取/回执不受归一影响；账本文件不回写
// 用法：node scripts/tests/prompt-legacy-words-20260910-001.test.mjs

import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as core from '../lib/core.mjs';
import * as batch from '../lib/batch.mjs';
import * as refine from '../lib/refine-store.mjs';
import * as taskSettings from '../lib/task-settings.mjs';

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const ATB = path.join(pluginRoot, 'scripts', 'atb.mjs');

const AGENT_WORDS = /zcode|Zcode|codex|Codex|general-purpose/;
const FOLLOW = taskSettings.FOLLOW_SESSION_PROMPT_LINE;
const HEAD_LINE = '在当前项目的 Agent 会话中执行本提示词：每轮新启动一个子代理，按执行流程完善本批';
const NAME_LINE = '一个已接受条目的文档。子代理会话命名统一为：<条目编号>（与主调度会话区分）。';
// REQ-20260913-003：现行单行头（归一层把旧两行/旧单行头统一收敛到现行口径）
const REFINE_HEAD_NOW = '在当前项目的 Agent 会话中执行本提示词：每轮新启动一个子代理，按执行流程完善当前队列中最早的一个已接受条目的文档。';
const DEV_HEAD_NOW = '每轮新启动一个子代理，按执行规范领取当前队列中最早的一个可实施条目，认领、实施、测试并上报。';

const cases = [];
const t = (name, fn) => cases.push([name, fn]);

// ---------- 脚手架 ----------

function mkProject(prefix = 'atb-b29-') {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  const dataDir = core.initData(root);
  return { root, dataDir };
}

function mkAccepted(dataDir, title) {
  const st = core.createItem(dataDir, { type: 'requirement', title, description: 'x', by: 'tester' });
  core.setStatus(dataDir, st.id, 'accepted', { by: 'tester' });
  return st.id;
}

function mkPlanned(dataDir, title) {
  const id = mkAccepted(dataDir, title);
  core.setStatus(dataDir, id, 'planned', { by: 'tester' });
  return id;
}

function atbJson(args, cwd) {
  const r = spawnSync(process.execPath, [ATB, ...args, '--dir', cwd, '--json'], { encoding: 'utf8', timeout: 30_000 });
  assert.equal(r.status, 0, `atb ${args.join(' ')} 应成功（${r.stderr || r.stdout}）`);
  return JSON.parse(r.stdout.split('\n').filter(Boolean).pop());
}

// ---------- 存量冻结 prompt 夹具（形态对齐真实账本逐字拷贝，仅路径/批次号参数化） ----------

// 变体 B：RFB-20260909-022（zcode 执行段 + 旧模型行 + zcode-refine 领取前缀）
function legacyRefineZcode(root, batchId, atb) {
  return [
    '你是当前项目的批量完善调度员，只负责派发与接收短回执。',
    `项目：${root}`,
    `完善批次：${batchId}`,
    '子代理模型配置：（默认） · 智能档位 high（来自设置「批量任务」，启动子代理时按此传递）。',
    '',
    '每轮新启动一个子 Agent，按执行流程完善本批一个已接受条目的文档。',
    '执行 Agent：zcode。在 Zcode 本项目新建会话粘贴本提示词，每轮新启动一个 general-purpose 子 Agent 派发一项，',
    `子代理会话命名统一为：${batchId}-refine-<序号>，与主调度会话区分。`,
    '每个子 Agent 只做一项；同一时间只运行一个；不要让子代理再派发子代理。',
    '',
    `CLI 约定：atb 指 node ${atb}（下同）。`,
    '',
    '子 Agent 流程（每项一个）：',
    `1. 领取：atb refine next --by zcode-refine-<批次尾号>-<序号> --dir ${JSON.stringify(root)}`,
    '   （返回条目、目录、缺失原因；stop 时按提示结束）',
    `4. 主会话核对：atb refine check --batch ${batchId} --dir ${JSON.stringify(root)}`,
  ].join('\n');
}

// 变体 A：RFB-20260908-001（最老：general-purpose 头行 + 待接受口径 + zcode-refine 领取前缀）
function legacyRefineOldest(root, atb) {
  return [
    '你是当前项目的需求完善调度员，只负责派发与接收短回执。',
    `项目：${root}`,
    '完善批次：RFB-20260908-001',
    '',
    '每轮新启动一个 general-purpose 子 Agent，按执行流程完善本批一个待接受条目的文档。',
    '每个子 Agent 只做一项；同一时间只运行一个；不要让子 Agent 再派发子代理。',
    '',
    `CLI 约定：atb 指 node ${atb}（下同）。`,
    '',
    '子 Agent 流程（每项一个）：',
    `1. 领取：atb refine next --by zcode-refine-<批次尾号>-<序号> --dir ${JSON.stringify(root)}`,
  ].join('\n');
}

// 变体 C：RFB-20260909-017（codex 执行段 + codex 口径行 + zcode-refine 领取前缀）
function legacyRefineCodex(root, batchId) {
  return [
    '你是当前项目的批量完善调度员，只负责派发与接收短回执。',
    `项目：${root}`,
    `完善批次：${batchId}`,
    '',
    '每轮新启动一个子 Agent，按执行流程完善本批一个已接受条目的文档。',
    '执行 Agent：codex。在 codex 会话中执行本提示词；每轮以子任务/子会话派发一项，',
    `子会话命名统一为：<条目编号>（如 REQ-20260908-021），与主会话命名 ${batchId} 区分。`,
    '每个子 Agent 只做一项；同一时间只运行一个；不要让子 Agent 再派发子代理。',
    '',
    `1. 领取：atb refine next --by zcode-refine-<批次尾号>-<序号> --dir ${JSON.stringify(root)}`,
    '   （返回条目、目录、缺失原因；stop 时按提示结束）',
    `   codex 口径：领取/回执命令在子会话内执行（工作目录用 --dir ${JSON.stringify(root)} 指定）；`,
  ].join('\n');
}

// 开发侧旧跟随行：batch-20260909-021（点名 codex exec 参数的 REQ-20260909-005 措辞）+ general-purpose 段
function legacyDevFollowOld(root, batchId, specPath, atb) {
  return [
    '你是当前项目的批次调度员，只负责派发与接收短回执。',
    `项目：${root}`,
    `批次：${batchId}`,
    '子代理模型与智能/推理档位：跟随主调度会话——启动每个子代理时，其模型与智能/推理档位必须与当前主调度会话保持一致：支持显式指定的执行端（如 codex exec 的 --model / model_reasoning_effort）显式传入与会话一致的值，不支持的执行端不另行指定、依赖子代理默认继承主会话配置；不得改用设置「批量任务」的静态值，也不得落到与主会话不同的默认档。',
    `执行规范：${specPath}`,
    `批次摘要入口：node ${atb} batch check --batch ${batchId} --dir ${root}`,
    '',
    '每轮新启动一个 general-purpose 子 Agent，按执行规范自行选择本批',
    '一个可实施条目，认领、实施、测试并上报。每个子 Agent 只做一项。',
    '同一时间只运行一个；不要让子 Agent 再派发子 Agent。',
  ].join('\n');
}

// 开发侧旧模型行：batch-20260908-018 形态
function legacyDevModelLine(root, batchId, specPath, atb) {
  return [
    '你是当前项目的批次调度员，只负责派发与接收短回执。',
    `项目：${root}`,
    `批次：${batchId}`,
    '子代理模型配置：（默认） · 智能档位 medium（来自设置「批量任务」，启动子代理时按此传递）。',
    `执行规范：${specPath}`,
    `批次摘要入口：node ${atb} batch check --batch ${batchId} --dir ${root}`,
    '',
    '每轮新启动一个 general-purpose 子 Agent，按执行规范自行选择本批',
    '一个可实施条目，认领、实施、测试并上报。每个子 Agent 只做一项。',
    '同一时间只运行一个；不要让子 Agent 再派发子 Agent。',
  ].join('\n');
}

function assertGeneric(out, label) {
  assert.doesNotMatch(out, AGENT_WORDS, `${label}：归一后全文不含执行端专属字样（实际透出：${(String(out).match(AGENT_WORDS) || [''])[0]}）`);
  assert.ok(out.includes(REFINE_HEAD_NOW) || out.includes(DEV_HEAD_NOW),
    `${label}：保留现行通用调度口径（REQ-20260913-003 单行头）`);
}

// ---------- A 归一函数 ----------

t('A1 变体 B（zcode 执行段 + 旧模型行 + zcode-refine 前缀）：执行端段/前缀/旧行全部归一，通用段与现行 buildRefinePrompt 逐字一致', () => {
  const out = taskSettings.normalizePromptForDisplay(legacyRefineZcode('/tmp/p', 'RFB-20260909-022', '/tmp/atb.mjs'));
  assertGeneric(out, 'A1');
  assert.ok(out.includes(FOLLOW), '旧模型行替换为跟随指令行');
  assert.ok(out.includes(REFINE_HEAD_NOW), '执行端段归一为现行通用单行头（与 buildRefinePrompt 一致）');
  assert.ok(out.includes('--by refine-<序号>'), '领取前缀归一为通用前缀（去批次尾号，REQ-20260913-003）');
  assert.ok(!out.includes('完善批次：'), '存量批次行删除（展示层）');
  assert.ok(!out.includes('-refine-<序号>，与主调度会话区分'), '旧命名行（<批次号>-refine-<序号>）不再出现');
  assert.ok(out.includes('每个子 Agent 只做一项；同一时间只运行一个；不要让子代理再派发子代理。'), '其余正文行逐字保留');
});

t('A2 变体 B 行序（009 形态：「每个子 Agent」行在执行 Agent 行之前）：同样归一，命名行独立成句', () => {
  const legacy = [
    '每轮新启动一个子 Agent，按执行流程完善本批一个已接受条目的文档。',
    '每个子 Agent 只做一项；同一时间只运行一个；不要让子 Agent 再派发子代理。',
    '执行 Agent：zcode。在 Zcode 本项目新建会话粘贴本提示词，每轮新启动一个 general-purpose 子 Agent 派发一项，',
    `子代理会话命名统一为：RFB-20260908-009-refine-<序号>，与主调度会话区分。`,
  ].join('\n');
  const out = taskSettings.normalizePromptForDisplay(legacy);
  assertGeneric(out, 'A2');
  assert.ok(out.includes(REFINE_HEAD_NOW), '头行归一为现行单行完整句（当前队列最早，REQ-20260913-003）');
  assert.ok(out.includes('子代理会话命名统一为：<条目编号>（与主调度会话区分）。'), '旧命名行归一为通用命名句');
});

t('A3 变体 A（最老：general-purpose 头行 + 待接受口径）：头行归一为单行完整句，前缀归一', () => {
  const out = taskSettings.normalizePromptForDisplay(legacyRefineOldest('/tmp/p', '/tmp/atb.mjs'));
  assertGeneric(out, 'A3');
  assert.ok(out.includes(REFINE_HEAD_NOW), 'general-purpose 头行归一（待接受 → 已接受 → 当前队列最早）');
  assert.ok(out.includes('--by refine-<序号>'), '领取前缀归一（去批次尾号）');
  assert.ok(out.includes('你是当前项目的需求完善调度员'), '其余行逐字保留');
});

t('A4 变体 C（codex 执行段 + codex 口径行）：执行端行删除、codex 口径行与命名行归一，前缀归一', () => {
  const out = taskSettings.normalizePromptForDisplay(legacyRefineCodex('/tmp/p', 'RFB-20260909-017'));
  assertGeneric(out, 'A4');
  assert.ok(out.includes(REFINE_HEAD_NOW), '执行端段归一为现行通用单行头');
  assert.ok(out.includes('领取/回执命令在子代理会话内执行（工作目录用 --dir 指定）。'), 'codex 口径行归一为通用说明');
  assert.ok(out.includes('--by refine-<序号>'), '领取前缀归一（去批次尾号）');
});

t('A5 开发侧存量：点名 codex exec 的旧跟随行整行替换为现行 FOLLOW_SESSION_PROMPT_LINE；旧模型行同；general-purpose 段归一为现行两行', () => {
  const followOld = taskSettings.normalizePromptForDisplay(legacyDevFollowOld('/tmp/p', 'batch-20260909-021', '/tmp/spec.md', '/tmp/atb.mjs'));
  assertGeneric(followOld, 'A5-follow');
  assert.ok(followOld.includes(FOLLOW), '旧跟随行替换为现行跟随指令行');
  assert.ok(!followOld.includes('codex exec'), '不再点名 codex exec 参数');
  assert.ok(followOld.includes(DEV_HEAD_NOW), 'general-purpose 段归一为现行开发头行（当前队列最早，REQ-20260913-003）');
  assert.ok(followOld.includes('每个子代理只做一项；子代理会话命名统一为：<条目编号>（与主调度会话区分）。'), '命名行归一保留');
  const modelOld = taskSettings.normalizePromptForDisplay(legacyDevModelLine('/tmp/p', 'batch-20260908-018', '/tmp/spec.md', '/tmp/atb.mjs'));
  assertGeneric(modelOld, 'A5-model');
  assert.ok(modelOld.includes(FOLLOW), '旧模型行替换为跟随指令行');
});

t('A6 幂等与透传：现行 buildRefinePrompt / generatePrompt 输出原样返回；BUG-20260909-017 夹具（通用段+旧模型行）输出与 normalizePromptModelLine 一致；非字符串透传', () => {
  const cur = refine.buildRefinePrompt({ projectRoot: '/tmp/p', batchId: 'RFB-1', developer: '张三', modelSource: 'follow' });
  assert.equal(taskSettings.normalizePromptForDisplay(cur), cur, '现行完善提示词原样返回（幂等）');
  const dev = batch.generatePrompt({ projectRoot: '/tmp/p', batchId: 'batch-1', workerSpecPath: '/tmp/spec.md', modelSource: 'follow' });
  assert.equal(taskSettings.normalizePromptForDisplay(dev), dev, '现行开发提示词原样返回（幂等）');
  const b17 = [
    '你是当前项目的批量完善调度员，只负责派发与接收短回执。',
    '子代理模型配置：（默认） · 智能档位 high（来自设置「批量任务」，启动子代理时按此传递）。',
    '',
    HEAD_LINE,
    NAME_LINE,
  ].join('\n');
  // REQ-20260913-003：两行头进一步归一为现行单行头，模型行替换口径不变（FOLLOW 行仍出现）
  const n17 = taskSettings.normalizePromptForDisplay(b17);
  assert.ok(n17.includes(FOLLOW), '旧模型行替换为跟随指令行');
  assert.ok(n17.includes(REFINE_HEAD_NOW), '两行头归一为现行单行头');
  void taskSettings.normalizePromptModelLine;
  assert.equal(taskSettings.normalizePromptForDisplay(null), null, 'null 透传');
  assert.equal(taskSettings.normalizePromptForDisplay(undefined), undefined, 'undefined 透传');
  assert.equal(taskSettings.normalizePromptForDisplay(''), '', '空串透传');
});

// ---------- B 完善侧透出链路 ----------

function freezeRefinePrompt(dataDir, batchId, prompt) {
  const file = path.join(dataDir, 'refine', 'batches', batchId, 'batch.json');
  const b = JSON.parse(fs.readFileSync(file, 'utf8'));
  b.prompt = prompt;
  fs.writeFileSync(file, JSON.stringify(b, null, 2));
}

t('B1 完善数据层：refineBatchPublicView / refineSummary 归一 zcode 旧段；账本文件不回写', () => {
  const p = mkProject('atb-b29-b1-');
  try {
    mkAccepted(p.dataDir, '存量 zcode 口径');
    const { batch: b } = refine.createRefineBatch(p.dataDir, { projectRoot: p.root, modelSource: 'follow' });
    freezeRefinePrompt(p.dataDir, b.batchId, legacyRefineZcode(p.root, b.batchId, ATB));
    const view = refine.refineBatchPublicView(refine.getRefineBatch(p.dataDir, b.batchId));
    assertGeneric(view.prompt, 'B1-publicView');
    const s = refine.refineSummary(p.dataDir, b.batchId);
    assertGeneric(s.batch.prompt, 'B1-summary');
    const raw = JSON.parse(fs.readFileSync(path.join(p.dataDir, 'refine', 'batches', b.batchId, 'batch.json'), 'utf8'));
    assert.match(raw.prompt, /执行 Agent：zcode/, '账本文件不回写（历史原样保留）');
  } finally { fs.rmSync(p.root, { recursive: true, force: true }); }
});

t('B2 完善 CLI：refine create 重复启动被拒（REQ-20260913-003）；refine summary 不透出执行端字样', () => {
  const p = mkProject('atb-b29-b2-');
  try {
    mkAccepted(p.dataDir, '回显');
    const first = atbJson(['refine', 'create'], p.root);
    freezeRefinePrompt(p.dataDir, first.batchId, legacyRefineZcode(p.root, first.batchId, ATB));
    const again = spawnSync(process.execPath, [ATB, 'refine', 'create', '--dir', p.root], { encoding: 'utf8', timeout: 30_000 });
    assert.notEqual(again.status, 0, '未结束轮内重复创建应被拒');
    assert.doesNotMatch(again.stdout + again.stderr, AGENT_WORDS, '拒绝输出不含执行端字样');
    const sum = atbJson(['refine', 'summary'], p.root);
    assertGeneric(sum.batch.prompt, 'B2-summary');
  } finally { fs.rmSync(p.root, { recursive: true, force: true }); }
});

// ---------- C 开发侧透出链路 ----------

function freezeDevPrompt(dataDir, batchId, prompt) {
  const file = path.join(dataDir, 'dispatch', 'batches', batchId, 'batch.json');
  const b = JSON.parse(fs.readFileSync(file, 'utf8'));
  b.prompt = prompt;
  fs.writeFileSync(file, JSON.stringify(b, null, 2));
}

t('C1 开发数据层与 CLI：batch create 幂等回显、batch summary（batchPublicView）归一旧跟随行；账本不回写', () => {
  const p = mkProject('atb-b29-c1-');
  try {
    mkPlanned(p.dataDir, '开发存量口径');
    const first = atbJson(['batch', 'create'], p.root);
    assert.equal(first.created, true, '首批创建成功');
    const specPath = path.join(p.dataDir, 'worker-spec.md');
    freezeDevPrompt(p.dataDir, first.batchId, legacyDevFollowOld(p.root, first.batchId, specPath, ATB));
    const again = spawnSync(process.execPath, [ATB, 'batch', 'create', '--dir', p.root], { encoding: 'utf8', timeout: 30_000 });
    assert.notEqual(again.status, 0, '未结束轮内重复创建应被拒（REQ-20260913-003）');
    assert.doesNotMatch(again.stdout + again.stderr, AGENT_WORDS, '拒绝输出不含执行端字样');
    const sum = atbJson(['batch', 'summary'], p.root);
    assertGeneric(sum.batch.prompt, 'C1-summary(batchPublicView)');
    const raw = JSON.parse(fs.readFileSync(path.join(p.dataDir, 'dispatch', 'batches', first.batchId, 'batch.json'), 'utf8'));
    assert.ok(raw.prompt.includes('codex exec'), '开发账本文件不回写（历史原样保留）');
  } finally { fs.rmSync(p.root, { recursive: true, force: true }); }
});

t('C2 开发服务端：/api/batch/create 幂等返回、/api/batch/prompt、/api/batch/current（面板提示词页签数据源）均归一', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'atb-b29-srv-'));
  const root = path.join(tmp, 'proj');
  fs.mkdirSync(root, { recursive: true });
  core.initData(root);
  const dataDir = core.dataDirFrom(root);
  const port = 35000 + Math.floor(Math.random() * 20000);
  const server = spawn(process.execPath, [path.join(pluginRoot, 'scripts', 'server.mjs')], {
    cwd: root,
    env: { ...process.env, ATB_PORT: String(port), ATB_REGISTRY: path.join(tmp, 'reg.json') },
    stdio: ['ignore', 'ignore', 'ignore'],
  });
  const req = (method, pth, body) => new Promise((resolve, reject) => {
    const u = new URL(`http://127.0.0.1:${port}${pth}`);
    const payload = body == null ? null : JSON.stringify(body);
    const r = http.request(u, { method, headers: payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {} }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => { try { resolve({ status: res.statusCode, json: JSON.parse(data || '{}') }); } catch (e) { reject(e); } });
    });
    r.on('error', reject);
    if (payload) r.write(payload);
    r.end();
  });
  try {
    for (let i = 0; i < 60; i++) {
      await new Promise((r) => setTimeout(r, 150));
      try { await req('GET', '/api/health'); break; } catch {}
    }
    mkPlanned(dataDir, '服务端开发口径');
    const first = await req('POST', '/api/batch/create', {});
    assert.equal(first.status, 200);
    const firstId = batch.queueHeadBatch(dataDir).batchId;
    const specPath = path.join(dataDir, 'worker-spec.md');
    freezeDevPrompt(dataDir, firstId, legacyDevModelLine(root, firstId, specPath, ATB));
    const again = await req('POST', '/api/batch/create', {});
    assert.equal(again.status, 400, '重复启动 400（REQ-20260913-003）');
    assert.match(String(again.json && again.json.error || ''), /已有进行中的任务/);
    const pr = await req('GET', '/api/batch/prompt');
    assert.equal(pr.status, 200);
    assertGeneric(pr.json.prompt, 'C2-prompt');
    const cur = await req('GET', '/api/batch/current');
    assert.equal(cur.status, 200);
    assertGeneric(cur.json.batch.prompt, 'C2-current(#batchPrompt 数据源)');
  } finally {
    server.kill();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// ---------- D 插件源契约（类似地方排查结论落地） ----------

t('D1 worker-spec 插件源：标题/适用/领取示例通用化（无 zcode 绑定）；项目内按批冻结的存量快照不检测（历史事实源）', () => {
  const src = fs.readFileSync(path.join(pluginRoot, 'skills', 'agent-team-board', 'worker-spec.md'), 'utf8');
  assert.doesNotMatch(src, /zcode|Zcode/, 'worker-spec 插件源不含执行端字样（后续批次快照随之通用）');
  assert.ok(src.includes('--by batch-<批次尾号>-<序号>'), '领取示例使用通用前缀 batch-');
});

t('D2 SKILL.md 批量开发段与 commands/dev.md 认领示例：移除「选执行 Agent / 按 Agent 差异化」旧口径，示例不绑执行端', () => {
  const skill = fs.readFileSync(path.join(pluginRoot, 'skills', 'agent-team-board', 'SKILL.md'), 'utf8');
  assert.ok(!skill.includes('启动时选执行 Agent'), 'SKILL.md 移除 REQ-20260909-011 已删的选 Agent 旧口径');
  assert.ok(!skill.includes('按 Agent 差异化的主调度提示词'), 'SKILL.md 移除按 Agent 差异化描述');
  const dev = fs.readFileSync(path.join(pluginRoot, 'commands', 'dev.md'), 'utf8');
  assert.ok(!/--by zcode-/.test(dev), 'dev.md 认领示例不绑执行端');
});

// ---------- E 流程回归（在途执行不受归一影响） ----------

t('E1 旧前缀 owner 回执互认：zcode-refine-* 前缀领取 → 补文档 → done → check 正常，账本 prompt 保持归一前原样', () => {
  const p = mkProject('atb-b29-e1-');
  try {
    mkAccepted(p.dataDir, '旧前缀流程');
    const first = atbJson(['refine', 'create'], p.root);
    freezeRefinePrompt(p.dataDir, first.batchId, legacyRefineZcode(p.root, first.batchId, ATB));
    const got = atbJson(['refine', 'next', '--by', 'zcode-refine-022-4'], p.root);
    assert.ok(got.runId && got.itemId, '旧前缀 owner 可正常领取');
    assert.equal(got.owner, 'zcode-refine-022-4', 'owner 为传入的旧前缀会话标识');
    const readme = path.join(got.itemDir, 'README.md');
    fs.appendFileSync(readme, '\n## 描述\n\n补全内容。\n\n## 验收标准\n\n- 验收点。\n');
    const done = atbJson(['refine', 'done', got.runId, '--summary', '补全描述与验收标准'], p.root);
    assert.equal(done.result, 'done', '旧前缀 run 回执正常');
    const check = atbJson(['refine', 'check'], p.root);
    assert.ok(check.nextAction, '核对入口正常返回');
    const raw = JSON.parse(fs.readFileSync(path.join(p.dataDir, 'refine', 'batches', first.batchId, 'batch.json'), 'utf8'));
    assert.match(raw.prompt, /执行 Agent：zcode/, '流程不回写账本 prompt');
  } finally { fs.rmSync(p.root, { recursive: true, force: true }); }
});

// ---------- 执行 ----------

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
