#!/usr/bin/env node
// REQ-20260914-007 人工确认完成和版本合并成功后自动提交管理文件 —— 该闭环已随
// BUG-20260918-002 整体下线（新目录架构下条目状态变更不需要同步提交到 git），本文件
// 按新口径改写为其回归承载：
//   · 确认完成（API / CLI）只做状态流转：不采集基线、不执行任何 git add/commit，
//     响应与详情不带 mgtCommit，runtime/commits/mgt/ 账本不写，留痕文档留在工作区；
//   · 提交纪律自然成立：无关脏文件 / 用户预先暂存内容 / 其他条目未跟踪资料原样保留；
//   · 版本合并入口维持 REQ-20260916-007 取消口径：响应无 mgtCommit、无版本管理提交；
//   · 重试通道下线：/api/mgt-commit/retry 对 item / version 一律 404，CLI atb mgt retry 非零退出；
//   · 前端源契约：无反馈块 / 无重试绑定 / 无 .mgt 样式 / 词典无相关词条。
// 用法：node scripts/tests/mgt-auto-commit-20260914-007.test.mjs
// 模式沿用真实 git 临时仓库 + HTTP 服务（batch-serve 同款）。

import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as core from '../lib/core.mjs';
import * as holdStore from '../lib/hold-store.mjs';
import * as buildStore from '../lib/build-store.mjs';
import * as buildGit from '../lib/build-git.mjs';
import * as gitFlow from '../lib/git-flow.mjs';
import '../web/i18n.js';

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const ATB = path.join(pluginRoot, 'scripts', 'atb.mjs');
const SERVER = path.join(pluginRoot, 'scripts', 'server.mjs');

