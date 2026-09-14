#!/usr/bin/env node
// REQ-20260906-003 Status Board 派发 API 集成测试 —— 以假 codex CLI 包装器驱动服务端到端链路
// 用法：node scripts/tests/dispatch-api.test.mjs
// 覆盖：设置校验/静态预检/开关门槛/执行上报/增量日志/停止当前/优雅关停（C01/C02/C08/C10/C19 局部）
// BUG-20260914-013：stop() 改确定性收尾（SIGTERM→有界等待→SIGKILL），并以 ATB_SHUTDOWN_FORCE_MS
//       对齐服务端强退时限，消除「5s 内未退 → 静默泄漏」窗口。

import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as core from '../lib/core.mjs';
import { stopChild } from './lib/test-process.mjs';

const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SERVER = path.join(PLUGIN_ROOT, 'scripts', 'server.mjs');
const FIXTURE = path.join(PLUGIN_ROOT, 'scripts', 'tests', 'fixtures', 'fake-codex.mjs');

const cases = [];
const t = (name, fn) => cases.push([name, fn]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(cond, timeoutMs = 15_000, label = '') {
  const start = Date.now();
  for (;;) {
    if (await cond()) return true;
    if (Date.now() - start > timeoutMs) throw new Error(`等待超时：${label}`);
    await sleep(50);
  }
}

// 无状态假 CLI 包装器：mode.txt 控制行为，node 拉起 fixtures/fake-codex.mjs
function makeFakeCli() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'atb-fakecli-'));
  const wrapper = path.join(dir, 'fake-codex');
  fs.writeFileSync(wrapper, `#!/bin/sh\nMODE=$(cat "$(dirname "$0")/mode.txt" 2>/dev/null || echo ok)\nexport FAKE_MODE="$MODE"\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(FIXTURE)} "$@"\n`, { mode: 0o755 });
  const setMode = (m) => fs.writeFileSync(path.join(dir, 'mode.txt'), m);
  setMode('ok');
  return { dir, wrapper, setMode };
}

function tempProject({ git = true } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atb-api-'));
  core.initData(root);
  // REQ-20260911-009 起 initData 自动 git init + 切 dev；非 git 场景（T2b）手工移除 .git
  // 模拟存量非 git 项目
  if (!git) fs.rmSync(path.join(root, '.git'), { recursive: true, force: true });
  return root;
}

function startServer(projectRoot) {
  const port = 20000 + Math.floor(Math.random() * 20000);
  const registry = path.join(os.tmpdir(), `atb-registry-${process.pid}-${Math.random().toString(16).slice(2)}.json`);
  const child = spawn(process.execPath, [SERVER], {
    cwd: projectRoot,
    env: {
      ...process.env,
      ATB_PORT: String(port),
      ATB_HOST: '127.0.0.1',
      ATB_REGISTRY: registry,
      ATB_TICK_MS: '60',
      ATB_CANCEL_GRACE_MS: '200',
      ATB_SETTLE_MS: '150',
      // BUG-20260914-013：服务端优雅关停强退兜底收紧到 8s（缺省 20s），stop() 等待上限与之对齐
      ATB_SHUTDOWN_FORCE_MS: '8000',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let logs = '';
  child.stdout.on('data', (c) => { logs += c; });
  child.stderr.on('data', (c) => { logs += c; });
  const base = `http://127.0.0.1:${port}`;
  const req = (method, p, body) => new Promise((resolve, reject) => {
    const r = http.request(`${base}${p}`, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : {},
    }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        let j = null;
        try { j = JSON.parse(data); } catch {}
        resolve({ status: res.statusCode, json: j, text: data });
      });
    });
    r.on('error', reject);
    if (body) r.write(JSON.stringify(body));
    r.end();
  });
  const P = `?project=${encodeURIComponent(projectRoot)}`;
  return {
    port, child, req, P, base,
    get logs() { return logs; },
    async stop() {
      // BUG-20260914-013：确定性收尾——SIGTERM 有界等待（覆盖 8s 强退兜底），超时 SIGKILL，仍存活抛错
      await stopChild(child, { timeoutMs: 12_000 });
    },
  };
}

