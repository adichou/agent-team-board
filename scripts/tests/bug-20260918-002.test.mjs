#!/usr/bin/env node
// BUG-20260918-002 需求/bug点击完成不应该触发管理记录提交 —— 确认完成只做状态流转
// 用法：node scripts/tests/bug-20260918-002.test.mjs
// 覆盖（见条目 README 期望行为 / design.md 定案）：
//   · 网页端确认完成（in-progress → done，含 hold 闭环刷新 decisions.md）：不采集基线、
//     不执行任何 git add/commit，响应与条目详情均不带 mgtCommit，留痕文档留在工作区，
//     runtime/commits/mgt/ 账本不再写入；非 git 项目同样只做状态流转；
//   · 连带通道下线：POST /api/mgt-commit/retry 404；CLI `atb mgt retry` 非零退出；
//     `atb status <ID> done` 输出不含管理记录提交相关行、--json 不含 mgtCommit；
//   · 防呆不回退：待人工决策未答项拦截（无 force 报错、force 放行）与
//     驳回完成（done → in-progress）行为保持；
//   · 前端与文案收敛：app.js / build.js 无反馈块与重试绑定，style.css 无 .mgt 样式，
//     i18n 词典无管理记录提交词条（EN / EN_DYNAMIC 双语同步移除），
//     scripts/lib/mgt-commit.mjs 模块删除、server.mjs / atb.mjs 无引用。
// 模式对齐 mgt-auto-commit-20260914-007（真实 git 临时仓库 + HTTP 服务）。

import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as core from '../lib/core.mjs';
import * as holdStore from '../lib/hold-store.mjs';
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
  const reg = path.join(os.tmpdir(), `atb-bug18-002-reg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.json`);
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
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), `atb-bug18-002-${tag}-`)));
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

