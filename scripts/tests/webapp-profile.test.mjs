#!/usr/bin/env node
// REQ-20260915-002 Web App 自动识别（webapp-profile）测试 C1~C4
// 用法：node scripts/tests/webapp-profile.test.mjs

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import * as profile from '../lib/webapp-profile.mjs';

const cases = [];
const t = (name, fn) => cases.push([name, fn]);
const tmpdir = () => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'atb-wap-')));

const fetchRes = (url) => new Promise((resolve, reject) => {
  http.get(url, (res) => {
    let s = '';
    res.on('data', (c) => { s += c; });
    res.on('end', () => resolve({ status: res.statusCode, body: s }));
  }).on('error', reject);
});

t('C1 vite 项目：识别框架、构建命令、产物目录、需安装', () => {
  const dir = tmpdir();
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({
    name: 'app',
    version: '1.4.0',
    scripts: { build: 'vite build' },
    devDependencies: { vite: '^5.0.0' },
  }));
  const p = profile.detectWebAppProfile(dir);
  assert.equal(p.detected, true);
  assert.equal(p.kind, 'package');
  assert.equal(p.framework, 'vite');
  assert.equal(p.buildCommand, 'vite build');
  assert.equal(p.outputDir, 'dist');
  assert.equal(p.needsInstall, true);
  assert.equal(p.version, '1.4.0');
});

t('C2 纯静态项目：无构建步骤，直接服务根目录', () => {
  const dir = tmpdir();
  fs.writeFileSync(path.join(dir, 'index.html'), '<!doctype html><meta name="app-version" content="0.9.0">');
  const p = profile.detectWebAppProfile(dir);
  assert.equal(p.detected, true);
  assert.equal(p.kind, 'static');
  assert.equal(p.buildCommand, null);
  assert.equal(p.outputDir, '.');
  assert.equal(p.needsInstall, false);
  assert.equal(p.version, null);
});

t('C3 识别失败：给诊断原因，不猜命令', () => {
  const dir = tmpdir();
  const p = profile.detectWebAppProfile(dir);
  assert.equal(p.detected, false);
  assert.ok(p.reason);
  assert.ok(Array.isArray(p.diagnostics) && p.diagnostics.length >= 1);
  // package.json 存在但既无 scripts.build 又无已知框架依赖
  const dir2 = tmpdir();
  fs.writeFileSync(path.join(dir2, 'package.json'), JSON.stringify({ name: 'x', version: '0.1.0', scripts: {} }));
  const p2 = profile.detectWebAppProfile(dir2);
  assert.equal(p2.detected, false);
  assert.ok(p2.diagnostics.some((d) => /build/.test(d)));
});

t('C4 端口分配 + 静态服务：空闲端口可监听，页面可访问，缺失文件 404', async () => {
  const port = await profile.allocLocalPort();
  assert.ok(Number.isInteger(port) && port > 0 && port < 65536);
  const dir = tmpdir();
  fs.writeFileSync(path.join(dir, 'index.html'), '<!doctype html><meta name="app-version" content="1.2.0">hello');
  const serve = await profile.startStaticServer(dir, port);
  try {
    assert.equal(serve.port, port);
    const res = await fetchRes(`http://127.0.0.1:${serve.port}/index.html`);
    assert.equal(res.status, 200);
    assert.ok(res.body.includes('1.2.0'));
    const miss = await fetchRes(`http://127.0.0.1:${serve.port}/nope.html`);
    assert.equal(miss.status, 404);
  } finally {
    await serve.close();
  }
  // 自动分配端口
  const serve2 = await profile.startStaticServer(dir);
  try {
    const res = await fetchRes(`http://127.0.0.1:${serve2.port}/`);
    assert.equal(res.status, 200);
  } finally {
    await serve2.close();
  }
});

/* ---------- 执行 ---------- */

let failed = 0;
for (const [name, fn] of cases) {
  try {
    await fn();
    console.log(`✓ ${name}`);
  } catch (e) {
    failed++;
    console.error(`✗ ${name}\n${e && e.stack ? e.stack : e}`);
  }
}
console.log(`webapp-profile：${cases.length - failed}/${cases.length} 通过`);
process.exit(failed ? 1 : 0);
