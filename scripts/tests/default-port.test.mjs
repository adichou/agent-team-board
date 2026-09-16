#!/usr/bin/env node
// REQ-20260905-003 Status Board 默认端口 7736 → 8888 —— 静态契约 + 默认端口/覆盖集成
// 用法：node scripts/tests/default-port.test.mjs

import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import http from 'node:http';
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (...rel) => fs.readFileSync(path.join(pluginRoot, ...rel), 'utf8');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function portBusy(port, host = '127.0.0.1') {
  return new Promise((resolve) => {
    const rq = http.request({ hostname: host, port, path: '/api/health', method: 'GET', timeout: 800 }, (rs) => {
      rs.resume();
      rs.on('end', () => resolve(true));
    });
    rq.on('error', () => resolve(false));
    rq.on('timeout', () => { rq.destroy(); resolve(false); });
    rq.end();
  });
}

// 端口占用判定：真实 bind 探测（EADDRINUSE=占用；bind 成功即空闲，随即关闭）。
// 不依赖占用者的 HTTP 响应速度——占用者阻塞/响应慢时 HTTP 探活会误判空闲（BUG-20260915-006）。
// portBusy 仅保留给 waitHealth 作「服务已可应答」的健康等待语义。
function portOccupied(port, host = '127.0.0.1') {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once('error', (e) => resolve(e.code === 'EADDRINUSE'));
    srv.once('listening', () => srv.close(() => resolve(false)));
    srv.listen(port, host);
  });
}

// 起临时 server：envOverrides 里 ATB_PORT 缺省删除（即测默认端口）
function startServer(tmp, envOverrides = {}) {
  const env = { ...process.env, ATB_REGISTRY: path.join(tmp, 'reg.json'), ...envOverrides };
  if (!('ATB_PORT' in envOverrides)) delete env.ATB_PORT;
  const proj = path.join(tmp, 'p');
  fs.mkdirSync(proj, { recursive: true });
  const child = spawn(process.execPath, [path.join(pluginRoot, 'scripts', 'server.mjs')], {
    cwd: proj, env, stdio: ['ignore', 'ignore', 'ignore'],
  });
  return child;
}

async function waitHealth(port, tries = 40) {
  for (let i = 0; i < tries; i++) {
    await sleep(200);
    if (await portBusy(port)) {
      const body = await new Promise((resolve) => {
        const rq = http.request({ hostname: '127.0.0.1', port, path: '/api/health', method: 'GET', timeout: 1500 }, (rs) => {
          let data = '';
          rs.on('data', (c) => { data += c; });
          rs.on('end', () => resolve(data));
        });
        rq.on('error', () => resolve(null));
        rq.on('timeout', () => { rq.destroy(); resolve(null); });
        rq.end();
      });
      try { return JSON.parse(body); } catch { return null; }
    }
  }
  return null;
}

const cases = [];
const t = (name, fn) => cases.push([name, fn]);

t('V1 server.mjs 默认端口 8888，头注释同步，无 7736 残留', () => {
  const src = read('scripts', 'server.mjs');
  // REQ-20260908-004：回退 CI Board 端口持久化，端口恢复 ATB_PORT > DEFAULT_PORT；
  // 显式常量保留（集成用例 V6 实测 port=8888）
  assert.match(src, /const DEFAULT_PORT = 8888;/, '默认端口应为 8888');
  assert.match(src, /默认端口 8888/, '文件头注释应写 8888');
  assert.doesNotMatch(src, /\b7736\b/, 'server.mjs 不应残留 7736');
  // EADDRINUSE 示例端口用动态 PORT 表达式，不再硬编码 7737
  assert.match(src, /ATB_PORT=\$\{PORT \+ 1\}/, '换端口示例应为 ATB_PORT=${PORT + 1}');
  assert.doesNotMatch(src, /\b7737\b/, '不应硬编码示例端口 7737');
});

t('V2 默认端口引用点同步：atb.mjs / electron/main.mjs / electron/service.mjs', () => {
  assert.match(read('scripts', 'atb.mjs'), /ATB_PORT \|\| 8888/, 'atb serve 缺省端口应为 8888');
  assert.match(read('electron', 'main.mjs'), /ATB_PORT \|\| 8888/, 'electron 主进程缺省端口应为 8888');
  assert.match(read('electron', 'service.mjs'), /port = 8888/, 'ensureService 缺省端口应为 8888');
  for (const rel of [['scripts', 'atb.mjs'], ['electron', 'main.mjs'], ['electron', 'service.mjs']]) {
    assert.doesNotMatch(read(...rel), /\b7736\b/, `${path.join(...rel)} 不应残留 7736`);
  }
});

