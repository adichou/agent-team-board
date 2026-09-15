#!/usr/bin/env node
// REQ-20260914-007 人工确认完成和版本合并成功后自动提交管理文件 —— 端到端测试
// 用法：node scripts/tests/mgt-auto-commit-20260914-007.test.mjs
// 覆盖（见条目 test-cases.md P1–P10）：
//   · 确认完成入口自动提交 status.json 与本次确有刷新的 decisions.md / confirmations.md；
//   · 提交纪律：路径限定、不夹带无关脏文件 / 其他条目 / 未跟踪需求资料 / 预先暂存内容；
//   · 目标文件已暂存（无法安全分离）→ 不提交、pendingManual 明确报告、暂存状态不破坏；
//   · 版本合并入口：version.json 提交到 main（临时工作树），当前分支不变、不推送，
//     当前分支同内容一并提交，工作区不再遗留版本记录；
//   · 当前分支即 main：原地路径限定提交；
//   · 幂等：成功后重试 noop 不制造空提交；重试只补交管理记录不重放业务操作；
//   · 失败反馈：身份缺失 → failed（原因 / 未提交文件 / 建议），账本持久化、详情刷新仍可见，
//     重试成功后清除失败提示；
//   · CLI：atb status <ID> done --json 携带 mgtCommit；atb mgt retry 补交；
//   · 串行（锁被占明确失败）与非 git 项目 skipped；
//   · 前端源契约：反馈块结构、重试绑定、样式沿用现有主题变量。
// 模式对齐 auto-commit-pre-dirty-20260913-006（真实 git 临时仓库）与 batch-serve（HTTP 服务）。

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
import * as gitFlow from '../lib/git-flow.mjs';

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

function atb(args, cwd, env = process.env) {
  const r = spawnSync(process.execPath, [ATB, ...args, '--dir', cwd], { encoding: 'utf8', timeout: 90_000, env });
  return { code: r.status, out: r.stdout || '', err: r.stderr || '' };
}

