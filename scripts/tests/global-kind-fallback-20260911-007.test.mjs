#!/usr/bin/env node
// BUG-20260911-007 全局任务面板 kind 兜底 —— 集成测试
// 现象：汇总按 status 计数（不看 kind）显示「执行中 1」，类型筛选按 t.kind 裸比对外来/旧口径
// 简报（kind 缺失或未知，如常驻服务进程旧于前端——BUG-20260907-017 同型机制）时 0 匹配，
// 任务行从所有筛选档位下静默消失。
// 修复口径（前端兜底）：kind 缺失/未知时按批次号前缀推断（RFB-→refine、CMT-→commit、
// batch-→develop），推不出归 unknown（中性徽标「未知类型」，至少在「全部类型」档可见），
// 行内留诊断 flag 并提示重启看板服务；计数行、跳转挂点同用兜底 kind。
// 覆盖：K1 推断矩阵（行为，提取 app.js 纯函数求值）/ K2 计数行兜底（行为）/
// K3 筛选与渲染契约（静态）/ K4 服务端现行主路径不回归（真实起 server）。
// 用法：node scripts/tests/global-kind-fallback-20260911-007.test.mjs

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as core from '../lib/core.mjs';
import * as refine from '../lib/refine-store.mjs';

const __http = http;

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const appJs = fs.readFileSync(path.join(pluginRoot, 'scripts', 'web', 'app.js'), 'utf8');

// ---------- 从 app.js 提取纯函数 / 常量（前端无 DOM 测试基建，行为用例经提取求值覆盖） ----------

// 括号配对截取（函数体 / 常量字面量均按深度配对，字符串内不含未配对括号字符）
function extractBlock(startMarker, open, close) {
  const start = appJs.indexOf(startMarker);
  assert.ok(start >= 0, `app.js 应包含 ${startMarker.trim()}`);
  let i = appJs.indexOf(open, start);
  let depth = 0;
  for (; i < appJs.length; i++) {
    if (appJs[i] === open) depth++;
    else if (appJs[i] === close) {
      depth--;
      if (depth === 0) return appJs.slice(start, i + 1);
    }
  }
  assert.fail(`无法截取 ${startMarker.trim()}：括号未配对`);
}

