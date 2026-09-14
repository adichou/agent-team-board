#!/usr/bin/env node
// REQ-20260910-027 删除所有任务中对开发人员的设置功能 —— 移除后契约测试
// 覆盖（test-cases.md D1~D8）：
//   D1 lib：三个 create 不落账 developer；三个 prompt 生成函数任何入参都不含会话命名指令
//   D2 lib 遗留兼容：create 传 developer 不报错、账本无字段；prompt 传与不传 developer 逐字一致
//   D3 lib 存量兼容：账本手工含 developer 的批次 summary/publicView/brief 正常且不透出
//   D4 前端：三启动区无输入框、无 atb.batch.dev 读写、无 batchDevInitial；创建请求体无 developer
//   D5 前端展示/搜索：状态行/排队批次行/全局任务行无「开发人员」；过滤字段无 developer
//   D6 server：无 gitUser/gitUserName；API 不透传 developer；current 视图与 queue 无 developer
//   D7 CLI：白名单无 dev、帮助无 --dev、输出无「开发人员/developer」、显式 --dev die 提示
//   D8 保留项：启动按钮/无候选禁用 title/启动新一轮/排队行其余片段/搜索其余字段不回归
// 用法：node scripts/tests/dev-setting-removed-20260910-027.test.mjs

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as core from '../lib/core.mjs';
import * as batch from '../lib/batch.mjs';
import * as refine from '../lib/refine-store.mjs';
import * as commitStore from '../lib/commit-store.mjs';

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const source = {
  app: fs.readFileSync(path.join(pluginRoot, 'scripts', 'web', 'app.js'), 'utf8'),
  srv: fs.readFileSync(path.join(pluginRoot, 'scripts', 'server.mjs'), 'utf8'),
  atb: fs.readFileSync(path.join(pluginRoot, 'scripts', 'atb.mjs'), 'utf8'),
  batch: fs.readFileSync(path.join(pluginRoot, 'scripts', 'lib', 'batch.mjs'), 'utf8'),
};

const cases = [];
const t = (name, fn) => cases.push([name, fn]);

// ---------- 脚手架 ----------

