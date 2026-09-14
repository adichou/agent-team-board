#!/usr/bin/env node
// BUG-20260914-013 集成测试泄漏 server/stub 进程：端口占用预检、确定性收尾、run-all 聚合兜底
// 载体：scripts/tests/lib/test-process.mjs（pickFreePort/stopChild/stopPid/waitHealth/listTestResidue/sweepTestResidue）
// 用例：见 docs/agent-team-board/bugs/BUG-20260914-013/test-cases.md（C1–C9）

import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as mod from './lib/test-process.mjs';

const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const cases = [];
const t = (name, fn) => cases.push([name, fn]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const alive = (pid) => {
  try { process.kill(pid, 0); return true; } catch { return false; }
};

// 复刻泄漏 stub：/api/health 返回 200 {ok:true}（可带/不带 pid），其余 404
async function startStub(port, { pid = null } = {}) {
  const srv = http.createServer((rq, rs) => {
    if (rq.url.startsWith('/api/health')) {
      rs.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      rs.end(JSON.stringify(pid ? { ok: true, pid } : { ok: true }));
      return;
    }
    rs.writeHead(404); rs.end('{}');
  });
  await new Promise((r) => srv.listen(port, '127.0.0.1', r));
  return srv;
}

const read = (...p) => fs.readFileSync(path.join(PLUGIN_ROOT, ...p), 'utf8');

// ---------- C1 pickFreePort 跳过被占端口 ----------
t('C1 pickFreePort 跳过被占端口并返回空闲端口', async () => {
  const base = 34100 + Math.floor(Math.random() * 2000);
  const held = await startStub(base); // 复刻残留监听者
  try {
    const port = await mod.pickFreePort({ min: base, max: base + 1, tries: 4 });
    assert.equal(port, base + 1, '应跳过被占端口选下一个');
    assert.equal(await mod.probePortFree(port), true, '返回端口应探测空闲');
  } finally {
    await new Promise((r) => held.close(r));
  }
});

// ---------- C2 pickFreePort 全占快速失败 ----------
t('C2 pickFreePort 全被占时快速失败并明确报端口被占', async () => {
  const base = 36500 + Math.floor(Math.random() * 2000);
  const s1 = await startStub(base);
  const s2 = await startStub(base + 1);
  const t0 = Date.now();
  try {
    await assert.rejects(
      mod.pickFreePort({ min: base, max: base + 1, tries: 8 }),
      (e) => /无可用端口|端口被占/.test(e.message),
      '应抛「无可用端口/端口被占」而非就绪超时类误导信息',
    );
    assert.ok(Date.now() - t0 < 3000, `应在 3s 内快速失败，实际 ${Date.now() - t0}ms`);
  } finally {
    await Promise.all([s1, s2].map((s) => new Promise((r) => s.close(r))));
  }
});

// ---------- C3 stopChild 优雅路径 ----------
t('C3 stopChild 对可优雅退出的子进程快速回收', async () => {
  const child = spawn(process.execPath, ['-e', 'process.on(\'SIGTERM\',()=>process.exit(0)); setInterval(()=>{},1<<30);'], { stdio: 'ignore' });
  await sleep(250);
  assert.ok(alive(child.pid), '子进程应已启动');
  const t0 = Date.now();
  await mod.stopChild(child, { timeoutMs: 4000 });
  assert.ok(Date.now() - t0 < 3500, `应快速返回，实际 ${Date.now() - t0}ms`);
  assert.ok(!alive(child.pid), '子进程应已退出');
});

// ---------- C4 stopChild 顽固进程 SIGKILL 兜底 ----------
t('C4 stopChild 对忽略 SIGTERM 的进程按超时 SIGKILL 兜底', async () => {
  const child = spawn(process.execPath, ['-e', 'process.on(\'SIGTERM\',()=>{}); setInterval(()=>{},1<<30);'], { stdio: 'ignore' });
  await sleep(250);
  const t0 = Date.now();
  await mod.stopChild(child, { timeoutMs: 1200 });
  const cost = Date.now() - t0;
  assert.ok(cost >= 1000 && cost < 5000, `应在超时+有界强杀窗口内返回，实际 ${cost}ms`);
  assert.ok(!alive(child.pid), '顽固进程应被 SIGKILL 回收');
});

// ---------- C5 stopPid 幂等 ----------
t('C5 stopPid 对已退出 pid 幂等不抛错', async () => {
  const child = spawn(process.execPath, ['-e', 'process.exit(0)'], { stdio: 'ignore' });
  await new Promise((r) => child.on('exit', r));
  await assert.doesNotReject(mod.stopPid(child.pid, { timeoutMs: 800 }));
});

// ---------- C6 waitHealth 诊断 ----------
t('C6a waitHealth 正常就绪（pid 匹配）', async () => {
  const base = 37500 + Math.floor(Math.random() * 1000);
  const stubPid = 424242; // 与 health.pid 一致的期望值
  const srv = await startStub(base, { pid: stubPid });
  try {
    const h = await mod.waitHealth(base, { expectPid: stubPid, timeoutMs: 3000 });
    assert.equal(h.pid, stubPid);
  } finally {
    await new Promise((r) => srv.close(r));
  }
});

t('C6b waitHealth 命中非目标 health 时报端口被占而非误导超时', async () => {
  const base = 38500 + Math.floor(Math.random() * 500);
  const srv = await startStub(base); // 无 pid 的冒牌 health（run-all round3 现场复刻）
  try {
    await assert.rejects(
      mod.waitHealth(base, { expectPid: 999999, timeoutMs: 900 }),
      (e) => /非目标|端口被占|残留/.test(e.message),
      '超时报错应指向端口被占/命中非目标服务',
    );
  } finally {
    await new Promise((r) => srv.close(r));
  }
});

// ---------- C7/C8 sweep 检测与清理 ----------
t('C7 sweep 检测并确定性清理标记残留（atb-* 临时目录 stub）', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'atb-leak-'));
  const stubPath = path.join(tmp, 'old-server.mjs');
  const port = 44500 + Math.floor(Math.random() * 1000);
  fs.writeFileSync(stubPath, [
    "import http from 'node:http';",
    `http.createServer((q,s)=>{s.end(JSON.stringify({ok:true}))}).listen(${port},'127.0.0.1');`,
    'setInterval(()=>{},1<<30);',
  ].join('\n'));
  const stub = spawn(process.execPath, [stubPath], { stdio: 'ignore' });
  try {
    await sleep(300);
    assert.ok(alive(stub.pid), '残留 stub 应在运行');
    const found = await mod.listTestResidue();
    assert.ok(found.some((r) => r.pid === stub.pid), `应检测到标记残留（检测到 ${found.length} 个）`);
    const swept = await mod.sweepTestResidue({ label: 'C7' });
    assert.ok(swept.some((r) => r.pid === stub.pid), '清理记录应包含该残留');
    await sleep(300);
    assert.ok(!alive(stub.pid), '残留 stub 应被确定性回收');
  } finally {
    try { stub.kill('SIGKILL'); } catch {}
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
  }
});

