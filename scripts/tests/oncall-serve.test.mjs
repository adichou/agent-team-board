#!/usr/bin/env node
// REQ-20260907-001 Oncall 咨询看板 —— Status Board 服务接口测试（H1~H3）
// 覆盖：创建（含 base64 附件）、board/详情/轮次/附件字节端点、追问、zcode 批量派单与账本、codexReady
// 用法：node scripts/tests/oncall-serve.test.mjs

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function req(port, method, pathname, body, raw = false) {
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
        if (raw) return resolve({ status: rs.statusCode, headers: rs.headers, buf });
        let json = null;
        try { json = JSON.parse(buf.toString() || '{}'); } catch {}
        resolve({ status: rs.statusCode, json, raw: buf.toString() });
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

t('H1/H2/H3 oncall 接口全链路', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'atb-oncall-serve-'));
  const root = path.join(tmp, 'proj');
  fs.mkdirSync(root);
  // 先初始化看板数据目录（不经 HTTP init，避免依赖默认项目注册）
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
  try {
    let up = false;
    for (let i = 0; i < 40; i++) {
      await sleep(150);
      try { await req(port, 'GET', '/api/health'); up = true; break; } catch {}
    }
    assert.ok(up, '服务应启动');

    // H1 创建（含 base64 附件）
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]);
    let r = await req(port, 'POST', `/api/oncall/ticket${P}`, {
      title: '构建为何失败',
      question: '## 现象\nnpm test 挂了，看截图',
      attachments: [{ name: 'err.png', dataBase64: png.toString('base64') }],
    });
    assert.equal(r.status, 200, `创建应成功（得到 ${r.status} ${JSON.stringify(r.json)}`);
    const id = r.json.id;
    assert.match(id, /^ASK-\d{8}-001$/);
    assert.equal(r.json.status, 'pending');

    // H3 board：卡片字段 + codexReady（未配置 CLI → false）
    r = await req(port, 'GET', `/api/oncall/board${P}`);
    assert.equal(r.status, 200);
    assert.equal(r.json.tickets.length, 1);
    const card = r.json.tickets[0];
    assert.equal(card.id, id);
    assert.equal(card.title, '构建为何失败');
    assert.equal(card.roundCount, 1);
    assert.ok('codexReady' in r.json, 'board 应携带 codexReady');
    assert.equal(typeof r.json.codexReady, 'boolean', 'codexReady 应为布尔（本机可能装有 codex，不硬编码 false）');

    // 详情 + 轮次内容
    r = await req(port, 'GET', `/api/oncall/ticket/${id}${P}`);
    assert.equal(r.status, 200);
    assert.equal(r.json.rounds[0].attachments.length, 1, '轮次应登记附件');
    r = await req(port, 'GET', `/api/oncall/ticket/${id}/round/1${P}`);
    assert.equal(r.status, 200);
    assert.match(r.json.question, /npm test 挂了/);
    assert.equal(r.json.answer, null, '未回答时 answer 为 null');

    // 附件字节端点：MIME + nosniff
    r = await req(port, 'GET', `/api/oncall/ticket/${id}/attachment/err.png${P}`, null, true);
    assert.equal(r.status, 200);
    assert.equal(r.headers['content-type'], 'image/png');
    assert.equal(r.headers['x-content-type-options'], 'nosniff');
    assert.ok(r.buf.equals(png), '字节应原样返回');
    r = await req(port, 'GET', `/api/oncall/ticket/${id}/attachment/..%2Fticket.json${P}`, null, true);
    assert.ok(r.status === 400 || r.status === 404, `穿越附件名应被拒绝（400/404，得到 ${r.status}）`);
    r = await req(port, 'GET', `/api/oncall/ticket/${id}/attachment/evil.sh${P}`, null, true);
    assert.equal(r.status, 400, '非图片后缀应 400');

    // H2 追问
    r = await req(port, 'POST', `/api/oncall/ticket/${id}/ask${P}`, { question: '补充：本地是 node 22' });
    assert.equal(r.status, 200);
    r = await req(port, 'GET', `/api/oncall/ticket/${id}${P}`);
    assert.equal(r.json.rounds.length, 2, '追问后两轮');
    assert.equal(r.json.status, 'pending', '追问拉回待回复');

    // H2 zcode 批量派单：两单一起
    r = await req(port, 'POST', `/api/oncall/ticket${P}`, { title: '第二个问题', question: 'q2' });
    const id2 = r.json.id;
    r = await req(port, 'POST', `/api/oncall/dispatch${P}`, { ids: [id, id2], mode: 'zcode', staff: '李四' });
    assert.equal(r.status, 200, `zcode 派单应成功（${JSON.stringify(r.json)}`);
    assert.match(r.json.prompt, /请将当前会话名改为：oncall-\d{8}-李四/, '提示词命名指令');
    assert.match(r.json.prompt, /oncall answer/, '提示词含回传命令');
    assert.deepEqual(r.json.dispatched.sort(), [id, id2].sort());
    r = await req(port, 'GET', `/api/oncall/board${P}`);
    assert.ok(r.json.tickets.every((x) => x.status === 'answering'), '两单均转回复中');
    assert.ok(r.json.tickets.every((x) => x.lastMode === 'zcode'), '卡片带派单模式徽标');

    // 派单账本
    r = await req(port, 'GET', `/api/oncall/dispatch/records${P}`);
    assert.equal(r.status, 200);
    assert.ok(r.json.records.length >= 1, '应有派单记录');
    assert.equal(r.json.records[0].staff, '李四');
    assert.equal(r.json.records[0].mode, 'zcode');

    // 非法参数 400
    r = await req(port, 'POST', `/api/oncall/dispatch${P}`, { ids: [], mode: 'zcode' });
    assert.equal(r.status, 400, '空 ids 应 400');
    r = await req(port, 'POST', `/api/oncall/dispatch${P}`, { ids: [id], mode: 'wrong' });
    assert.equal(r.status, 400, '非法 mode 应 400');
    r = await req(port, 'POST', `/api/oncall/ticket${P}`, { title: '', question: 'x' });
    assert.equal(r.status, 400, '空标题应 400');
    r = await req(port, 'POST', `/api/oncall/ticket${P}`, {
      title: 'x', question: 'y',
      attachments: [{ name: 'a.sh', dataBase64: Buffer.from('x').toString('base64') }],
    });
    assert.equal(r.status, 400, '非图片附件应 400');

    // codex 未就绪：显式配置不存在的 CLI 路径后 dispatch codex → 400 带原因
    // （不能用缺省态断言：本机 PATH/ChatGPT.app 可能装有真 codex，detectCli 会探测到）
    r = await req(port, 'POST', `/api/oncall/ticket${P}`, { title: '第三个问题', question: 'q3' });
    const id3 = r.json.id;
    r = await req(port, 'POST', `/api/dispatch/settings${P}`, { codex: { cliPath: '/nonexistent/atb-test-codex' } });
    assert.equal(r.status, 200);
    r = await req(port, 'GET', `/api/oncall/board${P}`);
    assert.equal(r.json.codexReady, false, '显式指向不存在的 CLI 时 codexReady=false');
    r = await req(port, 'POST', `/api/oncall/dispatch${P}`, { ids: [id3], mode: 'codex', staff: '' });
    assert.equal(r.status, 400, 'codex 未就绪时 codex 派单应 400');
    assert.match(r.json.error, /codex|CLI/, '应说明环境未就绪');
  } finally {
    server.kill();
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
  }
});

