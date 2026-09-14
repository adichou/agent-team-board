#!/usr/bin/env node
// REQ-20260909-003 需求文档引用讨论、纪要归档与说明同步 —— serve API 测试（S1）
// 覆盖：/api/req-disc 全链路（start 提示词、?req= 状态与自动检测、quote、archive、apply、
// finish/continue、非法参数 400、不改变需求状态）
// 用法：node scripts/tests/req-disc-serve.test.mjs

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

const pluginRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const cases = [];
const t = (name, fn) => cases.push([name, fn]);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function reqHttp(port, method, pathname, body) {
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

t('S1 serve：/api/req-disc 全链路（start / 状态检测 / quote / archive / apply / 400 / 状态不变）', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'atb-req-disc-serve-'));
  const root = path.join(tmp, 'proj');
  fs.mkdirSync(root);
  const initRes = await new Promise((resolve) => {
    const p = spawn(process.execPath, [path.join(pluginRoot, 'scripts', 'atb.mjs'), 'init', '--dir', root], { stdio: 'ignore' });
    p.on('close', resolve);
  });
  assert.equal(initRes, 0, 'atb init 应成功');

  const port = 31000 + Math.floor(Math.random() * 20000);
  const server = spawn(process.execPath, [path.join(pluginRoot, 'scripts', 'server.mjs')], {
    cwd: root,
    env: { ...process.env, ATB_PORT: String(port), ATB_REGISTRY: path.join(tmp, 'reg.json') },
    stdio: ['ignore', 'ignore', 'ignore'],
  });
  const P = `?project=${encodeURIComponent(root)}`;
  const dataDir = path.join(root, 'docs', 'agent-team-board');
  try {
    let up = false;
    for (let i = 0; i < 40; i++) {
      await sleep(150);
      try { await reqHttp(port, 'GET', '/api/health'); up = true; break; } catch {}
    }
    assert.ok(up, '服务应启动');

    let r = await reqHttp(port, 'POST', `/api/new${P}`, { type: 'req', title: '引用讨论需求', description: '# 背景\n\n从需求详情发起讨论。\n\n讨论结束后生成纪要。\n' });
    assert.equal(r.status, 201);
    const reqId = r.json.id;
    const reqDir = path.join(dataDir, 'requirements', reqId);
    const readmeFile = path.join(reqDir, 'README.md');

    // 无讨论 → null
    r = await reqHttp(port, 'GET', `/api/req-disc${P}&req=${encodeURIComponent(reqId)}`);
    assert.equal(r.status, 200);
    assert.equal(r.json.discussion, null, '尚无讨论应为 null');

    // 非法 reqId → 400
    r = await reqHttp(port, 'POST', `/api/req-disc/start${P}`, { reqId: 'REQ-20990101-999' });
    assert.equal(r.status, 400, '不存在的需求应 400');

    // 开始讨论 → 编号 + 启动提示词
    r = await reqHttp(port, 'POST', `/api/req-disc/start${P}`, { reqId });
    assert.equal(r.status, 200, `start 应成功（${JSON.stringify(r.json)}）`);
    const discId = r.json.discussion.id;
    assert.match(discId, /^DISC-\d{8}-\d{3}$/);
    assert.match(r.json.discussion.startPrompt, new RegExp(reqId), '启动提示词应含需求编号');
    assert.match(r.json.discussion.startPrompt, /README\.md/, '启动提示词应含文档入口');

    // 讨论完毕 → 收尾提示词
    r = await reqHttp(port, 'POST', `/api/req-disc/${discId}/finish${P}`, {});
    assert.equal(r.status, 200);
    assert.match(r.json.discussion.finishPrompt, /PUBLISH\.json/, '收尾提示词应含发布标记约定');
    assert.match(r.json.discussion.finishPrompt, /SHA-256/, '收尾提示词应含基线算法');

    // 状态：等待纪要与草稿
    r = await reqHttp(port, 'GET', `/api/req-disc${P}&req=${encodeURIComponent(reqId)}`);
    assert.equal(r.json.discussion.outcome.state, 'waiting', '未落盘应为等待');

    // 引用快照
    r = await reqHttp(port, 'POST', `/api/req-disc/${discId}/quote${P}`, { doc: 'README.md', startLine: 3, endLine: 3, version: 1, text: '从需求详情发起讨论。' });
    assert.equal(r.status, 200);
    assert.equal(r.json.discussion.quotes.length, 1);
    r = await reqHttp(port, 'POST', `/api/req-disc/${discId}/quote${P}`, { doc: '../evil.md', startLine: 1, endLine: 1, version: 1, text: 'x' });
    assert.equal(r.status, 400, '白名单外文档应 400');

    // Agent 成套落盘（模拟原会话执行收尾提示词）
    const roundDir = path.join(dataDir, 'discussions', discId, 'rounds', '1');
    fs.mkdirSync(roundDir, { recursive: true });
    fs.writeFileSync(path.join(roundDir, 'minutes.md'), '# 纪要\n\n## 明确共识\n\n1. 入口改为提示词。\n');
    const baseline = crypto.createHash('sha256').update(fs.readFileSync(readmeFile, 'utf8'), 'utf8').digest('hex');
    fs.writeFileSync(path.join(roundDir, 'readme-draft.json'), JSON.stringify({
      discussionId: discId, reqId, round: 1, baseline,
      changes: [{ id: 'c1', title: '调整入口', before: '从需求详情发起讨论。', after: '从需求详情生成启动提示词，在 Agent 新会话中讨论。', basis: '明确共识第 1 项' }],
    }));
    fs.writeFileSync(path.join(roundDir, 'PUBLISH.json'), JSON.stringify({ discussionId: discId, reqId, round: 1, publishedAt: new Date().toISOString() }));

    // 状态自动变为 published（读取即检测）
    r = await reqHttp(port, 'GET', `/api/req-disc${P}&req=${encodeURIComponent(reqId)}`);
    assert.equal(r.json.discussion.outcome.state, 'published', '落盘后应检测为 published');
    assert.match(r.json.discussion.outcome.minutes, /明确共识/);
    assert.equal(r.json.discussion.outcome.draft.changes.length, 1);

    // 未发布轮不可归档（先开新轮再归档旧轮走 store 测试；此处直接归档已发布轮）
    r = await reqHttp(port, 'POST', `/api/req-disc/${discId}/archive${P}`, {});
    assert.equal(r.status, 200);
    assert.ok(r.json.discussion.rounds[0].archivedAt, '归档应置 archivedAt');

    // 应用：空选择 400
    r = await reqHttp(port, 'POST', `/api/req-disc/${discId}/apply${P}`, { selected: [] });
    assert.equal(r.status, 400, '空选择应 400');
    // 应用：勾选 c1 → README 更新
    const before = fs.readFileSync(readmeFile, 'utf8');
    r = await reqHttp(port, 'POST', `/api/req-disc/${discId}/apply${P}`, { selected: ['c1'] });
    assert.equal(r.status, 200, `apply 应成功（${JSON.stringify(r.json)}）`);
    const after = fs.readFileSync(readmeFile, 'utf8');
    assert.ok(after.includes('在 Agent 新会话中讨论'), 'README 应写入勾选项');
    assert.ok(!after.includes('从需求详情发起讨论。'), '原文应被替换');
    assert.equal(r.json.applied.afterVersion, 2);
    assert.ok(fs.readFileSync(path.join(dataDir, 'discussions', discId, 'readme-versions', 'v1.md'), 'utf8') === before, '旧版应保留');

    // 重复应用幂等（README 不再变化）
    r = await reqHttp(port, 'POST', `/api/req-disc/${discId}/apply${P}`, { selected: ['c1'] });
    assert.equal(r.status, 200);
    assert.equal(r.json.applied.alreadyApplied, true, '重复应用返回已应用');
    assert.equal(fs.readFileSync(readmeFile, 'utf8'), after, '不应二次写入');

    // 需求状态不受影响（讨论不改状态机）
    const st = JSON.parse(fs.readFileSync(path.join(reqDir, 'status.json'), 'utf8'));
    assert.equal(st.status, 'submitted', '需求状态应保持不变');

    // 未知讨论编号 → 400
    r = await reqHttp(port, 'POST', `/api/req-disc/DISC-20990101-999/archive${P}`, {});
    assert.equal(r.status, 400, '未知讨论应 400');
  } finally {
    server.kill();
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
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