function git(root, args) {
  const r = spawnSync('git', ['-c', 'user.email=t@example.com', '-c', 'user.name=t', ...args], {
    cwd: root, encoding: 'utf8', timeout: 30_000,
  });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} 失败：${r.stderr || r.stdout}`);
  return r.stdout || '';
}

function mkProject({ gitRepo = false } = {}) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'atb-dev-removed-')));
  if (gitRepo) {
    git(root, ['init', '-q']);
    fs.writeFileSync(path.join(root, 'README.md'), '# t\n');
    git(root, ['add', '.']);
    git(root, ['commit', '-q', '-m', 'chore: 初始化测试仓库']);
  }
  core.initData(root);
  if (gitRepo) {
    git(root, ['add', '.']);
    git(root, ['commit', '-q', '-m', 'chore: 初始化看板数据']);
  }
  const dataDir = core.dataDirFrom(root);
  return { root, dataDir };
}

function mkPlanned(p, title) {
  const st = core.createItem(p.dataDir, { type: 'requirement', title, description: 'x', by: 'tester' });
  core.setStatus(p.dataDir, st.id, 'accepted', { by: 'tester' });
  core.setStatus(p.dataDir, st.id, 'planned', { by: 'tester' });
  return st.id;
}

function mkAccepted(p, title) {
  const st = core.createItem(p.dataDir, { type: 'requirement', title, description: 'x', by: 'tester' });
  core.setStatus(p.dataDir, st.id, 'accepted', { by: 'tester' });
  return st.id;
}

function mkDone(p, title) {
  const st = core.createItem(p.dataDir, { type: 'requirement', title, description: 'x', by: 'tester' });
  for (const s of ['accepted', 'planned']) core.setStatus(p.dataDir, st.id, s, { by: 'tester' });
  core.claim(p.dataDir, st.id, 'dev');
  core.report(p.dataDir, st.id, { summary: '实施完成', by: 'dev' });
  core.setStatus(p.dataDir, st.id, 'done', { by: 'human' });
  return st.id;
}

function cleanup(p) {
  fs.rmSync(p.root, { recursive: true, force: true });
}

const NAMING = /请将当前会话名改为/;

// ---------- D1/D2 lib：账本与提示词 ----------

t('D1 三个 create 账本不再写 developer；三个 prompt 生成函数（含传 developer）无会话命名指令', () => {
  const p = mkProject();
  try {
    mkPlanned(p, 'A');
    const { batch: bt } = batch.createBatch(p.dataDir, { projectRoot: p.root, developer: '张三' });
    assert.equal('developer' in bt, false, '批量开发账本不应再写 developer 字段');
    assert.ok(!NAMING.test(bt.prompt), '批量开发提示词不应含会话命名指令');

    mkAccepted(p, 'B');
    const rb = refine.createRefineBatch(p.dataDir, { projectRoot: p.root, developer: '张三' });
    assert.equal('developer' in rb.batch, false, '完善账本不应再写 developer 字段');
    assert.ok(!NAMING.test(rb.batch.prompt), '完善提示词不应含会话命名指令');
    assert.ok(!NAMING.test(refine.buildRefinePrompt({ projectRoot: p.root, batchId: 'RFB-1', developer: '张三', modelSource: 'follow' })), 'buildRefinePrompt 传 developer 也不生成命名行');
    assert.ok(!NAMING.test(batch.generatePrompt({ projectRoot: p.root, batchId: 'b-1', workerSpecPath: '/s.md', developer: '张三' })), 'generatePrompt 传 developer 也不生成命名行');

    // REQ-20260911-010：批量 commit 建批/提示词（createCommitBatch / buildCommitPrompt）已随回退移除，
    // 对应断言删除；developer 移除契约由批量开发/批量完善两侧继续守
  } finally { cleanup(p); }
});

t('D2 遗留兼容：三个 create 传 developer 不报错（忽略）；prompt 传与不传 developer 输出逐字一致', () => {
  const p = mkProject();
  try {
    mkPlanned(p, 'A');
    const withDev = batch.createBatch(p.dataDir, { projectRoot: p.root, developer: '张三' });
    const plain = batch.generatePrompt({ projectRoot: p.root, batchId: withDev.batch.batchId, workerSpecPath: '/s.md' });
    const legacy = batch.generatePrompt({ projectRoot: p.root, batchId: withDev.batch.batchId, workerSpecPath: '/s.md', developer: '张三' });
    assert.equal(legacy, plain, 'generatePrompt 传 developer 应与不传逐字一致（参数保留但忽略）');
    // 非法值也不再校验报错（校验随功能移除，遗留入参一律忽略）
    const second = mkPlanned(p, 'A2');
    const bad = batch.createBatch(p.dataDir, { projectRoot: p.root, ids: [second], developer: 'x'.repeat(31) });
    assert.ok(bad.batch.batchId, '超长 developer 应被忽略而不是拒绝');
    assert.equal(batch.listBatches(p.dataDir).length, 2, '两次创建均应成功');
  } finally { cleanup(p); }
});

t('D3 存量兼容：账本手工含 developer 的批次 summary/publicView/brief 正常且不透出 developer', () => {
  const p = mkProject();
  try {
    mkPlanned(p, 'A');
    const { batch: bt } = batch.createBatch(p.dataDir, { projectRoot: p.root });
    const bfile = path.join(p.dataDir, 'dispatch', 'batches', bt.batchId, 'batch.json');
    const saved = JSON.parse(fs.readFileSync(bfile, 'utf8'));
    saved.developer = '存量开发'; // 模拟存量账本
    fs.writeFileSync(bfile, JSON.stringify(saved, null, 2) + '\n');

    const sum = batch.batchSummary(p.dataDir, bt.batchId);
    assert.equal(sum.batch.batchId, bt.batchId, 'summary 应正常返回');
    assert.equal('developer' in batch.batchBrief(p.dataDir, bt.batchId), false, 'batchBrief 不应透出 developer');

    mkAccepted(p, 'B');
    const rb = refine.createRefineBatch(p.dataDir, { projectRoot: p.root });
    const rfile = path.join(p.dataDir, 'refine', 'batches', rb.batch.batchId, 'batch.json');
    const rsaved = JSON.parse(fs.readFileSync(rfile, 'utf8'));
    rsaved.developer = '存量开发';
    fs.writeFileSync(rfile, JSON.stringify(rsaved, null, 2) + '\n');
    const rview = refine.refineBatchPublicView(refine.getRefineBatch(p.dataDir, rb.batch.batchId));
    assert.equal(rview.batchId, rb.batch.batchId, 'refine 公开视图应正常返回');
    assert.equal('developer' in rview, false, 'refine 公开视图不应透出 developer');
    assert.equal('developer' in refine.refineBatchBrief(p.dataDir, rb.batch.batchId), false, 'refineBatchBrief 不应透出 developer');
  } finally { cleanup(p); }
});

// ---------- D4/D5 前端静态契约 ----------

t('D4 前端：三启动区无开发人员输入框与初值函数；无 atb.batch.dev 读写；创建函数请求体不含 developer', () => {
  for (const id of ['id="batchDev"', 'id="refineDev"', 'id="commitDev"']) {
    assert.doesNotMatch(source.app, new RegExp(id), `启动区不应再有 ${id} 输入框`);
  }
  assert.doesNotMatch(source.app, /batchDevInitial/, '输入初值函数应随输入框删除');
  assert.doesNotMatch(source.app, /atb\.batch\.dev/, '不应再读写 localStorage atb.batch.dev');
  assert.doesNotMatch(source.app, /developer/, '前端源码不应再引用 developer 字段');
  assert.doesNotMatch(source.app, /开发人员 \$\{/, '展示模板不应再拼接「开发人员 <值>」片段');
  assert.doesNotMatch(source.app, /如 张三（可留空/, '输入框 placeholder 应随输入框删除');
  // 创建请求体不再携带 developer（含终态「启动新一轮」与 refine 单条目重建）
  // REQ-20260911-010：createCommitBatchAndCopy 随批量 Commit 面板回退移除
  for (const fn of ['async function createBatchAndCopy', 'async function createRefineBatchAndCopy']) {
    const m = source.app.match(new RegExp(fn.replace(/[$]/g, '\\$&') + String.raw`\([\s\S]*?\n\}`));
    assert.ok(m, `应存在 ${fn}`);
    assert.doesNotMatch(m[0], /developer/, `${fn} 请求体不应携带 developer`);
  }
});

t('D5 前端展示/搜索：无「开发人员」片段；globalTaskMatches 与排队批次过滤字段无 developer', () => {
  const m = source.app.match(/function globalTaskMatches\(task, projRow, q\)[\s\S]*?\n\}/);
  assert.ok(m, '应存在 globalTaskMatches');
  assert.doesNotMatch(m[0], /developer/, '全局搜索过滤字段不应含 developer');
  const q = source.app.match(/allQueued\.filter\(\(x\) =>[\s\S]*?\)\)/);
  assert.ok(q, '应存在排队批次过滤');
  assert.doesNotMatch(q[0], /developer/, '排队批次过滤字段不应含 developer');
});

// ---------- D6/D7 server 与 CLI 静态契约 ----------

t('D6 server：无 gitUserName/gitUser；API 不透传 developer；current 视图与 queue 无 developer', () => {
  assert.doesNotMatch(source.srv, /gitUserName/, 'gitUserName 应删除');
  assert.doesNotMatch(source.srv, /gitUser/, '/api/batch/current 无批次响应不应再含 gitUser');
  assert.doesNotMatch(source.srv, /developer/, 'server 源码不应再出现 developer（入参忽略、输出移除）');
});

t('D7 CLI：白名单无 dev、帮助无 --dev、输出无「开发人员/developer」；normalizeDeveloper/DEV_MAX_CHARS 移除', () => {
  assert.doesNotMatch(source.atb, /--dev/, 'CLI 帮助文本不应再出现 --dev');
  assert.doesNotMatch(source.atb, /developer/, 'CLI 不应再引用 developer（输出与 payload 均移除；「开发人员」仅允许出现在 --dev 遗留 die 提示）');
  for (const fn of ['function batchCmd', 'async function refineCmd', 'async function commitCmd']) {
    const m = source.atb.match(new RegExp(fn.replace(/async /, '(?:async )?').replace(/[$]/g, '\\$&') + String.raw`\(rest\)[\s\S]*?\n\}`));
    assert.ok(m, `应存在 ${fn}`);
    assert.doesNotMatch(m[0], /'dev'/, `${fn} parseOpts 白名单不应含 dev`);
    assert.doesNotMatch(m[0], /developer/, `${fn} 不应再引用 developer`);
  }
  assert.doesNotMatch(source.batch, /normalizeDeveloper|DEV_MAX_CHARS/, 'lib 不应再有 normalizeDeveloper / DEV_MAX_CHARS');
});

t('D7b CLI 端到端：显式 --dev 时 die 提示已移除；create/summary JSON 输出无 developer', () => {
  const p = mkProject();
  try {
    mkPlanned(p, 'A');
    const ATB = path.join(pluginRoot, 'scripts', 'atb.mjs');
    const bad = spawnSync(process.execPath, [ATB, 'batch', 'create', '--dev', '张三', '--dir', p.root], { encoding: 'utf8', timeout: 60_000 });
    assert.notEqual(bad.status, 0, '--dev 应被明确拒绝（die 提示已移除）');
    assert.ok((bad.stdout + bad.stderr).includes('开发人员'), 'die 信息应说明开发人员设置已移除');

    const ok = spawnSync(process.execPath, [ATB, 'batch', 'create', '--json', '--dir', p.root], { encoding: 'utf8', timeout: 60_000 });
    assert.equal(ok.status, 0, '不带 --dev 创建应成功');
    const payload = JSON.parse(ok.stdout.split('\n').filter(Boolean).pop());
    assert.equal('developer' in payload, false, 'create JSON 响应不应含 developer');

    const sum = spawnSync(process.execPath, [ATB, 'batch', 'summary', '--json', '--dir', p.root], { encoding: 'utf8', timeout: 60_000 });
    assert.equal(sum.status, 0);
    const s = JSON.parse(sum.stdout.split('\n').filter(Boolean).pop());
    assert.equal('developer' in s.batch, false, 'summary JSON 不应含 developer');
  } finally { cleanup(p); }
});

// ---------- D8 保留项不回归（静态契约） ----------

t('D8 保留项：启动按钮与无候选禁用 title、启动新一轮、排队行其余片段、搜索其余字段保持', () => {
  const start = source.app.match(/function renderDevStartBar\(\)[\s\S]*?\n\}/);
  assert.ok(start, '应存在 renderDevStartBar');
  assert.match(start[0], /id="devStart"/, '启动按钮保留');
  assert.match(start[0], /暂无已计划候选/, '无候选禁用 title 保留');
  // REQ-20260911-010：commitCreate / commitNext 随批量 Commit 面板回退移除
  assert.match(source.app, /id="refineCreate"/, '完善启动按钮保留');
  assert.match(source.app, /id="batchNext"/, '终态「启动新一轮」保留');
  assert.match(source.app, /id="refineNext"/, '完善「启动新一轮」保留');
  const q = source.app.match(/allQueued\.filter\(\(x\) =>[\s\S]*?\)\)/);
  assert.ok(q && /x\.batchId/.test(q[0]), '排队批次仍按批次号过滤');
  assert.match(source.app.match(/function globalTaskMatches\(task, projRow, q\)[\s\S]*?\n\}/)[0], /task\.batchId/, '全局搜索仍按批次号过滤');
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
