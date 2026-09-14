// REQ-20260906-003 Scheduler —— Codex 后台自动派发调度器（每项目一个实例）。
// 只从 planned（已计划，REQ-20260908-010）选单（创建早优先、依赖满足）；预留 → 受控 claim（由 worker 按提示词执行）
// → 后台 codex exec → 事件/错误/会话 ID 落账 → 证据核对 → 收尾放锁 → 下一项。
// 空队列只做本地文件轮询，绝不调用模型；环境级错误（认证/额度/CLI 缺失/工作区不确定）暂停执行器。
// 运行阶段是执行账本（dispatch/runs），绝不触碰条目 status.json。

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import * as core from './core.mjs';
import * as store from './dispatch-store.mjs';
import { startCodexExec, classifyFailure, readPidStartTime } from './codex-adapter.mjs';
import { verifyCompletion } from './execution-verifier.mjs';
import {
  effectiveSelection, readModelConfigLayers, resolveInheritedModel,
  buildModelSnapshot, loadModelCatalog, fingerprintLayers, MODEL_FAILURE_KINDS,
} from './codex-model-config.mjs';

export { store };

// ---------- 模型配置解析（REQ-20260906-024：新执行启动前解析并落盘快照） ----------
// 优先级：本项 explicit > 项目 explicit > 本机有效配置继承。
// 解析失败返回可诊断错误（kind=config-unresolved），由调用方阻止派发并登记待处理；绝不猜默认模型。

export function resolveModelForItem({ dataDir, projectRoot, itemId, cliPath = null, noCache = false, catalogRun = null } = {}) {
  const cfg = store.loadSettings(dataDir).codex;
  const itemSel = store.loadItemModelSelection(dataDir, itemId);
  const eff = effectiveSelection({ itemSelection: itemSel, projectSelection: cfg.modelSelection });
  const cliVersion = cliPath ? probeCliVersion(cliPath) : null;
  let catalog = null;
  if (cliPath) {
    catalog = loadModelCatalog({ cliPath, cwd: projectRoot, noCache, runSync: catalogRun || undefined });
  }
  if (eff.selection.mode === 'explicit') {
    const snap = buildModelSnapshot({ selection: eff.selection, source: eff.source, catalog, cliVersion });
    if (!snap.ok) return { ok: false, kind: 'config-unresolved', error: snap.error };
    return { ok: true, snapshot: snap.snapshot, selection: eff.selection, source: eff.source };
  }
  const layers = readModelConfigLayers({ projectRoot });
  const inherit = resolveInheritedModel(layers);
  const snap = buildModelSnapshot({ selection: { mode: 'inherit' }, source: 'inherit', inherit, catalog, layers, cliVersion });
  if (!snap.ok) {
    return {
      ok: false, kind: 'config-unresolved',
      error: `沿用本机配置解析失败：${snap.error}。请在「模型与推理强度」中刷新配置或显式选择模型。`,
    };
  }
  return { ok: true, snapshot: snap.snapshot, selection: eff.selection, source: 'inherit', layers, inherit };
}

// ---------- 全局并发闸（首期全服务自动实施并发固定 1） ----------

export function createHub() {
  let holder = null; // { projectRoot, itemId, title }
  return {
    tryAcquire(info) {
      if (holder) return { ok: false, heldBy: holder };
      holder = { ...info };
      return { ok: true };
    },
    release(projectRoot) {
      if (holder && holder.projectRoot === projectRoot) holder = null;
    },
    current: () => holder,
  };
}

// ---------- 提示词 ----------

export function buildWorkerPrompt({ itemId, title, projectRoot, atbCliPath, runId }) {
  return [
    `请将当前会话名改为 ${itemId}。`,
    `你是本项目的开发执行者，处理智能体团队看板条目 ${itemId}：${title}`,
    `项目根：${projectRoot}（codex 已以 -C 指定工作目录，请勿切换目录）。执行编号：${runId}。`,
    '',
    '按以下步骤完成，只处理这一个条目：',
    `1. 认领：node ${JSON.stringify(atbCliPath)} claim ${itemId} --by ${itemId}`,
    `2. 读取条目文档：docs/agent-team-board/**/${itemId}/ 下的 README.md、design.md、test-cases.md`,
    '3. 按 TDD 实施：先补用例跑红 → 实现 → 跑绿 → 重构；不改动无关文件；不执行 git commit/push',
    '   开源选型牵引（REQ-20260909-015）：方案优先复用成熟开源库，以依赖方式引入（npm / SPM / CocoaPods），',
    '   禁止复制开源库源码进项目仓库；仅用开源友好许可（MIT / Apache-2.0 / BSD-2-Clause / BSD-3-Clause / ISC /',
    '   0BSD / Unlicense），GPL / LGPL / AGPL / SSPL 及 License 不明禁止引入；引入开源库须在条目目录维护',
    '   licenses.md（库名 / 版本 / 引入方式 / License / 仓库地址），未使用开源库不创建该文件；自研须写三选一理由。',
    `4. 上报：node ${JSON.stringify(atbCliPath)} report ${itemId} --coverage <0-100> --framework <框架> --summary "<要点>" --by ${itemId} --run ${runId}`,
    '',
    '完成后输出简短总结并结束本轮；不要继续处理其他条目，不要派发子任务。',
  ].join('\n');
}

export function buildResumePrompt({ itemId, atbCliPath, runId, missing }) {
  return [
    `继续条目 ${itemId} 的执行（执行编号 ${runId}，本项此前一轮已结束但未完成上报）。`,
    `缺失证据：${missing || '未收到有效 test-report 上报'}`,
    `若实施已完毕：node ${JSON.stringify(atbCliPath)} report ${itemId} --coverage <0-100> --framework <框架> --summary "<要点>" --by ${itemId} --run ${runId}`,
    '若未完毕：继续按条目文档 TDD 实施后上报。',
    '只处理这一个条目；不要引入其他条目的历史；完成后结束本轮。',
  ].join('\n');
}

