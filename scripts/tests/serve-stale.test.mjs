#!/usr/bin/env node
// BUG-20260907-017 使用「需求完善」等功能报错 —— 看板服务常驻进程版本过旧自愈
// 根因：server.mjs 路由集在进程启动时固化，静态前端实时读盘；代码更新后旧服务无新接口
//       （如 /api/refine/*），新前端调用得 404「未知接口」toast 报错；且 atb serve 探活
//       一律复用旧实例，用户无法自愈。
// 修复契约：health 暴露 pid/startedAt；atb serve 检测磁盘代码新于服务（或服务无 startedAt）
//       时自动 SIGTERM 优雅重启；前端对「未知接口」错误给出重启指引。
// 用法：node scripts/tests/serve-stale.test.mjs

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function getJson(port, pathname) {
  return new Promise((resolve, reject) => {
    const rq = http.request({ hostname: '127.0.0.1', port, path: pathname, method: 'GET', timeout: 2500 }, (rs) => {
      let out = '';
      rs.on('data', (c) => { out += c; });
      rs.on('end', () => {
        try { resolve({ status: rs.statusCode, json: JSON.parse(out || '{}') }); } catch { resolve({ status: rs.statusCode, json: null, raw: out }); }
      });
    });
    rq.on('error', reject);
    rq.on('timeout', () => { rq.destroy(); reject(new Error('timeout')); });
    rq.end();
  });
}

async function waitHealth(port, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    try {
      const r = await getJson(port, '/api/health');
      last = r;
      if (r.status === 200 && r.json && r.json.ok) return r.json;
    } catch {}
    await sleep(150);
  }
  throw new Error(`等待 /api/health 就绪超时（最后：${JSON.stringify(last)}`);
}

function runAtb(atbPath, args, cwd, env, timeoutMs = 30000) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [atbPath, ...args], { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    p.stdout.on('data', (c) => { out += c; });
    p.stderr.on('data', (c) => { err += c; });
    const timer = setTimeout(() => { p.kill(); resolve({ code: 124, out, err }); }, timeoutMs);
    p.on('close', (code) => { clearTimeout(timer); resolve({ code, out, err }); });
  });
}

// 拷贝插件运行骨架（atb/server/lib/web）到临时目录，便于操纵磁盘 mtime 模拟「代码更新」
function copySkeleton(tmp) {
  const dest = path.join(tmp, 'scripts');
  fs.mkdirSync(dest, { recursive: true });
  for (const f of ['atb.mjs', 'server.mjs']) fs.copyFileSync(path.join(pluginRoot, 'scripts', f), path.join(dest, f));
  fs.cpSync(path.join(pluginRoot, 'scripts', 'lib'), path.join(dest, 'lib'), { recursive: true });
  fs.cpSync(path.join(pluginRoot, 'scripts', 'web'), path.join(dest, 'web'), { recursive: true });
  return {
    atb: path.join(dest, 'atb.mjs'),
    server: path.join(dest, 'server.mjs'),
  };
}

function startServer(serverPath, cwdDir, port, registry) {
  return spawn(process.execPath, [serverPath], {
    cwd: cwdDir,
    env: { ...process.env, ATB_PORT: String(port), ATB_REGISTRY: registry, ATB_HOST: '127.0.0.1' },
    stdio: ['ignore', 'ignore', 'ignore'],
  });
}

async function exited(p, timeoutMs = 12000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (p.exitCode !== null || p.signalCode) return true;
    await sleep(150);
  }
  return false;
}

const cases = [];
const t = (name, fn) => cases.push([name, fn]);

