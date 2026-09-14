#!/usr/bin/env node
// BUG-20260908-003 Status Board 收到 SIGTERM 后可能滞留不退，端口被占导致后续实例无法启动
// 根因：server.mjs shutdownServer() 先 await Promise.all(schedulers.shutdown())，20s 强退兜底
//       setTimeout 在 await 之后才注册——任一 shutdown()/server.close() 挂起时兜底永不执行，
//       进程滞留并持续占用端口（后续实例 EADDRINUSE exit(1)）。
// 修复契约：
//   T1 兜底强退 setTimeout 必须先于 scheduler 关停 await 注册（源码顺序契约）；
//       scheduler 收尾等待有界（Promise.race），不让单个挂起拖住整个关停。
//   T2 正常路径：SIGTERM 后进程快速以 exit 0 退出且端口释放。
//   T3 挂起路径：server.close() 因滞留连接挂起时，进程仍在强退时限内退出、端口释放
//       （ATB_SHUTDOWN_FORCE_MS 供测试收紧时限，缺省 20s 行为不变）。
// 用法：node scripts/tests/shutdown-forced-exit.test.mjs

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import http from 'node:http';
import net from 'node:net';
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

function startServer(port, env = {}) {
  return spawn(process.execPath, [path.join(pluginRoot, 'scripts', 'server.mjs')], {
    cwd: os.tmpdir(),
    env: { ...process.env, ATB_PORT: String(port), ATB_HOST: '127.0.0.1', ...env },
    stdio: ['ignore', 'ignore', 'ignore'],
  });
}

async function exited(p, timeoutMs = 12000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (p.exitCode !== null || p.signalCode) return { ok: true, elapsed: null };
    await sleep(150);
  }
  return { ok: false, elapsed: null };
}

// 量测 SIGTERM → 退出耗时；超时上限内未退出返回 { ok:false, elapsed }
async function exitAfterTerm(p, boundMs) {
  const t0 = Date.now();
  p.kill('SIGTERM');
  while (Date.now() - t0 < boundMs) {
    if (p.exitCode !== null || p.signalCode) return { ok: true, elapsed: Date.now() - t0 };
    await sleep(100);
  }
  return { ok: false, elapsed: Date.now() - t0 };
}

// 端口释放核对：进程退出后连接应被拒绝（不再监听）
function portClosed(port) {
  return new Promise((resolve) => {
    const s = net.connect({ host: '127.0.0.1', port }, () => { s.destroy(); resolve(false); });
    s.on('error', () => resolve(true));
  });
}

// 挂一条不发数据的裸 TCP 连接：headersTimeout 缺省 60s 内不会被服务端收掉，
// 使 server.close() 回调挂起，复刻「关停链路挂起」现场。
function holdRawConnection(port) {
  const s = net.connect({ host: '127.0.0.1', port });
  s.on('error', () => {});
  return s;
}

const cases = [];
const t = (name, fn) => cases.push([name, fn]);

// T1 源码顺序契约：兜底强退先注册，scheduler 等待有界
t('T1 shutdownServer 先注册兜底强退再等待 scheduler 收尾（源码契约）', () => {
  const src = fs.readFileSync(path.join(pluginRoot, 'scripts', 'server.mjs'), 'utf8');
  const start = src.indexOf('async function shutdownServer()');
  assert.ok(start >= 0, 'server.mjs 应定义 shutdownServer()');
  const end = src.indexOf('for (const sig of', start);
  assert.ok(end > start, 'shutdownServer 后应紧跟信号注册');
  const fn = src.slice(start, end);
  const timerIdx = fn.indexOf('setTimeout');
  const awaitIdx = fn.indexOf('await Promise');
  assert.ok(timerIdx >= 0, 'shutdownServer 应注册强退兜底 setTimeout');
  assert.ok(awaitIdx >= 0, 'shutdownServer 应等待 scheduler 关停');
  assert.ok(timerIdx < awaitIdx,
    `兜底强退 setTimeout 必须先于关停 await 注册（当前 setTimeout@${timerIdx} > await@${awaitIdx}，挂起时进程滞留占端口）`);
  assert.match(fn, /Promise\.race/, 'scheduler 收尾等待应有界（Promise.race 兜底）');
});

// T2 正常路径：SIGTERM 快速 exit 0 且端口释放
t('T2 正常 SIGTERM 快速退出且释放端口', async () => {
  const port = 36100 + Math.floor(Math.random() * 800);
  const srv = startServer(port);
  try {
    await waitHealth(port);
    const r = await exitAfterTerm(srv, 8000);
    assert.ok(r.ok, `无挂起因素时 SIGTERM 后 8s 内应退出（已等 ${r.elapsed}ms）`);
    assert.equal(srv.exitCode, 0, `应 exit 0（signal=${srv.signalCode}）`);
    await sleep(200);
    assert.ok(await portClosed(port), '退出后端口应释放');
  } finally {
    try { srv.kill('SIGKILL'); } catch {}
  }
});

// T3 挂起路径（本 Bug 主场景）：close 挂起时强退兜底仍按时触发
t('T3 关停挂起时进程仍在强退时限内退出并释放端口', async () => {
  const port = 37600 + Math.floor(Math.random() * 800);
  const srv = startServer(port, { ATB_SHUTDOWN_FORCE_MS: '2500' });
  let held = null;
  try {
    await waitHealth(port);
    held = holdRawConnection(port); // 复刻 server.close() 回调挂起
    await sleep(300);
    const r = await exitAfterTerm(srv, 8000); // 缺省 20s 兜底若未被前置注册，将超此界
    assert.ok(r.ok, `挂起连接存在时 SIGTERM 后 8s 内仍应退出（已等 ${r.elapsed}ms）`);
    assert.ok(r.elapsed < 6000, `应在强退时限（2.5s）+余量内退出，实际 ${r.elapsed}ms`);
    await sleep(200);
    assert.ok(await portClosed(port), '强退后端口应释放，后续实例不再 EADDRINUSE');
  } finally {
    try { held?.destroy(); } catch {}
    try { srv.kill('SIGKILL'); } catch {}
  }
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