const healthy = (srv) => waitFor(async () => {
  try { return (await srv.req('GET', '/api/health')).status === 200; } catch { return false; }
}, 8000, '服务就绪');

async function acceptItem(srv, id) {
  // REQ-20260908-010：调度选单口径 planned（已计划），接受后置计划
  const r = await srv.req('POST', `/api/item/${id}/status${srv.P}`, { to: 'accepted' });
  assert.equal(r.status, 200, `接受条目失败：${r.text}`);
  const p = await srv.req('POST', `/api/item/${id}/status${srv.P}`, { to: 'planned' });
  assert.equal(p.status, 200, `置计划失败：${p.text}`);
}

t('T1 设置接口：默认值、非法值 400、假 CLI 路径可保存', async () => {
  const root = tempProject();
  const srv = startServer(root);
  await healthy(srv);
  const g = await srv.req('GET', `/api/dispatch/settings${srv.P}`);
  assert.equal(g.status, 200);
  assert.equal(g.json.settings.codex.enabled, false);
  assert.equal(g.json.settings.codex.timeoutMin, 60);

  const bad = await srv.req('POST', `/api/dispatch/settings${srv.P}`, { codex: { timeoutMin: 999 } });
  assert.equal(bad.status, 400);

  const fake = makeFakeCli();
  const ok = await srv.req('POST', `/api/dispatch/settings${srv.P}`, { codex: { cliPath: fake.wrapper, allowNonGit: true } });
  assert.equal(ok.status, 200);
  assert.equal(ok.json.settings.codex.cliPath, fake.wrapper);
  await srv.stop();
});

t('T2 静态预检与开关门槛：预检不过不开；模型验证单独触发且标注（C01）', async () => {
  const root = tempProject();
  const srv = startServer(root);
  await healthy(srv);
  // 显式配置不存在的 CLI 路径：静态检查失败 → 开启被拒（模拟 CLI 缺失/不可执行）
  await srv.req('POST', `/api/dispatch/settings${srv.P}`, { codex: { cliPath: '/nonexistent/codex-cli' } });
  const pre0 = await srv.req('GET', `/api/dispatch/preflight${srv.P}`);
  assert.equal(pre0.status, 200);
  assert.equal(pre0.json.allOk, false, 'CLI 不可用时静态检查不得显示可运行');
  assert.equal(pre0.json.checks.find((c) => c.id === 'cli').ok, false);

  const on0 = await srv.req('POST', `/api/dispatch/codex/toggle${srv.P}`, { enabled: true });
  assert.equal(on0.status, 400, '预检未过不得开启');

  const fake = makeFakeCli();
  await srv.req('POST', `/api/dispatch/settings${srv.P}`, { codex: { cliPath: fake.wrapper, allowNonGit: true } });
  const pre = await srv.req('GET', `/api/dispatch/preflight${srv.P}`);
  assert.equal(pre.json.allOk, true, pre.text);
  assert.match(pre.json.checks.find((c) => c.id === 'cli-version').detail, /fake-codex/);
  assert.match(pre.json.note, /不向模型发送请求/);

  // 模型可达性验证（假 CLI 的一次最小执行）
  const mp = await srv.req('POST', `/api/dispatch/preflight/model${srv.P}`, {});
  assert.equal(mp.status, 200);
  assert.equal(mp.json.ok, true, mp.text);
  assert.ok(mp.json.finalMessage);
  await srv.stop();
});