const extractFn = (name) => extractBlock(`function ${name}(`, '{', '}');
const extractConst = (name) => {
  const m = appJs.match(new RegExp(`const ${name} = `));
  assert.ok(m, `app.js 应定义常量 ${name}`);
  const rest = appJs.slice(m.index);
  const openCh = rest[rest.search(/[[{]/)];
  return extractBlock(`const ${name} = `, openCh, openCh === '[' ? ']' : '}') + ';';
};

const evalPure = (src, name) => new Function(`${src} return ${name};`)();

const globalTaskKind = evalPure(
  extractConst('GLOBAL_KIND_LABEL') + extractConst('GLOBAL_KIND_PREFIXES') + extractFn('globalTaskKind'),
  'globalTaskKind',
);
const globalCountsParts = evalPure(
  extractConst('GLOBAL_KIND_LABEL') + extractConst('GLOBAL_KIND_PREFIXES')
  + extractFn('globalTaskKind') + extractFn('globalCountsParts'),
  'globalCountsParts',
);

// ---------- 用例 ----------

const cases = [];
const t = (name, fn) => cases.push([name, fn]);

t('K1 globalTaskKind 推断矩阵：已知原样、缺失/未知按前缀推断、推不出归 unknown 且不静默丢失', () => {
  // 已知词表：原样返回，不标推断
  assert.deepEqual(globalTaskKind({ kind: 'refine', batchId: 'RFB-20260910-023' }), { kind: 'refine', inferred: false });
  assert.deepEqual(globalTaskKind({ kind: 'develop', batchId: 'batch-20260910-005' }), { kind: 'develop', inferred: false });
  // REQ-20260911-010：commit 词表与 CMT- 前缀兜底已随批量 Commit 回退移除——外来 CMT 简报归 unknown
  assert.deepEqual(globalTaskKind({ kind: 'commit', batchId: 'CMT-20260911-001' }), { kind: 'unknown', inferred: true });
  // kind 缺失（旧服务进程口径）：按批次号前缀推断——截图场景 RFB 执行中批次必须仍命中「批量完善」筛选
  assert.deepEqual(globalTaskKind({ batchId: 'RFB-20260910-023' }), { kind: 'refine', inferred: true });
  assert.deepEqual(globalTaskKind({ kind: undefined, batchId: 'CMT-20260911-002' }), { kind: 'unknown', inferred: true });
  assert.deepEqual(globalTaskKind({ kind: null, batchId: 'batch-20260910-001' }), { kind: 'develop', inferred: true });
  // kind 未知取值：同样按前缀兜底（不因词表外取值 0 匹配）
  assert.deepEqual(globalTaskKind({ kind: 'legacy', batchId: 'RFB-20260910-023' }), { kind: 'refine', inferred: true });
  // 前缀也认不出：归 unknown（中性档，至少「全部类型」可见），绝不返回 undefined
  const unk = globalTaskKind({ batchId: 'X-20990101-001' });
  assert.equal(unk.kind, 'unknown');
  assert.equal(unk.inferred, true);
  // 原型链键不得误判为已知词表（kind='toString' 之类不得混过）
  assert.equal(globalTaskKind({ kind: 'toString', batchId: 'X-1' }).kind, 'unknown');
});

t('K2 globalCountsParts 经兜底 kind 分支：缺 kind 的 RFB/CMT 简报按推断类型取计数口径', () => {
  // 缺 kind 的完善简报（RFB 前缀）→ refine 口径：已完成 done
  const rf = globalCountsParts({ batchId: 'RFB-20260910-023', counts: { done: 32, failed: 0, interrupted: 1, remaining: 4, total: 37 } });
  assert.equal(rf.doneLabel, '已完成');
  assert.equal(rf.done, 32);
  assert.equal(rf.abnormal, 1);
  assert.equal(rf.remaining, 4);
  assert.equal(rf.total, 37);
  // REQ-20260911-010：CMT 简报已随批量 Commit 回退移除——外来 CMT 简报按 unknown 归 develop 计数口径（已上报）
  const cm = globalCountsParts({ batchId: 'CMT-20260911-001', counts: { committed: 3, failed: 1, interrupted: 0, remaining: 2, total: 6 } });
  assert.equal(cm.doneLabel, '已上报');
  assert.equal(cm.done, 0);
  assert.equal(cm.abnormal, 1);
  // 已知 kind 不受兜底影响（develop 口径回归：已上报 reported）
  const dv = globalCountsParts({ kind: 'develop', batchId: 'batch-20260910-005', counts: { reported: 2, failed: 0, blocked: 1, interrupted: 0, remaining: 1, total: 4 } });
  assert.equal(dv.doneLabel, '已上报');
  assert.equal(dv.done, 2);
  assert.equal(dv.abnormal, 1);
});

t('K3 渲染契约：类型筛选 / 行徽标 / 跳转挂点走兜底 kind，行内留诊断线索', () => {
  // 类型筛选不得再裸比对 t.kind（本 Bug 的静默丢失机制）
  assert.doesNotMatch(appJs, /t\.kind === g\.kindFilter/, '类型筛选不得直接比对原始 kind');
  assert.match(appJs, /globalTaskKind\(t\)\.kind === g\.kindFilter/, '类型筛选应经 globalTaskKind 兜底后比对');
  // 任务行：跳转挂点与 kind 徽标使用兜底 kind
  assert.match(appJs, /data-ggoto-runs="\$\{esc\(effKind\)\}"/, '任务行跳转挂点应用兜底 kind');
  assert.match(appJs, /GLOBAL_KIND_LABEL\[effKind\] \|\| '未知类型'/, 'kind 徽标应有 unknown 中性文案');
  assert.match(appJs, /类型推断/, '兜底行应有「类型推断」诊断 flag');
  assert.match(appJs, /类型未知/, '推不出的行应有「类型未知」诊断 flag');
  assert.match(appJs, /重启看板服务/, '诊断提示应指引重启看板服务');
  // 汇总行口径保持不看 kind（按 status 计数）——回归保护
  assert.match(appJs, /function globalSummaryText\(projects\)/, '汇总行 globalSummaryText 应保留');
});

// ---------- K4 服务端现行主路径不回归（真实起 server：running 完善批次 brief 必含 kind） ----------

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'atb-globalkind-'));
const mkProj = (name) => {
  fs.mkdirSync(path.join(tmp, name), { recursive: true });
  return fs.realpathSync(path.join(tmp, name));
};
const proj = mkProj('projRf');
const registryFile = path.join(tmp, 'projects.json');
fs.writeFileSync(registryFile, JSON.stringify({ version: 1, projects: [proj] }, null, 2));

