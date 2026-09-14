#!/usr/bin/env node
// BUG-20260909-017 契约测试 —— 批量完善提示词不再含「子代理模型配置…（来自设置「批量任务」…）」旧行，
// 与批量开发统一为「跟随主调度会话」口径。
// 覆盖（design.md 方案 1–5）：
//   生成层：buildRefinePrompt / generatePrompt 移除 manual 固定行分支——任何模型入参一律
//           注入 FOLLOW_SESSION_PROMPT_LINE，均未传不注入（直连行为不变）
//   归一函数：normalizePromptModelLine 整行替换旧行，其余文本逐字不动
//   展示/回显：refineBatchPublicView / atb refine create（JSON 与文本回显）/ refine summary /
//           /api/refine/create 幂等返回 / /api/refine/current 面板数据均不透出旧行；
//           存量账本文件不回写（历史原样保留——design.md 处置口径）
//   新建口径：RFB 存量收尾后新建完善批次 prompt 含跟随行且不含旧行（验收 3）
//   流程回归：旧 prompt 账本上 refine next / done / check 行为不受影响（验收 4）
// 用法：node scripts/tests/bug-model-line-20260909-017.test.mjs

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
const appSource = fs.readFileSync(path.join(pluginRoot, 'scripts', 'web', 'app.js'), 'utf8');

const FOLLOW_LINE = '跟随主调度会话';
const OLD_SNIPPET = '子代理模型配置';
const OLD_SETTINGS = '设置「批量任务」';

const cases = [];
const t = (name, fn) => cases.push([name, fn]);

// ---------- 脚手架 ----------

function mkProject(prefix = 'atb-b17-') {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  const dataDir = core.initData(root);
  return { root, dataDir };
}

function mkAccepted(dataDir, title) {
  const st = core.createItem(dataDir, { type: 'requirement', title, description: 'x', by: 'tester' });
  core.setStatus(dataDir, st.id, 'accepted', { by: 'tester' });
  return st.id;
}

function atbJson(args, cwd) {
  const r = spawnSync(process.execPath, [ATB, ...args, '--dir', cwd, '--json'], { encoding: 'utf8', timeout: 30_000 });
  assert.equal(r.status, 0, `atb ${args.join(' ')} 应成功（${r.stderr || r.stdout}）`);
  return JSON.parse(r.stdout.split('\n').filter(Boolean).pop());
}

// 模拟 REQ-20260908-020 时代冻结进账本的旧提示词（形态对齐 RFB-20260909-022 首屏行）
function legacyPrompt(root, batchId) {
  return [
    '你是当前项目的批量完善调度员，只负责派发与接收短回执。',
    `项目：${root}`,
    `完善批次：${batchId}`,
    '子代理模型配置：（默认） · 智能档位 high（来自设置「批量任务」，启动子代理时按此传递）。',
    '',
    '在当前项目的 Agent 会话中执行本提示词：每轮新启动一个子代理，按执行流程完善本批',
    '一个已接受条目的文档。子代理会话命名统一为：<条目编号>（与主调度会话区分）。',
  ].join('\n');
}

// 就地把账本 prompt 改写为旧口径（模拟存量批次；不改变其余字段）
function freezeLegacyPrompt(dataDir, batchId, root) {
  const file = path.join(dataDir, 'refine', 'batches', batchId, 'batch.json');
  const b = JSON.parse(fs.readFileSync(file, 'utf8'));
  b.prompt = legacyPrompt(root, batchId);
  fs.writeFileSync(file, JSON.stringify(b, null, 2));
  return b;
}

// ---------- A 生成层统一（design 方案 4） ----------

t('A1 生成层（完善）：manual / 直传 model / level 一律注入跟随行，不再生成「子代理模型配置」旧行；无模型入参不注入', () => {
  const manual = refine.buildRefinePrompt({ projectRoot: '/tmp/p', batchId: 'RFB-1', modelSource: 'manual', model: 'glm-5.3', level: 'low' });
  assert.ok(manual.includes(FOLLOW_LINE), 'manual 入参也注入跟随指令');
  assert.ok(!manual.includes(OLD_SNIPPET), '不再出现「子代理模型配置」表述');
  assert.ok(!manual.includes(OLD_SETTINGS), '不再指向设置「批量任务」');
  assert.ok(!manual.includes('glm-5.3'), '不注入静态模型名');
  const legacy = refine.buildRefinePrompt({ projectRoot: '/tmp/p', batchId: 'RFB-1', model: 'glm-5.3', level: 'low' });
  assert.ok(legacy.includes(FOLLOW_LINE), '未传 source 的 model/level 直连兼容调用同样落跟随行');
  assert.ok(!legacy.includes(OLD_SNIPPET), '直传 model/level 不再生成固定行');
  const follow = refine.buildRefinePrompt({ projectRoot: '/tmp/p', batchId: 'RFB-1', modelSource: 'follow' });
  assert.ok(follow.includes(FOLLOW_LINE), 'follow 注入跟随指令');
  const bare = refine.buildRefinePrompt({ projectRoot: '/tmp/p', batchId: 'RFB-1' });
  assert.ok(!bare.includes(FOLLOW_LINE) && !bare.includes(OLD_SNIPPET), '无模型信息不注入任何行（直连行为不变）');
});

