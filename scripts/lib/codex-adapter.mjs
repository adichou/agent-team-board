// REQ-20260906-003 CodexExecAdapter —— codex exec 后台进程适配器。
// 职责（不做业务完成判断）：
//   - 参数数组构造（不经 shell；提示词走 stdin；恢复只用确切 threadId，禁止 --last）
//   - JSONL 事件流解析（跨 chunk/非 JSON/未知事件/无尾换行均不崩）
//   - 进程归属：独立进程组 + 启动时刻记录（防 PID 复用误杀）
//   - 取消（先中断 → 宽限 → 组强杀）、超时、退出后同组残留工具回收
// CLI 参数由静态预检按本机实际命令核验；resume 工作目录由 spawn.cwd 指定。

import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { validateModelId, validateReasoningEffort, classifyModelFailure } from './codex-model-config.mjs';

// 参数构造：数组直传 spawn，绝无 shell 拼接；'-' 表示提示词从 stdin 读
// REQ-20260906-024：model/reasoningEffort 为有类型字段（HTTP 不接收任意 CLI 参数）。
// 模型与强度必须成对出现：只覆盖其一会让另一个落在别的模型的默认值上，故缺一即全部不传。
export function buildExecArgs({ projectRoot, finalMessageFile, resumeThreadId, allowNonGit = false, extraArgs = [], model = null, reasoningEffort = null }) {
  if (typeof projectRoot !== 'string' || !path.isAbsolute(projectRoot)) {
    throw new Error(`projectRoot 必须是绝对路径：${projectRoot}`);
  }
  const hasModel = model != null && model !== '';
  const hasEffort = reasoningEffort != null && reasoningEffort !== '';
  if (hasModel !== hasEffort) {
    throw new Error('模型与推理强度必须同时提供（只覆盖其一会让另一项落在其他模型的默认值上）');
  }
  if (hasModel) {
    const m = validateModelId(model);
    if (!m.ok) throw new Error(`模型 ID 非法：${m.error}`);
    const e = validateReasoningEffort(reasoningEffort);
    if (!e.ok) throw new Error(`推理强度非法：${e.error}`);
  }
  const args = ['exec'];
  if (resumeThreadId) {
    if (typeof resumeThreadId !== 'string' || !/^[A-Za-z0-9_-]+$/.test(resumeThreadId)) {
      throw new Error(`恢复会话 ID 非法：${resumeThreadId}`);
    }
    args.push('resume', resumeThreadId);
  }
  args.push('--json');
  if (!resumeThreadId) args.push('-C', projectRoot);
  if (hasModel) {
    args.push('--model', model);
    // TOML 值编码：字符串必须带引号；形态校验已排除引号/控制字符，无需转义面
    args.push('-c', `model_reasoning_effort="${reasoningEffort}"`);
  }
  if (allowNonGit) args.push('--skip-git-repo-check');
  if (finalMessageFile) args.push('--output-last-message', finalMessageFile);
  args.push(...extraArgs, '-');
  return args;
}

// 流式行解析：push() 喂 chunk，flush() 输出无尾换行的残行；CRLF 归一
export function createLineParser(onLine) {
  let buf = '';
  return {
    push(chunk) {
      buf += chunk;
      let idx;
      while ((idx = buf.indexOf('\n')) !== -1) {
        let line = buf.slice(0, idx);
        buf = buf.slice(idx + 1);
        if (line.endsWith('\r')) line = line.slice(0, -1);
        if (line) onLine(line);
      }
    },
    flush() {
      if (buf) {
        const line = buf.endsWith('\r') ? buf.slice(0, -1) : buf;
        buf = '';
        if (line) onLine(line);
      }
    },
  };
}

// 进程启动时刻（macOS 无 /proc，用 ps lstart；读取失败返回 null）
// 与 PID 一起构成本次归属的身份指纹：重启后核对旧记录时防止 PID 复用误杀
export function readPidStartTime(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return null;
  try {
    const out = execFileSync('ps', ['-p', String(pid), '-o', 'lstart='], { timeout: 2000, encoding: 'utf8' }).trim();
    return out || null;
  } catch {
    return null;
  }
}

