#!/usr/bin/env node
// REQ-20260903-001 取消对齐流程（回退单阶段）—— 状态机/守卫/server/前端契约测试
// 用法：node scripts/tests/pending-alignment.test.mjs（原文件改造为回退语义）

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as core from '../lib/core.mjs';

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

// ---------- 环境 ----------
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'atb-singlephase-'));
fs.mkdirSync(path.join(tmp, 'proj'), { recursive: true });
const project = fs.realpathSync(path.join(tmp, 'proj'));
core.initData(project);
const dataDir = core.dataDirFrom(project);
// 存量兼容样本：pending-alignment 旧条目（历史数据直写）
const legacyPA = core.createItem(dataDir, { type: 'requirement', title: '存量待对齐', by: 'legacy' });
{
  const f = path.join(core.resolveItemDir(dataDir, legacyPA.id).dir, 'status.json');
  const st = JSON.parse(fs.readFileSync(f, 'utf8'));
  st.status = 'pending-alignment';
  st.owner = 'legacy-session';
  st.history.push({ at: new Date().toISOString(), from: 'accepted', to: 'pending-alignment', by: 'legacy' });
  fs.writeFileSync(f, JSON.stringify(st, null, 2) + '\n');
}
// 新流程样本
const mkAccepted = (title) => {
  const it = core.createItem(dataDir, { type: 'requirement', title, by: 'test' });
  core.setStatus(dataDir, it.id, 'accepted', { by: 'human' });
  return it.id;
};