t('A2 生成层（开发）：generatePrompt 同口径——manual / 直传一律跟随行；follow 输出仍含跟随指令；无模型入参不注入', () => {
  const base = { projectRoot: '/tmp/p', batchId: 'batch-1', workerSpecPath: '/tmp/spec.md' };
  const manual = batch.generatePrompt({ ...base, modelSource: 'manual', model: 'glm-5.3', level: 'medium' });
  assert.ok(manual.includes(FOLLOW_LINE), 'manual 入参注入跟随指令');
  assert.ok(!manual.includes(OLD_SNIPPET) && !manual.includes(OLD_SETTINGS), '不再出现固定行与设置指向');
  const legacy = batch.generatePrompt({ ...base, model: 'glm-5.3' });
  assert.ok(legacy.includes(FOLLOW_LINE) && !legacy.includes(OLD_SNIPPET), '直传 model 兼容调用落跟随行');
  const follow = batch.generatePrompt({ ...base, modelSource: 'follow' });
  assert.ok(follow.includes(FOLLOW_LINE), 'follow 输出不变仍含跟随指令');
  assert.ok(!follow.includes('glm-5.3'), 'follow 档不注入模型名');
  const bare = batch.generatePrompt(base);
  assert.ok(!bare.includes(FOLLOW_LINE) && !bare.includes(OLD_SNIPPET), '无模型信息不注入任何行');
});

// ---------- B 归一函数（design 方案 1） ----------

t('B1 normalizePromptModelLine：旧行整行替换为 FOLLOW_SESSION_PROMPT_LINE，其余行逐字不动；无旧行原样返回；非字符串透传', () => {
  const legacy = legacyPrompt('/tmp/p', 'RFB-1');
  const out = taskSettings.normalizePromptModelLine(legacy);
  assert.ok(out.includes(taskSettings.FOLLOW_SESSION_PROMPT_LINE), '旧行替换为跟随指令行');
  assert.ok(!out.includes(OLD_SNIPPET) && !out.includes(OLD_SETTINGS), '不再含旧表述');
  assert.ok(out.includes('你是当前项目的批量完善调度员'), '首行保留');
  assert.ok(out.includes('子代理会话命名统一为：<条目编号>'), '后续正文保留');
  const follow = refine.buildRefinePrompt({ projectRoot: '/tmp/p', batchId: 'RFB-1', modelSource: 'follow' });
  assert.equal(taskSettings.normalizePromptModelLine(follow), follow, '新口径提示词原样返回（幂等）');
  assert.equal(taskSettings.normalizePromptModelLine(null), null, '非字符串原样透传');
  assert.equal(taskSettings.normalizePromptModelLine(undefined), undefined, 'undefined 透传');
});

// ---------- C 展示/回显链路（design 方案 2 / 3；账本不回写） ----------

t('C1 数据层公开视图：refineBatchPublicView / refineSummary 归一旧口径账本 prompt；账本文件不回写（历史原样）', () => {
  const p = mkProject('atb-b17-c1-');
  try {
    const id = mkAccepted(p.dataDir, '存量口径');
    const { batch: b } = refine.createRefineBatch(p.dataDir, { projectRoot: p.root, modelSource: 'follow' });
    freezeLegacyPrompt(p.dataDir, b.batchId, p.root);
    const view = refine.refineBatchPublicView(refine.getRefineBatch(p.dataDir, b.batchId));
    assert.ok(view.prompt.includes(FOLLOW_LINE), '公开视图 prompt 归一为跟随口径');
    assert.ok(!view.prompt.includes(OLD_SNIPPET) && !view.prompt.includes(OLD_SETTINGS), '公开视图不透出旧行');
    const s = refine.refineSummary(p.dataDir, b.batchId);
    assert.ok(s.batch.prompt.includes(FOLLOW_LINE) && !s.batch.prompt.includes(OLD_SNIPPET), 'refineSummary 同口径');
    // 处置口径：不回写账本——盘上文件仍保留旧 prompt（历史记录原样）
    const raw = JSON.parse(fs.readFileSync(path.join(p.dataDir, 'refine', 'batches', b.batchId, 'batch.json'), 'utf8'));
    assert.ok(raw.prompt.includes(OLD_SNIPPET), '账本文件不回写（design.md 处置口径：历史原样保留）');
    assert.equal(raw.candidates[0].id, id, '账本其余字段不受影响');
  } finally { fs.rmSync(p.root, { recursive: true, force: true }); }
});

