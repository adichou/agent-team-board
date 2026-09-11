#!/usr/bin/env node
// REQ-20260909-004 开放式讨论模块重构 —— 服务接口测试（H1~H4）
// 覆盖：board 两态卡片（含未初始化空态）、创建（含启动提示词与标题缺失 400）、
// finish/archive/resume/reread、create-items 逐项结果与幂等
// 用法：node scripts/tests/discussion-serve.test.mjs

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function req(port, method, pathname, body) {
  return new Promise((resolve, reject) => {
    const payload = body == null ? null : JSON.stringify(body);
    const r = http.request({
      hostname: '127.0.0.1', port, path: pathname, method,
      headers: payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {},
      timeout: 6000,
    }, (rs) => {
      const chunks = [];
      rs.on('data', (c) => chunks.push(c));
      rs.on('end', () => {
        const buf = Buffer.concat(chunks);
        let json = null;
        try { json = JSON.parse(buf.toString() || '{}'); } catch {}
        resolve({ status: rs.statusCode, json });
      });
    });
    r.on('error', reject);
    r.on('timeout', () => { r.destroy(); reject(new Error('timeout')); });
    if (payload) r.write(payload);
    r.end();
  });
}

const cases = [];
const t = (name, fn) => cases.push([name, fn]);

function publish(dataDir, id, items) {
  const dir = path.join(dataDir, 'oncall', 'tickets', id);
  fs.writeFileSync(path.join(dir, 'minutes.md'), '# 纪要\n\n- 共识：走看板沉淀');
  fs.writeFileSync(path.join(dir, 'candidates.json'), JSON.stringify({ discussionId: id, items }));
  fs.writeFileSync(path.join(dir, 'PUBLISH.json'), JSON.stringify({ discussionId: id, publishedAt: '2026-09-09T00:00:00.000Z' }));
}

