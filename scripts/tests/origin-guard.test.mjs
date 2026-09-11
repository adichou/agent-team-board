#!/usr/bin/env node
// BUG-20260907-005 看板 API 跨站防护：/api/* 校验 Host / Origin / Referer，
// 恶意网页（fetch text/plain 简单请求、无预检）代替人工「接受/确认完成」应被 403 拒绝；
// 本机非浏览器客户端（curl / Electron 探活，不带 Origin/Referer）与同源看板页面不受影响。
// 用法：node scripts/tests/origin-guard.test.mjs

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// headers 显式透传（含 Host/Origin/Referer/Content-Type），默认不带任何来源头（模拟 curl）
function req(port, method, pathname, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const payload = body == null ? null : JSON.stringify(body);
    const base = { ...headers };
    if (payload && !base['Content-Type']) base['Content-Type'] = 'application/json';
    if (payload) base['Content-Length'] = Buffer.byteLength(payload);
    const r = http.request({ hostname: '127.0.0.1', port, path: pathname, method, headers: base, timeout: 20000 }, (rs) => {
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

function runAtb(args, cwd, timeoutMs = 20000) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [path.join(pluginRoot, 'scripts', 'atb.mjs'), ...args], { cwd, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
    let err = '';
    p.stderr.on('data', (c) => { err += c; });
    const timer = setTimeout(() => { p.kill(); resolve({ code: 124, err }); }, timeoutMs);
    p.on('close', (code) => { clearTimeout(timer); resolve({ code, err }); });
  });
}

const cases = [];
const t = (name, fn) => cases.push([name, fn]);

t('BUG-20260907-005 跨站请求防护：拒绝恶意 Origin/Referer/Host，放行同源与非浏览器客户端', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'atb-origin-guard-'));
  const root = path.join(tmp, 'proj');
  fs.mkdirSync(root);
  assert.equal(await new Promise((resolve) => {
    const p = spawn(process.execPath, [path.join(pluginRoot, 'scripts', 'atb.mjs'), 'init', '--dir', root], { stdio: 'ignore' });
    p.on('close', resolve);
  }), 0, 'atb init 应成功');

  const port = 31000 + Math.floor(Math.random() * 20000);
  const server = spawn(process.execPath, [path.join(pluginRoot, 'scripts', 'server.mjs')], {
    cwd: root,
    env: { ...process.env, ATB_PORT: String(port), ATB_REGISTRY: path.join(tmp, 'reg.json') },
    stdio: ['ignore', 'ignore', 'ignore'], // 服务器日志
  });
  const P = `?project=${encodeURIComponent(root)}`;
  const sameOrigin = `http://127.0.0.1:${port}`;
  try {
    let up = false;
    for (let i = 0; i < 40; i++) {
      await sleep(150);
      try { await req(port, 'GET', '/api/health'); up = true; break; } catch {}
    }
    assert.ok(up, '服务应启动');

    // 条目 A：经 /api/new 创建（不带来源头，非浏览器调用应始终可用）
    let r = await req(port, 'POST', `/api/new${P}`, { type: 'req', title: 'CSRF 防护验证 A' });
    assert.equal(r.status, 201, `非浏览器 POST /api/new 应可用（得到 ${r.status} ${r.raw.slice(0, 120)}）`);
    const idA = r.json.id;

    // T1 Bug 主场景：恶意网页用 fetch 发 text/plain 简单请求（无预检）代替人工接受 → 403，状态不变
    r = await req(port, 'POST', `/api/item/${idA}/status${P}`, { to: 'accepted' }, {
      Origin: 'http://evil.example', 'Content-Type': 'text/plain',
    });
    assert.equal(r.status, 403, `跨站 Origin 的状态流转应 403（得到 ${r.status} ${r.raw.slice(0, 120)}）`);
    r = await req(port, 'GET', `/api/item/${idA}${P}`);
    assert.equal(r.json.status, 'submitted', '被拒请求不得改变条目状态');

    // T2 无 Origin/Referer 的本机客户端（curl / Electron 探活同形）：人工流转仍可用 → accepted
    r = await req(port, 'POST', `/api/item/${idA}/status${P}`, { to: 'accepted' }, { 'Content-Type': 'text/plain' });
    assert.equal(r.status, 200, `非浏览器状态流转应可用（得到 ${r.status} ${r.raw.slice(0, 120)}）`);
    assert.equal(r.json.status, 'accepted');

    // T3 同源看板页面（Origin 与服务同源）：认领后确认完成可用 → done
    const claim = await runAtb(['claim', idA, '--by', 'origin-guard-test', '--dir', root], root);
    assert.equal(claim.code, 0, `atb claim 应成功：${claim.err}`);
    r = await req(port, 'POST', `/api/item/${idA}/status${P}`, { to: 'done' }, { Origin: sameOrigin });
    assert.equal(r.status, 200, `同源 Origin 的确认完成应可用（得到 ${r.status} ${r.raw.slice(0, 120)}）`);
    assert.equal(r.json.status, 'done');

    // T4 Referer 携带恶意来源（Origin 缺席，如部分表单/导航场景）→ 403
    r = await req(port, 'POST', `/api/new${P}`, { type: 'req', title: 'CSRF 防护验证 B' });
    const idB = r.json.id;
    r = await req(port, 'POST', `/api/item/${idB}/status${P}`, { to: 'accepted' }, {
      Referer: 'http://evil.example/attack.html', 'Content-Type': 'text/plain',
    });
    assert.equal(r.status, 403, `跨站 Referer 的状态流转应 403（得到 ${r.status} ${r.raw.slice(0, 120)}）`);
    r = await req(port, 'GET', `/api/item/${idB}${P}`);
    assert.equal(r.json.status, 'submitted', 'Referer 被拒同样不得改变状态');

    // T5 DNS rebinding：Host 头被换成攻击者域名 → 403（含只读接口）
    r = await req(port, 'GET', '/api/health', null, { Host: `evil.example:${port}` });
    assert.equal(r.status, 403, `可疑 Host 应 403（得到 ${r.status} ${r.raw.slice(0, 120)}）`);

    // T6 只读接口同样拦截跨站 Origin（降低信息泄露面）
    r = await req(port, 'GET', `/api/board${P}`, null, { Origin: 'https://evil.example' });
    assert.equal(r.status, 403, `跨站 GET /api/board 应 403（得到 ${r.status}）`);

    // T7 回环别名（localhost 打开的看板页）与同源 Referer 放行
    r = await req(port, 'POST', `/api/new${P}`, { type: 'bug', title: 'localhost 别名来源' }, { Origin: `http://localhost:${port}` });
    assert.equal(r.status, 201, `localhost 回环 Origin 应放行（得到 ${r.status} ${r.raw.slice(0, 120)}）`);
    r = await req(port, 'GET', `/api/board${P}`, null, { Referer: `${sameOrigin}/` });
    assert.equal(r.status, 200, `同源 Referer 的 GET 应放行（得到 ${r.status}）`);

    // 拒绝后服务应仍正常（后续请求不受影响）
    r = await req(port, 'GET', '/api/health');
    assert.equal(r.status, 200, '拦截请求后服务应仍可用');
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