const registryFile = path.join(tmp, 'projects.json');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function request(method, url, body) {
  const __http = http;
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = __http.request(
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
const get = (url, expect = 200) => request('GET', url).then((r) => {
  assert.equal(r.status, expect, `GET ${url} → ${r.status}：${JSON.stringify(r.json)}`);
  return r.json;
});
const post = (url, body, expect = 200) => request('POST', url, body ?? {}).then((r) => {
  assert.equal(r.status, expect, `POST ${url} → ${r.status}：${JSON.stringify(r.json)}`);
  return r.json;
});

let serverProc = null;
let base = '';
async function tryStartServer(port) {
  const proc = spawn(process.execPath, [path.join(pluginRoot, 'scripts', 'server.mjs')], {
    cwd: project,
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

const cases = [];
const t = (name, fn) => cases.push([name, fn]);

t('R1 状态机回退：accepted → planned/in-progress 可达；pending-alignment 移出主流程（无进入边）', () => {
  // REQ-20260907-011 新增人工回退边 accepted → submitted（驳回接受）；实施主干仍直达 in-progress
  assert.deepEqual(core.TRANSITIONS.accepted, ['planned', 'in-progress', 'submitted'], 'accepted 可置计划/直达 in-progress（另含驳回回退边，REQ-20260908-010）');
  assert.ok(!core.STATES.includes('pending-alignment') || !core.TRANSITIONS.accepted.includes('pending-alignment'),
    '主流程不再进入 pending-alignment');
  // 存量 pending-alignment → in-progress 仍可达
  const { status: st } = core.setStatus(dataDir, legacyPA.id, 'in-progress', { by: 'human' });
  assert.equal(st.status, 'in-progress', '存量待对齐可人工放行');
});

t('R2 claim 直达 in-progress（owner+锁+history）；存量待对齐 claim 视为续认', () => {
  const id = mkAccepted('直达实施');
  const st = core.claim(dataDir, id, 'zcode-direct');
  assert.equal(st.status, 'in-progress');
  assert.equal(st.owner, 'zcode-direct');
  assert.throws(() => core.claim(dataDir, id, 'other'), /已.*认领/, '异 owner 冲突保留');
  // BUG-20260906-002：claim 即占用项目实施互斥；用例结束 report 收尾，释放占用供后续用例认领
  core.report(dataDir, id, { summary: '完成', by: 'zcode-direct' });
});

t('R3 钩子拦截清单收回：in-progress 放行，accepted/done 仍拦', async () => {
  const guard = path.join(pluginRoot, 'scripts', 'state-guard.mjs');
  const run = (input) => new Promise((resolve) => {
    const p = spawn(process.execPath, [guard, 'bash'], { stdio: ['pipe', 'ignore', 'pipe'] });
    let err = '';
    p.stderr.on('data', (c) => { err += c; });
    p.on('close', (code) => resolve({ code, err }));
    p.stdin.write(JSON.stringify(input));
    p.stdin.end();
  });
  const ip = await run({ tool_input: { command: `node atb.mjs status REQ-1 in-progress` } });
  assert.equal(ip.code, 0, 'status in-progress 应放行（回退单阶段）');
  const acc = await run({ tool_input: { command: `node atb.mjs status REQ-1 accepted` } });
  assert.equal(acc.code, 2, 'accepted 仍拦');
  const done = await run({ tool_input: { command: `node atb.mjs status REQ-1 done` } });
  assert.equal(done.code, 2, 'done 仍拦');
});

t('R4 server：accepted → in-progress 网页放行（或不在网页操作但流转合法）；submitted→in-progress 仍拒', async () => {
  const id = mkAccepted('server 回退');
  // 网页端不再承担认领——直接验证流转合法性经由 Agent claim；网页对 accepted→in-progress 不再 403 拦截语义由实现定，
  // 这里验证 claim 后 report 主链路正常即可，核心是状态机 R1/R2。
  core.claim(dataDir, id, 'web-session');
  const board = await get(`${base}/api/board`);
  const it = board.items.find((i) => i.id === id);
  assert.equal(it.status, 'in-progress');
  const other = core.createItem(dataDir, { type: 'bug', title: 'y', by: 't' });
  await post(`${base}/api/item/${other.id}/status`, { to: 'in-progress' }, 403);
});

t('R5 前端无「待对齐」档与「对齐」按钮（REQ-20260907-004 布局重构：看板改列表+详情，五档语义保留）', () => {
  const js = fs.readFileSync(path.join(pluginRoot, 'scripts', 'web', 'app.js'), 'utf8');
  const css = fs.readFileSync(path.join(pluginRoot, 'scripts', 'web', 'style.css'), 'utf8');
  assert.ok(!js.includes("'pending-alignment'"), 'app.js 不应含 pending-alignment 分类');
  assert.ok(!js.includes('▶ 对齐'), '不应再有「▶ 对齐」按钮');
  assert.match(js, /「移入计划」排入开发计划/, 'accepted 提示应指引移入计划（REQ-20260908-010；BUG-20260908-006 统一文案）');
  assert.ok(!css.includes('s-pending-alignment'), 'css 待对齐配色应移除');
  // 布局契约：REQ-20260907-004 后为需求列表+详情双栏；BUG-20260907-016 恢复状态筛选条（五档无「全部」，laneOf 派生保留）
  assert.match(js, /const REQ_FILTERS = LANES\.map/, '需求状态筛选条应恢复且由五档 LANES 派生（BUG-20260907-016）');
  assert.match(js, /confirming: '待测试'/, 'lane 派生标签保留（行状态展示用）');
  assert.match(css, /\.req-split\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/, '需求工作区应为列表双栏网格');
});

t('R6 dev.md 单阶段化 + req.md UI 设计前置（静态契约）', () => {
  const dev = fs.readFileSync(path.join(pluginRoot, 'commands', 'dev.md'), 'utf8');
  const req = fs.readFileSync(path.join(pluginRoot, 'commands', 'req.md'), 'utf8');
  const skill = fs.readFileSync(path.join(pluginRoot, 'skills', 'agent-team-board', 'SKILL.md'), 'utf8');
  assert.ok(!dev.includes('阶段一'), 'dev.md 不应再有阶段一（单阶段化）');
  assert.ok(!dev.includes('implement'), 'implement 参数应移除');
  assert.match(dev, /loop/, 'loop 语义保留');
  // UI/交互设计前置
  assert.match(req, /UI|界面|交互/, 'req.md 应含 UI/交互设计要求');
  assert.match(skill, /UI|界面|交互/, 'SKILL 数据规范应含 UI 设计要求');
});

let failed = 0;
try {
  for (const port of [29536, 29736, 29936]) {
    try {
      const r = await tryStartServer(port);
      serverProc = r.proc;
      base = r.base;
      break;
    } catch (e) {
      if (port === 29936) throw e;
    }
  }
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