t('T2b 非 Git 项目默认阻止，显式兼容后通过；版本存在不代表参数可用', async () => {
  const root = tempProject({ git: false }); // 存量非 git 项目（REQ-20260911-009 起 initData 自动建仓）
  const fake = makeFakeCli();
  const srv = startServer(root);
  try {
    await healthy(srv);
    await srv.req('POST', `/api/dispatch/settings${srv.P}`, { codex: { cliPath: fake.wrapper, allowNonGit: false } });
    const pre = await srv.req('GET', `/api/dispatch/preflight${srv.P}`);
    assert.equal(pre.json.allOk, false, '无 Git 且未授权兼容时不得显示可运行');
    assert.equal(pre.json.checks.find((c) => c.id === 'project-policy')?.ok, false);
    const on = await srv.req('POST', `/api/dispatch/codex/toggle${srv.P}`, { enabled: true });
    assert.equal(on.status, 400, '项目约束未通过必须阻止开启');
    const model = await srv.req('POST', `/api/dispatch/preflight/model${srv.P}`, {});
    assert.equal(model.status, 400, '静态预检失败不得继续模型验证');
    await srv.req('POST', `/api/dispatch/settings${srv.P}`, { codex: { allowNonGit: true } });
    assert.equal((await srv.req('GET', `/api/dispatch/preflight${srv.P}`)).json.allOk, true);

    fs.writeFileSync(fake.wrapper, '#!/bin/sh\nif [ "$1" = "--version" ]; then echo codex-unsupported; exit 0; fi\necho unsupported >&2\nexit 2\n');
    const unsupported = await srv.req('GET', `/api/dispatch/preflight${srv.P}`);
    assert.equal(unsupported.json.checks.find((c) => c.id === 'cli-version').ok, true);
    assert.equal(unsupported.json.allOk, false, '只支持 --version 的 CLI 不得冒充参数已验证');
    assert.equal(unsupported.json.checks.find((c) => c.id === 'exec-args')?.ok, false);
    fs.chmodSync(fake.wrapper, 0o644);
    const noExec = await srv.req('GET', `/api/dispatch/preflight${srv.P}`);
    assert.equal(noExec.json.checks.find((c) => c.id === 'cli').ok, false, '文件存在不等于可执行');
  } finally {
    await srv.stop();
  }
});

t('T3 端到端：开启后自动选单执行上报；运行账本与条目最近执行可查（C02/C08/C22 假 CLI 形态）', async () => {
  const root = tempProject();
  const dataDir = core.requireDataDir(root);
  const fake = makeFakeCli();
  fake.setMode('worker-ok');
  const srv = startServer(root);
  await healthy(srv);
  await srv.req('POST', `/api/dispatch/settings${srv.P}`, { codex: { cliPath: fake.wrapper, allowNonGit: true } });

  const created = await srv.req('POST', `/api/new${srv.P}`, { type: 'req', title: '自动实施目标' });
  const id = created.json.id;
  await acceptItem(srv, id);

  const on = await srv.req('POST', `/api/dispatch/codex/toggle${srv.P}`, { enabled: true });
  assert.equal(on.status, 200, on.text);
  assert.equal(on.json.status.enabled, true);

  let runId = null;
  await waitFor(async () => {
    const runs = await srv.req('GET', `/api/dispatch/runs${srv.P}`);
    if (runs.json.total >= 1) { runId = runs.json.items[0].runId; return true; }
    return false;
  }, 15_000, '创建运行');
  await waitFor(async () => {
    const runs = await srv.req('GET', `/api/dispatch/runs${srv.P}`);
    return runs.json.items[0].phase === 'reported';
  }, 15_000, '上报完成');

  // 条目详情附最近 Codex 执行（账本信息不改变业务状态列）
  const item = await srv.req('GET', `/api/item/${id}${srv.P}`);
  assert.equal(item.json.status, 'in-progress');
  assert.equal(item.json.lastCodexRun.runId, runId);
  assert.equal(item.json.lastCodexRun.phase, 'reported');

  // 运行详情 + 增量日志（events 分页、final 有内容）
  const detail = await srv.req('GET', `/api/dispatch/runs/${runId}${srv.P}`);
  assert.ok(detail.json.threadId, '应记录会话 ID');
  assert.ok(detail.json.finalSize > 0);
  const first = await srv.req('GET', `/api/dispatch/runs/${runId}/log${srv.P}&name=events&offset=0&limit=32`);
  assert.equal(first.json.data.length, 32);
  assert.equal(first.json.eof, false);
  const fm = await srv.req('GET', `/api/dispatch/runs/${runId}/log${srv.P}&name=final&offset=0&limit=4096`);
  assert.match(fm.json.data, /认领|上报|完成/);

  // 关闭开关后不再领取
  fake.setMode('worker-ok');
  await srv.req('POST', `/api/dispatch/codex/toggle${srv.P}`, { enabled: false });
  await sleep(300);
  const runs2 = await srv.req('GET', `/api/dispatch/runs${srv.P}`);
  assert.equal(runs2.json.total, 1, '关闭后不得新增执行');
  await srv.stop();
});