function jsonOf(r) {
  return JSON.parse(r.out.split('\n').filter(Boolean).pop());
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

async function bootServer(proj, { env = {} } = {}) {
  const port = 31000 + Math.floor(Math.random() * 20000);
  const reg = path.join(os.tmpdir(), `atb-mgt-reg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.json`);
  const server = spawn(process.execPath, [SERVER], {
    cwd: proj,
    env: { ...process.env, ATB_PORT: String(port), ATB_REGISTRY: reg, ...env },
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

// 带本地身份的 git 项目（main 起步）：服务端 git 提交可直接成功
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

// 条目推进到 in-progress（claim 由 worker 占用），并把条目目录入库（干净基线）
function mkInProgressItem(dataDir, title, type = 'requirement') {
  const x = core.createItem(dataDir, { type, title });
  core.setStatus(dataDir, x.id, 'accepted', { by: 'human' });
  core.setStatus(dataDir, x.id, 'planned', { by: 'human' });
  core.claim(dataDir, x.id, 'w1');
  return x;
}

const commitItemBaseline = (root, dataDir, id) => {
  git(root, ['add', path.relative(root, path.join(dataDir, 'requirements', id))
    || path.relative(root, path.join(dataDir, 'bugs', id))]);
  git(root, ['commit', '-q', '-m', 'chore: 条目基线入库']);
};

const subjectsOn = (root, ref, keyword) =>
  git(root, ['log', ref, '--format=%s']).stdout.split('\n').filter(Boolean).filter((s) => s.includes(keyword));

const mgtStateFile = (dataDir, kind, id) => path.join(dataDir, 'commits', 'mgt', `${kind}-${id}.json`);

// ---------- P1 确认完成入口（API，含 decisions.md 随闭环刷新） ----------

t('P1 确认完成：status.json 与本次确有刷新的 decisions.md 自动提交；说明带单号过规范核验；账本与详情接口可见', async () => {
  const root = mkProject('p1');
  const dataDir = core.dataDirFrom(root);
  const item = mkInProgressItem(dataDir, '确认完成自动提交管理记录');
  commitItemBaseline(root, dataDir, item.id);
  // 主流闭环：先作答待人工决策（decisions.md 因此已脏——历史管理写入），再确认完成（随闭环再次刷新）
  holdStore.declareHold(dataDir, item.id, { questions: ['是否采用方案 A？'], reason: '方案确认', by: 'w1' });
  holdStore.answerHold(dataDir, item.id, { answers: [{ q: 'q1', text: '采用方案 A' }], by: 'human' });

  const { server, port } = await bootServer(root);
  try {
    const r = await req(port, 'POST', `/api/item/${item.id}/status`, { to: 'done' });
    assert.equal(r.status, 200, `确认完成应成功：${JSON.stringify(r.json)}`);
    assert.equal(r.json.status, 'done', '业务操作成功：条目已完成');
    const mgt = r.json.mgtCommit;
    assert.ok(mgt, '响应应携带可识别的 mgtCommit 提交结果');
    assert.equal(mgt.status, 'committed', `应提交成功：${mgt && mgt.reason}`);
    assert.equal(mgt.subject, `doc: 人工确认完成 ${item.id}`);
    assert.equal(mgt.commits.length, 1);
    assert.match(mgt.commits[0].hash, /^[0-9a-f]{40}$/);
    assert.ok(mgt.commits[0].short && mgt.commits[0].short.length <= 12, '应提供短 SHA');
    const paths = mgt.files.map((f) => f.path);
    assert.ok(paths.some((p) => p.endsWith(`${item.id}/status.json`)), '目标文件应含 status.json');
    assert.ok(paths.some((p) => p.endsWith(`${item.id}/decisions.md`)), '本次确有刷新的 decisions.md 应一并纳入');

    // git 侧：说明过规范核验；管理文件不再遗留未提交
    const { validateCommitSubject } = await import('../lib/commit-store.mjs');
    assert.equal(validateCommitSubject(mgt.subject, item.id), null, '提交说明须过规范核验');
    const subjects = subjectsOn(root, 'HEAD', item.id);
    assert.equal(subjects.length, 1);
    assert.equal(subjects[0], mgt.subject);
    const st = git(root, ['status', '--porcelain', '-uall']).stdout;
    assert.ok(!st.includes(item.id), '条目管理文件不应再遗留为未提交状态');

    // 账本持久化 + 详情接口（刷新后仍可见）
    const ledger = JSON.parse(fs.readFileSync(mgtStateFile(dataDir, 'item', item.id), 'utf8'));
    assert.equal(ledger.status, 'committed');
    const detail = await req(port, 'GET', `/api/item/${item.id}`);
    assert.equal(detail.status, 200);
    assert.equal(detail.json.mgtCommit.status, 'committed', '条目详情应返回持久化的提交状态');
    assert.equal(detail.json.mgtCommit.commits[0].hash, mgt.commits[0].hash);
    // 账本目录被忽略，不受跟踪文件反复变脏
    assert.ok(git(root, ['check-ignore', path.relative(root, mgtStateFile(dataDir, 'item', item.id))]).status === 0,
      'commits/mgt/ 账本应被看板 .gitignore 忽略');
  } finally {
    server.kill();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ---------- P2 提交纪律（不夹带） ----------

t('P2 提交纪律：仅含目标路径；无关脏文件 / 其他条目未跟踪目录 / 预先暂存内容不被夹带，暂存状态不被破坏', async () => {
  const root = mkProject('p2');
  const dataDir = core.dataDirFrom(root);
  const item = mkInProgressItem(dataDir, '提交纪律单');
  commitItemBaseline(root, dataDir, item.id);
  // 无关已跟踪脏文件（业务源码）
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src', 'app.js'), 'v1\n');
  git(root, ['add', '.']);
  git(root, ['commit', '-q', '-m', 'chore: 源码基线']);
  fs.appendFileSync(path.join(root, 'src', 'app.js'), '用户未提交改动\n');
  // 用户预先暂存的内容（另一文件）
  fs.writeFileSync(path.join(root, 'staged.txt'), '用户暂存内容\n');
  git(root, ['add', 'staged.txt']);
  // 其他条目未跟踪需求资料
  const other = core.createItem(dataDir, { type: 'bug', title: '其他条目' });
  const otherDir = path.join(dataDir, 'bugs', other.id);

  const { server, port } = await bootServer(root);
  try {
    const r = await req(port, 'POST', `/api/item/${item.id}/status`, { to: 'done' });
    assert.equal(r.json.mgtCommit.status, 'committed');
    const mgtPath = `docs/agent-team-board/requirements/${item.id}`;
    // 提交仅含目标路径（status.json；本单未声明 hold，decisions/confirmations 未刷新不纳入）；
    // 账本忽略行（commits/mgt/）的一次性 .gitignore 变更允许随本次提交一并收纳
    const show = git(root, ['show', '--name-only', '--format=', r.json.mgtCommit.commits[0].hash]).stdout;
    const committed = show.split('\n').filter(Boolean);
    assert.ok(committed.includes(`${mgtPath}/status.json`), `应含 status.json：${committed}`);
    assert.ok(committed.every((p) => p === `${mgtPath}/status.json` || p === 'docs/agent-team-board/.gitignore'),
      `只应含本条目管理文件与账本忽略行：${committed}`);
    assert.ok(!committed.some((p) => p.endsWith('decisions.md') || p.endsWith('confirmations.md')),
      '未刷新的留痕文档不应被卷入');

    const st = git(root, ['status', '--porcelain', '-uall']).stdout;
    assert.match(st, /M\s+src\/app\.js/, '无关已跟踪脏改动应保留在工作区');
    assert.match(st, /A\s+staged\.txt/, '用户预先暂存状态应原样保留');
    assert.ok(st.includes(path.relative(root, otherDir)), '其他条目未跟踪需求资料不应被夹带');
  } finally {
    server.kill();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ---------- P3 目标文件已暂存：无法安全分离 → 待人工 ----------

t('P3 目标文件操作前已暂存：整操作不提交、pendingManual 明确报告待人工处理、暂存状态不被破坏', async () => {
  const root = mkProject('p3');
  const dataDir = core.dataDirFrom(root);
  const item = mkInProgressItem(dataDir, '暂存冲突单');
  commitItemBaseline(root, dataDir, item.id);
  holdStore.declareHold(dataDir, item.id, { questions: ['边界口径？'], reason: '确认', by: 'w1' });
  holdStore.answerHold(dataDir, item.id, { answers: [{ q: 'q1', text: '按保守口径' }], by: 'human' });
  // decisions.md 被用户预先暂存（无法安全分离的其他变更）
  git(root, ['add', path.relative(root, path.join(dataDir, 'requirements', item.id, 'decisions.md'))]);

  const { server, port } = await bootServer(root);
  try {
    const r = await req(port, 'POST', `/api/item/${item.id}/status`, { to: 'done' });
    assert.equal(r.json.status, 'done', '提交失败不得伪装成功，也不得撤销业务操作：条目保持已完成');
    const mgt = r.json.mgtCommit;
    assert.equal(mgt.status, 'failed', '应明确报告失败（待人工处理）');
    assert.ok(mgt.pendingManual.some((p) => p.endsWith('decisions.md')), `应列出待人工文件：${mgt.pendingManual}`);
    assert.ok(mgt.reason && mgt.reason.includes('人工'), 'reason 应说明待人工处理');
    assert.ok(mgt.advice, '应携带可执行处理建议');
    assert.equal(subjectsOn(root, 'HEAD', item.id).length, 0, '不得强行整文件提交');
    const st = git(root, ['status', '--porcelain', '-uall']).stdout;
    // 暂存条目保留（A/AM/MM 任一暂存位形态），操作刷新体现在工作区（未被提交）
    assert.match(st, new RegExp(`[AM][MD]\\s+docs/agent-team-board/requirements/${item.id}/decisions\\.md`),
      '暂存内容保留，操作刷新体现在工作区（未被提交）');
  } finally {
    server.kill();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ---------- P4 / P5 版本合并入口 ----------

async function mkVersionProject(tag, { onMain = false } = {}) {
  const root = mkProject(tag);
  const dataDir = core.dataDirFrom(root);
  if (!onMain) {
    gitFlow.ensureDevWorkflow(root); // main + dev，当前 dev（main 在根提交幂等补建）
  } else {
    // initData 已把工作区切到 dev（未出生 main 改名路径）：显式在基线提交补建 main 并切回，
    // 模拟「当前分支即 main」的仓库形态
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

t('P4 版本合并（当前 dev）：version.json 提交到 main（临时工作树）且当前分支不变、不推送；当前分支同内容提交、工作区不遗留', async () => {
  const { root, dataDir, item, v } = await mkVersionProject('p4');
  const verRel = path.relative(root, path.join(dataDir, 'builds', 'versions', v.id, 'version.json'));
  const { server, port } = await bootServer(root);
  try {
    const r = await req(port, 'POST', '/api/build/version/merge', { id: v.id });
    assert.equal(r.status, 200, `合并应成功：${JSON.stringify(r.json).slice(0, 200)}`);
    assert.equal(r.json.version.status, 'merged');
    const mgt = r.json.mgtCommit;
    assert.ok(mgt, '合并响应应携带 mgtCommit');
    assert.equal(mgt.status, 'committed', `版本记录应提交成功：${mgt && mgt.reason}`);
    assert.equal(mgt.subject, `doc: 版本合并记录 ${v.id}`);
    const mainCommit = mgt.commits.find((c) => c.branch === 'main');
    const devCommit = mgt.commits.find((c) => c.branch === 'dev');
    assert.ok(mainCommit, '应有提交到 main 的记录');
    assert.ok(devCommit, '当前分支应有同内容提交');

    // main 分支持有最终版本数据（status=merged），提交说明在 main 历史上
    const mainVer = JSON.parse(git(root, ['show', `main:${verRel}`]).stdout);
    assert.equal(mainVer.status, 'merged', 'main 上的 version.json 应为最终合并结果');
    assert.ok(mainVer.items.every((x) => x.mergedAt), 'main 上的最终记录应含逐条目合并时间');
    assert.ok(subjectsOn(root, 'main', v.id).includes(mgt.subject), '提交说明应在 main 历史');
    // 当前分支不变、未切换；工作区不再遗留版本记录
    assert.equal(git(root, ['branch', '--show-current']).stdout.trim(), 'dev', '不得擅自切换当前工作区分支');
    const workVer = fs.readFileSync(path.join(root, verRel), 'utf8');
    assert.equal(git(root, ['show', `main:${verRel}`]).stdout, workVer, '工作区与 main 记录一致');
    const st = git(root, ['status', '--porcelain', '-uall']).stdout;
    assert.ok(!st.includes(verRel), '版本记录不应遗留为未提交状态');
    // 账本
    const ledger = JSON.parse(fs.readFileSync(mgtStateFile(dataDir, 'version', v.id), 'utf8'));
    assert.equal(ledger.status, 'committed');
    const state = await req(port, 'GET', '/api/build/state');
    const ver = state.json.versions.find((x) => x.id === v.id);
    assert.equal(ver.mgtCommit.commits.find((c) => c.branch === 'main').hash, mainCommit.hash,
      '版本状态接口应携带持久化的提交记录');
    assert.equal(ver.mgtCommit.status, 'committed');
  } finally {
    server.kill();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

t('P5 当前分支即 main：原地路径限定提交，单条提交、不切分支', async () => {
  const { root, dataDir, v } = await mkVersionProject('p5', { onMain: true });
  const verRel = path.relative(root, path.join(dataDir, 'builds', 'versions', v.id, 'version.json'));
  const { server, port } = await bootServer(root);
  try {
    const r = await req(port, 'POST', '/api/build/version/merge', { id: v.id });
    const mgt = r.json.mgtCommit;
    assert.equal(mgt.status, 'committed');
    assert.equal(mgt.commits.length, 1, '在 main 上原地提交只应有一条');
    assert.equal(mgt.commits[0].branch, 'main');
    assert.equal(git(root, ['branch', '--show-current']).stdout.trim(), 'main');
    const mainVer = JSON.parse(git(root, ['show', `main:${verRel}`]).stdout);
    assert.equal(mainVer.status, 'merged');
    assert.ok(!git(root, ['status', '--porcelain', '-uall']).stdout.includes(verRel));
  } finally {
    server.kill();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ---------- P6 幂等（重试不重复提交 / noop 不制造空提交） ----------

t('P6 幂等：成功后重试 → 已同步（noop）不制造空提交；无账本的重复确认完成被状态机拒绝、不重放业务操作', async () => {
  const root = mkProject('p6');
  const dataDir = core.dataDirFrom(root);
  const item = mkInProgressItem(dataDir, '幂等单');
  commitItemBaseline(root, dataDir, item.id);
  const { server, port } = await bootServer(root);
  try {
    const r1 = await req(port, 'POST', `/api/item/${item.id}/status`, { to: 'done' });
    assert.equal(r1.json.mgtCommit.status, 'committed');
    const before = subjectsOn(root, 'HEAD', item.id).length;
    // 重复确认完成：状态机拒绝（业务操作不重放）
    const r2 = await req(port, 'POST', `/api/item/${item.id}/status`, { to: 'done' });
    assert.equal(r2.status, 403, '已完成条目再次确认完成应被状态机拒绝');
    // 重试只补交管理记录：全部已入库 → noop
    const rt = await req(port, 'POST', '/api/mgt-commit/retry', { kind: 'item', id: item.id });
    assert.equal(rt.status, 200);
    assert.equal(rt.json.mgtCommit.status, 'noop', '无新变化应视为已同步');
    assert.equal(subjectsOn(root, 'HEAD', item.id).length, before, '不得制造空提交或重复提交');
  } finally {
    server.kill();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ---------- P7 失败反馈与重试（身份缺失 → 持久可见 → 重试成功清除） ----------

t('P7 失败与重试：身份缺失 → failed 带原因 / 未提交文件 / 建议，条目保持 done；账本持久化刷新仍可见；重试只补交管理记录并清除失败提示', async () => {
  const root = mkProject('p7');
  const dataDir = core.dataDirFrom(root);
  const item = mkInProgressItem(dataDir, '失败重试单');
  commitItemBaseline(root, dataDir, item.id);
  // 抹掉可用身份：user.useConfigOnly=true 且无 user.name/email（git 不再自动探测，
  // commit 以「请告知你是谁」失败）→ 服务端管理提交失败
  git(root, ['config', '--unset', 'user.email']);
  git(root, ['config', '--unset', 'user.name']);
  git(root, ['config', 'user.useConfigOnly', 'true']);
  // 全局 / 系统配置对服务进程置空（本机全局可能已有身份）：只剩「本地无身份 + 禁止自动探测」
  const { server, port } = await bootServer(root, {
    env: { GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' },
  });
  try {
    const r = await req(port, 'POST', `/api/item/${item.id}/status`, { to: 'done' });
    assert.equal(r.json.status, 'done', '业务操作成功不受提交失败影响');
    const mgt = r.json.mgtCommit;
    assert.equal(mgt.status, 'failed');
    assert.ok(mgt.reason && mgt.reason.length > 0, '失败原因应可识别');
    assert.ok(mgt.files.length && mgt.files.some((f) => f.path.endsWith('status.json')), '应列出未提交文件');
    assert.ok(mgt.advice, '应携带处理建议');
    assert.equal(subjectsOn(root, 'HEAD', item.id).length, 0, '失败时不得产生提交');
    // 账本持久化：详情接口（等价页面刷新 / 服务重启后）仍可见失败提示
    const d1 = await req(port, 'GET', `/api/item/${item.id}`);
    assert.equal(d1.json.mgtCommit.status, 'failed', '失败提示刷新后仍可见');

    // 补齐身份后重试：只补交管理记录（不重放确认完成），成功后清除失败提示
    git(root, ['config', 'user.email', 't@example.com']);
    git(root, ['config', 'user.name', 't']);
    git(root, ['config', '--unset', 'user.useConfigOnly']);
    const rt = await req(port, 'POST', '/api/mgt-commit/retry', { kind: 'item', id: item.id });
    assert.equal(rt.status, 200);
    assert.equal(rt.json.mgtCommit.status, 'committed', `重试应成功：${JSON.stringify(rt.json).slice(0, 200)}`);
    assert.equal(rt.json.mgtCommit.subject, `doc: 人工确认完成 ${item.id}`);
    assert.equal(subjectsOn(root, 'HEAD', item.id).length, 1, '只补一次管理提交');
    const d2 = await req(port, 'GET', `/api/item/${item.id}`);
    assert.equal(d2.json.mgtCommit.status, 'committed', '重试成功后失败提示被清除');
    assert.ok(!git(root, ['status', '--porcelain', '-uall']).stdout.includes(item.id), '管理文件不再遗留');
  } finally {
    server.kill();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ---------- P8 CLI 可识别结果 ----------

t('P8 CLI：atb status done --json 携带 mgtCommit；atb mgt retry 补交并输出结果', async () => {
  const root = mkProject('p8');
  const dataDir = core.dataDirFrom(root);
  const item = mkInProgressItem(dataDir, 'CLI 结果单');
  commitItemBaseline(root, dataDir, item.id);
  const r = atb(['status', item.id, 'done', '--json'], root);
  assert.equal(r.code, 0, `CLI 应成功：${r.err}`);
  const st = jsonOfAtb(r);
  assert.equal(st.status, 'done');
  assert.equal(st.mgtCommit.status, 'committed', 'CLI 结果应可识别提交状态');
  assert.equal(st.mgtCommit.subject, `doc: 人工确认完成 ${item.id}`);
  assert.match(r.out, /管理记录已提交/, '人读输出应提示管理记录提交结果');
  assert.equal(subjectsOn(root, 'HEAD', item.id).length, 1);

  // CLI 重试：人为制造未入库（回退提交）后经 mgt retry 补交
  git(root, ['reset', '-q', '--soft', 'HEAD~1']);
  const rt = atb(['mgt', 'retry', 'item', item.id, '--json'], root);
  assert.equal(rt.code, 0, `重试应成功：${rt.err}`);
  assert.equal(jsonOfAtb(rt).mgtCommit.status, 'committed');
  assert.equal(subjectsOn(root, 'HEAD', item.id).length, 1, '重试补交后说明仍带单号');
  // 无账目可重试时明确报错
  const none = atb(['mgt', 'retry', 'item', 'REQ-19990101-001'], root);
  assert.notEqual(none.code, 0, '无可重试记录应非零退出');
});

// ---------- P9 串行与非 git 边界 ----------

t('P9 边界：管理提交经文件锁串行（锁被占返回明确 failed）；非 git 项目 skipped 不影响业务流转', async () => {
  const root = mkProject('p9');
  const dataDir = core.dataDirFrom(root);
  const item = mkInProgressItem(dataDir, '锁与非 git 单');
  commitItemBaseline(root, dataDir, item.id);
  const { server, port } = await bootServer(root);
  try {
    // 先确认完成（产生可重试账本），再人为占住管理提交锁 → 重试应明确失败
    const r = await req(port, 'POST', `/api/item/${item.id}/status`, { to: 'done' });
    assert.equal(r.json.mgtCommit.status, 'committed');
    git(root, ['reset', '-q', '--soft', 'HEAD~1']); // 制造待补交状态
    const lockDir = path.join(dataDir, '.locks');
    fs.mkdirSync(lockDir, { recursive: true });
    fs.writeFileSync(path.join(lockDir, 'mgt-git-write.lock'), JSON.stringify({ owner: 'other', at: new Date().toISOString() }));
    const busy = await req(port, 'POST', '/api/mgt-commit/retry', { kind: 'item', id: item.id });
    assert.equal(busy.json.mgtCommit.status, 'failed');
    assert.ok(busy.json.mgtCommit.reason.includes('锁'), '锁冲突应可识别');
    fs.rmSync(path.join(lockDir, 'mgt-git-write.lock'), { force: true });
    const okr = await req(port, 'POST', '/api/mgt-commit/retry', { kind: 'item', id: item.id });
    assert.equal(okr.json.mgtCommit.status, 'committed');
  } finally {
    server.kill();
    fs.rmSync(root, { recursive: true, force: true });
  }

  // 非 git 项目：业务流转不受影响，mgt 返回 skipped（ initData 本身会建仓——移除 .git 构造）
  const plain = mkTmp('p9nogit');
  core.initData(plain);
  fs.rmSync(path.join(plain, '.git'), { recursive: true, force: true });
  const dataDir2 = core.dataDirFrom(plain);
  const item2 = mkInProgressItem(dataDir2, '非 git 单');
  const { server: s2, port: p2 } = await bootServer(plain);
  try {
    const r = await req(p2, 'POST', `/api/item/${item2.id}/status`, { to: 'done' });
    assert.equal(r.status, 200);
    assert.equal(r.json.status, 'done', '非 git 项目确认完成不受影响');
    assert.equal(r.json.mgtCommit.status, 'skipped', '应明确返回 skipped 而非伪装成功');
    assert.ok(r.json.mgtCommit.reason);
  } finally {
    s2.kill();
    fs.rmSync(plain, { recursive: true, force: true });
  }
});

// ---------- P10 前端源契约 ----------

t('P10 前端：两入口渲染管理记录提交反馈块，失败含原因 / 文件 / 建议 / 重试按钮并绑定 /api/mgt-commit/retry；样式沿用主题变量', () => {
  const app = fs.readFileSync(path.join(pluginRoot, 'scripts', 'web', 'app.js'), 'utf8');
  const build = fs.readFileSync(path.join(pluginRoot, 'scripts', 'web', 'build.js'), 'utf8');
  const css = fs.readFileSync(path.join(pluginRoot, 'scripts', 'web', 'style.css'), 'utf8');

  assert.match(app, /mgtCommit/, '条目详情应使用 mgtCommit 数据');
  assert.match(app, /管理记录提交/, '应渲染「管理记录提交」反馈块');
  assert.match(app, /data-mgt-retry/, '重试按钮应有可绑定标记');
  assert.match(app, /api\/mgt-commit\/retry/, '重试应调用补交接口');
  assert.match(app, /提交中/, '提交中应显示进度提示');
  assert.match(build, /mgtCommit/, '版本详情应使用 mgtCommit 数据');
  assert.match(build, /管理记录提交/, '版本合并结果区应渲染反馈块');
  assert.match(build, /api\/mgt-commit\/retry/, '版本侧重试应调用补交接口');
  assert.match(css, /\.mgt\b/, '反馈块样式类');
  assert.match(css, /\.mgt\.(failed|submitting|success)/, '状态化样式');
  assert.match(css, /\.mgt[^{]*\{[^}]*(--ok|--warn|--inprogress)/, '样式应沿用现有主题变量');
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
