// BUG-20260914-013 测试进程/端口基建：端口占用预检、确定性收尾（SIGTERM→有界等待→SIGKILL）、
// health 就绪探测（可校验 pid，命中非目标服务时报端口被占）、测试残留扫描与聚合层清理。
// 自研说明（REQ-20260909-015）：均为 10–30 行进程/端口原语，Node 内置 net/child_process 即可表达，
// 引入外部库无增量价值；未引入开源依赖。
// 用法（测试文件内）：
//   const tp = await import('../lib/test-process.mjs');
//   const port = await tp.pickFreePort({ min: 34100, max: 39099 });
//   await tp.stopChild(server);            // SIGTERM→等待→SIGKILL 兜底，仍存活则抛错
//   await tp.waitHealth(port, { expectPid: server.pid });

import net from 'node:net';
import http from 'node:http';
import fs from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import os from 'node:os';

const execFileP = promisify(execFile);
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- 端口预检 ----------

// 端口空闲探测：短暂 bind（不 connect，避免对残留进程产生请求噪音）。
export function probePortFree(port, host = '127.0.0.1') {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once('error', () => resolve(false));
    srv.once('listening', () => srv.close(() => resolve(true)));
    srv.listen(port, host);
  });
}

// 随机候选 + 占用预检重选（BUG-20260914-013 期望行为 2：选端口前探测可用性，被占则重选）。
// 全部尝试被占时快速失败，报错直指「端口被占」（期望行为 4：失败可诊断）。
export async function pickFreePort({ min, max, tries = 12, host = '127.0.0.1' } = {}) {
  if (!Number.isInteger(min) || !Number.isInteger(max) || max < min) {
    throw new Error(`pickFreePort 参数非法：min=${min} max=${max}`);
  }
  for (let i = 0; i < tries; i++) {
    const port = min + Math.floor(Math.random() * (max - min + 1));
    if (await probePortFree(port, host)) return port;
  }
  throw new Error(`无可用端口（端口被占）：区间 ${min}-${max} 尝试 ${tries} 次均被占用，请清理残留监听进程后重试`);
}

// ---------- 确定性收尾 ----------

const pidAlive = (pid) => {
  try { process.kill(pid, 0); return true; } catch { return false; }
};

// kill(SIGTERM) → 有界等待退出 → 超时 SIGKILL → 再有界等待；仍存活抛错。已退出幂等返回 false。
export async function stopChild(child, { timeoutMs = 8000, killWaitMs = 2000 } = {}) {
  if (!child) return false;
  if (child.exitCode !== null || child.signalCode) return false;
  const exited = new Promise((resolve) => child.once('exit', () => resolve(true)));
  try { child.kill('SIGTERM'); } catch { return false; }
  let ok = await Promise.race([exited, sleep(timeoutMs).then(() => false)]);
  if (!ok) {
    try { child.kill('SIGKILL'); } catch {}
    ok = await Promise.race([exited, sleep(killWaitMs).then(() => false)]);
  }
  if (!ok) throw new Error(`子进程 pid=${child.pid} 在 SIGTERM（${timeoutMs}ms）+ SIGKILL 后仍未退出，疑似泄漏`);
  return true;
}

// 按 pid 收尾（用于非本进程直接 spawn 的服务，如 atb serve 拉起的新实例）。已退出幂等。
export async function stopPid(pid, { timeoutMs = 8000, killWaitMs = 2000 } = {}) {
  if (!Number.isInteger(pid) || pid <= 1 || pid === process.pid) return false;
  if (!pidAlive(pid)) return false;
  try { process.kill(pid, 'SIGTERM'); } catch { return false; }
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline && pidAlive(pid)) await sleep(120);
  if (pidAlive(pid)) {
    try { process.kill(pid, 'SIGKILL'); } catch {}
    const hardDeadline = Date.now() + killWaitMs;
    while (Date.now() < hardDeadline && pidAlive(pid)) await sleep(120);
  }
  if (pidAlive(pid)) throw new Error(`进程 pid=${pid} 在 SIGTERM（${timeoutMs}ms）+ SIGKILL 后仍未退出，疑似泄漏`);
  return true;
}

// ---------- health 就绪探测（可诊断） ----------