t('T4 停止当前执行：停止中可见、interrupted 落账（C10）', async () => {
  const root = tempProject();
  const fake = makeFakeCli();
  fake.setMode('worker-hang');
  const srv = startServer(root);
  await healthy(srv);
  await srv.req('POST', `/api/dispatch/settings${srv.P}`, { codex: { cliPath: fake.wrapper, allowNonGit: true } });
  const created = await srv.req('POST', `/api/new${srv.P}`, { type: 'req', title: '挂死任务' });
  await acceptItem(srv, created.json.id);
  await srv.req('POST', `/api/dispatch/codex/toggle${srv.P}`, { enabled: true });

  await waitFor(async () => {
    const st = await srv.req('GET', `/api/dispatch/status${srv.P}`);
    return st.json.current !== null && st.json.current.phase === 'running';
  }, 15_000, '进入执行');

  const stop = await srv.req('POST', `/api/dispatch/codex/stop${srv.P}`, {});
  assert.equal(stop.json.ok, true);
  // 「停止中」以账本持久化的 cancelRequested 呈现（UI 侧在 phase 变 interrupted 前可见）
  await waitFor(async () => {
    const runs = await srv.req('GET', `/api/dispatch/runs${srv.P}`);
    return runs.json.items[0] && runs.json.items[0].cancelRequested === true;
  }, 5000, '停止请求持久化');

  await waitFor(async () => {
    const runs = await srv.req('GET', `/api/dispatch/runs${srv.P}`);
    return runs.json.items[0].phase === 'interrupted';
  }, 15_000, '确认中断');
  const runsFinal = await srv.req('GET', `/api/dispatch/runs${srv.P}`);
  assert.equal(runsFinal.json.items[0].cancelRequested, true, '中断后停止请求仍留痕');
  await srv.req('POST', `/api/dispatch/codex/toggle${srv.P}`, { enabled: false });
  await srv.stop();
});

