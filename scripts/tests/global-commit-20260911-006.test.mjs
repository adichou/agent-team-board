#!/usr/bin/env node
// BUG-20260911-006 全局任务聚合 × 批量 Commit —— REQ-20260911-010 回退后契约测试
// 批量 Commit（CMT）批次简报已随人工批量提交流程回退移除：/api/batch/global 不再返回
// CMT 简报行；存量 commits/batches 账本（含损坏 JSON）不再影响全局聚合（历史数据保留、
// 只读不动）；批量开发 / 批量完善聚合不回归。前端静态契约见 commit-rollback-20260911-010.test.mjs。
// 用法：node scripts/tests/global-commit-20260911-006.test.mjs

import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as core from '../lib/core.mjs';
import * as batch from '../lib/batch.mjs';

const __http = http;

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

// ---------- 测试环境 ----------

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'atb-globalcommit-'));
// macOS 下 /var 是 /private/var 的符号链接，server 会做 realpath，测试路径需对齐
const mkProj = (name) => {
  fs.mkdirSync(path.join(tmp, name), { recursive: true });
  return fs.realpathSync(path.join(tmp, name));
};

function git(root, args) {
  const r = spawnSync('git', ['-c', 'user.email=t@example.com', '-c', 'user.name=t', ...args], {
    cwd: root, encoding: 'utf8', timeout: 30_000,
  });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} 失败：${r.stderr || r.stdout}`);
  return r.stdout || '';
}

function mkGitProj(name) {
  const root = mkProj(name);
  git(root, ['init', '-q']);
  fs.writeFileSync(path.join(root, 'README.md'), '# t\n');
  git(root, ['add', '.']);
  git(root, ['commit', '-q', '-m', 'chore: 初始化测试仓库']);
  core.initData(root);
  return root;
}

const projDev = mkGitProj('projDev');        // 批量开发批次在途（聚合不回归）
const projLegacy = mkProj('projLegacy');     // 存量 CMT 账本（含未结束批次 + 损坏 JSON）
core.initData(projLegacy);
const projClean = mkProj('projClean');       // 已初始化、无批次（回归：无任务项目）
core.initData(projClean);

// projDev：已计划条目 → 批量开发批次（prepared，应聚合为 develop 行）
const devDir = core.dataDirFrom(projDev);
const dx = core.createItem(devDir, { type: 'requirement', title: '开发单' });
core.setStatus(devDir, dx.id, 'accepted', { by: 'human' });
core.setStatus(devDir, dx.id, 'planned', { by: 'human' });
const devBatch = batch.createBatch(devDir, { projectRoot: projDev });
assert.ok(devBatch.batch, '前置：批量开发批次应创建成功');

// projLegacy：模拟回退前留下的 CMT 批次账本（一个未结束 running + 一个损坏 batch.json）
// REQ-20260911-010：存量账本保留不删，但全局聚合不再读取/展示，也不再因损坏而降级项目行
const legacyBatches = path.join(core.dataDirFrom(projLegacy), 'commits', 'batches');
fs.mkdirSync(path.join(legacyBatches, 'CMT-20990909-001'), { recursive: true });
fs.writeFileSync(path.join(legacyBatches, 'CMT-20990909-001', 'batch.json'), JSON.stringify({
  version: 1, batchId: 'CMT-20990909-001', kind: 'commit', mode: 'subagent', projectRoot: projLegacy,
  createdAt: '2026-09-10T00:00:00.000Z', lastActivityAt: '2026-09-10T00:00:00.000Z',
  status: 'running', pauseRequested: false, abortRequested: false, currentRunId: 'run-20990909-000000-aaaa',
  candidates: ['REQ-20990909-001'], prompt: 'legacy',
}));
fs.mkdirSync(path.join(legacyBatches, 'CMT-20990909-002'), { recursive: true });
fs.writeFileSync(path.join(legacyBatches, 'CMT-20990909-002', 'batch.json'), '{oops');

const registryFile = path.join(tmp, 'projects.json');
fs.writeFileSync(registryFile, JSON.stringify({
  version: 1,
  projects: [projDev, projLegacy, projClean],
}, null, 2));

// 只读性快照：GET 前后存量账本必须逐字节不变（不吸收、不改写、不清理）
const legacyBatch1 = fs.readFileSync(path.join(legacyBatches, 'CMT-20990909-001', 'batch.json'), 'utf8');

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

function request(method, url) {
  const http = __http;
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = http.request(
      { hostname: u.hostname, port: u.port, path: u.pathname + u.search, method },
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

t('C1 聚合不再纳入批量 Commit：存量 CMT 批次（未结束 running + 损坏 JSON）不产生简报行、不降级项目', async () => {
  global1 = await get(`${base}/api/batch/global`);
  const legacy = projRow(projLegacy);
  assert.ok(legacy, '存量账本项目行应存在');
  assert.equal(legacy.status, 'ok', '存量/损坏 CMT 账本不再使项目行降级为 error');
  assert.deepEqual(legacy.tasks, [], '存量 CMT 批次不得再出现在聚合简报中');
});

t('C2 批量开发聚合不回归：develop 批次照常聚合；无任务项目行为空', async () => {
  global1 = await get(`${base}/api/batch/global`);
  const dev = projRow(projDev);
  assert.equal(dev.status, 'ok');
  assert.equal(dev.tasks.length, 1, '批量开发批次应聚合为一行');
  assert.equal(dev.tasks[0].kind, 'develop', '批次类型为 develop');
  assert.equal('batchId' in dev.tasks[0], false, 'REQ-20260913-003：简报不再透出批次号');
  const clean = projRow(projClean);
  assert.deepEqual(clean.tasks, [], '无任务项目行为空');
});

t('C3 聚合只读：GET 前后存量 CMT 账本逐字节不变（不吸收、不改写、不清理、无 Git 操作）', async () => {
  await get(`${base}/api/batch/global`);
  assert.equal(
    fs.readFileSync(path.join(legacyBatches, 'CMT-20990909-001', 'batch.json'), 'utf8'),
    legacyBatch1,
    '存量 CMT 批次账本必须保持原样（回退不做破坏性删除）'
  );
  assert.ok(fs.existsSync(path.join(legacyBatches, 'CMT-20990909-002', 'batch.json')), '损坏的存量账本同样保留');
});

let failed = 0;
let started = null;
for (const [name, fn] of cases) {
  try {
    if (!started) {
      started = await tryStartServer(37700 + Math.floor(Math.random() * 20000));
      serverProc = started.proc;
      base = started.base;
    }
    await fn();
    console.log(`✓ ${name}`);
  } catch (e) {
    failed++;
    console.error(`✗ ${name}\n    ${String(e.message).split('\n')[0]}`);
  }
}
if (serverProc) serverProc.kill();
try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
console.log(failed ? `\n${failed} 个用例未通过` : '\n全部通过');
process.exit(failed ? 1 : 0);
