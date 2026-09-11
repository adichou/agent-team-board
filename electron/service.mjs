// Status Board 服务管理 —— 纯 Node 模块（REQ-20260905-001）。
// 供 Electron 主进程与测试共用，禁止 import electron（保持可测）。
// 职责：探活复用 → 以 ELECTRON_RUN_AS_NODE 拉起 scripts/server.mjs → 轮询 /api/health 就绪 → 回收子进程。

import http from 'node:http';
import fs from 'node:fs';
import { spawn } from 'node:child_process';

const sleepMs = (ms) => new Promise((r) => setTimeout(r, ms));

// GET /api/health，200 即就绪（与 atb serve 同款探活）
export function probeHealth(port, host = '127.0.0.1', timeoutMs = 1500) {
  return new Promise((resolve) => {
    const req = http.request(
      { hostname: host, port, path: '/api/health', method: 'GET', timeout: timeoutMs },
      (res) => {
        let data = '';
        res.on('data', (c) => { data += c; });
        res.on('end', () => resolve({ ok: res.statusCode === 200, body: data }));
      }
    );
    req.on('error', () => resolve({ ok: false }));
    req.on('timeout', () => { req.destroy(); resolve({ ok: false }); });
    req.end();
  });
}

// 拉起或复用看板服务：
// - 已运行 → 复用（{ reused: true, child: null }），终端已起服务时 GUI 直连不冲突；
// - 未运行 → spawn 子进程（execPath 缺省 process.execPath，Electron 下即 Electron 二进制，
//   强制 ELECTRON_RUN_AS_NODE=1 当纯 Node 用），轮询探活至 maxWaitMs；
// - 子进程提前退出（如 EADDRINUSE）不判死，健康检查转 OK 仍视为就绪；
// - 超时未就绪：回收子进程并抛错（err.child 携带已回收的子进程，便于核验）。
export async function ensureService({
  port = 8888,
  serverPath,
  projectRoot,
  maxWaitMs = 10000,
  execPath = process.execPath,
  env = process.env,
  logFile = '/tmp/agent-team-board-electron.log',
} = {}) {
  if ((await probeHealth(port)).ok) {
    return { reused: true, child: null, port };
  }
  if (!serverPath) throw new Error('ensureService 需要 serverPath（scripts/server.mjs 路径）');

  const logFd = fs.openSync(logFile, 'a');
  const child = spawn(execPath, [serverPath], {
    cwd: projectRoot,
    env: { ...env, ELECTRON_RUN_AS_NODE: '1', ATB_PORT: String(port), ATB_HOST: '127.0.0.1' },
    stdio: ['ignore', logFd, logFd],
  });
  fs.closeSync(logFd); // 子进程持有自己的 dup，父进程副本即刻关闭

  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline) {
    await sleepMs(200);
    if ((await probeHealth(port)).ok) {
      return { reused: false, child, port };
    }
  }
  try { child.kill(); } catch {}
  const err = new Error(
    `看板服务未能就绪（端口 ${port}）。端口可能被其他程序占用，请释放或以 ATB_PORT 换端口；服务输出见 ${logFile}`
  );
  err.child = child;
  throw err;
}

// 结束 ensureService 拉起的子进程；复用句柄（child 为 null）与重复调用均幂等。
// REQ-20260906-003：先发 SIGTERM 走服务端优雅关停（停止取单、取消受管执行、落账），
// 宽限期内未退出再 SIGKILL 兜底——Electron 壳拥有本服务时负责协调收尾；
// 复用外部服务（child=null）时不拥有其生命周期，不做任何 kill。
export async function stopService(handle, { graceMs = 8000 } = {}) {
  const child = handle?.child;
  if (!child) return false;
  if (child.exitCode !== null || child.signalCode) return false; // 已退出：幂等
  const exited = new Promise((resolve) => child.once('exit', () => resolve(true)));
  try {
    child.kill('SIGTERM');
  } catch {
    return false;
  }
  const graceful = await Promise.race([exited, sleepMs(graceMs).then(() => false)]);
  if (!graceful) {
    try { child.kill('SIGKILL'); } catch {}
  }
  return true;
}