// C7b cwd 形态残留（dispatch-api/T1 形态）：argv 是插件 server.mjs、工作目录在 atb-* 临时目录。
// 复刻 2026-09-08 起实际泄漏的 atb-api-*/atb-mapi-* 进程（含 macOS /var → /private/var 符号链接差异）。
t('C7b sweep 检测 cwd 形态残留（插件 server.mjs + atb-* 临时工作目录）', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'atb-api-'));
  const port = await mod.pickFreePort({ min: 45500, max: 46499 });
  const server = spawn(process.execPath, [path.join(PLUGIN_ROOT, 'scripts', 'server.mjs')], {
    cwd: tmp,
    env: { ...process.env, ATB_PORT: String(port), ATB_HOST: '127.0.0.1', ATB_REGISTRY: path.join(tmp, 'reg.json') },
    stdio: 'ignore',
  });
  try {
    await mod.waitHealth(port, { expectPid: server.pid, timeoutMs: 15_000 });
    const found = await mod.listTestResidue();
    assert.ok(found.some((r) => r.pid === server.pid), `应检测到 cwd 形态残留（检测到 ${found.length} 个）`);
    const swept = await mod.sweepTestResidue({ label: 'C7b' });
    assert.ok(swept.some((r) => r.pid === server.pid), '清理记录应包含该残留');
    await sleep(300);
    assert.ok(!alive(server.pid), 'cwd 形态残留应被确定性回收');
  } finally {
    try { server.kill('SIGKILL'); } catch {}
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
  }
});

t('C8 sweep 不误杀无标记监听者（node -e 与第三方应用）', async () => {
  const port = 46500 + Math.floor(Math.random() * 1000);
  const plain = spawn(process.execPath, ['-e', `const http=require('http');http.createServer((q,s)=>s.end('{}')).listen(${port},'127.0.0.1');setInterval(()=>{},1<<30);`], { stdio: 'ignore' });
  try {
    await sleep(300);
    assert.ok(alive(plain.pid), '无标记服务应在运行');
    const found = await mod.listTestResidue();
    assert.ok(!found.some((r) => r.pid === plain.pid), '无标记 node -e 监听者不得判定为测试残留');
    await mod.sweepTestResidue({ label: 'C8' });
    await sleep(200);
    assert.ok(alive(plain.pid), 'sweep 不得误杀无标记监听者');
  } finally {
    try { plain.kill('SIGKILL'); } catch {}
  }
});

// ---------- C9 源码契约 ----------
t('C9 源码契约：serve-stale/dispatch-api/run-all 接入新基建', async () => {
  const stale = read('scripts', 'tests', 'serve-stale.test.mjs');
  assert.match(stale, /pickFreePort/, 'serve-stale 应使用 pickFreePort 预检端口');
  assert.match(stale, /stopChild|stopPid/, 'serve-stale 应使用确定性收尾');
  assert.ok((stale.match(/finally/g) || []).length >= 3, 'T2/T3/T5 应有 finally 失败路径回收');

  const api = read('scripts', 'tests', 'dispatch-api.test.mjs');
  assert.match(api, /ATB_SHUTDOWN_FORCE_MS/, 'dispatch-api 应对齐服务端强退时限');
  assert.match(api.slice(api.indexOf('async stop()'), api.indexOf('async stop()') + 400), /stopChild/, 'stop() 应走 stopChild 确定性收尾');

  const runner = read('scripts', 'tests', 'run-all.mjs');
  assert.match(runner, /sweepTestResidue/, 'run-all 应在每个测试文件后做残留清理兜底');
});

let failed = 0;
for (const [name, fn] of cases) {
  try {
    await fn();
    console.log(`✓ ${name}`);
  } catch (e) {
    failed++;
    console.error(`✗ ${name}\n    ${String(e && e.message ? e.message : e).split('\n')[0]}`);
  }
}
console.log(failed ? `\n${failed} 个用例未通过` : '\n全部通过');
process.exit(failed ? 1 : 0);
