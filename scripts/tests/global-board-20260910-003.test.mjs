#!/usr/bin/env node
// REQ-20260910-003 全局任务看板集成测试 —— 真实起 server（随机端口 + 临时注册表 + 多临时项目）
// 用法：node scripts/tests/global-board-20260910-003.test.mjs
// 覆盖 test-cases.md 的 G1–G7（G6/G7 为前端静态契约；浏览器交互按验收标准人工核对）。

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as core from '../lib/core.mjs';
import * as batch from '../lib/batch.mjs';
import * as refine from '../lib/refine-store.mjs';

const __http = http;

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

// ---------- 测试环境 ----------

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'atb-globalboard-'));
// macOS 下 /var 是 /private/var 的符号链接，server 会做 realpath，测试路径需对齐
const mkProj = (name) => {
  fs.mkdirSync(path.join(tmp, name), { recursive: true });
  return fs.realpathSync(path.join(tmp, name));
};
const projDev = mkProj('projDev');       // 批量开发：1 执行中 + 1 排队中
const projRefine = mkProj('projRefine'); // 批量完善：1 执行中
const projClean = mkProj('projClean');   // 已初始化、无批次
const projUninit = mkProj('projUninit'); // 未初始化（无数据目录）
const projFin = mkProj('projFin');       // 已终止 + 已结束批次（均不应出现）
const projCorrupt = mkProj('projCorrupt'); // 批次账本 JSON 损坏
const projGone = mkProj('projGone');     // 注册后删除目录

const registryFile = path.join(tmp, 'projects.json');
fs.writeFileSync(registryFile, JSON.stringify({
  version: 1,
  projects: [projDev, projRefine, projClean, projUninit, projFin, projCorrupt, projGone],
}, null, 2));

const plannedItem = (dataDir, title) => {
  const st = core.createItem(dataDir, { type: 'requirement', title, description: 'x', by: 'test' });
  core.setStatus(dataDir, st.id, 'accepted', { by: 'test' });
  core.setStatus(dataDir, st.id, 'planned', { by: 'test' });
  return st;
};

// projDev：3 个已计划条目 → 批次1（2 项）+ 批次2（1 项，排队中），再领取批次1 一项转执行中
//（顺序注意：领取会实时吸收新置计划条目进当前批次，须先建齐批次再领取）
const devDir = core.dataDirFrom(projDev) || core.initData(projDev);
const devA = plannedItem(devDir, '开发条目 A');
const devB = plannedItem(devDir, '开发条目 B');
const devC = plannedItem(devDir, '开发条目 C');
const devBatch1 = batch.createBatch(devDir, { ids: [devA.id, devB.id], projectRoot: projDev, developer: '张三' }); // developer 为遗留入参（REQ-20260910-027 起忽略）
const devBatch2 = batch.createBatch(devDir, { ids: [devC.id], projectRoot: projDev });
const devClaim = batch.nextItem(devDir, devBatch1.batch.batchId, { owner: 'zcode-batch-028-1' });

// projRefine：1 个已接受条目 → 完善批次（领取 1 项转执行中）
const rfDir = core.dataDirFrom(projRefine) || core.initData(projRefine);
const rfItem = core.createItem(rfDir, { type: 'requirement', title: '完善条目 R', description: 'y', by: 'test' });
core.setStatus(rfDir, rfItem.id, 'accepted', { by: 'test' });
const rfBatch = refine.createRefineBatch(rfDir, { projectRoot: projRefine, developer: '李四' });
const rfClaim = refine.nextRefineItem(rfDir, rfBatch.batch.batchId, { owner: 'refine-022-3' });

// projClean：初始化但无批次
core.initData(projClean);

// projFin：批次1 人工终止（aborted + finished）；批次2 直接落 finished——均不进全局聚合
const finDir = core.dataDirFrom(projFin) || core.initData(projFin);
const finItem = plannedItem(finDir, '收尾条目 F');
const finBatch1 = batch.createBatch(finDir, { ids: [finItem.id], projectRoot: projFin });
batch.abortBatch(finDir, finBatch1.batch.batchId);
const finBatch2 = batch.createBatch(finDir, { ids: [finItem.id], projectRoot: projFin });
const finB2Path = path.join(finDir, 'dispatch', 'batches', finBatch2.batch.batchId, 'batch.json');
const finB2 = JSON.parse(fs.readFileSync(finB2Path, 'utf8'));
finB2.status = 'finished';
fs.writeFileSync(finB2Path, JSON.stringify(finB2, null, 2));

// projCorrupt：批次账本 JSON 损坏（listBatches 会静默跳过，聚合须显式报该项目读取失败）
const corDir = core.dataDirFrom(projCorrupt) || core.initData(projCorrupt);
const corBatchDir = path.join(corDir, 'dispatch', 'batches', 'batch-20990909-001');
fs.mkdirSync(corBatchDir, { recursive: true });
fs.writeFileSync(path.join(corBatchDir, 'batch.json'), '{oops');