// T1 health 暴露 pid 与 startedAt：客户端可判断服务新旧、定位进程
t('T1 /api/health 返回 pid 与 startedAt', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'atb-stale-h-'));
  const port = 34100 + Math.floor(Math.random() * 5000);
  const server = startServer(path.join(pluginRoot, 'scripts', 'server.mjs'), tmp, port, path.join(tmp, 'reg.json'));
  try {
    const h = await waitHealth(port);
    assert.equal(typeof h.pid, 'number', 'health 应含数字 pid');
    assert.equal(h.pid, server.pid, 'health.pid 应等于服务进程 pid');
    assert.equal(typeof h.startedAt, 'string', 'health 应含 startedAt');
    const started = Date.parse(h.startedAt);
    assert.ok(Number.isFinite(started), `startedAt 应为合法 ISO 时间，得到：${h.startedAt}`);
    assert.ok(started <= Date.now() + 5000, 'startedAt 不应晚于当前时间');
  } finally {
    server.kill();
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
  }
});

// T2 磁盘代码新于在运行服务 → atb serve 自动优雅重启替换（本 Bug 主场景）
t('T2 服务旧于磁盘代码时 atb serve 自动重启替换', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'atb-stale-s2-'));
  const proj = path.join(tmp, 'proj');
  fs.mkdirSync(proj, { recursive: true });
  const sk = copySkeleton(tmp);
  const port = 34600 + Math.floor(Math.random() * 5000);
  const registry = path.join(tmp, 'reg.json');
  const old = startServer(sk.server, proj, port, registry);
  let h = await waitHealth(port);
  const oldPid = h.pid;
  assert.equal(oldPid, old.pid, '预置服务应正常运行');

  // 模拟「服务启动后代码被更新」：磁盘 server.mjs mtime 拨到服务启动时间之后
  const future = new Date(Date.now() + 60_000);
  fs.utimesSync(sk.server, future, future);
  fs.utimesSync(path.join(path.dirname(sk.server), 'lib', 'core.mjs'), future, future);

  const r = await runAtb(sk.atb, ['serve', '--port', String(port)], proj, { ...process.env, ATB_REGISTRY: registry }, 30000);
  assert.equal(r.code, 0, `serve 应成功退出：stdout=${r.out} stderr=${r.err}`);
  assert.match(r.out, /版本过旧|已自动重启|重启/, '应说明检测到过旧并已重启');

  const oldGone = await exited(old);
  assert.ok(oldGone, '旧服务进程应已退出');
  h = await waitHealth(port);
  assert.notEqual(h.pid, oldPid, '端口上应是新服务进程');
  assert.equal(typeof h.startedAt, 'string', '新服务仍应暴露 startedAt');
  try { process.kill(h.pid, 'SIGTERM'); } catch {}
});

// T3 服务不旧于磁盘代码（正常运行）→ 维持复用语义，不误杀
t('T3 服务不旧时 atb serve 照常复用、不误杀', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'atb-stale-s3-'));
  const proj = path.join(tmp, 'proj');
  fs.mkdirSync(proj, { recursive: true });
  const sk = copySkeleton(tmp);
  const port = 35100 + Math.floor(Math.random() * 5000);
  const registry = path.join(tmp, 'reg.json');
  const cur = startServer(sk.server, proj, port, registry);
  const h0 = await waitHealth(port);
  assert.equal(h0.pid, cur.pid);

  // 不动 mtime：磁盘代码（拷贝时间）早于服务启动 → 应复用
  const r = await runAtb(sk.atb, ['serve', '--port', String(port)], proj, { ...process.env, ATB_REGISTRY: registry }, 30000);
  assert.equal(r.code, 0, `serve 应成功：${r.err}`);
  assert.match(r.out, /复用|已在运行/, '应提示复用现有实例');
  assert.ok(!/已自动重启|版本过旧/.test(r.out), '不应触发重启');
  assert.equal(cur.exitCode, null, '现有服务不应被杀');
  const h1 = await waitHealth(port);
  assert.equal(h1.pid, cur.pid, '服务进程应保持不变');
  cur.kill();
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
});

