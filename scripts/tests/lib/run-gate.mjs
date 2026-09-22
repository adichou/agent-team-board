// BUG-20260922-005 run-all 单实例互斥 + 文件级重试 —— 聚合层基建。
// 动机：并发 npm test 实例重叠时（看板确认/核验任务内嵌测试、终端手工测试、中断任务的
// 孤儿进程），任一实例文件结束触发的 sweepTestResidue 会把「另一实例正在使用的测试
// server」按残留误杀（node + server.mjs + cwd 临时目录 + 监听段），用例随即裸
// ECONNREFUSED；单实例负载下另有 server 中途死亡导致的未捕获 ECONNRESET。
// 口径：A. 同套件锁文件互斥——第二实例等待而非并发（治本，消灭互杀前提）；
//      D. 单文件首跑失败 → sweep → 重试一次（治标，兜住两类瞬时偶发；重试通过标注
//         可观测、真实回归两次仍失败照常报红不掩盖）。
// 用法（run-all.mjs）：
//   const gate = await acquireRunLock(testsDir, { waitMs, log });
//   installGateSignalRelease(gate);   // SIGINT/SIGTERM 尽力释放
//   const r = await runFileWithRetry(f, { runOnce, sweep, log, errLog });
//   … gate.release();
// 自研说明（REQ-20260909-015）：约 40 行进程/文件锁与重试原语，node 内置能力即可表达，
// 无合适形态的库分发且引入成本高于自研；未引入开源依赖。

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// pid 存活判定：signal 0 探测；EPERM 视为存活（进程存在但属其他用户）。
const pidAlive = (pid) => {
  if (!Number.isInteger(pid) || pid <= 1) return false;
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
};

// 锁文件路径：按套件目录分键（同套件互斥；不同仓库 / 插件缓存副本各自独立不互相阻塞）。
export function lockPathFor(suiteDir) {
  const h = crypto.createHash('sha1').update(String(suiteDir)).digest('hex').slice(0, 10);
  return path.join(os.tmpdir(), `atb-run-all-${h}.lock`);
}

// 获取锁：无锁即建（O_EXCL 原子语义经 writeFileSync flag 'wx'）；持有者存活 → 轮询等待
// 至 waitMs 上限后抛错（消息含持有者 pid / 启动时间与指引）；持有者已死（陈旧锁）→ 移除
// 后接管。返回句柄 release() 只移除仍属本实例的锁（被接管覆写后不误删他人锁）。
export async function acquireRunLock(suiteDir, {
  waitMs = 20 * 60_000,
  pollMs = 2_000,
  log = () => {},
  lockPath = null,
  pid = process.pid,
  now = () => new Date().toISOString(),
} = {}) {
  const file = lockPath || lockPathFor(suiteDir);
  const payload = { pid, startedAt: now(), suite: String(suiteDir) };
  const deadline = Date.now() + Math.max(0, Number(waitMs) || 0);
  let announced = false;
  for (;;) {
    try {
      fs.writeFileSync(file, JSON.stringify(payload), { flag: 'wx' });
      return {
        release() {
          try {
            const cur = JSON.parse(fs.readFileSync(file, 'utf8'));
            if (cur && cur.pid === pid) fs.rmSync(file, { force: true });
          } catch (e) {
            if (e.code === 'ENOENT') return;
            // 读取失败（损坏）：仅当文件仍存在时保守不动（可能已被他人接管覆写）
          }
        },
      };
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
    }
    let holder = null;
    try { holder = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { holder = null; }
    if (!holder || !pidAlive(holder.pid)) {
      // 陈旧 / 损坏锁：移除后重试创建（竞态下他人先建则下轮自然进入等待分支）
      try { fs.rmSync(file, { force: true }); } catch { /* 他人已移除/接管 */ }
      continue;
    }
    if (!announced) {
      announced = true;
      log(`另一 npm test 实例正在运行（pid=${holder.pid}，启动于 ${holder.startedAt || '?'}），等待其结束后执行，不并发互跑（BUG-20260922-005 单实例互斥）…`);
    }
    if (Date.now() >= deadline) {
      throw new Error(`等待其他 npm test 实例超时（${Math.round(Math.max(0, Number(waitMs) || 0) / 1000)}s）：pid=${holder.pid}（启动于 ${holder.startedAt || '?'}）仍在运行。并发实例会互相误杀测试 server（BUG-20260922-005），请等其结束或按 pid 处理后重试`);
    }
    await sleep(Math.max(50, Number(pollMs) || 2_000));
  }
}

// 信号兜底释放（run-all 主进程安装）：正常路径在结束时显式 release；此处保证 SIGINT/SIGTERM
// 尽力释放（残留陈旧锁亦可被下一轮 pid 存活判定自愈接管，双保险）。
export function installGateSignalRelease(gate) {
  if (!gate || typeof gate.release !== 'function') return () => {};
  let released = false;
  const onSignal = (sig, code) => () => {
    if (released) return;
    released = true;
    try { gate.release(); } catch { /* 尽力而为 */ }
    process.exit(code);
  };
  process.on('SIGINT', onSignal('SIGINT', 130));
  process.on('SIGTERM', onSignal('SIGTERM', 143));
  return () => { released = true; };
}

// 文件级重试（BUG-20260922-005 D）：首跑失败 → 提示 + sweep（清首跑泄漏的 server，提高
// 重试成功率）→ 重试一次。返回结果带 retried 标记；重试仍失败保持失败（真实回归不掩盖）。
export async function runFileWithRetry(f, { runOnce, sweep = null, log = () => {}, errLog = () => {} } = {}) {
  let r = await runOnce(f);
  if (r.status !== 0) {
    errLog(`⚠ ${f} 首跑失败（exit=${r.status}${r.signal ? ` signal=${r.signal}` : ''}），${sweep ? '清理残留后' : ''}重试一次（BUG-20260922-005 瞬时偶发缓解）`);
    if (sweep) await sweep(`${f}#retry`);
    r = await runOnce(f);
    return { ...r, retried: true };
  }
  return { ...r, retried: false };
}