t('C2 CLI 回显：refine create 幂等返回（JSON 与文本回显）与 refine summary 均不透出旧行', () => {
  const p = mkProject('atb-b17-c2-');
  try {
    mkAccepted(p.dataDir, '幂等回显');
    const first = atbJson(['refine', 'create'], p.root);
    freezeLegacyPrompt(p.dataDir, first.batchId, p.root);
    const again = atbJson(['refine', 'create'], p.root);
    assert.equal(again.created, false, '在途批次幂等返回');
    assert.ok(again.prompt.includes(FOLLOW_LINE), '幂等回显 prompt 归一为跟随口径');
    assert.ok(!again.prompt.includes(OLD_SNIPPET) && !again.prompt.includes(OLD_SETTINGS), '幂等回显不含旧行');
    const text = spawnSync(process.execPath, [ATB, 'refine', 'create', '--dir', p.root], { encoding: 'utf8', timeout: 30_000 });
    assert.equal(text.status, 0, '文本模式回显应成功');
    assert.ok(!text.stdout.includes(OLD_SNIPPET) && !text.stdout.includes(OLD_SETTINGS), '文本回显不含旧行');
    assert.ok(text.stdout.includes(FOLLOW_LINE), '文本回显含跟随指令行');
    const sum = atbJson(['refine', 'summary'], p.root);
    assert.ok(sum.batch.prompt.includes(FOLLOW_LINE) && !sum.batch.prompt.includes(OLD_SNIPPET), 'refine summary 公开视图同口径');
  } finally { fs.rmSync(p.root, { recursive: true, force: true }); }
});

t('C3 服务端：/api/refine/create 幂等返回与 /api/refine/current 面板数据均归一，不透出旧行', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'atb-b17-srv-'));
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
    mkAccepted(dataDir, '服务端口径');
    const first = await req('POST', '/api/refine/create', {});
    assert.equal(first.status, 200);
    freezeLegacyPrompt(dataDir, first.json.batchId, root);
    const again = await req('POST', '/api/refine/create', {});
    assert.equal(again.status, 200);
    assert.equal(again.json.created, false, '幂等返回在途批次');
    assert.ok(again.json.prompt.includes(FOLLOW_LINE), '幂等返回 prompt 归一');
    assert.ok(!again.json.prompt.includes(OLD_SNIPPET) && !again.json.prompt.includes(OLD_SETTINGS), '幂等返回不含旧行');
    const cur = await req('GET', '/api/refine/current');
    assert.equal(cur.status, 200);
    assert.ok(cur.json.batch.prompt.includes(FOLLOW_LINE), '面板数据（/api/refine/current → #refinePrompt 与重新复制源）归一');
    assert.ok(!cur.json.batch.prompt.includes(OLD_SNIPPET) && !cur.json.batch.prompt.includes(OLD_SETTINGS), '面板数据不含旧行');
  } finally {
    server.kill();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

t('C4 前端源码契约：app.js 不含旧模型配置行文案（面板渲染/复制均直用已归一的服务端数据）', () => {
  assert.ok(!appSource.includes(OLD_SNIPPET), '前端不得出现「子代理模型配置」文案');
  assert.ok(!appSource.includes(OLD_SETTINGS), '前端不得指向设置「批量任务」');
});

// ---------- D 新建口径与流程回归（验收 3 / 4） ----------

t('D1 新建与流程：存量收尾后新建批次 prompt 正确落账（验收 3）；旧 prompt 账本上 next/done/check 不受影响（验收 4）', () => {
  const p = mkProject('atb-b17-d1-');
  try {
    mkAccepted(p.dataDir, '旧账本流程');
    const first = atbJson(['refine', 'create'], p.root);
    freezeLegacyPrompt(p.dataDir, first.batchId, p.root);
    // 流程回归：旧 prompt 账本上领取 → 补文档 → 回执 → 核对
    const got = atbJson(['refine', 'next', '--by', 'w1'], p.root);
    assert.ok(got.runId && got.itemId, '旧 prompt 账本可正常领取');
    const readme = path.join(got.itemDir, 'README.md');
    fs.appendFileSync(readme, '\n## 描述\n\n补全内容。\n\n## 验收标准\n\n- 验收点。\n');
    const done = atbJson(['refine', 'done', got.runId, '--summary', '补全描述与验收标准'], p.root);
    assert.equal(done.result, 'done', '旧 prompt 账本回执正常');
    const check = atbJson(['refine', 'check'], p.root);
    assert.ok(check.nextAction, '核对入口正常返回');
    // 新建口径（验收 3）：存量批次已收尾 → 新候选建批，账本 prompt 含跟随行且不含旧行
    const id2 = mkAccepted(p.dataDir, '新建口径');
    const second = atbJson(['refine', 'create'], p.root);
    assert.equal(second.created, true, '存量收尾后可新建');
    assert.ok(second.prompt.includes(FOLLOW_LINE), '新建提示词含跟随指令');
    assert.ok(!second.prompt.includes(OLD_SNIPPET), '新建提示词不含旧行');
    const raw = JSON.parse(fs.readFileSync(path.join(p.dataDir, 'refine', 'batches', second.batchId, 'batch.json'), 'utf8'));
    assert.ok(raw.prompt.includes(FOLLOW_LINE) && !raw.prompt.includes(OLD_SNIPPET), '新账本文件落盘口径正确（验收 3）');
    assert.ok(raw.candidates.some((c) => c.id === id2), '新候选入批');
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