// 环境级失败分类（C14）：auth/quota 暂停执行器；network 按配置退避重试
// REQ-20260906-024：模型类错误单独分类（M09/M10）——结构化特征优先，
// 泛化 HTTP 400/404/429 不归为模型问题（保持 unknown 交人工核对）。
export function classifyFailure(stderr, code) {
  const s = String(stderr || '');
  if (/not inside a trusted directory|not a git repository|skip-git-repo-check was not specified/i.test(s)) return { kind: 'project', retryable: false };
  if (/unexpected argument|unrecognized (?:option|argument)|unknown (?:option|argument)/i.test(s)) return { kind: 'cli-args', retryable: false };
  const model = classifyModelFailure(s);
  if (model) return { ...model, retryable: false };
  if (/\b401\b|unauthorized|not logged in|login required|auth/i.test(s)) return { kind: 'auth', retryable: false };
  if (/\b429\b|usage limit|quota|rate limit|余额|额度/i.test(s)) return { kind: 'quota', retryable: false };
  if (/network|econnreset|econnrefused|etimedout|connection (reset|refused|closed)|fetch failed|暂时无法连接/i.test(s)) {
    return { kind: 'network', retryable: true };
  }
  return { kind: 'unknown', retryable: false };
}

// 受控环境白名单：沿用本机登录（HOME）与 PATH，剔除无关注入面
function controlledEnv(extra) {
  const keep = ['HOME', 'PATH', 'LANG', 'LC_ALL', 'LC_CTYPE', 'TMPDIR', 'XDG_CACHE_HOME', 'CODEX_HOME', 'SSH_AUTH_SOCK'];
  const env = { NO_COLOR: '1', TERM: 'dumb' };
  for (const k of keep) if (process.env[k] !== undefined) env[k] = process.env[k];
  return { ...env, ...(extra || {}) };
}

function threadIdOf(evt) {
  if (!evt || typeof evt !== 'object') return null;
  const v = evt.thread_id ?? evt.threadId ?? (evt.thread && evt.thread.id) ?? null;
  return typeof v === 'string' && v ? v : null;
}

const groupAlive = (pgid) => {
  try { process.kill(-pgid, 0); return true; } catch { return false; }
};

/**
 * 启动一次 codex exec。
 * 返回 { pid, args, promise, cancel, stopping }：
 *   promise → { code, signal, cancelled, timedOut, threadId, pid, pidStartTime, stderr, lingerKilled, finalMessageFile }
 *   cancel(reason) 幂等：SIGINT 组中断 → cancelGraceMs → SIGKILL 组强杀 → 等 exit
 * spawnArgs：夹具用（真 CLI 时省略，args[0] 即子命令）；envMode：注入受控环境变量。
 */