const rfDir = core.dataDirFrom(proj) || core.initData(proj);
const rfItem = core.createItem(rfDir, { type: 'requirement', title: '完善条目 K', description: 'z', by: 'test' });
core.setStatus(rfDir, rfItem.id, 'accepted', { by: 'test' });
const rfBatch = refine.createRefineBatch(rfDir, { projectRoot: proj });
const rfClaim = refine.nextRefineItem(rfDir, rfBatch.batch.batchId, { owner: 'refine-023-31' });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let serverProc = null;
let base = '';

function request(method, url) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = __http.request({ hostname: u.hostname, port: u.port, path: u.pathname, method }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        let json = {};
        try { json = JSON.parse(data || '{}'); } catch {}
        resolve({ status: res.statusCode, json });
      });
    });
    req.on('error', reject);
    req.end();
  });
}

t('K4 服务端主路径回归：执行中完善批次聚合返回 kind=refine（口径内必显示的前提）', async () => {
  assert.ok(base, 'server 未启动（前置失败）');
  const r = await request('GET', `${base}/api/batch/global`);
  assert.equal(r.status, 200, `GET /api/batch/global → ${r.status}`);
  const row = r.json.projects.find((p) => p.root === proj);
  assert.ok(row, '项目行应出现');
  assert.equal(row.status, 'ok');
  assert.equal(row.tasks.length, 1, '执行中的完善批次应进入聚合');
  const task = row.tasks[0];
  assert.equal(task.kind, 'refine', '现行服务端 brief 必含 kind=refine');
  assert.equal(task.kindInferred, undefined, '正常路径不得误标推断');
  assert.equal(task.status, 'running');
  assert.equal(task.current.itemId, rfClaim.itemId);
});

// ---------- 执行 ----------
let failed = 0;
try {
  if (cases.length > 4) throw new Error('用例编号漂移：K4 前的用例应全部为同步静态/提取用例');
  // 先跑静态与提取用例（不需要 server）
  for (const [name, fn] of cases.slice(0, 3)) {
    try {
      await fn();
      console.log(`✓ ${name}`);
    } catch (e) {
      failed++;
      console.error(`✗ ${name}\n    ${String(e.message).split('\n')[0]}`);
    }
  }
  if (!failed) {
    for (const port of [28436, 28636, 28836]) {
      try {
        const proc = spawn(process.execPath, [path.join(pluginRoot, 'scripts', 'server.mjs')], {
          cwd: proj,
          env: { ...process.env, ATB_PORT: String(port), ATB_REGISTRY: registryFile },
          stdio: ['ignore', 'pipe', 'pipe'],
        });
        let err = '';
        proc.stderr.on('data', (c) => { err += c; });
        for (let i = 0; i < 30; i++) {
          await sleep(200);
          try {
            const r = await request('GET', `http://127.0.0.1:${port}/api/health`);
            if (r.status === 200) { serverProc = proc; base = `http://127.0.0.1:${port}`; break; }
          } catch {}
          if (proc.exitCode !== null) throw new Error(`server 提前退出: ${err}`);
        }
        if (base) break;
        proc.kill();
        if (port === 28836) throw new Error(`server 启动超时: ${err}`);
      } catch (e) {
        if (port === 28836) throw e;
      }
    }
    for (const [name, fn] of cases.slice(3)) {
      try {
        await fn();
        console.log(`✓ ${name}`);
      } catch (e) {
        failed++;
        console.error(`✗ ${name}\n    ${String(e.message).split('\n')[0]}`);
      }
    }
  } else {
    console.error('（静态/提取用例未全过，跳过 server 用例）');
  }
} finally {
  if (serverProc) serverProc.kill();
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
}
console.log(failed ? `\n${failed} 个用例未通过` : '\n全部通过');
process.exit(failed ? 1 : 0);