t('H1~H4 /api/discussion* 接口全链路', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'atb-discussion-serve-'));
  const root = path.join(tmp, 'proj');
  fs.mkdirSync(root);
  const initRes = await new Promise((resolve) => {
    const p = spawn(process.execPath, [path.join(pluginRoot, 'scripts', 'atb.mjs'), 'init', '--dir', root], { stdio: 'ignore' });
    p.on('close', resolve);
  });
  assert.equal(initRes, 0, 'atb init 应成功');
  const dataDir = path.join(root, 'docs', 'agent-team-board');

  const port = 31000 + Math.floor(Math.random() * 20000);
  const server = spawn(process.execPath, [path.join(pluginRoot, 'scripts', 'server.mjs')], {
    cwd: root,
    env: { ...process.env, ATB_PORT: String(port), ATB_REGISTRY: path.join(tmp, 'reg.json') },
    stdio: ['ignore', 'ignore', 'ignore'],
  });
  const P = `?project=${encodeURIComponent(root)}`;
  try {
    let up = false;
    for (let i = 0; i < 40; i++) {
      await sleep(150);
      try { await req(port, 'GET', '/api/health'); up = true; break; } catch {}
    }
    assert.ok(up, '服务应启动');

    // H1：空 board（已初始化项目、无讨论）
    let r = await req(port, 'GET', `/api/discussion/board${P}`);
    assert.equal(r.status, 200);
    assert.equal(r.json.initialized, true);
    assert.deepEqual(r.json.discussions, [], '初始无讨论');

    // H2：创建（标题缺失 400；成功返回含启动提示词的全量）
    r = await req(port, 'POST', `/api/discussion${P}`, { title: '   ', background: 'b' });
    assert.equal(r.status, 400, '空标题应 400');
    assert.match(r.json.error, /标题/);

    r = await req(port, 'POST', `/api/discussion${P}`, { title: '服务端讨论', background: '背景S' });
    assert.equal(r.status, 200);
    const id = r.json.discussion.id;
    assert.match(id, /^ASK-\d{8}-001$/);
    assert.equal(r.json.discussion.status, 'discussing');
    assert.equal(r.json.discussion.background, '背景S');
    assert.ok(r.json.discussion.startPrompt.includes(id), '创建即带启动提示词');

    // H1：board 出现两态卡片
    r = await req(port, 'GET', `/api/discussion/board${P}`);
    assert.equal(r.json.discussions.length, 1);
    assert.equal(r.json.discussions[0].status, 'discussing');

    // H3：finish（等待纪要阶段，状态不变）
    r = await req(port, 'POST', `/api/discussion/${id}/finish${P}`, {});
    assert.equal(r.status, 200);
    assert.ok(r.json.discussion.finishPromptAt, '应记录收尾时间');
    assert.ok(r.json.discussion.finishPrompt.includes(id), '应含收尾提示词');
    assert.equal(r.json.discussion.status, 'discussing', '等待纪要不是状态');
    r = await req(port, 'GET', `/api/discussion/board${P}`);
    assert.equal(r.json.discussions[0].phase, 'waiting');

    // 成套落盘 + reread
    publish(dataDir, id, [
      { id: 'c1', type: 'requirement', title: '接口需求', description: 'd1', acceptance: 'a1' },
    ]);
    r = await req(port, 'POST', `/api/discussion/${id}/reread${P}`, {});
    assert.equal(r.json.discussion.outcome.state, 'published');
    assert.ok(r.json.discussion.outcome.minutes.includes('共识'));
    r = await req(port, 'GET', `/api/discussion/board${P}`);
    assert.equal(r.json.discussions[0].phase, 'drafts', '有待创建草稿');

    // H4：create-items 逐项结果 + 幂等
    r = await req(port, 'POST', `/api/discussion/${id}/create-items${P}`, {
      items: [
        { id: 'c1', type: 'requirement', title: '接口需求（编辑后）', description: 'd1', acceptance: 'a1' },
        { id: 'bad', type: 'bug', title: '', description: 'x' },
      ],
    });
    assert.equal(r.status, 200);
    assert.equal(r.json.results.length, 2);
    assert.equal(r.json.results[0].ok, true);
    assert.match(r.json.results[0].itemId, /^REQ-/);
    assert.equal(r.json.results[1].ok, false);
    assert.match(r.json.results[1].error, /标题/);
    assert.equal(r.json.discussion.created.length, 1, '讨论侧记录已创建成果');

    // 幂等：重复提交已创建草稿
    r = await req(port, 'POST', `/api/discussion/${id}/create-items${P}`, {
      items: [{ id: 'c1', type: 'requirement', title: '接口需求（编辑后）', description: 'd1' }],
    });
    assert.equal(r.json.results[0].skipped, true, '不重复创建');
    assert.match(r.json.results[0].itemId, /^REQ-/, '跳过项返回原条目编号');

    // 条目侧来源讨论（双向关联）
    const itemId = r.json.results[0].itemId;
    const st = JSON.parse(fs.readFileSync(path.join(dataDir, 'requirements', itemId, 'status.json'), 'utf8'));
    assert.equal(st.sourceDiscussion.id, id);

    // H3：archive / resume
    r = await req(port, 'POST', `/api/discussion/${id}/archive${P}`, {});
    assert.equal(r.json.discussion.status, 'archived');
    r = await req(port, 'GET', `/api/discussion/board${P}`);
    assert.equal(r.json.discussions[0].status, 'archived', '归档进入已归档档');
    assert.equal(r.json.discussions[0].createdCount, 1, '归档保留成果计数');
    r = await req(port, 'POST', `/api/discussion/${id}/resume${P}`, {});
    assert.equal(r.json.discussion.status, 'discussing');
    assert.equal(r.json.discussion.created.length, 1, '继续讨论不清空成果');

    // 详情全量
    r = await req(port, 'GET', `/api/discussion/${id}${P}`);
    assert.equal(r.status, 200);
    assert.equal(r.json.discussion.id, id);
    assert.equal(r.json.discussion.outcome.state, 'published');

    // 未初始化项目：board 空态
    const root2 = path.join(tmp, 'proj2');
    fs.mkdirSync(root2);
    const P2 = `?project=${encodeURIComponent(root2)}`;
    r = await req(port, 'GET', `/api/discussion/board${P2}`);
    assert.equal(r.status, 200);
    assert.equal(r.json.initialized, false, '未初始化项目返回空态引导');
    assert.deepEqual(r.json.discussions, []);
    r = await req(port, 'POST', `/api/discussion${P2}`, { title: 'x' });
    assert.equal(r.status, 400, '未初始化项目创建应 400');
  } finally {
    server.kill('SIGKILL');
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
