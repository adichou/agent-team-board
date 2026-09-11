#!/usr/bin/env node
// REQ-20260830-001 多项目集成测试 —— 真实起 server（随机端口 + 临时注册表 + 临时项目）
// 用法：node scripts/tests/multi-project.test.mjs
// 覆盖 test-cases.md 的 M1–M8；M9 为浏览器实测。

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as core from '../lib/core.mjs';

const __http = http;

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

// ---------- 测试环境 ----------
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'atb-multiproj-'));
// macOS 下 /var 是 /private/var 的符号链接，server 会做 realpath，测试路径需对齐
fs.mkdirSync(path.join(tmp, 'projA'), { recursive: true });
fs.mkdirSync(path.join(tmp, 'projB'), { recursive: true });
fs.mkdirSync(path.join(tmp, 'projC'), { recursive: true }); // 未初始化
const projectA = fs.realpathSync(path.join(tmp, 'projA'));
const projectB = fs.realpathSync(path.join(tmp, 'projB'));
const projectC = fs.realpathSync(path.join(tmp, 'projC'));

core.initData(projectA);
core.initData(projectB);
const itemA = core.createItem(core.dataDirFrom(projectA), { type: 'requirement', title: 'A 项目的需求', by: 'test' });
const itemB = core.createItem(core.dataDirFrom(projectB), { type: 'requirement', title: 'B 项目的需求', by: 'test' });

const registryFile = path.join(tmp, 'projects.json');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let serverProc = null;
let base = '';

async function tryStartServer(port) {
  const proc = spawn(process.execPath, [path.join(pluginRoot, 'scripts', 'server.mjs')], {
    cwd: projectA, // 默认项目 = 启动目录（单项目兼容行为）
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
  // 本机 node 可能 < 18（无全局 fetch），统一走 node:http
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
async function post(url, body, expect = 200) {
  const r = await request('POST', url, body ?? {});
  assert.equal(r.status, expect, `POST ${url} → ${r.status}（期望 ${expect}）：${JSON.stringify(r.json)}`);
  return r.json;
}

// ---------- 用例 ----------
const cases = [];
const t = (name, fn) => cases.push([name, fn]);
let health;

t('M1 health 无参数可用，含 projects 与 defaultProject', async () => {
  health = await get(`${base}/api/health`);
  assert.ok(Array.isArray(health.projects), 'health.projects 应为数组');
  assert.ok(typeof health.defaultProject === 'string' && health.defaultProject.length > 0, 'health.defaultProject 缺失');
  assert.ok(health.projects.includes(projectA), '默认项目（启动目录）应在 projects 中');
});

t('M2 board 按项目返回各自数据', async () => {
  const a = await get(`${base}/api/board?project=${encodeURIComponent(projectA)}`);
  const b = await get(`${base}/api/board?project=${encodeURIComponent(projectB)}`);
  assert.equal(a.dataDir, path.join(projectA, 'docs', 'agent-team-board'));
  assert.equal(b.dataDir, path.join(projectB, 'docs', 'agent-team-board'));
  // 两项目计数器独立、编号可能相同（各为当天 001），判据用标题与数据目录
  const titlesA = a.items.map((i) => i.title).join('|');
  const titlesB = b.items.map((i) => i.title).join('|');
  assert.equal(titlesA, 'A 项目的需求');
  assert.equal(titlesB, 'B 项目的需求');
  assert.notEqual(titlesA, titlesB, 'A/B 项目数据不应相同');
});

t('M3 未初始化项目返回 initialized:false；init 后可用', async () => {
  const before = await get(`${base}/api/board?project=${encodeURIComponent(projectC)}`);
  assert.equal(before.initialized, false, '未初始化项目应 initialized:false 而非报错');
  assert.equal(before.projectRoot, projectC);
  await post(`${base}/api/init?project=${encodeURIComponent(projectC)}`);
  const after = await get(`${base}/api/board?project=${encodeURIComponent(projectC)}`);
  assert.equal(after.initialized, true);
});

t('M4 状态流转带 project 只作用于对应项目', async () => {
  const idA = itemA.id;
  await post(`${base}/api/item/${idA}/status?project=${encodeURIComponent(projectA)}`, { to: 'accepted' });
  const a = await get(`${base}/api/board?project=${encodeURIComponent(projectA)}`);
  const b = await get(`${base}/api/board?project=${encodeURIComponent(projectB)}`);
  assert.equal(a.items.find((i) => i.id === idA).status, 'accepted');
  assert.equal(b.items.find((i) => i.id === itemB.id).status, 'submitted', 'B 项目条目不应被影响');
});

t('M5 非法 project 返回 400', async () => {
  await get(`${base}/api/board?project=relative/path`, 400);
  await get(`${base}/api/board?project=${encodeURIComponent(path.join(tmp, 'not-exists'))}`, 400);
});

t('M6 register 登记项目并持久化', async () => {
  await post(`${base}/api/register`, { path: projectB });
  const h = await get(`${base}/api/health`);
  assert.ok(h.projects.includes(projectB), 'register 后应出现在 projects');
  const saved = JSON.parse(fs.readFileSync(registryFile, 'utf8'));
  assert.ok(saved.projects.includes(projectB), '注册表文件应包含 projectB');
});

t('M7 前端项目切换与带参调用（静态契约）', () => {
  const html = fs.readFileSync(path.join(pluginRoot, 'scripts', 'web', 'index.html'), 'utf8');
  const js = fs.readFileSync(path.join(pluginRoot, 'scripts', 'web', 'app.js'), 'utf8');
  assert.match(html, /id="projectSel"/, 'index.html 需要项目选择器');
  assert.match(js, /URLSearchParams/, 'app.js 需要从 URL 读取 project');
  assert.match(js, /localStorage/, 'app.js 需要记住当前项目');
  assert.match(js, /project=/, 'app.js 的 API 调用需带 project 参数');
});

t('M8 /board 命令与 SKILL.md 使用项目深链（静态契约）', () => {
  const board = fs.readFileSync(path.join(pluginRoot, 'commands', 'board.md'), 'utf8');
  const skill = fs.readFileSync(path.join(pluginRoot, 'skills', 'agent-team-board', 'SKILL.md'), 'utf8');
  assert.match(board, /\?project=/, 'board.md 应打开带 ?project= 的 URL');
  assert.match(skill, /\?project=/, 'SKILL.md 的 /board 流程应带 ?project=');
});

// ---------- 执行 ----------
let failed = 0;
try {
  for (let port of [27736, 27936, 28136]) {
    try {
      const r = await tryStartServer(port);
      serverProc = r.proc;
      base = r.base;
      break;
    } catch (e) {
      if (port === 28136) throw e;
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
