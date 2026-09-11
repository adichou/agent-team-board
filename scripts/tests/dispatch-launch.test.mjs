#!/usr/bin/env node
// REQ-20260907-007 删除详情页一键派单（派单只能通过批量实施）—— 前后端移除契约 + 端点 404 集成
// 历史：REQ-20260906-019 一键派发改走调度器（/api/dispatch/codex/item），本条目整体移除该入口。
// 集成用例用 ATB_PORT 起临时实例，不打扰默认端口 8888。

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as core from '../lib/core.mjs';

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const src = {
  app: fs.readFileSync(path.join(pluginRoot, 'scripts', 'web', 'app.js'), 'utf8'),
  server: fs.readFileSync(path.join(pluginRoot, 'scripts', 'server.mjs'), 'utf8'),
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const cases = [];
const t = (name, fn) => cases.push([name, fn]);

let lib = null;
const D = async () => {
  if (!lib) lib = await import('../lib/dispatch.mjs');
  return lib;
};

// ---------- 前端移除契约（详细断言见 dispatch.test.mjs R1-R3） ----------

t('U1 前端契约：一键派单按钮与调用链已移除（REQ-20260907-007）', () => {
  assert.doesNotMatch(src.app, /data-dispatch/, '不得残留 [data-dispatch] 按钮与绑定');
  assert.doesNotMatch(src.app, /launchCodex|launchZcode|dispatchBtnHtml|dispatchPrompt|flashDispatchBtn/, '不得残留一键派单函数');
  // REQ-20260910-002：codex://threads/new?path= 重现于任务模块「打开 Codex 工作区」入口
  // （仅打开工作区、不注入 prompt）；一键派发的深链降级禁令收敛为 prompt 注入式（自动执行链路）
  assert.doesNotMatch(src.app, /codex:\/\/threads\/new\?prompt=/, '不得残留 codex 深链降级（prompt 注入式）');
});

// ---------- 服务端与 lib 移除契约 ----------

t('U3 服务端契约：一键派发端点与 dispatchItem 调用已移除；旧 .command/open 链路移除保持', () => {
  assert.doesNotMatch(src.server, /'\/api\/dispatch\/codex\/item'/, '一键派发端点应移除（REQ-20260907-007）');
  assert.doesNotMatch(src.server, /dispatchItem/, '不得再调用调度器 dispatchItem');
  assert.doesNotMatch(src.server, /buildCommandScript/, '不得残留 .command 脚本生成');
  assert.doesNotMatch(src.server, /\.command/, '不得残留 .command 临时文件链路');
  assert.doesNotMatch(src.server, /ATB_OPEN_CMD/, 'open 拉起 Terminal 接缝应移除');
  assert.doesNotMatch(src.server, /ATB_CODEX_CLI/, '旧端点 CLI 环境接缝应移除');
});

t('U4 lib 清理：旧构建函数移除；ITEM_ID_RE 与 zcode 深链保留', async () => {
  const m = await D();
  assert.equal(m.buildCommandScript, undefined, 'buildCommandScript 应移除（放弃当前方案）');
  assert.equal(m.buildCodexThreadUrl, undefined, 'buildCodexThreadUrl 应移除');
  assert.equal(m.shQuote, undefined, 'shQuote 应移除（仅为 .command 服务）');
  assert.equal(m.CODEX_CLI_DEFAULT, undefined, 'CODEX_CLI_DEFAULT 应移除');
  assert.ok(m.ITEM_ID_RE.test('REQ-20260906-019'), 'ITEM_ID_RE 应保留');
  assert.ok(!m.ITEM_ID_RE.test('../evil'), 'ITEM_ID_RE 应拒绝路径穿越形态');
  const url = m.buildZcodeWorkspaceUrl('/Users/x/我的 项目');
  assert.ok(url.startsWith('zcode://workspace/open?path='), `深链形态：${url}`);
  assert.equal(decodeURIComponent(new URL(url).searchParams.get('path')), '/Users/x/我的 项目', 'URL 解析往返应还原路径');
});

// ---------- 集成：临时端口实例，验证派单入口唯一性 ----------

function httpRequest(port, p, method, body) {
  return new Promise((resolve, reject) => {
    const rq = http.request({ hostname: '127.0.0.1', port, path: p, method, headers: { 'Content-Type': 'application/json' }, timeout: 8000 }, (rs) => {
      let out = '';
      rs.on('data', (c) => { out += c; });
      rs.on('end', () => { try { resolve({ code: rs.statusCode, json: JSON.parse(out || '{}') }); } catch { resolve({ code: rs.statusCode, json: null, raw: out }); } });
    });
    rq.on('error', reject);
    rq.on('timeout', () => { rq.destroy(); reject(new Error('timeout')); });
    if (body) rq.write(JSON.stringify(body));
    rq.end();
  });
}

async function startTmpServer() {
  const tmp = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'atb-d7-srv-'));
  const proj = path.join(tmp, 'proj');
  fs.mkdirSync(proj, { recursive: true });
  core.initData(proj); // 调度器要求看板数据目录存在
  const port = 30700 + Math.floor(Math.random() * 400);
  const server = spawn(process.execPath, [path.join(pluginRoot, 'scripts', 'server.mjs')], {
    cwd: proj,
    env: { ...process.env, ATB_PORT: String(port), ATB_REGISTRY: path.join(tmp, 'reg.json'), ATB_TICK_MS: '4000' },
    stdio: ['ignore', 'ignore', 'ignore'],
  });
  const base = `?project=${encodeURIComponent(fs.realpathSync(proj))}`;
  for (let i = 0; i < 40; i++) {
    await sleep(150);
    try {
      const ok = await new Promise((res) => {
        const rq = http.request({ hostname: '127.0.0.1', port, path: '/api/health', method: 'GET', timeout: 1000 }, (rs) => { rs.resume(); rs.on('end', () => res(true)); });
        rq.on('error', () => res(false));
        rq.on('timeout', () => { rq.destroy(); res(false); });
        rq.end();
      });
      if (ok) return { server, port, base, tmp, proj };
    } catch {}
  }
  server.kill();
  fs.rmSync(tmp, { recursive: true, force: true });
  throw new Error('临时 server 启动超时');
}

async function stopTmpServer(ctx) {
  ctx.server.kill();
  await sleep(300);
  try { fs.rmSync(ctx.tmp, { recursive: true, force: true }); } catch {}
}

t('I1 集成：一键派发端点已移除——对 accepted 条目 POST /api/dispatch/codex/item 得 404，不产生执行记录', async () => {
  const ctx = await startTmpServer();
  try {
    const created = await httpRequest(ctx.port, `/api/new${ctx.base}`, 'POST', { type: 'req', title: '只能批量实施' });
    const id = created.json.id;
    await httpRequest(ctx.port, `/api/item/${id}/status${ctx.base}`, 'POST', { to: 'accepted' });

    const r = await httpRequest(ctx.port, `/api/dispatch/codex/item${ctx.base}`, 'POST', { id });
    assert.equal(r.code, 404, `已移除端点应 404：${r.code} ${JSON.stringify(r.json)}`);
    const runs = await httpRequest(ctx.port, `/api/dispatch/runs${ctx.base}`, 'GET');
    assert.equal(runs.json.total, 0, '不得创建任何执行记录');
  } finally {
    await stopTmpServer(ctx);
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