// projGone：注册后删除目录
fs.rmSync(projGone, { recursive: true, force: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let serverProc = null;
let base = '';

async function tryStartServer(port) {
  const proc = spawn(process.execPath, [path.join(pluginRoot, 'scripts', 'server.mjs')], {
    cwd: projDev,
    env: { ...process.env, ATB_PORT: String(port), ATB_REGISTRY: registryFile },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let err = '';
  proc.stderr.on('data', (c) => { err += c; });
  for (let i = 0; i < 30; i++) {
    await sleep(200);
    try {
      const r = await request('GET', `http://127.0.0.1:${port}/api/health`);
      if (r.status === 200) return { proc, base: `http://127.0.0.1:${port}` };
    } catch {}
    if (proc.exitCode !== null) throw new Error(`server 提前退出: ${err}`);
  }
  proc.kill();
  throw new Error(`server 启动超时: ${err}`);
}

function request(method, url, body) {
  const http = __http;
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = http.request(
      { hostname: u.hostname, port: u.port, path: u.pathname + u.search, method, headers: body ? { 'Content-Type': 'application/json' } : {} },
      (res) => {
        let data = '';
        res.on('data', (c) => { data += c; });
        res.on('end', () => {
          let json = {};
          try { json = JSON.parse(data || '{}'); } catch {}
          resolve({ status: res.statusCode, json });
        });
      }
    );
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function get(url, expect = 200) {
  const r = await request('GET', url);
  assert.equal(r.status, expect, `GET ${url} → ${r.status}（期望 ${expect}）：${JSON.stringify(r.json)}`);
  return r.json;
}

// ---------- 用例 ----------

const cases = [];
const t = (name, fn) => cases.push([name, fn]);
let global1 = null;
const projRow = (root) => global1.projects.find((p) => p.root === root);

t('G1 聚合全部注册项目：开发 + 完善批次字段口径与面板一致', async () => {
  global1 = await get(`${base}/api/batch/global`);
  assert.equal(global1.ok, true);
  assert.ok(Array.isArray(global1.projects), 'projects 应为数组');
  assert.equal(global1.projects.length, 7, '注册表 7 个项目均应有行');

  const devRow = projRow(projDev);
  assert.equal(devRow.status, 'ok');
  assert.equal(devRow.name, 'projDev');
  const devTasks = devRow.tasks;
  assert.equal(devTasks.length, 2, 'projDev 应有 2 个在工作批次（执行中 + 排队中）');
  const t1 = devTasks.find((x) => x.batchId === devBatch1.batch.batchId);
  assert.ok(t1, '批次1 应出现在全局聚合');
  assert.equal(t1.kind, 'develop');
  assert.equal(t1.status, 'running');
  assert.equal('developer' in t1, false, 'REQ-20260910-027：brief 不再透出 developer');
  assert.equal(t1.counts.total, 2);
  assert.equal(t1.counts.remaining, 2, '在途项未上报仍计入待处理（与面板 taskStatsLine 同口径）');
  assert.equal(t1.counts.reported, 0);
  assert.ok(t1.createdAt && t1.lastActivityAt, '应带创建与最后活动时间');
  assert.ok(t1.current, '执行中批次应有当前条目');
  assert.equal(t1.current.itemId, devClaim.itemId);
  assert.equal(t1.current.owner, 'zcode-batch-028-1');
  assert.equal(t1.current.title, '开发条目 A');

  const rfRow = projRow(projRefine);
  assert.equal(rfRow.status, 'ok');
  assert.equal(rfRow.tasks.length, 1);
  const rt = rfRow.tasks[0];
  assert.equal(rt.kind, 'refine');
  assert.equal(rt.batchId, rfBatch.batch.batchId);
  assert.equal(rt.status, 'running');
  assert.equal('developer' in rt, false, 'REQ-20260910-027：brief 不再透出 developer');
  assert.equal(rt.current.itemId, rfClaim.itemId);
  assert.equal(rt.current.owner, 'refine-022-3');
  assert.equal(rt.counts.total, 1);
  assert.equal(rt.counts.done, 0);
});

t('G2 已结束 / 已终止批次不出现；接口与 ?project= 无关', async () => {
  const finRow = projRow(projFin);
  assert.equal(finRow.status, 'ok');
  assert.equal(finRow.tasks.length, 0, '已终止（aborted）与已结束（finished）批次均不应出现');
  // 聚合接口与项目参数无关：带任意 project 参数不 400、结果一致
  const withParam = await get(`${base}/api/batch/global?project=${encodeURIComponent('/not/a/real/project')}`);
  assert.equal(withParam.projects.length, 7, 'project 参数不应影响全局聚合');
});

t('G3 未初始化 / 无批次项目按「无任务」返回（不报错）', async () => {
  const uninit = projRow(projUninit);
  assert.equal(uninit.status, 'ok', '未初始化项目应按无任务处理而非报错');
  assert.deepEqual(uninit.tasks, []);
  const clean = projRow(projClean);
  assert.equal(clean.status, 'ok');
  assert.deepEqual(clean.tasks, []);
});

t('G4 单项目读盘失败只影响该项目行', async () => {
  const gone = projRow(projGone);
  assert.equal(gone.status, 'error', '目录不存在的项目应为 error 行');
  assert.ok(typeof gone.error === 'string' && gone.error.includes('不存在'), `error 原因应说明目录不存在，得到：${gone.error}`);
  const corrupt = projRow(projCorrupt);
  assert.equal(corrupt.status, 'error', '账本 JSON 损坏的项目应为 error 行');
  assert.ok(typeof corrupt.error === 'string' && corrupt.error.length > 0, 'error 行应带原因');
  // 其他项目不受影响
  assert.equal(projRow(projDev).status, 'ok');
  assert.equal(projRow(projRefine).status, 'ok');
});

t('G5 非队首 prepared 批次标 queued=true；pauseRequested 如实透出', async () => {
  const devRow = projRow(projDev);
  const t2 = devRow.tasks.find((x) => x.batchId === devBatch2.batch.batchId);
  assert.ok(t2, '排队批次应出现');
  assert.equal(t2.status, 'prepared');
  assert.equal(t2.queued, true, '非队首 prepared 批次应标记排队中');
  assert.equal(t2.current, null, '排队批次无当前条目');
  const t1 = devRow.tasks.find((x) => x.batchId === devBatch1.batch.batchId);
  assert.equal(t1.queued, false, '队首批次不是排队中');
  assert.equal(t1.pauseRequested, false, 'pauseRequested 字段应存在且如实');
});

t('G6 前端静态契约：顶栏入口 + 右侧面板 / 拉取 / 跳转 / 样式（BUG-20260910-004 改造后）', () => {
  const html = fs.readFileSync(path.join(pluginRoot, 'scripts', 'web', 'index.html'), 'utf8');
  const js = fs.readFileSync(path.join(pluginRoot, 'scripts', 'web', 'app.js'), 'utf8');
  const css = fs.readFileSync(path.join(pluginRoot, 'scripts', 'web', 'style.css'), 'utf8');
  assert.match(html, /id="btnGlobal"/, '顶栏应有「全局」入口按钮（管理项目右侧）');
  assert.match(html, /id="globalPanel"/, '应有 #globalPanel 侧边面板容器');
  assert.match(js, /const VIEWS = \['status', 'oncall', 'runs', 'files', 'marketing', 'release', 'settings'\]/, 'VIEWS 不再含 global（BUG-20260910-004：非主视图；REQ-20260910-019 增 marketing）');
  assert.match(js, /function openGlobalPanel\(/, '应有 openGlobalPanel 面板开合');
  assert.match(js, /function refreshGlobal\(/, '应有 refreshGlobal 数据拉取');
  assert.match(js, /function renderGlobalView\(/, '应有 renderGlobalView 渲染');
  assert.match(js, /if \(state\.global\.open\) await refreshGlobal\(\)/, '主轮询应随面板打开联动全局数据');
  assert.match(js, /gotoRuns\(/, '任务跳转应复用 gotoRuns 进入对应项目任务模块');
  assert.match(js, /switchProject\(/, '跳转应切换顶栏项目（switchProject）');
  assert.match(css, /\.global-panel/, '样式应有 .global-panel（双主题 CSS 变量）');
});

t('G7 前端分支契约：空态 / 引导 / 错误行 / 筛选 / 快照', () => {
  const js = fs.readFileSync(path.join(pluginRoot, 'scripts', 'web', 'app.js'), 'utf8');
  assert.match(js, /无注册项目/, '无注册项目应有引导空态');
  assert.match(js, /均已收尾|无在工作的批量任务/, '全部收尾应有空态说明');
  assert.match(js, /读取失败/, '项目读取失败应有错误行文案');
  assert.match(js, /data-ggoto-runs|data-ggoto-item|globalGoto/, '任务行 / 条目编号应有跳转挂点');
  assert.match(js, /globalStatus/, '全局状态筛选应有独立状态键');
  assert.match(js, /globalKind/, '全局类型筛选应有独立状态键');
});

// ---------- 执行 ----------
let failed = 0;
try {
  for (let port of [27836, 28036, 28236]) {
    try {
      const r = await tryStartServer(port);
      serverProc = r.proc;
      base = r.base;
      break;
    } catch (e) {
      if (port === 28236) throw e;
    }
  }
  assert.ok(base, 'server 未能在候选端口启动');
  for (const [name, fn] of cases) {
    try {
      await fn();
      console.log(`✓ ${name}`);
    } catch (e) {
      failed++;
      console.error(`✗ ${name}\n    ${String(e.message).split('\n')[0]}`);
    }
  }
} finally {
  if (serverProc) serverProc.kill();
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
}
console.log(failed ? `\n${failed} 个用例未通过` : '\n全部通过');
process.exit(failed ? 1 : 0);