// 条目推进到 in-progress 并把条目目录入库（干净基线）；holdAnswered=true 时补一轮
// 已作答的待人工决策（decisions.md 随闭环在确认完成时再次刷新——旧机制的可提交内容来源）
function mkInProgressItem(dataDir, title, { holdAnswered = false, holdOpen = false } = {}) {
  const x = core.createItem(dataDir, { type: 'requirement', title });
  core.setStatus(dataDir, x.id, 'accepted', { by: 'human' });
  core.setStatus(dataDir, x.id, 'planned', { by: 'human' });
  core.claim(dataDir, x.id, 'w1');
  if (holdAnswered || holdOpen) {
    holdStore.declareHold(dataDir, x.id, { questions: ['口径确认？'], reason: '确认', by: 'w1' });
    if (holdAnswered) {
      holdStore.answerHold(dataDir, x.id, { answers: [{ q: 'q1', text: '按本单口径' }], by: 'human' });
    }
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

// ---------- B1 网页端确认完成：只做状态流转，不触发任何 git 提交 ----------

t('B1 网页端确认完成不提交：响应/详情无 mgtCommit、HEAD 不变、留痕留在工作区、账本不写、非 git 项目同口径', async () => {
  const root = mkProject('b1');
  const dataDir = core.dataDirFrom(root);
  const item = mkInProgressItem(dataDir, '确认完成不再提交', { holdAnswered: true });
  commitItemBaseline(root, dataDir, item.id);
  const headBefore = headOf(root);

  const { server, port } = await bootServer(root);
  try {
    const r = await req(port, 'POST', `/api/item/${item.id}/status`, { to: 'done' });
    assert.equal(r.status, 200, `确认完成应成功：${JSON.stringify(r.json)}`);
    assert.equal(r.json.status, 'done', '业务状态流转成功');
    assert.equal(r.json.mgtCommit, undefined, '响应不应再携带 mgtCommit 提交结果');
    assert.equal(headOf(root), headBefore, '不得产生任何 git 提交（含 doc: 人工确认完成）');
    assert.equal(subjectsOn(root, 'HEAD', item.id).length, 0, '提交说明不得出现单号');
    // 留痕文档留在工作区（随既有通道入库），不遗留账本
    const st = git(root, ['status', '--porcelain', '-uall']).stdout;
    assert.ok(st.includes(`${item.id}/decisions.md`), '闭环刷新的 decisions.md 应留在工作区待既有通道入库');
    assert.ok(!fs.existsSync(mgtStateFile(dataDir, item.id)), 'runtime/commits/mgt/ 账本不应再写入');
    const detail = await req(port, 'GET', `/api/item/${item.id}`);
    assert.equal(detail.status, 200);
    assert.equal(detail.json.mgtCommit, undefined, '条目详情不应附带管理记录提交状态');
    // 重试接口随入口一并下线（未知接口统一 404）
    const rt = await req(port, 'POST', '/api/mgt-commit/retry', { kind: 'item', id: item.id });
    assert.equal(rt.status, 404, 'POST /api/mgt-commit/retry 应已下线');
  } finally {
    server.kill();
    fs.rmSync(root, { recursive: true, force: true });
  }

  // 非 git 项目：确认完成同样只做状态流转（不再有 skipped 管理提交结果）
  const plain = mkTmp('b1nogit');
  core.initData(plain);
  fs.rmSync(path.join(plain, '.git'), { recursive: true, force: true });
  const dataDir2 = core.dataDirFrom(plain);
  const item2 = mkInProgressItem(dataDir2, '非 git 确认完成');
  const { server: s2, port: p2 } = await bootServer(plain);
  try {
    const r = await req(p2, 'POST', `/api/item/${item2.id}/status`, { to: 'done' });
    assert.equal(r.status, 200);
    assert.equal(r.json.status, 'done');
    assert.equal(r.json.mgtCommit, undefined, '非 git 项目也不应携带管理提交结果');
  } finally {
    s2.kill();
    fs.rmSync(plain, { recursive: true, force: true });
  }
});

// ---------- B2 CLI 口径 ----------

t('B2 CLI：atb status done 无管理记录输出与 mgtCommit 字段、不产生提交；atb mgt retry 已下线', async () => {
  const root = mkProject('b2');
  const dataDir = core.dataDirFrom(root);
  const item = mkInProgressItem(dataDir, 'CLI 不再提交', { holdAnswered: true });
  commitItemBaseline(root, dataDir, item.id);
  const headBefore = headOf(root);

  const r = atb(['status', item.id, 'done', '--json'], root);
  assert.equal(r.code, 0, `CLI 应成功：${r.err}`);
  const st = jsonOfAtb(r);
  assert.equal(st.status, 'done');
  assert.equal(st.mgtCommit, undefined, '--json 输出不应包含 mgtCommit');
  assert.ok(!r.out.includes('管理记录'), `人读输出不应含管理记录提交相关行：${r.out}`);
  assert.equal(headOf(root), headBefore, 'CLI 确认完成不得产生提交');

  const rt = atb(['mgt', 'retry', 'item', item.id], root);
  assert.notEqual(rt.code, 0, 'atb mgt retry 子命令应已下线（非零退出）');
});

// ---------- B3 防呆与回退回归（不回退既有保护） ----------

t('B3 防呆回归：未答决策无 force 拦截、force 放行完成；驳回完成 done → in-progress 正常', async () => {
  const root = mkProject('b3');
  const dataDir = core.dataDirFrom(root);
  const item = mkInProgressItem(dataDir, '防呆回归单', { holdOpen: true });
  const { server, port } = await bootServer(root);
  try {
    const no = await req(port, 'POST', `/api/item/${item.id}/status`, { to: 'done' });
    assert.equal(no.status, 400, '未答决策且无 force 应被拦截');
    assert.ok(String(no.json.error || '').includes('人工决策未答'), '拦截原因应指向待人工决策');
    const yes = await req(port, 'POST', `/api/item/${item.id}/status`, { to: 'done', force: true });
    assert.equal(yes.status, 200, `force 放行应成功：${JSON.stringify(yes.json)}`);
    assert.equal(yes.json.status, 'done');
    assert.equal(yes.json.mgtCommit, undefined);
    // 驳回完成（done → in-progress）不受影响
    const back = await req(port, 'POST', `/api/item/${item.id}/status`, { to: 'in-progress' });
    assert.equal(back.status, 200, `驳回完成应成功：${JSON.stringify(back.json)}`);
    assert.equal(back.json.status, 'in-progress');
  } finally {
    server.kill();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ---------- B4 前端 / 文案 / 模块下线契约 ----------

t('B4 前端与模块契约：反馈块/重试/样式/词典/模块全面收敛', () => {
  const read = (p) => fs.readFileSync(path.join(pluginRoot, p), 'utf8');
  const app = read('scripts/web/app.js');
  const build = read('scripts/web/build.js');
  const css = read('scripts/web/style.css');
  const i18nSrc = read('scripts/web/i18n.js');
  const serverSrc = read('scripts/server.mjs');
  const atbSrc = read('scripts/atb.mjs');

  assert.ok(!app.includes('mgtCommit'), 'app.js 不应再使用 mgtCommit 数据');
  assert.ok(!app.includes('管理记录提交'), 'app.js 不应渲染「管理记录提交」反馈块');
  assert.ok(!app.includes('data-mgt-retry'), 'app.js 不应再有重试按钮绑定标记');
  assert.ok(!app.includes('/api/mgt-commit/retry'), 'app.js 不应再调用补交接口');
  assert.ok(!build.includes('mgtCommit'), 'build.js 不应再使用 mgtCommit 数据');
  assert.ok(!build.includes('管理记录提交'), 'build.js 版本侧反馈块应随死代码清除');
  assert.ok(!build.includes('/api/mgt-commit/retry'), 'build.js 不应再调用补交接口');
  assert.ok(!/\.mgt\b/.test(css), 'style.css 应移除 .mgt 反馈块样式');
  assert.ok(!serverSrc.includes('mgt-commit'), 'server.mjs 不应再引用 mgt-commit 模块/接口');
  assert.ok(!atbSrc.includes('mgt'), 'atb.mjs 不应再含 mgt 子命令/引用');
  assert.ok(!fs.existsSync(path.join(pluginRoot, 'scripts', 'lib', 'mgt-commit.mjs')), 'scripts/lib/mgt-commit.mjs 应删除');

  // i18n 双语同步移除：静态与动态词条均不再保留（import 后查真实词典）
  const I = globalThis.ATBI18N;
  assert.ok(I, 'i18n.js 应在 globalThis.ATBI18N 暴露接口');
  const { EN, EN_DYNAMIC } = I._dict;
  for (const k of [
    '管理记录提交：提交中…', '✓ 管理记录提交：', '✓ 管理记录提交：已同步 · 无新变化',
    '⚠ 操作已成功，管理记录提交失败', '管理记录未自动提交', '已提交 ·', '提交说明：',
    '未提交文件：', '建议：', '重试提交', '本次操作没有新的管理变更，不制造空提交。',
    '正在提交本次操作更新的管理记录（路径限定提交，不使用全量 git add）…',
    '失败提示已持久化：刷新页面后仍可见，重试成功后清除。',
  ]) {
    assert.ok(!(k in EN), `EN 静态词条应移除：${k}`);
    assert.ok(!(k in EN_DYNAMIC), `EN_DYNAMIC 不应残留：${k}`);
  }
  for (const k of ['⚠ 操作已成功，管理记录提交失败：◇', '重试提交失败：◇', '原因：◇', '建议：◇', '（◇ 个分支：◇）']) {
    assert.ok(!(k in EN_DYNAMIC), `EN_DYNAMIC 动态词条应移除：${k}`);
  }
  assert.ok(!i18nSrc.includes('管理记录'), 'i18n.js 源中管理记录相关文案应清理');
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