t('T4b 恢复本项：必须绑定 runId，不得代选其他可恢复执行（BUG-20260906-008 / C-A5）', async () => {
  const root = tempProject();
  const dataDir = core.requireDataDir(root);
  const dispatchStore = await import('../lib/dispatch-store.mjs');
  const fake = makeFakeCli();
  fake.setMode('no-report');
  const srv = startServer(root);
  try {
    await healthy(srv);
    await srv.req('POST', `/api/dispatch/settings${srv.P}`, { codex: { cliPath: fake.wrapper, allowNonGit: true } });
    // 两条可恢复的 interrupted 记录（较早/较新，不同会话 ID）
    const mkInterrupted = async (title, threadId) => {
      const created = await srv.req('POST', `/api/new${srv.P}`, { type: 'req', title });
      await acceptItem(srv, created.json.id);
      // REQ-20260906-024：新运行均带模型快照（无快照旧记录按 M15 走「以新配置重试」补建）
      const run = dispatchStore.newRun(dataDir, { itemId: created.json.id, projectRoot: root, prompt: '', modelSnapshot: { mode: 'explicit', modelId: 'fake-astra', reasoningEffort: 'low', source: 'project-explicit', configFingerprint: 'x', resolvedAt: new Date().toISOString() } });
      dispatchStore.updateRun(dataDir, run.runId, { phase: 'interrupted', threadId, startedAt: new Date().toISOString() });
      return run.runId;
    };
    const older = await mkInterrupted('较早中断', 'th-api-older');
    await sleep(20);
    await mkInterrupted('较新中断', 'th-api-newer');

    // 空请求体（旧行为）：必须 400 拒绝，而不是代选一条恢复
    const empty = await srv.req('POST', `/api/dispatch/codex/resume-item${srv.P}`, {});
    assert.equal(empty.status, 400, `空请求体必须 400：${empty.text}`);
    // 不存在的 runId：调度层 ok:false 拒绝（与 stopCurrent 错误语义一致）
    const missing = await srv.req('POST', `/api/dispatch/codex/resume-item${srv.P}`, { runId: 'run-not-exist' });
    assert.equal(missing.status, 200, missing.text);
    assert.equal(missing.json.ok, false, missing.text);
    assert.match(missing.json.error, /执行不存在/);
    // 指定较早 run：恢复的必须就是它
    const res = await srv.req('POST', `/api/dispatch/codex/resume-item${srv.P}`, { runId: older });
    assert.equal(res.status, 200, res.text);
    assert.equal(res.json.ok, true, res.text);
    assert.equal(res.json.runId, older, `必须恢复用户指定的执行：${res.text}`);
    const st = await srv.req('GET', `/api/dispatch/status${srv.P}`);
    assert.equal(st.json.current?.runId, older, '执行器当前项必须是指定的 run');
  } finally {
    await srv.stop();
  }
});

t('T5 优雅关停：SIGTERM 取消受管执行并落账后退出（服务生命周期）', async () => {
  const root = tempProject();
  const fake = makeFakeCli();
  fake.setMode('worker-hang');
  const srv = startServer(root);
  await healthy(srv);
  await srv.req('POST', `/api/dispatch/settings${srv.P}`, { codex: { cliPath: fake.wrapper, allowNonGit: true } });
  const created = await srv.req('POST', `/api/new${srv.P}`, { type: 'req', title: '关停时在途' });
  await acceptItem(srv, created.json.id);
  await srv.req('POST', `/api/dispatch/codex/toggle${srv.P}`, { enabled: true });
  await waitFor(async () => {
    const st = await srv.req('GET', `/api/dispatch/status${srv.P}`);
    return st.json.current !== null && st.json.current.phase === 'running';
  }, 15_000, '进入执行');

  srv.child.kill('SIGTERM');
  const exited = await new Promise((r) => { srv.child.on('exit', () => r(true)); setTimeout(() => r(false), 15000); });
  assert.ok(exited, '服务应在关停流程后退出（不悬挂）');
  // 进程退出后核对账本：在途执行已被取消并落账 interrupted
  const dataDir = core.requireDataDir(root);
  const dispatchStore = await import('../lib/dispatch-store.mjs');
  const runs = dispatchStore.listRuns(dataDir, { limit: 10 });
  assert.equal(runs.items[0].phase, 'interrupted', '关停必须取消受管执行并落账，不留幽灵运行');
});

