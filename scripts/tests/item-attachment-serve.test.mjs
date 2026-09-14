#!/usr/bin/env node
// REQ-20260909-009 新建需求 / Bug 描述支持截图 —— 服务接口测试 V1–V4。
// 覆盖：POST /api/new 携带附件、附件读取端点口径（MIME/nosniff/CSP/no-store/8MB/防穿越）、
// 非法附件整单拒绝、旧调用兼容。用法：node scripts/tests/item-attachment-serve.test.mjs

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

t('V1–V4 /api/new 附件链路与附件读取端点', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'atb-item-att-serve-'));
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

    // V1 创建需求带两张附件（按添加顺序）
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]);
    let r = await req(port, 'POST', `/api/new${P}`, {
      type: 'req',
      title: '带截图的需求',
      description: '见截图',
      attachments: [
        { name: 'a.png', dataBase64: png.toString('base64') },
        { name: 'b.webp', dataBase64: Buffer.from('webp').toString('base64') },
      ],
    });
    assert.equal(r.status, 201, `创建应成功（得到 ${r.status} ${JSON.stringify(r.json)}`);
    const id = r.json.id;
    const attDir = path.join(root, 'docs', 'agent-team-board', 'requirements', id, 'attachments');
    assert.deepEqual(fs.readdirSync(attDir).sort(), ['a.png', 'b.webp'], '附件应落盘条目 attachments/ 子目录');
    const md = fs.readFileSync(path.join(root, 'docs', 'agent-team-board', 'requirements', id, 'README.md'), 'utf8');
    assert.match(md, /!\[截图\]\(attachments\/a\.png\)\n!\[截图\]\(attachments\/b\.webp\)/, 'README 描述节末尾按顺序追加引用');

    // V1 附件读取端点：原字节 + 白名单 MIME + nosniff + 收敛 CSP + no-store
    r = await req(port, 'GET', `/api/item/${id}/attachment/a.png${P}`, null, true);
    assert.equal(r.status, 200);
    assert.equal(r.headers['content-type'], 'image/png');
    assert.equal(r.headers['x-content-type-options'], 'nosniff');
    assert.equal(r.headers['content-security-policy'], "default-src 'none'; style-src 'unsafe-inline'; img-src data:");
    assert.equal(r.headers['cache-control'], 'no-store');
    assert.ok(r.buf.equals(png), '字节应原样返回');
    r = await req(port, 'GET', `/api/item/${id}/attachment/b.webp${P}`, null, true);
    assert.equal(r.headers['content-type'], 'image/webp');

    // V3 防穿越与非白名单
    r = await req(port, 'GET', `/api/item/${id}/attachment/..%2Fstatus.json${P}`, null, true);
    assert.ok(r.status === 400 || r.status === 404, `穿越附件名应被拒绝（400/404，得到 ${r.status}）`);
    r = await req(port, 'GET', `/api/item/${id}/attachment/evil.sh${P}`, null, true);
    assert.equal(r.status, 400, '非图片后缀应 400');
    r = await req(port, 'GET', `/api/item/REQ-20990101-999/attachment/a.png${P}`, null, true);
    assert.ok(r.status === 400 || r.status === 404, '不存在条目应报错不崩溃');

    // V2 非法附件整单拒绝：目录数不变（不产生重复 / 半写入条目）
    const reqRoot = path.join(root, 'docs', 'agent-team-board', 'requirements');
    const before = fs.readdirSync(reqRoot).length;
    const badBodies = [
      { type: 'bug', title: '非图片', attachments: [{ name: 'x.sh', dataBase64: 'eA==' }] },
      { type: 'bug', title: '穿越', attachments: [{ name: '../x.png', dataBase64: 'eA==' }] },
      { type: 'bug', title: '超限', attachments: [{ name: 'x.png', dataBase64: Buffer.alloc(8 * 1024 * 1024 + 1).toString('base64') }] },
      { type: 'bug', title: '超张数', attachments: Array.from({ length: 10 }, (_, i) => ({ name: `s${i}.png`, dataBase64: 'eA==' })) },
      { type: 'bug', title: '缺数据', attachments: [{ name: 'x.png' }] },
    ];
    for (const body of badBodies) {
      r = await req(port, 'POST', `/api/new${P}`, body);
      assert.equal(r.status, 400, `非法附件应 400（${body.title}，得到 ${r.status}）`);
      assert.ok(r.json && typeof r.json.error === 'string' && r.json.error, '错误信息应非空');
    }
    assert.equal(fs.readdirSync(reqRoot).length, before, '被拒请求不得留下条目目录');

    // V4 兼容：不带 attachments 的旧调用仍成功
    r = await req(port, 'POST', `/api/new${P}`, { type: 'bug', title: '旧口径', description: '纯文本' });
    assert.equal(r.status, 201, '不带附件的旧调用应兼容');
    const bugDir = path.join(root, 'docs', 'agent-team-board', 'bugs', r.json.id);
    assert.equal(fs.existsSync(path.join(bugDir, 'attachments')), false, '无附件不建 attachments 目录');
  } finally {
    server.kill('SIGTERM');
  }
});

let failed = 0;
for (const [name, fn] of cases) {
  try { await fn(); console.log(`✓ ${name}`); }
  catch (e) { failed++; console.error(`✗ ${name}\n${e.stack}`); }
}
console.log(`\n${cases.length} 个用例，失败 ${failed}`);
process.exitCode = failed ? 1 : 0;