t('V3 state-guard 端口启发式包含 8888（保留 7736 兼容旧实例）', () => {
  const src = read('scripts', 'state-guard.mjs');
  assert.match(src, /8888/, 'state-guard 应识别新默认端口 8888');
  assert.match(src, /7736/, 'state-guard 应保留 7736 以拦截对旧实例的改状态调用');
});

t('V4 文档与清单无 7736 残留且含 8888', () => {
  const docs = [
    ['README.md'],
    ['commands', 'board.md'],
    ['skills', 'agent-team-board', 'SKILL.md'],
    ['.zcode-plugin', 'plugin.json'],
    ['.codex-plugin', 'plugin.json'],
  ];
  for (const rel of docs) {
    const src = read(...rel);
    assert.doesNotMatch(src, /\b7736\b/, `${path.join(...rel)} 不应残留 7736`);
    assert.match(src, /\b8888\b/, `${path.join(...rel)} 应写明新端口 8888`);
  }
});

t('V5 traceability 测试断言与新端口同步', () => {
  const src = read('scripts', 'tests', 'traceability.test.mjs');
  assert.match(src, /health\|8888/, '/board 探活断言应包含 8888');
  assert.doesNotMatch(src, /health\|7736/, '不应再断言旧端口 7736');
});

t('V6 集成：未设 ATB_PORT 时 /api/health 返回 port=8888', async () => {
  if (await portOccupied(8888)) {
    console.log('  ⚠ 8888 已被占用，跳过默认端口集成用例（不影响其余用例）');
    return;
  }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'atb-port-'));
  const server = startServer(tmp);
  try {
    const health = await waitHealth(8888);
    assert.ok(health, '默认端口 8888 上应能探活');
    assert.equal(health.port, 8888, '/api/health 应返回 port=8888');
  } finally {
    server.kill();
    await sleep(100);
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
  }
});

t('V7 集成：ATB_PORT=7737 覆盖仍生效', async () => {
  // 8888 被外部进程占用（如运行中的看板）时跳过该断言，与 V6 的跳过策略一致
  const port8888Busy = await portOccupied(8888);
  if (await portOccupied(7737)) {
    console.log('  ⚠ 7737 已被占用，跳过覆盖用例');
    return;
  }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'atb-port-'));
  const server = startServer(tmp, { ATB_PORT: '7737' });
  try {
    const health = await waitHealth(7737);
    assert.ok(health, '覆盖端口 7737 上应能探活');
    assert.equal(health.port, 7737, '/api/health 应返回 port=7737');
    if (port8888Busy) {
      console.log('  ⚠ 8888 已被占用，跳过「不再占 8888」断言（不影响本用例其余断言）');
    } else {
      assert.equal(await portOccupied(8888), false, '未设默认端口时不应再占 8888');
    }
  } finally {
    server.kill();
    await sleep(100);
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
  }
});

t('V8 npm test 入口存在且指向测试聚合脚本', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.match(pkg.scripts.test, /run-all/, 'package.json 应注册 test script');
  const runner = read('scripts', 'tests', 'run-all.mjs');
  assert.match(runner, /\.test\.mjs/, 'run-all 应枚举 *.test\.mjs');
});

t('V9 占用判定 portOccupied（bind 探测）：占用/空闲两分支自证（BUG-20260915-006）', async () => {
  const dummy = http.createServer((rq, rs) => { rs.end('{}'); });
  await new Promise((r) => dummy.listen(0, '127.0.0.1', r));
  const port = dummy.address().port;
  try {
    assert.equal(await portOccupied(port), true, '已被监听的端口应判定为占用');
  } finally {
    await new Promise((r) => dummy.close(r));
  }
  assert.equal(await portOccupied(port), false, '释放后的端口应判定为空闲');
});

let failed = 0;
for (const [name, fn] of cases) {
  try {
    await fn();
    console.log(`✓ ${name}`);
  } catch (e) {
    failed++;
    console.error(`✗ ${name}\n  ${e.message}`);
  }
}
if (failed) {
  console.error(`\n${failed}/${cases.length} 个用例失败`);
  process.exit(1);
}
console.log(`\n全部 ${cases.length} 个用例通过`);