// T4 前端 api() 对「未知接口」错误附加重启指引（版本漂移时用户得到可操作提示）
t('T4 前端对未知接口错误给出重启指引', async () => {
  const src = fs.readFileSync(path.join(pluginRoot, 'scripts', 'web', 'app.js'), 'utf8');
  const apiFn = src.slice(src.indexOf('async function api('), src.indexOf('async function api(') + 900);
  assert.match(apiFn, /未知接口/, 'api() 应识别「未知接口」错误');
  assert.match(apiFn, /atb serve|重启/, '应指引重启看板服务');
});

// T5 老形态服务（health 无 startedAt/pid，即用户现场）：serve 借助 lsof 定位并替换
t('T5 无 startedAt 的旧服务被定位并重启（用户现场复刻）', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'atb-stale-s5-'));
  const proj = path.join(tmp, 'proj');
  fs.mkdirSync(proj, { recursive: true });
  const sk = copySkeleton(tmp);
  const port = 35600 + Math.floor(Math.random() * 5000);
  const registry = path.join(tmp, 'reg.json');

  // 复刻用户现场：独立子进程"老服务"——/api/health 响应 200 但无 pid/startedAt，
  // 其余接口一律 404「未知接口」（新前端调用即报错，正是 BUG-20260907-017 现象）
  const stubPath = path.join(tmp, 'old-server.mjs');
  fs.writeFileSync(stubPath, [
    "import http from 'node:http';",
    `const PORT = ${port};`,
    `const PROJ = ${JSON.stringify(proj)};`,
    `http.createServer((rq, rs) => {`,
    `  if (rq.url.startsWith('/api/health')) {`,
    `    rs.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });`,
    `    rs.end(JSON.stringify({ ok: true, port: PORT, version: '0.1.0', projects: [PROJ], defaultProject: PROJ }));`,
    `    return;`,
    `  }`,
    `  rs.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });`,
    `  rs.end(JSON.stringify({ error: '未知接口：' + rq.method + ' ' + rq.url.split('?')[0] }));`,
    `}).listen(PORT, '127.0.0.1');`,
  ].join('\n'));
  const stub = spawn(process.execPath, [stubPath], { stdio: 'ignore' });
  const h0 = await waitHealth(port);
  assert.equal(h0.pid, undefined, '老服务 health 不应含 pid');
  assert.equal(h0.startedAt, undefined, '老服务 health 不应含 startedAt');
  const miss = await getJson(port, '/api/refine/current');
  assert.equal(miss.status, 404, '老服务对新接口应 404（复刻报错现场）');

  const r = await runAtb(sk.atb, ['serve', '--port', String(port)], proj, { ...process.env, ATB_REGISTRY: registry }, 30000);
  assert.ok(/版本过旧|已自动重启|重启/.test(r.out + r.err), `应检测过旧并重启：${r.out}${r.err}`);
  const stubGone = await exited(stub);
  assert.ok(stubGone, '老服务进程应被优雅停止');
  const h1 = await waitHealth(port);
  assert.equal(typeof h1.pid, 'number', '替换后应为新服务（health 有 pid）');
  assert.notEqual(h1.pid, stub.pid, '新服务不应是老进程');
  const ok = await getJson(port, '/api/refine/current?project=' + encodeURIComponent(proj));
  assert.ok(ok.json && typeof ok.json.error === 'string' && !ok.json.error.startsWith('未知接口'),
    `新服务应已加载 refine 路由（业务错误亦可，不得再是「未知接口」），得到 ${ok.status}：${JSON.stringify(ok.json)}`);
  try { process.kill(h1.pid, 'SIGTERM'); } catch {}
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
});

let failed = 0;
for (const [name, fn] of cases) {
  try {
    await fn();
    console.log(`✓ ${name}`);
  } catch (e) {
    failed++;
    console.error(`✗ ${name}\n  ${e && e.stack ? e.stack.split('\n').slice(0, 6).join('\n  ') : e}`);
  }
}
console.log(failed ? `\n失败 ${failed} 例` : '\n全部通过');
process.exit(failed ? 1 : 0);