t('T6 Electron 壳关停协调：ensureService 自建服务经 stopService 优雅退出（复用外部服务不受影响）', async () => {
  const service = await import('../../electron/service.mjs');
  const root = tempProject();
  const fake = makeFakeCli();
  fake.setMode('worker-hang');
  const registry = path.join(os.tmpdir(), `atb-registry-es-${Math.random().toString(16).slice(2)}.json`);
  const port = 21000 + Math.floor(Math.random() * 20000);
  const handle = await service.ensureService({
    port,
    serverPath: SERVER,
    projectRoot: root,
    maxWaitMs: 10_000,
    env: { ...process.env, ATB_REGISTRY: registry, ATB_TICK_MS: '60', ATB_CANCEL_GRACE_MS: '200', ATB_SETTLE_MS: '150' },
  });
  assert.ok(handle.child, '自建服务应有子进程');
  const P = `?project=${encodeURIComponent(root)}`;
  const req = (method, p, body) => new Promise((resolve, reject) => {
    const r = http.request(`http://127.0.0.1:${port}${p}`, { method, headers: body ? { 'Content-Type': 'application/json' } : {} }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => resolve({ status: res.statusCode, json: JSON.parse(data || '{}') }));
    });
    r.on('error', reject);
    if (body) r.write(JSON.stringify(body));
    r.end();
  });
  await waitFor(async () => (await req('GET', '/api/health')).status === 200, 8000, '服务就绪');
  await req('POST', `/api/dispatch/settings${P}`, { codex: { cliPath: fake.wrapper, allowNonGit: true } });
  const created = await req('POST', `/api/new${P}`, { type: 'req', title: '壳关停在途' });
  await req('POST', `/api/item/${created.json.id}/status${P}`, { to: 'accepted' });
  await req('POST', `/api/item/${created.json.id}/status${P}`, { to: 'planned' }); // REQ-20260908-010：调度选单口径
  await req('POST', `/api/dispatch/codex/toggle${P}`, { enabled: true });
  await waitFor(async () => {
    const st = await req('GET', `/api/dispatch/status${P}`);
    return st.json.current !== null && st.json.current.phase === 'running';
  }, 15_000, '进入执行');

  const stopped = await service.stopService(handle);
  assert.equal(stopped, true);
  assert.notEqual(handle.child.exitCode, null, '子进程应已退出（SIGTERM 优雅路径）');
  const dispatchStore = await import('../lib/dispatch-store.mjs');
  const runs = dispatchStore.listRuns(core.requireDataDir(root), { limit: 10 });
  assert.equal(runs.items[0].phase, 'interrupted', '壳退出前应协调取消受管执行并落账');
  // 复用外部服务（child=null）不误杀
  assert.equal(await service.stopService({ child: null }), false);
});

t('T7 一键派发端点已移除（REQ-20260907-007）：POST /api/dispatch/codex/item 一律 404，不产生执行记录', async () => {
  const root = tempProject();
  const srv = startServer(root);
  await healthy(srv);
  const created = await srv.req('POST', `/api/new${srv.P}`, { type: 'req', title: '只能批量开发' });
  const id = created.json.id;
  await acceptItem(srv, id);

  // 合法 accepted 条目、非法单号、不存在单号：统一落入「未知接口」404
  for (const body of [{ id }, { id: '../../etc/passwd' }, { id: 'REQ-19990101-999' }]) {
    const r = await srv.req('POST', `/api/dispatch/codex/item${srv.P}`, body);
    assert.equal(r.status, 404, `端点已移除应 404：${r.text}`);
    assert.match(r.json.error, /未知接口/, '应是未注册路径的 404 语义');
  }
  const runs = await srv.req('GET', `/api/dispatch/runs${srv.P}`);
  assert.equal(runs.json.total, 0, '不得创建任何执行记录');
  const item = await srv.req('GET', `/api/item/${id}${srv.P}`);
  assert.equal(item.json.status, 'planned', '条目状态不得被改写');
  await srv.stop();
});

let failed = 0;
for (const [name, fn] of cases) {
  try {
    await fn();
    console.log(`✓ ${name}`);
  } catch (e) {
    failed++;
    console.error(`✗ ${name}\n    ${String(e.message).split('\n')[0]}`);
  }
}
console.log(failed ? `\n${failed} 个用例未通过` : '\n全部通过');
process.exit(failed ? 1 : 0);
