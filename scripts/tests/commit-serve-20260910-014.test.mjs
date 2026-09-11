#!/usr/bin/env node
// BUG-20260910-014 批量 Commit 服务接口 —— REQ-20260911-010 回退后契约测试
// 批量 Commit 面板路由（/api/commit/current|create|pause|abort|records）已随人工批量
// 提交流程回退移除（404）；已完成条目提交状态取数 /api/commit/item-status 保留（换源为
// REQ-20260911-009 索引；换源合并/空索引等行为由 commit-rollback-20260911-010.test.mjs 覆盖）。
// 用法：node scripts/tests/commit-serve-20260910-014.test.mjs

import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as core from '../lib/core.mjs';

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function req(port, method, pathname, body) {
  return new Promise((resolve, reject) => {
    const payload = body == null ? null : JSON.stringify(body);
    const r = http.request({
      hostname: '127.0.0.1', port, path: pathname, method,
      headers: payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {},
      timeout: 8000,
    }, (rs) => {
      let out = '';
      rs.on('data', (c) => { out += c; });
      rs.on('end', () => { try { resolve({ status: rs.statusCode, json: JSON.parse(out || '{}') }); } catch { resolve({ status: rs.statusCode, json: null, raw: out }); } });
    });
    r.on('error', reject);
    r.on('timeout', () => { r.destroy(); reject(new Error('timeout')); });
    if (payload) r.write(payload);
    r.end();
  });
}

function git(root, args) {
  const r = spawnSync('git', ['-c', 'user.email=t@example.com', '-c', 'user.name=t', ...args], {
    cwd: root, encoding: 'utf8', timeout: 30_000,
  });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} 失败：${r.stderr || r.stdout}`);
  return r.stdout || '';
}

function mkProject() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'atb-commit-serve-')));
  git(root, ['init', '-q']);
  fs.writeFileSync(path.join(root, 'README.md'), '# t\n');
  git(root, ['add', '.']);
  git(root, ['commit', '-q', '-m', 'chore: 初始化测试仓库']);
  core.initData(root);
  git(root, ['add', '.']);
  git(root, ['commit', '-q', '-m', 'chore: 初始化看板数据']);
  return root;
}

async function startServer(root, tmp) {
  const port = 33000 + Math.floor(Math.random() * 20000);
  const server = spawn(process.execPath, [path.join(pluginRoot, 'scripts', 'server.mjs')], {
    cwd: root,
    env: { ...process.env, ATB_PORT: String(port), ATB_REGISTRY: path.join(tmp, 'reg.json') },
    stdio: ['ignore', 'ignore', 'ignore'],
  });
  for (let i = 0; i < 40; i++) {
    await sleep(150);
    try { await req(port, 'GET', '/api/health'); return { server, port }; } catch {}
  }
  throw new Error('服务未启动');
}

const cases = [];
const t = (name, fn) => cases.push([name, fn]);

t('S1 批量 Commit 面板路由已回退：current/create/pause/abort/records 一律 404（未知接口）', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'atb-commit-serve-404-'));
  const root = mkProject();
  const { server, port } = await startServer(root, tmp);
  const P = `&project=${encodeURIComponent(root)}`;
  try {
    for (const [method, pathname, body] of [
      ['GET', `/api/commit/current?${P}`, null],
      ['POST', `/api/commit/create?${P}`, {}],
      ['POST', `/api/commit/pause?${P}`, { batchId: 'CMT-20260101-001' }],
      ['POST', `/api/commit/abort?${P}`, { batchId: 'CMT-20260101-001' }],
      ['GET', `/api/commit/records?${P}`, null],
    ]) {
      const r = await req(port, method, pathname, body);
      assert.equal(r.status, 404, `${pathname} 应回退为 404（实际 ${r.status}）`);
      assert.match(r.json?.error || '', /未知接口/, '404 应为未知接口口径');
    }
    // 回退不落任何 CMT 账本
    assert.ok(!fs.existsSync(path.join(core.dataDirFrom(root), 'commits', 'batches')), '不得落 commits/batches 账本');
  } finally {
    server.kill();
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
    try { fs.rmSync(root, { recursive: true, force: true }); } catch {}
  }
});

t('S2 item-status 保留：初始化项目返回 200 空索引；未初始化项目返回 400 明确提示', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'atb-commit-serve-item-'));
  const root = mkProject();
  const { server, port } = await startServer(root, tmp);
  const P = `&project=${encodeURIComponent(root)}`;
  try {
    const r = await req(port, 'GET', `/api/commit/item-status?${P}`);
    assert.equal(r.status, 200, `item-status 应保留（${JSON.stringify(r.json)}）`);
    assert.deepEqual(r.json.statuses, {}, '无账本/无关联提交时 statuses 为空对象');
  } finally {
    server.kill();
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
    try { fs.rmSync(root, { recursive: true, force: true }); } catch {}
  }
  // 未初始化：明确 400，不落任何数据目录
  const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'atb-commit-bare-'));
  const proj = path.join(bare, 'proj');
  fs.mkdirSync(proj);
  const s2 = await startServer(proj, bare);
  try {
    const r = await req(s2.port, 'GET', `/api/commit/item-status?&project=${encodeURIComponent(proj)}`);
    assert.equal(r.status, 400, '未初始化应 400');
    assert.match(r.json?.error || '', /未找到/, '错误应说明数据目录未初始化');
    assert.ok(!fs.existsSync(path.join(proj, 'docs')), '不得落任何数据目录');
  } finally {
    s2.server.kill();
    try { fs.rmSync(bare, { recursive: true, force: true }); } catch {}
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
