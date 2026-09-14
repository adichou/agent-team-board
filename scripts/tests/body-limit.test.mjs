#!/usr/bin/env node
// BUG-20260907-004 请求体上限与错误反馈：前后端上限对齐（单张 8MB 附件 base64 ≈ 10.7MB 可提交），
// 超限请求返回完整 400 JSON（而非 req.destroy() 掐断连接致 ECONNRESET 网络错误）。
// 用法：node scripts/tests/body-limit.test.mjs

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
      timeout: 20000,
    }, (rs) => {
      const chunks = [];
      rs.on('data', (c) => chunks.push(c));
      rs.on('end', () => {
        const buf = Buffer.concat(chunks);
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

t('BUG-20260907-004 请求体上限对齐 + 超限 400 JSON', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'atb-body-limit-'));
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

    // T1 原 Bug 场景：单张 2MB 图片（>旧 1MB 限、前端 8MB 校验通过）应创建成功
    const png2m = Buffer.alloc(2 * 1024 * 1024, 1);
    let r = await req(port, 'POST', `/api/oncall/ticket${P}`, {
      title: '截图附件可用性',
      question: 'q',
      attachments: [{ name: 'big.png', dataBase64: png2m.toString('base64') }],
    });
    assert.equal(r.status, 200, `2MB 附件应创建成功（得到 ${r.status} ${JSON.stringify(r.json)}）`);
    assert.match(r.json.id, /^ASK-\d{8}-001$/);
    r = await req(port, 'GET', `/api/oncall/ticket/${r.json.id}${P}`);
    assert.deepEqual(r.json.rounds[0].attachments, ['big.png'], '附件应落盘登记');

    // T2 单张均合法但总量超上限（两张 7MB → base64 ≈ 18.7MB）：应答完整 400 JSON，连接不被掐断
    const png7m = Buffer.alloc(7 * 1024 * 1024, 2);
    r = await req(port, 'POST', `/api/oncall/ticket${P}`, {
      title: '总量超限',
      question: 'q',
      attachments: [
        { name: 'a.png', dataBase64: png7m.toString('base64') },
        { name: 'b.png', dataBase64: png7m.toString('base64') },
      ],
    });
    assert.equal(r.status, 400, `总量超限应 400（得到 ${r.status} ${r.raw.slice(0, 120)}）`);
    assert.match(r.json.error || '', /请求体过大/, '400 应带可读错误说明');

    // T3 对照 /api/new：超限文本同样 400 JSON 而非 ECONNRESET
    r = await req(port, 'POST', `/api/new${P}`, {
      type: 'req',
      title: '超长描述',
      description: 'x'.repeat(13 * 1024 * 1024),
    });
    assert.equal(r.status, 400, `/api/new 超限应 400（得到 ${r.status} ${r.raw.slice(0, 120)}）`);
    assert.match(r.json.error || '', /请求体过大/);

    // 超限后服务应仍可用（连接处理不残留、可继续创建）
    r = await req(port, 'POST', `/api/oncall/ticket${P}`, { title: '超限后恢复', question: 'q2' });
    assert.equal(r.status, 200, '超限请求之后服务应正常处理新请求');
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