export function startCodexExec({
  cliPath,
  spawnArgs = null,     // 测试接缝：以 [fixture, ...] 形式替换被拉起目标
  projectRoot,
  prompt,
  resumeThreadId = null,
  finalMessageFile = null,
  allowNonGit = false,
  extraArgs = [],
  model = null,             // REQ-20260906-024：有类型模型字段（与 reasoningEffort 成对）
  reasoningEffort = null,   // 与 model 成对；来自 run.modelSnapshot，续跑不重解析
  timeoutMs = 60 * 60_000,
  cancelGraceMs = 10_000,
  settleMs = 1_500,     // CLI 退出后同组残留工具的观察窗口
  envMode = {},
  onEvent = () => {},
  onStderr = () => {},
  onPid = () => {},
} = {}) {
  const args = buildExecArgs({ projectRoot, finalMessageFile, resumeThreadId, allowNonGit, extraArgs, model, reasoningEffort });
  const fullArgs = spawnArgs ? [...spawnArgs, ...args] : args;

  let child;
  try {
    child = spawn(cliPath, fullArgs, {
      cwd: projectRoot,
      env: controlledEnv(envMode),
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: true, // 独立进程组：组身份 = child.pid，可整组精确回收，不误伤别的 Codex
    });
  } catch (e) {
    const err = new Error(`codex 启动失败：${e.message}`);
    err.cause = e;
    const dead = Promise.resolve({
      code: null, signal: null, cancelled: false, timedOut: false, threadId: null,
      pid: null, pidStartTime: null, stderr: '', lingerKilled: false,
      finalMessageFile: finalMessageFile || null, spawnError: err,
    });
    return { pid: null, args, promise: dead, cancel: () => {}, stopping: () => false };
  }

  const pid = child.pid ?? null;
  const pidStartTime = pid ? readPidStartTime(pid) : null;
  onPid(pid);

  const state = {
    threadId: null,
    cancelled: false,
    timedOut: false,
    stopping: false,
    stderr: '',
    settled: false,
  };

  let resolvePromise;
  const promise = new Promise((resolve) => { resolvePromise = resolve; });

  const stdoutParser = createLineParser((line) => {
    let evt = null;
    try {
      evt = JSON.parse(line);
    } catch {
      onEvent({ kind: 'diagnostic', line });
      return;
    }
    const tid = threadIdOf(evt) ?? (evt.type === 'thread.started' ? null : null);
    if (tid && !state.threadId) state.threadId = tid;
    if (evt.type === 'thread.started' && !state.threadId && evt.id) state.threadId = String(evt.id);
    onEvent({ kind: 'event', event: evt });
  });

  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => stdoutParser.push(chunk));
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => {
    state.stderr += chunk;
    if (state.stderr.length > 256 * 1024) state.stderr = state.stderr.slice(-128 * 1024); // 有界
    onStderr(chunk);
  });

  const killGroup = (sig) => {
    try { process.kill(-pid, sig); } catch {}
    try { child.kill(sig); } catch {} // 组杀兜底单杀（主进程异常时）
  };

  let graceTimer = null;
  const interrupt = (reason) => {
    if (state.stopping) return;
    state.stopping = true;
    if (reason === 'timeout') state.timedOut = true;
    else state.cancelled = true;
    killGroup('SIGINT');
    graceTimer = setTimeout(() => killGroup('SIGKILL'), cancelGraceMs);
    if (graceTimer.unref) graceTimer.unref();
  };

  function cancel() { interrupt('user'); }
  const stopping = () => state.stopping;

  let timeoutTimer = null;
  if (timeoutMs > 0) {
    timeoutTimer = setTimeout(() => interrupt('timeout'), timeoutMs);
    if (timeoutTimer.unref) timeoutTimer.unref();
  }

  const finish = (code, signal, spawnError) => {
    stdoutParser.flush(); // 尾行（无换行）不丢
    if (graceTimer) clearTimeout(graceTimer);
    if (timeoutTimer) clearTimeout(timeoutTimer);
    try { child.stdin.destroy(); } catch {}

    // CLI 退出 ≠ 组内工具已停：观察窗口内组仍存活则组强杀（仅本次归属的组）
    const deadline = Date.now() + settleMs;
    const pollSettle = () => {
      if (spawnError || !groupAlive(pid)) return Promise.resolve(false);
      if (Date.now() >= deadline) {
        killGroup('SIGKILL');
        return Promise.resolve(true);
      }
      return new Promise((r) => setTimeout(r, Math.min(120, settleMs))).then(pollSettle);
    };

    pollSettle().then((lingerKilled) => {
      state.settled = true;
      resolvePromise({
        code: spawnError || code == null ? null : code,
        signal: signal || null,
        cancelled: state.cancelled,
        timedOut: state.timedOut,
        threadId: state.threadId,
        pid,
        pidStartTime,
        stderr: state.stderr,
        lingerKilled,
        finalMessageFile: finalMessageFile || null,
        spawnError: spawnError || null,
      });
    });
  };

  let spawnErr = null;
  child.on('error', (e) => { spawnErr = e; });
  child.on('close', (code, signal) => finish(code, signal, spawnErr));

  // 提示词经 stdin 注入后即关闭（codex exec 约定：'-' 从 stdin 读全文）
  child.stdin.write(prompt == null ? '' : String(prompt));
  child.stdin.end();

  return { pid, args, promise, cancel, stopping, get spawnError() { return spawnErr; } };
}