const cases = [];
const t = (name, fn) => cases.push([name, fn]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function git(root, args) {
  const r = spawnSync('git', args, { cwd: root, encoding: 'utf8', timeout: 60_000 });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} 失败：${r.stderr || r.stdout}`);
  return r;
}

function atb(args, cwd) {
  const r = spawnSync(process.execPath, [ATB, ...args, '--dir', cwd], { encoding: 'utf8', timeout: 90_000 });
  return { code: r.status, out: r.stdout || '', err: r.stderr || '' };
}

// atb --json 输出为多行 pretty JSON：取最后一个顶层对象（\n{ 起到末尾）
function jsonOfAtb(r) {
  const i = r.out.lastIndexOf('\n{');
  assert.ok(i >= 0, `应包含 JSON 输出：${r.out.slice(-400)}`);
  return JSON.parse(r.out.slice(i + 1));
}

function req(port, method, pathname, body) {
  return new Promise((resolve, reject) => {
    const payload = body == null ? null : JSON.stringify(body);
    const r = http.request({
      hostname: '127.0.0.1', port, path: pathname, method,
      headers: payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {},
      timeout: 15000,
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

async function bootServer(proj) {
  const port = 31000 + Math.floor(Math.random() * 20000);
  const reg = path.join(os.tmpdir(), `atb-mgt-reg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.json`);
  const server = spawn(process.execPath, [SERVER], {
    cwd: proj,
    env: { ...process.env, ATB_PORT: String(port), ATB_REGISTRY: reg },
    stdio: ['ignore', 'ignore', 'ignore'],
  });
  try {
    for (let i = 0; i < 60; i++) {
      await sleep(150);
      const ok = await new Promise((res) => {
        const rq = http.request({ hostname: '127.0.0.1', port, path: '/api/health', method: 'GET', timeout: 1000 }, (rs) => { res(rs.statusCode === 200); rs.resume(); });
        rq.on('error', () => res(false));
        rq.on('timeout', () => { rq.destroy(); res(false); });
        rq.end();
      });
      if (ok) return { server, port };
    }
  } catch (e) { server.kill(); throw e; }
  server.kill();
  throw new Error('server 启动超时');
}

function mkTmp(tag) {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), `atb-mgt-${tag}-`)));
}

// 带本地身份的 git 项目（main 起步）
function mkProject(tag) {
  const root = mkTmp(tag);
  git(root, ['init', '-q', '-b', 'main']);
  git(root, ['config', 'user.email', 't@example.com']);
  git(root, ['config', 'user.name', 't']);
  fs.writeFileSync(path.join(root, 'README.md'), '# t\n');
  core.initData(root);
  git(root, ['add', '.']);
  git(root, ['commit', '-q', '-m', 'chore: 初始化测试仓库']);
  return root;
}

// 条目推进到 in-progress（claim 由 worker 占用）；holdAnswered 时补一轮已作答的待人工决策
// （决策留痕 BUG-20260918-003 起落 runtime/holds/decisions/<ID>.md，不进 git）
function mkInProgressItem(dataDir, title, { holdAnswered = false } = {}) {
  const x = core.createItem(dataDir, { type: 'requirement', title });
  core.setStatus(dataDir, x.id, 'accepted', { by: 'human' });
  core.setStatus(dataDir, x.id, 'planned', { by: 'human' });
  core.claim(dataDir, x.id, 'w1');
  if (holdAnswered) {
    holdStore.declareHold(dataDir, x.id, { questions: ['口径确认？'], reason: '确认', by: 'w1' });
    holdStore.answerHold(dataDir, x.id, { answers: [{ q: 'q1', text: '按本单口径' }], by: 'human' });
  }
  return x;
}

function commitItemBaseline(root, dataDir, id) {
  git(root, ['add', path.relative(root, path.join(dataDir, 'data', 'requirements', id))]);
  git(root, ['commit', '-q', '-m', 'chore: 条目基线入库']);
}

const headOf = (root) => git(root, ['rev-parse', 'HEAD']).stdout.trim();
const subjectsOn = (root, ref, keyword) =>
  git(root, ['log', ref, '--format=%s']).stdout.split('\n').filter(Boolean).filter((s) => s.includes(keyword));
const mgtStateFile = (dataDir, id) => path.join(dataDir, 'runtime', 'commits', 'mgt', `item-${id}.json`);

// ---------- R1 确认完成入口：只做状态流转（含 hold 闭环刷新 decisions.md 场景） ----------

t('R1 确认完成不提交：响应/详情无 mgtCommit、HEAD 不变、账本不写、留痕留在工作区', async () => {
  const root = mkProject('r1');
  const dataDir = core.dataDirFrom(root);
  const item = mkInProgressItem(dataDir, '确认完成不再自动提交', { holdAnswered: true });
  commitItemBaseline(root, dataDir, item.id);
  const headBefore = headOf(root);

  const { server, port } = await bootServer(root);
  try {
    const r = await req(port, 'POST', `/api/item/${item.id}/status`, { to: 'done' });
    assert.equal(r.status, 200, `确认完成应成功：${JSON.stringify(r.json)}`);
    assert.equal(r.json.status, 'done', '业务状态流转成功');
    assert.equal(r.json.mgtCommit, undefined, '响应不应携带 mgtCommit 提交结果');
    assert.equal(headOf(root), headBefore, '不得产生任何 git 提交');
    assert.equal(subjectsOn(root, 'HEAD', item.id).length, 0, '提交说明不得出现单号');
    assert.ok(!fs.existsSync(mgtStateFile(dataDir, item.id)), 'runtime/commits/mgt/ 账本不应写入');
    const st = git(root, ['status', '--porcelain', '-uall']).stdout;
    // BUG-20260918-003：决策留痕迁 runtime（git 忽略域）——闭环刷新不产生任何工作区变更
    assert.ok(!st.includes('decisions.md'), '闭环刷新的决策留痕在 runtime，不得出现在 git status');
    const rtDoc = path.join(dataDir, 'runtime', 'holds', 'decisions', `${item.id}.md`);
    assert.ok(fs.readFileSync(rtDoc, 'utf8').includes('closed-done'), 'runtime 决策留痕应体现闭环');
    const detail = await req(port, 'GET', `/api/item/${item.id}`);
    assert.equal(detail.status, 200);
    assert.equal(detail.json.mgtCommit, undefined, '条目详情不附带管理提交状态');
  } finally {
    server.kill();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ---------- R2 提交纪律（不触碰用户工作区） ----------

t('R2 工作区原样：无关脏文件 / 预先暂存内容 / 其他条目未跟踪资料不被触碰', async () => {
  const root = mkProject('r2');
  const dataDir = core.dataDirFrom(root);
  const item = mkInProgressItem(dataDir, '工作区纪律单', { holdAnswered: true });
  commitItemBaseline(root, dataDir, item.id);
  // 无关已跟踪脏文件（业务源码）+ 用户预先暂存内容 + 其他条目未跟踪需求资料
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src', 'app.js'), 'v1\n');
  git(root, ['add', '.']);
  git(root, ['commit', '-q', '-m', 'chore: 源码基线']);
  fs.appendFileSync(path.join(root, 'src', 'app.js'), '用户未提交改动\n');
  fs.writeFileSync(path.join(root, 'staged.txt'), '用户暂存内容\n');
  git(root, ['add', 'staged.txt']);
  const other = core.createItem(dataDir, { type: 'bug', title: '其他条目' });
  const otherDir = path.join(dataDir, 'data', 'bugs', other.id);

  const { server, port } = await bootServer(root);
  try {
    const r = await req(port, 'POST', `/api/item/${item.id}/status`, { to: 'done' });
    assert.equal(r.json.status, 'done');
    assert.equal(r.json.mgtCommit, undefined);
    const st = git(root, ['status', '--porcelain', '-uall']).stdout;
    assert.match(st, /M\s+src\/app\.js/, '无关已跟踪脏改动应保留在工作区');
    assert.match(st, /A\s+staged\.txt/, '用户预先暂存状态应原样保留');
    assert.ok(st.includes(path.relative(root, otherDir)), '其他条目未跟踪需求资料不应被触碰');
  } finally {
    server.kill();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ---------- R3 版本合并入口（REQ-20260916-007 取消口径维持） ----------

async function mkVersionProject(tag, { onMain = false } = {}) {
  const root = mkProject(tag);
  const dataDir = core.dataDirFrom(root);
  if (!onMain) {
    gitFlow.ensureDevWorkflow(root); // main + dev，当前 dev（main 在根提交幂等补建）
  } else {
    git(root, ['branch', 'main']);
    git(root, ['switch', '-q', 'main']);
  }
  const item = mkInProgressItem(dataDir, '版本条目单');
  core.report(dataDir, item.id, { summary: '完成', by: 'w1' });
  core.setStatus(dataDir, item.id, 'done', { by: 'human' });
  git(root, ['add', '.']);
  git(root, ['commit', '-q', '-m', 'chore: 版本条目基线']);
  const hash = git(root, ['rev-parse', 'HEAD']).stdout.trim();
  const v = buildStore.createVersion(dataDir, {
    name: '测试版本',
    items: [{ itemId: item.id, commit: hash, title: '版本条目单' }],
  });
  return { root, dataDir, item, v };
}

t('R3 版本合并无管理提交：合并响应/详情不带 mgtCommit、无版本管理提交（REQ-20260920-003 起合并前置要求工作目录在 dev；非 dev 阻止口径由 req-20260920-003.test.mjs 覆盖）', async () => {
  const { root, dataDir, item, v } = await mkVersionProject('r3');
  // REQ-20260920-003：合并前置 = 八个发布文档已提交（pathspec 限定，无管理提交语义）；
  // REQ-20260921-010 起默认语言集 cn,en、英文文件下划线命名，提交清单显式传入
  const DOCS8 = ['README.md', 'README_en.md', 'CHANGELOG.md', 'CHANGELOG_en.md', 'FEATURES.md', 'FEATURES_en.md', 'AGENTS.md', 'AGENTS_en.md'];
  for (const file of DOCS8) {
    fs.writeFileSync(path.join(root, file), `# ${file} (${v.id})`);
  }
  const docsCommit = buildGit.commitPublishDocs(root, { message: 'docs: 发布文档基线', files: DOCS8 });
  buildStore.recordDocsCommit(dataDir, v.id, { commitHash: docsCommit.commitHash, files: docsCommit.hashes, scopeFp: null });
  const { server, port } = await bootServer(root);
  try {
    const r = await req(port, 'POST', '/api/build/version/merge', { id: v.id });
    assert.equal(r.status, 200, `合并应成功：${JSON.stringify(r.json).slice(0, 200)}`);
    assert.equal(r.json.version.status, 'merged');
    assert.equal(r.json.mgtCommit, undefined, '合并响应不应携带 mgtCommit');
    assert.equal(subjectsOn(root, 'HEAD', '版本合并记录').length, 0, '不得产生版本管理提交');
    assert.equal(subjectsOn(root, 'HEAD', v.id).length, 0, '版本号不得出现在提交说明');
    assert.equal(subjectsOn(root, 'HEAD', item.id).filter((s) => s.startsWith('doc:')).length, 0, '确认完成后的条目也不再有 doc 管理提交');
    const state = await req(port, 'GET', '/api/build/state');
    const vs = state.json.versions.find((x) => x.id === v.id);
    assert.equal(vs.mgtCommit, undefined, 'build/state 不附版本管理提交状态');
  } finally {
    server.kill();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ---------- R4 重试通道下线（API + CLI） ----------

t('R4 重试通道下线：/api/mgt-commit/retry 对 item / version 一律 404；atb mgt retry 非零退出', async () => {
  const root = mkProject('r4');
  const dataDir = core.dataDirFrom(root);
  const item = mkInProgressItem(dataDir, '重试下线单', { holdAnswered: true });
  commitItemBaseline(root, dataDir, item.id);
  const { server, port } = await bootServer(root);
  try {
    const rItem = await req(port, 'POST', '/api/mgt-commit/retry', { kind: 'item', id: item.id });
    assert.equal(rItem.status, 404, 'item 重试接口应已下线（未知接口统一 404）');
    const rVer = await req(port, 'POST', '/api/mgt-commit/retry', { kind: 'version', id: 'BLD-20260918-001' });
    assert.equal(rVer.status, 404, 'version 重试接口同样下线');
  } finally {
    server.kill();
  }
  const cli = atb(['mgt', 'retry', 'item', item.id], root);
  assert.notEqual(cli.code, 0, 'CLI mgt 子命令应已下线（非零退出）');
  fs.rmSync(root, { recursive: true, force: true });
});

// ---------- R5 CLI 可识别结果 ----------

t('R5 CLI：atb status done --json 无 mgtCommit、输出无管理提交行、不产生提交', async () => {
  const root = mkProject('r5');
  const dataDir = core.dataDirFrom(root);
  const item = mkInProgressItem(dataDir, 'CLI 新口径单', { holdAnswered: true });
  commitItemBaseline(root, dataDir, item.id);
  const headBefore = headOf(root);
  const r = atb(['status', item.id, 'done', '--json'], root);
  assert.equal(r.code, 0, `CLI 应成功：${r.err}`);
  const st = jsonOfAtb(r);
  assert.equal(st.status, 'done');
  assert.equal(st.mgtCommit, undefined, '--json 不应包含 mgtCommit');
  assert.ok(!r.out.includes('管理记录'), `人读输出不应含管理提交相关行：${r.out}`);
  assert.equal(headOf(root), headBefore, 'CLI 确认完成不得产生提交');
  fs.rmSync(root, { recursive: true, force: true });
});

// ---------- R6 前端源契约（原 P10 新口径：全面收敛） ----------

t('R6 前端与词典：无反馈块 / 无重试绑定 / 无 .mgt 样式 / 无相关词条', async () => {
  const read = (p) => fs.readFileSync(path.join(pluginRoot, p), 'utf8');
  const app = read('scripts/web/app.js');
  const build = read('scripts/web/build.js');
  const css = read('scripts/web/style.css');

  assert.ok(!app.includes('mgtCommit'), 'app.js 不应使用 mgtCommit 数据');
  assert.ok(!app.includes('data-mgt-retry'), 'app.js 不应再有重试按钮绑定标记');
  assert.ok(!app.includes('/api/mgt-commit/retry'), 'app.js 不应再调用补交接口');
  assert.ok(!build.includes('mgtCommit'), 'build.js 不应使用 mgtCommit 数据');
  assert.ok(!build.includes('data-ver-mgt-retry'), 'build.js 不应再有版本侧重试绑定');
  assert.ok(!build.includes('/api/mgt-commit/retry'), 'build.js 不应再调用补交接口');
  assert.ok(!/\.mgt\b/.test(css), 'style.css 无 .mgt 反馈块样式');
  assert.ok(!/mgt-spin/.test(css), 'style.css 无残留动画');

  const I = globalThis.ATBI18N;
  assert.ok(I, 'i18n.js 应在 globalThis.ATBI18N 暴露接口');
  const { EN, EN_DYNAMIC } = I._dict;
  for (const k of [
    '管理记录提交：提交中…', '✓ 管理记录提交：已同步 · 无新变化', '⚠ 操作已成功，管理记录提交失败',
    '管理记录未自动提交', '重试提交', '⚠ 操作已成功，管理记录提交失败：◇', '重试提交失败：◇',
  ]) {
    assert.ok(!(k in EN) && !(k in EN_DYNAMIC), `词典不应残留管理提交词条：${k}`);
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