t('H4 REQ-20260908-013 正文可空：只传 title（question 缺省/空串）返回 200，第 1 轮问题回退标题', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'atb-oncall-serve-opt-'));
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
  try {
    let up = false;
    for (let i = 0; i < 40; i++) {
      await sleep(150);
      try { await req(port, 'GET', '/api/health'); up = true; break; } catch {}
    }
    assert.ok(up, '服务应启动');

    let r = await req(port, 'POST', `/api/oncall/ticket${P}`, { title: '部署后看板列表为空，如何排查？' }); // question 缺省
    assert.equal(r.status, 200, `question 缺省应创建成功（得到 ${r.status} ${JSON.stringify(r.json)}`);
    const id = r.json.id;
    assert.equal(r.json.status, 'pending', '留空创建同样待回复');

    r = await req(port, 'POST', `/api/oncall/ticket${P}`, { title: '第二问', question: '' }); // 空串
    assert.equal(r.status, 200, `空串 question 应创建成功（得到 ${r.status} ${JSON.stringify(r.json)}`);

    r = await req(port, 'GET', `/api/oncall/ticket/${id}${P}`);
    assert.equal(r.status, 200);
    assert.equal(r.json.rounds[0].question, '部署后看板列表为空，如何排查？', '详情第 1 轮问题应为标题');
    r = await req(port, 'GET', `/api/oncall/ticket/${id}/round/1${P}`);
    assert.equal(r.json.question, '部署后看板列表为空，如何排查？', '轮次端点第 1 轮问题应为标题');

    // 回归：标题必填不放松
    r = await req(port, 'POST', `/api/oncall/ticket${P}`, { title: '', question: '' });
    assert.equal(r.status, 400, '空标题仍应 400');
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
