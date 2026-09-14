#!/usr/bin/env node
// BUG-20260907-004 请求体上限与错误反馈：前后端上限对齐（单张 8MB 附件 base64 ≈ 10.7MB 可提交），
// 超限请求返回完整 400 JSON（而非 req.destroy() 掐断连接致 ECONNRESET 网络错误）。
// BUG-20260914-007 run-all 全量高负载下的稳定性与失败定位（仅测试层，不改 server 行为）：
//   - 启动等待预算放宽（默认 45s，可注入缩短）；健康探测非 200 不算就绪；server 退出即快速失败；
//     失败输出含探测次数、最后错误、进程退出信息与 server stderr 尾部；
//   - 每个请求带环节标签（健康检查 / T1 / T2 / T3 / 超限后恢复），超时与连接错误可区分环节；
//   - 传输类抖动（超时/ECONNRESET/EPIPE/ECONNREFUSED）默认重试 1 次且每次打印留痕；功能性失败不重试。
// 注入旋钮（验收/诊断用环境变量）：
//   ATB_TEST_BODY_LIMIT_STARTUP_BUDGET_MS   启动就绪等待预算，默认 45000
//   ATB_TEST_BODY_LIMIT_REQ_TIMEOUT_MS      单请求超时，默认 30000
//   ATB_TEST_BODY_LIMIT_TRANSPORT_RETRIES   传输类抖动重试次数，默认 1
// 用法：node scripts/tests/body-limit.test.mjs

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

function positiveIntEnv(name, fallback) {
  const raw = process.env[name];
  if (raw == null || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) throw new Error(`环境变量 ${name} 应为正整数（收到 ${raw}）`);
  return Math.floor(n);
}

const STARTUP_BUDGET_MS = positiveIntEnv('ATB_TEST_BODY_LIMIT_STARTUP_BUDGET_MS', 45000);
const REQ_TIMEOUT_MS = positiveIntEnv('ATB_TEST_BODY_LIMIT_REQ_TIMEOUT_MS', 30000);
const TRANSPORT_RETRIES = positiveIntEnv('ATB_TEST_BODY_LIMIT_TRANSPORT_RETRIES', 1);

// 带环节标签的请求：超时 → 「请求超时[环节]」，连接错误 → 「请求失败[环节]：错误码」，均标记 transport（可重试类）。
function req(port, method, pathname, body, { label = pathname, timeoutMs = REQ_TIMEOUT_MS } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body == null ? null : JSON.stringify(body);
    let settled = false;
    const fail = (e, kind) => {
      if (settled) return;
      settled = true;
      const err = kind === 'timeout'
        ? new Error(`请求超时[${label}]：${timeoutMs}ms 无响应`)
        : new Error(`请求失败[${label}]：${(e && e.code) || String((e && e.message) || e)}`);
      err.transport = true;
      if (e && e.code) err.code = e.code;
      reject(err);
    };
    const r = http.request({
      hostname: '127.0.0.1', port, path: pathname, method,
      headers: payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {},
      timeout: timeoutMs,
    }, (rs) => {
      const chunks = [];
      rs.on('data', (c) => chunks.push(c));
      rs.on('end', () => {
        if (settled) return;
        settled = true;
        const buf = Buffer.concat(chunks);
        let json = null;
        try { json = JSON.parse(buf.toString() || '{}'); } catch {}
        resolve({ status: rs.statusCode, json, raw: buf.toString() });
      });
      rs.on('error', (e) => fail(e));
    });
    r.on('error', (e) => fail(e));
    r.on('timeout', () => { r.destroy(); fail(null, 'timeout'); });
    if (payload) r.write(payload);
    r.end();
  });
}

// 传输类抖动重试：仅对 transport 标记的错误重试并打印留痕；功能性失败（断言/状态不符）直接抛出。
async function withTransportRetry(label, fn, retries = TRANSPORT_RETRIES) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (e) {
      if (!e || e.transport !== true || attempt >= retries) throw e;
      console.log(`↻ ${label} 疑似环境抖动（${String(e.message).split('\n')[0]}），重试 ${attempt + 1}/${retries}`);
    }
  }
}