// ---------- 工作区探针（C17：git 工作区不确定时暂停项目；非 git 项目无法判定，如实跳过） ----------

function gitStatusSnapshot(projectRoot) {
  if (!fs.existsSync(path.join(projectRoot, '.git'))) return null;
  const r = spawnSync('git', ['-C', projectRoot, 'status', '--porcelain'], { encoding: 'utf8', timeout: 5000 });
  if (r.status !== 0) return null;
  return (r.stdout || '')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !/(^|\/)docs\/agent-team-board\//.test(l)); // 看板数据目录变化属正常
}

const workspaceChanged = (a, b) => JSON.stringify(a ?? null) !== JSON.stringify(b ?? null);

// ---------- 调度器 ----------

export function createScheduler({
  projectRoot,
  dataDir,
  hub = createHub(),
  atbCliPath,
  cli = {},                 // { path, spawnArgs, envForRun }
  tickMs = 4000,
  backoffs = [5000, 15000],
  cancelGraceMs = 10_000,
  settleMs = 1500,
  maxResumeRounds = 2,
  timeoutMs = 60 * 60_000,
  maxTotalMs = null,        // 单项尝试总时限（缺省 = timeoutMs，同单项时限）
}) {
  const S = {
    enabled: false,
    paused: false,
    pauseReason: null,
    recoveryNote: null,
    waiting: { kind: 'disabled' },
    current: null,          // 内存态：{ runId, itemId, title, phase, startedAt, lastEventAt, threadId, handle, cancelRequested, attempts }
    timer: null,
    stopping: false,
    retryTimer: null,
    watchers: new Set(),
  };

  const settings = () => store.loadSettings(dataDir).codex;
  const saveSettings = (patch) => store.saveSettings(dataDir, { codex: patch });

  // 模型目录读取接缝：生产直接 spawn CLI；测试经 cli.spawnArgs 前缀拉起夹具
  function modelCatalogRun(args, opts) {
    const target = cli.path || settings().cliPath;
    if (!target) {
      const r = { status: null, stdout: '', stderr: '', error: new Error('未配置 codex CLI') };
      return r;
    }
    const finalArgs = cli.spawnArgs ? [...cli.spawnArgs, ...args] : args;
    return spawnSync(target, finalArgs, opts);
  }

  function status() {
    const cur = S.current
      ? {
        runId: S.current.runId,
        itemId: S.current.itemId,
        title: S.current.title,
        phase: S.current.phase,
        startedAt: S.current.startedAt,
        lastEventAt: S.current.lastEventAt,
        attempts: S.current.attemptCount,
        threadId: S.current.threadId,
        cancelRequested: S.current.cancelRequested,
        stopping: !!S.current?.handle?.stopping?.(),
        retriesUsed: S.current?.retriesUsed || 0,
        model: S.current.model || null,
        reasoningEffort: S.current.reasoningEffort || null,
        modelSource: S.current.modelSource || null,
      }
      : null;
    return {
      projectRoot,
      enabled: S.enabled,
      paused: S.paused,
      pauseReason: S.pauseReason,
      recoveryNote: S.recoveryNote,
      current: cur,
      waiting: S.current ? null : S.waiting,
      concurrency: { project: 1, global: 1 },
      globalHolder: hub.current(),
    };
  }

  const itemDetail = (id) => {
    try { return core.getItemDetail(dataDir, id); } catch { return null; }
  };

  // 项目互斥：unknown in-progress 执行（手工/Zcode，无账本归属）或收尾待核对 → 占用
  function findProjectBlocker(items) {
    for (const it of items) {
      if (it.status !== 'in-progress' || it.agentCompletedAt) continue;
      const last = store.lastRunForItem(dataDir, it.id);
      if (!last) return { kind: 'project-busy', holder: it.owner || '未知执行', itemId: it.id };
      if (last.phase === 'cleanup_pending' || last.phase === 'needs_attention') {
        return { kind: 'project-busy', holder: `收尾待核对（${it.id}）`, itemId: it.id };
      }
      // 终态（reported/failed/blocked/interrupted）：账本可归属，等人工处理该条目，不阻塞其他条目
    }
    return null;
  }

  function selectCandidate() {
    const items = core.listItems(dataDir);
    const blocker = findProjectBlocker(items); // 互斥优先：项目被占时即便有候选也不取
    if (blocker) return { item: null, blocker };
    const statusOf = (id) => items.find((x) => x.id === id)?.status || 'submitted';
    const openItemIds = new Set(store.listOpenRuns(dataDir).map((r) => r.itemId));
    // BUG-20260906-005：收集仅因依赖未满足被排除的已计划条目，用于把「依赖阻塞」与「队列已空」区分开
    const depBlocked = [];
    const cands = items
      .filter((x) => x.status === 'planned' && !openItemIds.has(x.id))
      .filter((x) => {
        // 失败、受阻或中断过的条目不自动重派，避免新建 run 重置有限尝试预算。
        // 以持久化账本为准，关闭再开启或服务重启也必须等待人工恢复。
        const last = store.lastRunForItem(dataDir, x.id);
        if (last && ['blocked', 'failed', 'interrupted'].includes(last.phase)) return false;
        const dep = store.depsSatisfied(dataDir, x.id, statusOf);
        if (!dep.ok) {
          depBlocked.push({ id: x.id, title: x.title, unsatisfied: dep.unsatisfied });
          return false;
        }
        return true;
      });
    if (!cands.length) {
      if (depBlocked.length) {
        return {
          item: null,
          // 上限截断防 waiting 载荷膨胀；count 保留真实总数
          blocker: {
            kind: 'deps-blocked',
            count: depBlocked.length,
            items: depBlocked.slice(0, 3).map((x) => ({ ...x, unsatisfied: x.unsatisfied.slice(0, 5) })),
          },
        };
      }
      return { item: null, blocker: { kind: 'empty' } };
    }
    cands.sort((a, b) =>
      // REQ-20260908-010 最旧优先：纯创建时间序（需求优先于 Bug 的旧规则随已计划口径退役）
      (a.createdAt || '').localeCompare(b.createdAt || '') ||
      a.id.localeCompare(b.id));
    return { item: cands[0], blocker: null };
  }

  function pauseExecutor(reason) {
    S.paused = true;
    S.pauseReason = reason;
    S.waiting = { kind: 'paused', reason };
  }

  function releaseOccupancy(cur = S.current) {
    store.releaseProjectLock(dataDir, cur ? cur.itemId : null, cur ? cur.runId : null);
    hub.release(projectRoot);
  }

  // ---- 单次尝试启动 ----
  // 模型参数取自 run.modelSnapshot（REQ-20260906-024）：new/resume/retry 一律用创建时快照，
  // 后来修改的项目/全局设置不影响同项续跑与重试。
  function spawnAttempt(run, { kind, resumeThreadId = null, prompt }) {
    const attemptNo = run.attempts.length + 1;
    const finalMessageFile = path.join(store.runDir(dataDir, run.runId), 'final-message.md');
    store.updateRun(dataDir, run.runId, { phase: 'starting' });
    S.current.phase = 'starting';

    const workspaceBefore = gitStatusSnapshot(projectRoot);
    const handle = startCodexExec({
      cliPath: cli.path || settings().cliPath,
      spawnArgs: cli.spawnArgs || null,
      projectRoot,
      prompt,
      resumeThreadId,
      finalMessageFile,
      allowNonGit: settings().allowNonGit,
      model: run.modelSnapshot ? run.modelSnapshot.modelId : null,
      reasoningEffort: run.modelSnapshot ? run.modelSnapshot.reasoningEffort : null,
      timeoutMs,
      cancelGraceMs,
      settleMs,
      envMode: cli.envForRun ? cli.envForRun({ ...run, attemptNo }) : {},
      onEvent: ({ kind: k, event, line }) => {
        store.appendEvent(dataDir, run.runId, k === 'diagnostic' ? { diag: line, at: new Date().toISOString() } : event);
        S.current.lastEventAt = new Date().toISOString();
        const evt = event;
        if (evt && evt.type === 'thread.started') {
          const tid = evt.thread_id ?? evt.threadId ?? evt.id ?? null;
          if (tid && !run.threadId) {
            run.threadId = String(tid);
            S.current.threadId = run.threadId;
            store.updateRun(dataDir, run.runId, { threadId: run.threadId }); // 拿到即持久化
          }
        }
        // M17：运行时若返回实际模型标识，单独保存作核对；不把推断包装成服务端确认
        const runtimeModel = evt && typeof evt === 'object'
          ? (typeof evt.model === 'string' && evt.model) || (evt.turn && typeof evt.turn.model === 'string' ? evt.turn.model : null)
          : null;
        if (runtimeModel && !run.modelConfirmed) {
          run.modelConfirmed = runtimeModel;
          store.updateRun(dataDir, run.runId, { modelConfirmed: runtimeModel });
          // 请求与返回不一致：记录异常并暂停后续派发（不自动换模型）
          if (run.modelSnapshot && runtimeModel !== run.modelSnapshot.modelId) {
            store.addModelPending(dataDir, {
              itemId: run.itemId, runId: run.runId, kind: 'model-mismatch',
              summary: `请求模型 ${run.modelSnapshot.modelId}，运行时返回 ${runtimeModel}；已暂停派发待核对`,
              logRef: { runId: run.runId, file: 'events' },
              configFingerprint: run.modelSnapshot.configFingerprint,
            });
            pauseExecutor(`模型标识不一致：请求 ${run.modelSnapshot.modelId}，运行返回 ${runtimeModel}。请核对配置后重新开启。`);
          }
        }
      },
      onStderr: (chunk) => store.appendStderr(dataDir, run.runId, chunk),
    });

    const attempt = {
      attemptNo, kind, resumeThreadId,
      startedAt: new Date().toISOString(),
      pid: handle.pid ?? null,
      pidStartTime: handle.pid ? readPidStartTime(handle.pid) : null,
      exitCode: null, signal: null, endedAt: null, lingerKilled: null,
    };
    run.attempts.push(attempt);
    run.startedAt = run.startedAt || attempt.startedAt; // 内存对象与账本同步（核对器依赖）
    store.updateRun(dataDir, run.runId, {
      phase: 'running',
      startedAt: run.startedAt,
      attempts: run.attempts,
    });
    if (S.current.workspaceBefore === undefined) {
      S.current.workspaceBefore = workspaceBefore; // 基线只在首个尝试拍一次：失败遗留改动相对整 run 判定
    }
    Object.assign(S.current, { phase: 'running', handle, attemptCount: attemptNo });

    handle.promise.then((res) => {
      settleAttempt(run, attempt, res); // 取消/关停路径同样走统一结算（含 SIGTERM 后的 interrupted 落账）
    }).catch(() => {});
  }

  // ---- 尝试结算 ----
  function settleAttempt(run, attempt, res) {
    attempt.exitCode = res.code;
    attempt.signal = res.signal;
    attempt.lingerKilled = res.lingerKilled;
    attempt.endedAt = new Date().toISOString();
    run.attempts = [...run.attempts];

    // 启动失败：无副作用，直接失败并暂停执行器（环境问题）
    if (res.spawnError) {
      store.updateRun(dataDir, run.runId, {
        attempts: run.attempts,
        phase: 'failed',
        endedAt: new Date().toISOString(),
        result: { reason: 'cli-spawn-failed', detail: res.spawnError.message },
      });
      finishRun('failed');
      pauseExecutor(`codex CLI 启动失败：${res.spawnError.message}。请在「检查运行环境」确认 CLI 路径后重新开启。`);
      return;
    }

    // 用户取消：停止中 → 确认回收后 interrupted
    if (res.cancelled) {
      store.updateRun(dataDir, run.runId, {
        attempts: run.attempts, phase: 'interrupted', endedAt: new Date().toISOString(),
        result: { reason: 'user-stop' },
      });
      finishRun('interrupted');
      return;
    }

    // 超时：单项尝试时限到
    if (res.timedOut) {
      store.updateRun(dataDir, run.runId, {
        attempts: run.attempts, phase: 'failed', endedAt: new Date().toISOString(),
        result: { reason: 'timeout', detail: `超过单项时限（${Math.round(timeoutMs / 60000)} 分钟）` },
      });
      finishRun('failed');
      return;
    }

    // 网络类可重试：退避后按确切 threadId 续（副作用不明且无会话 ID 时不重试）
    const cls = classifyFailure(res.stderr, res.code);
    if (cls.kind === 'project' || cls.kind === 'cli-args') {
      const detail = String(res.stderr || '').trim().slice(-2000);
      store.updateRun(dataDir, run.runId, {
        attempts: run.attempts, phase: 'failed', endedAt: new Date().toISOString(),
        result: { reason: cls.kind, detail },
      });
      finishRun('failed');
      pauseExecutor(`Codex 运行环境不满足要求：${detail}。请检查运行环境后重新开启。`);
      return;
    }
    // 模型/配置类失败（M09）：暂停本项目自动派发 + 持久待处理记录；不自动换模型、不降级强度、
    // 不把整个队列逐项认领失败（暂停后不再取单）。条目业务状态保持 in-progress 等人工处置。
    if (MODEL_FAILURE_KINDS.includes(cls.kind)) {
      const detail = String(res.stderr || '').trim().slice(-2000);
      store.updateRun(dataDir, run.runId, {
        attempts: run.attempts, phase: 'failed', endedAt: new Date().toISOString(),
        result: { reason: cls.kind, detail },
      });
      const labels = {
        'model-missing': '模型不存在',
        'model-denied': '账户无权使用该模型',
        'effort-unsupported': '推理强度不被该模型支持',
      };
      store.addModelPending(dataDir, {
        itemId: run.itemId, runId: run.runId, kind: cls.kind,
        summary: `${labels[cls.kind] || cls.kind}：请求模型 ${run.modelSnapshot ? run.modelSnapshot.modelId : '（无快照）'}`
          + `${run.modelSnapshot ? ` / 强度 ${run.modelSnapshot.reasoningEffort}` : ''}。${detail.slice(-400)}`,
        logRef: { runId: run.runId, file: 'stderr' },
        configFingerprint: run.modelSnapshot ? run.modelSnapshot.configFingerprint : null,
      });
      finishRun('failed');
      pauseExecutor(`${labels[cls.kind] || '模型配置问题'}：已暂停本项目 Codex 自动派发。请在「模型与推理强度」检查设置或以新配置重试本项。`);
      return;
    }
    if (cls.kind === 'network' && cls.retryable) {
      const used = run.retriesUsed || 0;
      if (used < settings().retries) {
        run.retriesUsed = used + 1;
        store.updateRun(dataDir, run.runId, { attempts: run.attempts, retriesUsed: run.retriesUsed });
        const waitMs = backoffs[Math.min(used, backoffs.length - 1)] ?? 15000;
        S.waiting = { kind: 'retry-backoff', waitMs, attempt: run.retriesUsed };
        scheduleRetry(run, waitMs);
        return;
      }
      store.updateRun(dataDir, run.runId, {
        attempts: run.attempts, phase: 'failed', endedAt: new Date().toISOString(),
        result: { reason: 'network-retries-exhausted' },
      });
      finishRun('failed');
      return;
    }
    if (cls.kind === 'auth' || cls.kind === 'quota') {
      const label = cls.kind === 'auth' ? '认证失败（401/未登录）' : '额度不足（429/配额用尽）';
      store.updateRun(dataDir, run.runId, {
        attempts: run.attempts, phase: 'failed', endedAt: new Date().toISOString(),
        result: { reason: cls.kind },
      });
      finishRun('failed');
      pauseExecutor(`${label}：执行器已暂停，未领取其余条目。请在本机完成登录/额度确认后重新开启自动派发。`);
      return;
    }

    // 正常/异常退出 → 完成证据核对
    const v = verifyCompletion({ run, dataDir });
    if (v.reported) {
      store.updateRun(dataDir, run.runId, {
        attempts: run.attempts, phase: 'reported', endedAt: new Date().toISOString(),
        result: { reason: 'reported', reportRef: 'test-report.md' },
      });
      finishRun('reported');
      return;
    }

    // 未上报：有确切会话 ID 且续跑轮数未满 → 有限续跑（默认最多追加 2 轮）。
    // cancelRequested 以账本现值核对：停止请求发出后不得再续跑/复活本次 run
    const resumeCount = run.attempts.filter((a) => a.kind === 'resume' || a.kind === 'retry').length;
    const fresh = store.getRun(dataDir, run.runId);
    if (!fresh.cancelRequested && run.threadId && resumeCount < maxResumeRounds) {
      store.updateRun(dataDir, run.runId, { attempts: run.attempts });
      S.waiting = { kind: 'continuation', attempt: resumeCount + 1 };
      const prompt = buildResumePrompt({ itemId: run.itemId, atbCliPath, runId: run.runId, missing: v.reason });
      setTimeout(() => {
        if (S.current?.runId !== run.runId || S.stopping) return;
        if (store.getRun(dataDir, run.runId).cancelRequested) return; // 二次核对：竞态下仍可能已请求停止
        spawnAttempt(run, { kind: 'resume', resumeThreadId: run.threadId, prompt });
      }, Math.min(200, tickMs)).unref?.();
      return;
    }

    // 续跑耗尽 / 无会话 ID：记录阻塞（业务状态保持 in-progress，等人工）
    store.updateRun(dataDir, run.runId, {
      attempts: run.attempts, phase: 'blocked', endedAt: new Date().toISOString(),
      result: {
        reason: run.threadId ? 'unfinished-after-continuation' : v.reason,
        detail: run.threadId ? '续跑轮数已达上限仍未完成上报' :
          ['未获得会话 ID，无法续跑', String(res.stderr || '').trim().slice(-2000)].filter(Boolean).join('；'),
      },
    });
    finishRun('blocked', { verify: v });
  }

  function scheduleRetry(run, waitMs) {
    S.retryTimer = setTimeout(() => {
      S.retryTimer = null;
      // BUG-20260906-007：停止请求撤销待执行重试——与续跑路径同级的内存+账本双重核对，竞态下也不复活
      const cur = S.current;
      const cancelled = S.stopping || !cur || cur.runId !== run.runId
        || cur.cancelRequested || store.getRun(dataDir, run.runId).cancelRequested;
      if (!cancelled) {
        const prompt = buildResumePrompt({ itemId: run.itemId, atbCliPath, runId: run.runId, missing: '网络错误自动重试' });
        spawnAttempt(run, { kind: 'retry', resumeThreadId: run.threadId || undefined, prompt });
      }
    }, waitMs);
    if (S.retryTimer.unref) S.retryTimer.unref();
  }

  // run 收尾：工作区核对 → 释放占用（reported）或暂停（不确定）；S.current 清空
  function finishRun(phaseLabel) {
    const cur = S.current;
    S.current = null;
    if (cur) {
      const before = cur.workspaceBefore;
      const after = gitStatusSnapshot(projectRoot);
      if (phaseLabel !== 'reported' && before !== undefined && workspaceChanged(before, after)) {
        releaseOccupancy(cur);
        pauseExecutor('工作区有失败遗留改动，实施结果不确定：项目已暂停。请人工核对/处理改动后重新开启（不会自动清理改动）。');
        return;
      }
    }
    releaseOccupancy(cur);
    // 修复后执行成功上报 → 更新该条目的模型待处理状态（REQ-20260906-024 M11/M12）
    if (phaseLabel === 'reported' && cur) {
      try { store.resolveModelPending(dataDir, { itemId: cur.itemId }); } catch {}
    }
    if (S.enabled && !S.paused) S.waiting = { kind: 'empty' };
  }

  // ---- 为已选定条目启动 run（自动选单与一键派发 REQ-20260906-019 共用）----
  // hub 全局并发 → 项目实施锁 → 复核 accepted → 账本预留 → prompt 落盘 → 后台执行。
  // 失败返回 { ok:false, error, waiting? }：tick 把 waiting 呈现为等待态，dispatchItem 直接报 error。
  function startRunForItem(item) {
    // REQ-20260906-024：启动前解析最终模型与推理强度；失败不创建运行、不认领（M14），
    // 暂停本项目自动派发并登记持久待处理（M01/M11），待用户刷新/显式选择后重新开启。
    const model = resolveModelForItem({
      dataDir, projectRoot, itemId: item.id,
      cliPath: cli.path || settings().cliPath || null,
      catalogRun: modelCatalogRun,
    });
    if (!model.ok) {
      store.addModelPending(dataDir, {
        itemId: item.id, runId: null, kind: model.kind || 'config-unresolved',
        summary: `${model.error}`,
        logRef: null, configFingerprint: null,
      });
      pauseExecutor(`模型配置待处理：${model.error}`);
      S.waiting = { kind: 'model-config', reason: model.error };
      return {
        ok: false,
        waiting: { kind: 'model-config', reason: model.error },
        error: model.error,
      };
    }
    const got = hub.tryAcquire({ projectRoot, itemId: item.id, title: item.title });
    if (!got.ok) {
      const holder = got.heldBy.title || got.heldBy.projectRoot;
      return {
        ok: false,
        waiting: { kind: 'global-busy', holder },
        error: `全局执行中（首期全服务并发 1）：等待 ${holder}`,
      };
    }
    const lock = store.acquireProjectLock(dataDir, item.id, { itemId: item.id });
    if (!lock.ok) {
      hub.release(projectRoot);
      const h = lock.holder;
      const who = h?.kind === 'batch' ? `Zcode 批次 ${h.batchId || ''}` : h?.kind === 'codex' ? 'Codex 自动派发' : h?.kind === 'manual' ? '手工认领' : '实施任务';
      const holder = `${who}（owner ${h?.owner || '未知'}）`;
      return {
        ok: false,
        waiting: { kind: 'project-busy', holder },
        error: `项目被占用：${holder}`,
      };
    }
    // 预留：先持久化意图（reserved），再启动；启动前复核条目仍 planned（已计划）
    const detail = itemDetail(item.id);
    if (!detail || detail.status !== 'planned') {
      hub.release(projectRoot);
      store.releaseProjectLock(dataDir, item.id);
      return {
        ok: false,
        error: `条目已不在已计划状态（当前 ${detail ? detail.status : '不存在'}），不能派发`,
      };
    }
    const run = store.newRun(dataDir, {
      itemId: item.id,
      projectRoot,
      prompt: buildWorkerPrompt({ itemId: item.id, title: item.title, projectRoot, atbCliPath, runId: 'pending' }),
      config: settings(),
      modelSnapshot: model.snapshot, // REQ-20260906-024：配置快照随运行创建固定
    });
    run.prompt = buildWorkerPrompt({ itemId: item.id, title: item.title, projectRoot, atbCliPath, runId: run.runId });
    fs.writeFileSync(path.join(store.runDir(dataDir, run.runId), 'prompt.md'), run.prompt);
    store.updateRun(dataDir, run.runId, { prompt: run.prompt });
    store.stampProjectLock(dataDir, { runId: run.runId, itemId: item.id });
    S.current = {
      runId: run.runId, itemId: item.id, title: item.title,
      phase: run.phase, startedAt: null, lastEventAt: null, threadId: null,
      cancelRequested: false, attemptCount: 0, retriesUsed: 0,
      model: model.snapshot.modelId, reasoningEffort: model.snapshot.reasoningEffort, modelSource: model.snapshot.source,
    };
    spawnAttempt(run, { kind: 'new', prompt: run.prompt });
    return { ok: true, runId: run.runId };
  }

  // ---- 周期调度 ----
  async function tick() {
    if (S.stopping || S.paused || S.current) return;
    if (!S.enabled) {
      S.waiting = { kind: 'disabled' };
      return;
    }
    const cfg = settings();
    if (!cli.path && (!cfg.cliPath || !fs.existsSync(cfg.cliPath))) {
      // 未配置 CLI：执行器待配置（预检负责给原因）；显式注入路径直接交给 spawn 错误路径处理
      S.waiting = { kind: 'no-cli' };
      return;
    }
    const { item, blocker } = selectCandidate();
    if (!item) {
      S.waiting = blocker || { kind: 'empty' };
      return;
    }
    const r = startRunForItem(item);
    if (!r.ok) {
      if (r.waiting) S.waiting = r.waiting; // 复核不过（无 waiting）等下一轮重新选单
      return;
    }
  }

  function loop() {
    if (S.stopping) return;
    tick().catch(() => {});
    S.timer = setTimeout(loop, tickMs);
    if (S.timer.unref) S.timer.unref();
  }

  // ---- 对外控制 ----
  const api = {
    start() { if (!S.timer) loop(); },
    stop() {
      if (S.timer) { clearTimeout(S.timer); S.timer = null; }
      if (S.retryTimer) { clearTimeout(S.retryTimer); S.retryTimer = null; }
    },
    enable() {
      const cfg = settings();
      if (!cfg.cliPath) {
        const detected = detectCli();
        if (detected) saveSettings({ cliPath: detected });
      }
      S.enabled = true;
      S.paused = false; // 重新开启 = 人工确认环境已处理
      S.pauseReason = null;
      saveSettings({ enabled: true });
      tick().catch(() => {});
      api.start();
    },
    disable() {
      S.enabled = false;
      saveSettings({ enabled: false }); // 只停止领取新项；当前项默认继续
    },
    stopCurrent() {
      if (!S.current) return { ok: false, error: '当前无执行' };
      const run = store.getRun(dataDir, S.current.runId);
      store.updateRun(dataDir, run.runId, { cancelRequested: true, phase: 'cleanup_pending' });
      S.current.cancelRequested = true;
      S.current.phase = 'cleanup_pending';
      // BUG-20260906-007：网络退避等待期无活进程（旧 handle 已结束，cancel 无效），停止请求
      // 直接撤销待执行重试并落账 interrupted，结束运行、释放占用，不复活旧执行
      if (S.retryTimer) {
        clearTimeout(S.retryTimer);
        S.retryTimer = null;
        store.updateRun(dataDir, run.runId, {
          attempts: run.attempts, phase: 'interrupted', endedAt: new Date().toISOString(),
          result: { reason: 'user-stop' },
        });
        finishRun('interrupted');
        return { ok: true };
      }
      S.current.handle?.cancel();
      return { ok: true };
    },
    resumeItem(runId) {
      // 恢复本项（BUG-20260906-008）：必须绑定用户当前查看的 runId，
      // 按该 run 已记录的确切会话 ID 接续原 run，绝不代选其他可恢复记录
      if (S.current) return { ok: false, error: '当前有执行进行中' };
      if (typeof runId !== 'string' || !runId.trim()) return { ok: false, error: '缺少 runId：恢复必须绑定当前查看的执行' };
      let target = null;
      try { target = store.getRun(dataDir, runId); } catch { /* 不存在走下方统一报错 */ }
      if (!target) return { ok: false, error: `执行不存在：${runId}` };
      if (target.phase !== 'blocked' && target.phase !== 'interrupted') {
        return { ok: false, error: `不可恢复：仅已收尾的 blocked/interrupted 执行可续跑（当前 ${target.phase}）` };
      }
      if (!target.threadId) return { ok: false, error: '不可恢复：该执行未记录会话 ID' };
      // REQ-20260906-024 M15：旧运行缺模型快照时不猜测历史模型——要求先建立一次明确配置（以新配置重试）
      if (!target.modelSnapshot) {
        return {
          ok: false,
          error: '该执行创建于模型配置记录之前（历史记录未记录模型）：恢复前请用「以新配置重试本项」建立一次明确的模型选择',
        };
      }
      // REQ-20260906-024 M05：提供方身份变化时暂停核对，不悄然改用另一个提供方
      if (target.modelSnapshot.provider) {
        const curProvider = resolveInheritedModel(readModelConfigLayers({ projectRoot })).provider;
        if (curProvider && curProvider !== target.modelSnapshot.provider) {
          return {
            ok: false,
            error: `提供方身份已变化（快照 ${target.modelSnapshot.provider} → 当前 ${curProvider}）：原配置恢复需先人工核对，或以新配置重试本项`,
          };
        }
      }
      const got = hub.tryAcquire({ projectRoot, itemId: target.itemId, title: 'resume' });
      if (!got.ok) return { ok: false, error: '全局执行中' };
      const lock = store.acquireProjectLock(dataDir, target.itemId, { itemId: target.itemId });
      if (!lock.ok) { hub.release(projectRoot); return { ok: false, error: '项目被占用' }; }
      store.stampProjectLock(dataDir, { runId: target.runId, itemId: target.itemId });
      const run = store.getRun(dataDir, target.runId);
      S.current = {
        runId: run.runId, itemId: run.itemId, title: itemDetail(run.itemId)?.title || run.itemId,
        phase: 'starting', startedAt: run.startedAt, lastEventAt: null, threadId: run.threadId,
        cancelRequested: false, attemptCount: run.attempts.length, retriesUsed: run.retriesUsed || 0,
        model: run.modelSnapshot ? run.modelSnapshot.modelId : null,
        reasoningEffort: run.modelSnapshot ? run.modelSnapshot.reasoningEffort : null,
        modelSource: run.modelSnapshot ? run.modelSnapshot.source : null,
      };
      const prompt = buildResumePrompt({ itemId: run.itemId, atbCliPath, runId: run.runId, missing: '人工触发的恢复本项' });
      spawnAttempt(run, { kind: 'resume', resumeThreadId: run.threadId, prompt });
      return { ok: true, runId: run.runId };
    },
    // 以新配置重试本项（REQ-20260906-024 M12）：用户主动切换模型时，在原执行已停止且核对通过后，
    // 为本项建立关联的新尝试（新 run + 新快照 + supersedes 链）；原运行与记录保留不覆写。
    // 保存/验证本身不触发本方法；重复点击由 hub/实施互斥/S.current 保证至多产生一次执行（M13）。
    retryItemWithConfig({ runId, modelSelection } = {}) {
      if (S.stopping) return { ok: false, error: '服务正在关停，暂不能重试' };
      if (S.current) return { ok: false, error: `当前有执行进行中（${S.current.itemId}），完成后可再试` };
      if (typeof runId !== 'string' || !runId.trim()) return { ok: false, error: '缺少 runId：重试必须绑定当前查看的执行' };
      let target = null;
      try { target = store.getRun(dataDir, runId); } catch {}
      if (!target) return { ok: false, error: `执行不存在：${runId}` };
      // 已收尾的终态执行（含已上报：用户主动切换模型场景）才可换配置重试
      if (!store.isTerminalPhase(target.phase)) {
        return { ok: false, error: `不可重试：仅已收尾的执行可换配置重试（当前 ${target.phase}）` };
      }
      // 过期请求核对（M13）：该条目已有更新的执行记录时，旧 runId 的重试请求不得启动新任务
      const latest = store.lastRunForItem(dataDir, target.itemId);
      if (latest && latest.runId !== target.runId) {
        return { ok: false, error: `该条目已有更新的执行记录（${latest.runId}），请刷新后对新记录操作` };
      }
      const detail = itemDetail(target.itemId);
      if (!detail) return { ok: false, error: `条目不存在：${target.itemId}` };
      if (detail.status !== 'planned' && detail.status !== 'in-progress') {
        return { ok: false, error: `条目当前状态不支持重试（${detail.status}）` };
      }
      // 先保存本项模型策略（影响本项后续新执行），再按新选择解析快照；解析失败不创建运行
      let savedSel = null;
      try {
        savedSel = store.saveItemModelSelection(dataDir, target.itemId, modelSelection ?? { mode: 'inherit' });
      } catch (e) {
        return { ok: false, error: e.message };
      }
      const model = resolveModelForItem({
        dataDir, projectRoot, itemId: target.itemId,
        cliPath: cli.path || settings().cliPath || null, noCache: true,
        catalogRun: modelCatalogRun,
      });
      if (!model.ok) {
        store.addModelPending(dataDir, {
          itemId: target.itemId, runId: null, kind: 'config-unresolved', summary: model.error,
        });
        return { ok: false, error: model.error };
      }
      const got = hub.tryAcquire({ projectRoot, itemId: target.itemId, title: 'retry' });
      if (!got.ok) return { ok: false, error: '全局执行中' };
      const lock = store.acquireProjectLock(dataDir, target.itemId, { itemId: target.itemId });
      if (!lock.ok) { hub.release(projectRoot); return { ok: false, error: '项目被占用' }; }
      const prompt = buildWorkerPrompt({
        itemId: target.itemId, title: detail.title, projectRoot, atbCliPath, runId: 'pending',
      });
      const run = store.newRun(dataDir, {
        itemId: target.itemId, projectRoot, prompt, config: settings(),
        modelSnapshot: model.snapshot,
      });
      run.prompt = buildWorkerPrompt({ itemId: target.itemId, title: detail.title, projectRoot, atbCliPath, runId: run.runId });
      fs.writeFileSync(path.join(store.runDir(dataDir, run.runId), 'prompt.md'), run.prompt);
      store.updateRun(dataDir, run.runId, {
        prompt: run.prompt,
        supersedes: { runId: target.runId, reason: 'model-change', at: new Date().toISOString() },
      });
      store.stampProjectLock(dataDir, { runId: run.runId, itemId: target.itemId });
      S.current = {
        runId: run.runId, itemId: target.itemId, title: detail.title,
        phase: run.phase, startedAt: null, lastEventAt: null, threadId: null,
        cancelRequested: false, attemptCount: 0, retriesUsed: 0,
        model: model.snapshot.modelId, reasoningEffort: model.snapshot.reasoningEffort, modelSource: model.snapshot.source,
      };
      spawnAttempt(store.getRun(dataDir, run.runId), { kind: 'new', prompt: run.prompt });
      return { ok: true, runId: run.runId, modelSelection: savedSel, supersedes: target.runId };
    },
    // REQ-20260907-007：一键派发 dispatchItem 已删除，派单只能通过批量开发；
    // 自动派发 tick 仍经 startRunForItem 创建执行，互斥/账本/结算路径不变
    tick,
    status,
    // 崩溃恢复：核对账本/锁/进程/上报，不自动重派
    recover() {
      const cfg = settings();
      const notes = [];
      for (const run of store.listOpenRuns(dataDir)) {
        const it = itemDetail(run.itemId);
        const last = run.attempts[run.attempts.length - 1];
        if (run.phase === 'reserved') {
          if (it && it.status === 'planned' && !it.owner) {
            store.updateRun(dataDir, run.runId, { phase: 'failed', endedAt: new Date().toISOString(), result: { reason: 'recovered-reserved', detail: '服务在预留后未启动即退出，核对无副作用' }, recoveryNote: '恢复核销：预留后未启动' });
          } else {
            store.updateRun(dataDir, run.runId, { phase: 'needs_attention', recoveryNote: '恢复：预留条目状态异常，请人工核对' });
          }
          continue;
        }
        // starting/running：核进程身份（PID + 启动时刻）
        let alive = false;
        if (last?.pid) {
          try { process.kill(last.pid, 0); alive = true; } catch { alive = false; }
          if (alive && last.pidStartTime) {
            const nowStart = readPidStartTime(last.pid);
            if (nowStart !== last.pidStartTime) alive = false; // PID 已被复用
          }
        }
        if (alive) {
          store.updateRun(dataDir, run.runId, { phase: 'needs_attention', recoveryNote: '恢复：受管进程仍在执行，等待结束后请人工核对（不重复派发）' });
          watchRecovered(run);
          notes.push(`${run.runId} 进程仍在执行，等待核对`);
          continue;
        }
        const v = verifyCompletion({ run, dataDir });
        if (v.reported) {
          store.updateRun(dataDir, run.runId, { phase: 'reported', endedAt: new Date().toISOString(), result: { reason: 'reported', reportRef: 'test-report.md' }, recoveryNote: '恢复核对：上报证据齐备' });
        } else if (run.threadId) {
          store.updateRun(dataDir, run.runId, { phase: 'blocked', endedAt: new Date().toISOString(), result: { reason: 'recovered-interrupted' }, recoveryNote: '恢复：会话中断（进程已退出），可用「恢复本项」按确切会话 ID 续跑' });
        } else {
          store.updateRun(dataDir, run.runId, { phase: 'failed', endedAt: new Date().toISOString(), result: { reason: 'recovered-no-thread', detail: v.reason }, recoveryNote: '恢复：进程退出且无会话 ID' });
        }
      }
      // 残留实施互斥核对：仅当属本执行器（kind codex）且持有者进程已死（PID 校验）才回收；
      // 其他归属（批次/手工）不动，走人工核对——与 impl.lock「无超时自动接管」约定一致
      const lock = store.readProjectLock(dataDir);
      if (lock && lock.kind === 'codex' && lock.pid) {
        let alive = false;
        try { process.kill(lock.pid, 0); alive = true; } catch {}
        if (!alive) {
          store.releaseProjectLock(dataDir, lock.owner, lock.runId);
          notes.push(`回收了本执行器的残留实施锁（owner ${lock.owner}，进程已退出）`);
        } else {
          notes.push(`实施互斥仍被本执行器进程持有（owner ${lock.owner}）：等待其结束后请重新核对`);
        }
      }
      // 重启续跑策略：默认等待人工
      if (cfg.enabled) {
        if (cfg.resumeAfterRestart && !store.listOpenRuns(dataDir).some((r) => r.phase === 'needs_attention')) {
          S.enabled = true;
          notes.push('已恢复记录，核对通过，自动继续取单');
        } else {
          S.enabled = false;
          store.saveSettings(dataDir, { codex: { enabled: false } });
          notes.push('已恢复记录，等待继续（「重启后自动继续」未开启或存在待核对执行）');
        }
      }
      S.recoveryNote = notes.join('；') || '已恢复记录，等待继续';
      if (S.enabled) {
        tick().catch(() => {});
        api.start();
      }
      return { notes };
    },
    // 优雅关停：停止取单 → 取消受管执行 → 等收尾 → 落盘
    async shutdown({ cancelCurrent = true, waitMs = cancelGraceMs + settleMs + 3000 } = {}) {
      S.stopping = true;
      api.stop();
      if (S.retryTimer) { clearTimeout(S.retryTimer); S.retryTimer = null; }
      if (cancelCurrent && S.current?.handle) {
        store.updateRun(dataDir, S.current.runId, { cancelRequested: true });
        S.current.handle.cancel();
      }
      const deadline = Date.now() + waitMs;
      while (S.current && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 100));
      }
      for (const w of S.watchers) clearTimeout(w);
      S.watchers.clear();
      releaseOccupancy();
    },
  };

  // 恢复观察：进程仍在执行的旧 run，等它结束后核对并结算（不重新派发）
  function watchRecovered(run) {
    const timer = setTimeout(async () => {
      S.watchers.delete(timer);
      const last = run.attempts[run.attempts.length - 1];
      let alive = false;
      try { process.kill(last.pid, 0); alive = true; } catch {}
      if (alive) { watchRecovered(run); return; }
      const fresh = store.getRun(dataDir, run.runId);
      if (fresh.phase !== 'needs_attention') return;
      const v = verifyCompletion({ run: fresh, dataDir });
      store.updateRun(dataDir, run.runId, {
        phase: v.reported ? 'reported' : 'blocked',
        endedAt: new Date().toISOString(),
        result: { reason: v.reported ? 'reported' : 'recovered-then-incomplete', detail: v.reported ? null : v.reason },
        recoveryNote: '恢复观察：进程结束后核对',
      });
    }, 2000);
    if (timer.unref) timer.unref();
    S.watchers.add(timer);
  }

  return api;
}

// ---------- CLI 探测（显式配置 > PATH > 桌面包内置） ----------

export function detectCli({ explicit } = {}) {
  if (explicit) return explicit;
  try {
    const out = execFileSync('which', ['codex'], { encoding: 'utf8', timeout: 2000 }).trim();
    if (out && fs.existsSync(out)) return out;
  } catch {}
  const bundled = '/Applications/ChatGPT.app/Contents/Resources/codex';
  if (fs.existsSync(bundled)) return bundled;
  return null;
}

export function probeCliVersion(cliPath) {
  try {
    const r = spawnSync(cliPath, ['--version'], { encoding: 'utf8', timeout: 5000 });
    return r.status === 0 ? (r.stdout || '').trim() : null;
  } catch {
    return null;
  }
}
