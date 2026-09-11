#!/usr/bin/env node
// REQ-20260902-003 atb serve 子命令 —— 静态契约 + 探活复用集成
// 用法：node scripts/tests/serve.test.mjs

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const atb = path.join(pluginRoot, 'scripts', 'atb.mjs');
const src = fs.readFileSync(atb, 'utf8');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function runAtb(args, cwd, timeoutMs = 20000) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [atb, ...args], { cwd, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    p.stdout.on('data', (c) => { out += c; });
    p.stderr.on('data', (c) => { err += c; });
    const timer = setTimeout(() => { p.kill(); resolve({ code: 124, out, err }); }, timeoutMs);
    p.on('close', (code) => { clearTimeout(timer); resolve({ code, out, err }); });
  });
}

const cases = [];
const t = (name, fn) => cases.push([name, fn]);

t('V1 serve 子命令存在：代码含探活、后台拉起、健康等待、--open 打开', () => {
  assert.match(src, /'serve'|\"serve\"/, '应注册 serve 子命令');
  assert.match(src, /api\/health/, '应探活');
  assert.match(src, /spawn|detached/, '应后台拉起 server');
  assert.match(src, /--open/, '应支持 --open');
  assert.match(src, /open\b|xdg-open/, '应调用系统打开');
});

t('V2 serve --help 不起服务', async () => {
  const r = await runAtb(['serve', '--help'], pluginRoot, 8000);
  assert.equal(r.code, 0);
  assert.match(r.out + r.err, /serve/, '帮助应说明 serve');
});

t('V3 集成：对已运行实例探活复用（不重复起服务）', async () => {
  // 用随机端口起一个 server，然后 serve --port 同端口，应在短超时内返回且服务仍是同一个
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'atb-serve-'));
  fs.mkdirSync(path.join(tmp, 'p'), { recursive: true });
  const proj = fs.realpathSync(path.join(tmp, 'p'));
  const port = 30331;
  const server = spawn(process.execPath, [path.join(pluginRoot, 'scripts', 'server.mjs')], {
    cwd: proj, env: { ...process.env, ATB_PORT: String(port), ATB_REGISTRY: path.join(tmp, 'reg.json') },
    stdio: ['ignore', 'ignore', 'ignore'],
  });
  try {
    let up = false;
    for (let i = 0; i < 30; i++) {
      await sleep(200);
      try {
        const ok = await new Promise((res) => {
          const rq = http.request({ hostname: '127.0.0.1', port, path: '/api/health', method: 'GET', timeout: 1200 }, (rs) => { res(rs.statusCode === 200); rs.resume(); });
          rq.on('error', () => res(false));
          rq.on('timeout', () => { rq.destroy(); res(false); });
          rq.end();
        });
        if (ok) { up = true; break; }
      } catch {}
    }
    assert.ok(up, '预置 server 应已启动');
    const r = await runAtb(['serve', '--port', String(port), '--no-open'], proj, 15000);
    assert.equal(r.code, 0, `serve 应成功复用：${r.err}`);
    assert.match(r.out, /已在运行|复用|already/, '应提示复用现有实例');
    // 原进程应仍活着
    assert.equal(server.kill(0), true, '原 server 不应被杀');
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