// 服务就绪等待：健康端点返回 200 才算就绪；server 进程已退出则快速失败；
// 预算耗尽抛「服务启动未就绪」，附探测次数、最后错误、退出信息与 stderr 尾部。
async function waitReady(port, { budgetMs = STARTUP_BUDGET_MS, intervalMs = 200, getExit, stderrPath } = {}) {
  const startedAt = Date.now();
  const probeTimeoutMs = Math.max(200, Math.min(2000, budgetMs));
  let attempts = 0;
  let lastErr = '未探测';
  while (Date.now() - startedAt < budgetMs) {
    attempts += 1;
    try {
      const rs = await req(port, 'GET', '/api/health', null, { label: '健康检查', timeoutMs: probeTimeoutMs });
      if (rs.status === 200) return { attempts, elapsedMs: Date.now() - startedAt };
      lastErr = `HTTP ${rs.status}`;
    } catch (e) {
      lastErr = e.code || String(e.message).split('\n')[0];
    }
    if (getExit && getExit()) break; // 进程已退出，继续轮询无意义
    await sleep(intervalMs);
  }
  const parts = [`服务启动未就绪：${budgetMs}ms 内 /api/health 未返回 200（探测 ${attempts} 次，最后错误：${lastErr}）`];
  const exit = getExit && getExit();
  if (exit) parts.push(`server 进程已退出（${exit}）`);
  if (stderrPath && fs.existsSync(stderrPath)) {
    const tail = fs.readFileSync(stderrPath, 'utf8').trim().slice(-1500);
    if (tail) parts.push(`server stderr 尾部：\n${tail}`);
  }
  throw new Error(parts.join('\n'));
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
  const stderrPath = path.join(tmp, 'server-stderr.log');
  const stderrFd = fs.openSync(stderrPath, 'a');
  const server = spawn(process.execPath, [path.join(pluginRoot, 'scripts', 'server.mjs')], {
    cwd: root,
    env: { ...process.env, ATB_PORT: String(port), ATB_REGISTRY: path.join(tmp, 'reg.json') },
    stdio: ['ignore', 'ignore', stderrFd],
  });
  let serverExit = null;
  server.on('exit', (code, signal) => { serverExit = signal ? `signal=${signal}` : `code=${code}`; });
  const P = `?project=${encodeURIComponent(root)}`;
  // 各环节统一走带标签 + 传输类抖动重试的请求，失败输出可区分步骤
  const post = (pathname, body, label) => withTransportRetry(label, () => req(port, 'POST', `${pathname}${P}`, body, { label }));
  try {
    const ready = await waitReady(port, { getExit: () => serverExit, stderrPath });
    console.log(`  服务就绪：${ready.attempts} 次探测 / ${ready.elapsedMs}ms`);

    // T1 原 Bug 场景：单张 2MB 图片（>旧 1MB 限、前端 8MB 校验通过）应创建成功
    const png2m = Buffer.alloc(2 * 1024 * 1024, 1);
    let r = await post('/api/oncall/ticket', {
      title: '截图附件可用性',
      question: 'q',
      attachments: [{ name: 'big.png', dataBase64: png2m.toString('base64') }],
    }, 'T1 2MB 附件创建');
    assert.equal(r.status, 200, `2MB 附件应创建成功（得到 ${r.status} ${JSON.stringify(r.json)}）`);
    assert.match(r.json.id, /^ASK-\d{8}-001$/);
    r = await withTransportRetry('T1 附件查询', () => req(port, 'GET', `/api/oncall/ticket/${r.json.id}${P}`, { label: 'T1 附件查询' }));
    assert.deepEqual(r.json.rounds[0].attachments, ['big.png'], '附件应落盘登记');

    // T2 单张均合法但总量超上限（两张 7MB → base64 ≈ 18.7MB）：应答完整 400 JSON，连接不被掐断
    const png7m = Buffer.alloc(7 * 1024 * 1024, 2);
    r = await post('/api/oncall/ticket', {
      title: '总量超限',
      question: 'q',
      attachments: [
        { name: 'a.png', dataBase64: png7m.toString('base64') },
        { name: 'b.png', dataBase64: png7m.toString('base64') },
      ],
    }, 'T2 总量超限 400');
    assert.equal(r.status, 400, `总量超限应 400（得到 ${r.status} ${r.raw.slice(0, 120)}）`);
    assert.match(r.json.error || '', /请求体过大/, '400 应带可读错误说明');

    // T3 对照 /api/new：超限文本同样 400 JSON 而非 ECONNRESET
    r = await post('/api/new', {
      type: 'req',
      title: '超长描述',
      description: 'x'.repeat(13 * 1024 * 1024),
    }, 'T3 /api/new 超限 400');
    assert.equal(r.status, 400, `/api/new 超限应 400（得到 ${r.status} ${r.raw.slice(0, 120)}）`);
    assert.match(r.json.error || '', /请求体过大/);

    // 超限后服务应仍可用（连接处理不残留、可继续创建）
    r = await post('/api/oncall/ticket', { title: '超限后恢复', question: 'q2' }, '超限后恢复');
    assert.equal(r.status, 200, '超限请求之后服务应正常处理新请求');
  } finally {
    server.kill();
    try { fs.closeSync(stderrFd); } catch {}
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
  }
});