export function httpGetJson(port, pathname, { timeoutMs = 2500 } = {}) {
  return new Promise((resolve, reject) => {
    const rq = http.request({ hostname: '127.0.0.1', port, path: pathname, method: 'GET', timeout: timeoutMs }, (rs) => {
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

// 就绪判据：status 200 且 json.ok，可选校验 json.pid === expectPid（BUG-20260914-013 期望行为 4：
// 命中冒牌 health 时不再误判就绪，超时报错指向端口被占/残留进程）。
// 兼容旧签名 waitHealth(port, 10000)。
export async function waitHealth(port, opts = {}) {
  const o = typeof opts === 'number' ? { timeoutMs: opts } : opts;
  const { timeoutMs = 10000, expectPid = null } = o;
  const deadline = Date.now() + timeoutMs;
  let last = null;
  let foreign = null;
  while (Date.now() < deadline) {
    try {
      const r = await httpGetJson(port, '/api/health');
      last = r;
      if (r.status === 200 && r.json && r.json.ok) {
        if (expectPid == null || r.json.pid === expectPid) return r.json;
        foreign = r.json; // ok:true 但 pid 不符：端口上是别的（疑似残留冒牌）服务
      }
    } catch {}
    await sleep(150);
  }
  if (foreign) {
    throw new Error(`等待 /api/health 就绪超时：命中非目标服务（health pid=${JSON.stringify(foreign.pid)}，期望 ${expectPid}），疑似端口被占/残留进程，实际响应：${JSON.stringify(foreign)}`);
  }
  throw new Error(`等待 /api/health 就绪超时（最后：${JSON.stringify(last)}`);
}

// ---------- 测试残留扫描与聚合层清理（run-all 每文件兜底） ----------

// 测试随机端口段并集（serve-stale 34100–40599、dispatch-api 20000–40999、其余 21000–50999）。
export const DEFAULT_RESIDUE_RANGES = [[20000, 50999]];

// 命令行/工作区标记：三重判定缺一不可（node 进程 + 监听在段内 + 命中标记），防误杀第三方应用。
const ARGV_TMP_MARKER = /\/atb-[A-Za-z0-9_.-]+\//; // 测试临时目录（atb-stale-*/atb-api-*/atb-leak-* 等）
const ARGV_STUB_MARKER = /old-server\.mjs$/;       // serve-stale T5 冒牌老服务 stub
const ARGV_SCRIPT_MARKER = /scripts\/(server|atb)\.mjs$/; // 插件或拷贝骨架的服务入口
const NODE_NAME = /node/i;

async function run(cmd, args) {
  const { stdout } = await execFileP(cmd, args, { timeout: 10_000, maxBuffer: 4 * 1024 * 1024 });
  return stdout;
}

function portInRange(port, ranges) {
  return ranges.some(([lo, hi]) => port >= lo && port <= hi);
}

// lsof 枚举监听者 → [{pid, port, command}]；lsof 不可用返回 null（走 ps 回退）。
async function scanListeners(ranges) {
  let txt;
  try { txt = await run('lsof', ['-nP', '-w', '-iTCP', '-sTCP:LISTEN']); } catch { return null; }
  const out = [];
  for (const line of txt.split('\n').slice(1)) {
    const cols = line.trim().split(/\s+/);
    if (cols.length < 2) continue;
    const command = cols[0];
    const pid = Number(cols[1]);
    let name = cols[cols.length - 1];
    if (/^\(LISTEN\)$/.test(name)) name = cols[cols.length - 2]; // Linux 布局：NAME (LISTEN)
    const m = name && name.match(/(\d+)$/);
    if (!Number.isInteger(pid) || !m) continue;
    const port = Number(m[1]);
    if (portInRange(port, ranges)) out.push({ pid, port, command });
  }
  return out;
}

async function psCommand(pid) {
  try { return (await run('ps', ['-o', 'command=', '-p', String(pid)])).trim(); } catch { return ''; }
}

async function cwdOf(pid) {
  try {
    const txt = await run('lsof', ['-a', '-w', '-p', String(pid), '-d', 'cwd', '-Fn']);
    const line = txt.split('\n').find((l) => l.startsWith('n'));
    return line ? line.slice(1) : null;
  } catch { return null; }
}

// 判定测试残留：node 监听测试端口段，且（命令行带 atb-* 临时标记 / old-server.mjs stub，
// 或命令行是 server.mjs|atb.mjs 入口且工作目录在系统临时目录下——T1/dispatch-api 形态）。
// cwd 比较同时接受 os.tmpdir() 与其 realpath（macOS /var → /private/var 符号链接差异）。
function underTmp(p, tmpRoots) {
  return !!p && tmpRoots.some((t) => p === t || p.startsWith(t + '/'));
}
function classify(entry, cmdline, cwd, tmpRoots) {
  const isNode = NODE_NAME.test(entry.command) || /\bnode\b/.test(cmdline);
  if (!isNode) return false;
  if (ARGV_TMP_MARKER.test(cmdline) || ARGV_STUB_MARKER.test(cmdline)) return true;
  if (ARGV_SCRIPT_MARKER.test(cmdline) && underTmp(cwd, tmpRoots)) return true;
  return false;
}

function tmpRootVariants(tmpRoot) {
  const roots = [tmpRoot.replace(/\/+$/, '')];
  try {
    const real = fs.realpathSync(tmpRoot).replace(/\/+$/, '');
    if (!roots.includes(real)) roots.push(real);
  } catch {}
  return roots;
}

// 检测测试残留进程。lsof 不可用时回退 ps 纯标记扫描（仅回收命令行带 atb-* 临时标记 / stub 者，
// 不碰无监听验证的 server.mjs 形态，避免误杀用户看板实例）。
export async function listTestResidue({ ranges = DEFAULT_RESIDUE_RANGES, tmpRoot = os.tmpdir() } = {}) {
  const tmpRoots = tmpRootVariants(tmpRoot);
  const listeners = await scanListeners(ranges);
  const residue = [];
  if (listeners) {
    for (const entry of listeners) {
      if (!Number.isInteger(entry.pid) || entry.pid <= 1 || entry.pid === process.pid) continue;
      const [cmdline, cwd] = await Promise.all([psCommand(entry.pid), cwdOf(entry.pid)]);
      if (!cmdline) continue;
      if (classify(entry, cmdline, cwd, tmpRoots)) residue.push({ ...entry, commandLine: cmdline, cwd });
    }
    return residue;
  }
  // ps 回退
  let txt;
  try { txt = await run('ps', ['-eo', 'pid=,command=']); } catch { return residue; }
  for (const line of txt.split('\n')) {
    const m = line.trim().match(/^(\d+)\s+(.*)$/);
    if (!m) continue;
    const pid = Number(m[1]);
    const cmdline = m[2];
    if (pid <= 1 || pid === process.pid || !NODE_NAME.test(cmdline)) continue;
    if (ARGV_TMP_MARKER.test(cmdline) || ARGV_STUB_MARKER.test(cmdline)) {
      residue.push({ pid, port: null, command: cmdline.split(/\s+/)[0], commandLine: cmdline, cwd: null });
    }
  }
  return residue;
}

// 聚合层兜底：检测 → SIGTERM/有界等待/SIGKILL 确定性回收 → 醒目报告（BUG-20260914-013 期望行为 3）。
// 返回本轮实际清理的残留列表；未发现时静默（不打扰正常轮次）。
export async function sweepTestResidue({ label = 'sweep', log = () => {}, ranges = DEFAULT_RESIDUE_RANGES } = {}) {
  const found = await listTestResidue({ ranges });
  const cleaned = [];
  for (const r of found) {
    let killed = false;
    try {
      await stopPid(r.pid, { timeoutMs: 1500, killWaitMs: 1000 });
      killed = true;
    } catch (e) {
      log(`⚠ [${label}] 残留 pid=${r.pid} 清理失败：${e.message}`);
    }
    if (killed) cleaned.push(r);
  }
  if (cleaned.length) {
    log(`⚠ [${label}] 检测并清理测试残留进程 ${cleaned.length} 个（BUG-20260914-013 兜底）：`);
    for (const r of cleaned) log(`    pid=${r.pid} port=${r.port ?? '?'} :: ${r.commandLine}`);
  }
  return cleaned;
}