t('BUG-20260914-007 诊断：服务启动未就绪可定位（最后错误/退出信息/stderr 留痕）', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'atb-body-limit-diag-'));
  try {
    // 先占后放拿到一个空闲端口，使首次探测确定性地得到 ECONNREFUSED
    const holder = net.createServer();
    const freePort = await new Promise((res) => {
      holder.listen(0, '127.0.0.1', () => { const p = holder.address().port; holder.close(() => res(p)); });
    });
    const stderrPath = path.join(tmp, 'stderr.log');
    fs.writeFileSync(stderrPath, 'Error: 注入的启动崩溃');
    await assert.rejects(
      waitReady(freePort, { budgetMs: 700, intervalMs: 100, getExit: () => 'code=1', stderrPath }),
      (e) => /服务启动未就绪/.test(e.message)
        && /ECONNREFUSED/.test(e.message)
        && /探测 \d+ 次/.test(e.message)
        && /code=1/.test(e.message)
        && /注入的启动崩溃/.test(e.message),
    );
    // 健康端点非 200 同样不算就绪，且错误信息应体现 HTTP 状态
    const srv = http.createServer((rq, rs) => { rs.statusCode = 503; rs.end('nope'); });
    await new Promise((res) => srv.listen(0, '127.0.0.1', res));
    try {
      await assert.rejects(waitReady(srv.address().port, { budgetMs: 800, intervalMs: 100 }), /HTTP 503/);
    } finally { await new Promise((r) => srv.close(r)); }
  } finally {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
  }
});

t('BUG-20260914-007 诊断：请求超时带环节标签，可区分失败步骤', async () => {
  const sockets = new Set();
  const srv = http.createServer();
  srv.on('connection', (s) => { sockets.add(s); s.on('close', () => sockets.delete(s)); });
  srv.on('request', () => {}); // 收到请求但不响应，制造确定性超时
  await new Promise((res) => srv.listen(0, '127.0.0.1', res));
  try {
    await assert.rejects(
      req(srv.address().port, 'POST', '/api/new', { type: 'req' }, { label: 'T3 /api/new 超限 400', timeoutMs: 300 }),
      (e) => /请求超时\[T3 \/api\/new 超限 400\]：300ms/.test(e.message) && e.transport === true,
    );
  } finally {
    for (const s of sockets) s.destroy();
    await new Promise((r) => srv.close(r));
  }
});

t('BUG-20260914-007 重试：传输类抖动重试留痕，功能性失败直接抛出', async () => {
  const logs = [];
  const origLog = console.log;
  console.log = (...a) => logs.push(a.join(' '));
  try {
    let calls = 0;
    const ok = await withTransportRetry('T1 2MB 附件创建', async () => {
      calls += 1;
      if (calls === 1) { const e = new Error('请求超时[T1 2MB 附件创建]：45ms 无响应'); e.transport = true; throw e; }
      return 'created';
    }, 1);
    assert.equal(ok, 'created');
    assert.equal(calls, 2, '传输类错误应重试一次');
    assert.ok(logs.some((l) => l.includes('↻ T1 2MB 附件创建') && l.includes('请求超时[T1')), '重试前应打印失败原因留痕');

    logs.length = 0;
    let funcCalls = 0;
    await assert.rejects(
      withTransportRetry('T2 总量超限 400', async () => {
        funcCalls += 1;
        throw new Error('总量超限应 400（得到 500）'); // 功能性断言失败：不带 transport 标记
      }, 1),
      /总量超限应 400/,
    );
    assert.equal(funcCalls, 1, '功能性失败不应重试');
    assert.ok(!logs.some((l) => l.includes('↻')), '功能性失败不应产生重试日志');
  } finally { console.log = origLog; }
});

let failed = 0;
for (const [name, fn] of cases) {
  try {
    await fn();
    console.log(`✓ ${name}`);
  } catch (e) {
    failed++;
    // 完整多行消息缩进输出：保留「服务启动未就绪」诊断中的 stderr 尾部等留痕
    const msg = String((e && e.message) || e).trim().split('\n').join('\n    ');
    console.error(`✗ ${name}\n    ${msg}`);
  }
}
console.log(failed ? `\n${failed} 个用例未通过` : '\n全部通过');
process.exit(failed ? 1 : 0);
