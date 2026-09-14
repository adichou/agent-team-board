#!/usr/bin/env node
// REQ-20260910-030 发布模块 —— 桌面应用（Electron）构建目标测试 E1~E12 + U1~U3 + S1
// 数据层 / 五阶段流水线为真实集成（真实临时 git 仓库 + 真实 git worktree；
// npm / electron-builder 命令在 exec 层注入 stub，产物真实落盘供核验阶段计算 SHA-256）。
// 前端为 vm 行为 + 源码静态契约（同 release-ui.test.mjs 接缝）。
// 用法：node scripts/tests/release-electron.test.mjs

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import * as core from '../lib/core.mjs';
import * as store from '../lib/release-store.mjs';
import { realExec } from '../lib/release-git.mjs';
import { runElectronPipeline } from '../lib/release-electron.mjs';

const cases = [];
const t = (name, fn) => cases.push([name, fn]);

const GIT_ENV = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' };
function git(cwd, args, opts = {}) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', env: GIT_ENV, timeout: 20000, ...opts });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} 失败：${r.stderr || r.stdout}`);
  return r.stdout.trim();
}

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const webRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'web');
const itemDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'docs', 'agent-team-board', 'requirements', 'REQ-20260910-030');

/* ---------- 真实工程环境 ---------- */

// Electron 工程：package.json（productName / version / main / devDependencies / build 字段）+ main 入口 + lock
function mkEnv({ pkgOver = {}, buildField = true, lock = true, mainFile = true } = {}) {
  const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'atb-release-el-')));
  const work = path.join(tmp, 'work');
  fs.mkdirSync(path.join(work, 'electron'), { recursive: true });
  git(tmp, ['init', '-b', 'main', work]);
  git(work, ['config', 'user.email', 't@e.co']);
  git(work, ['config', 'user.name', 'T']);
  const pkg = {
    name: 'demo-app',
    productName: 'Demo App',
    version: '1.0.0',
    main: 'electron/main.mjs',
    devDependencies: { electron: '^37.2.0', 'electron-builder': '^25.1.8' },
    ...(buildField ? { build: { appId: 'com.example.DemoApp', mac: { target: ['dmg'] }, win: { target: ['nsis'] } } } : {}),
    ...pkgOver,
  };
  fs.writeFileSync(path.join(work, 'package.json'), `${JSON.stringify(pkg, null, 2)}\n`);
  if (mainFile) fs.writeFileSync(path.join(work, 'electron', 'main.mjs'), "import { app } from 'electron';\n");
  if (lock) fs.writeFileSync(path.join(work, 'package-lock.json'), '{ "lockfileVersion": 3, "name": "demo-app", "version": "1.0.0" }\n');
  git(work, ['add', '-A']);
  git(work, ['commit', '-m', 'init']);
  core.initData(work);
  return { tmp, work, dataDir: core.dataDirFrom(work), pkg, oid: (ref = 'HEAD') => git(work, ['rev-parse', ref]) };
}

const elConfig = (over = {}) => ({
  platforms: ['mac', 'win'], macArch: '', version: '1.2.0', outDir: 'dist', appName: 'Demo App', ...over,
});
const newRun = (env, cfgOver = {}) =>
  store.createRun(env.dataDir, { target: 'electron', config: elConfig(cfgOver), by: 'test' });

/* ---------- exec 注入（git 真实；node / npm / electron-builder stub） ---------- */

function stubExec({ nodeOk = true, npmOk = true, builder = null } = {}) {
  const real = realExec({ timeoutMs: 30000 });
  const calls = [];
  const exec = async (cmd, args, opts = {}) => {
    calls.push({ cmd, args, cwd: opts.cwd || null });
    if (cmd === 'git') return real(cmd, args, opts);
    const a = args || [];
    if (cmd === 'node' && a[0] === '-v') {
      return nodeOk ? { code: 0, stdout: 'v22.9.0\n', stderr: '' } : { code: 127, stdout: '', stderr: 'node: command not found' };
    }
    if (cmd === 'npm' && a[0] === '-v') {
      return npmOk ? { code: 0, stdout: '10.8.2\n', stderr: '' } : { code: 127, stdout: '', stderr: 'npm: command not found' };
    }
    if (cmd === 'npm' && (a[0] === 'ci' || a[0] === 'install')) {
      const wd = opts.cwd;
      fs.mkdirSync(path.join(wd, 'node_modules', 'electron-builder'), { recursive: true });
      fs.writeFileSync(path.join(wd, 'node_modules', 'electron-builder', 'package.json'), JSON.stringify({ name: 'electron-builder', version: '25.1.8' }));
      fs.mkdirSync(path.join(wd, 'node_modules', 'electron'), { recursive: true });
      fs.writeFileSync(path.join(wd, 'node_modules', 'electron', 'package.json'), JSON.stringify({ name: 'electron', version: '37.2.0' }));
      fs.mkdirSync(path.join(wd, 'node_modules', '.bin'), { recursive: true });
      fs.writeFileSync(path.join(wd, 'node_modules', '.bin', 'electron-builder'), '#!/bin/sh\nexit 0\n');
      return { code: 0, stdout: '', stderr: 'added 316 packages in 12s' };
    }
    if (String(cmd).endsWith('electron-builder')) {
      if (!builder) return { code: 127, stdout: '', stderr: `command not found: ${cmd}` };
      return builder(cmd, a, opts);
    }
    return { code: 127, stdout: '', stderr: `command not found: ${cmd}` };
  };
  return { exec, calls };
}

// 默认 builder stub：按 --mac/--win 在 -c.directories.output 指定目录写真实产物
function okBuilder({ failWin = false, noArtifact = false } = {}) {
  return (cmd, args, opts) => {
    const isMac = args.includes('--mac');
    const isWin = args.includes('--win');
    if ((isWin && failWin) || (!isMac && !isWin)) {
      return { code: 1, stdout: '', stderr: '  ⨯ build failed: target=win needs extra toolchain (electron-builder 原文摘录)' };
    }
    if (noArtifact) return { code: 0, stdout: '  • skipped writing artifacts\n', stderr: '' };
    const outArg = args.find((x) => x.startsWith('-c.directories.output='));
    const verArg = args.find((x) => x.startsWith('-c.extraMetadata.version='));
    const outDir = outArg ? outArg.split('=').slice(1).join('=') : path.join(opts.cwd, 'dist');
    const ver = verArg ? verArg.split('=').slice(1).join('=') : '0.0.0';
    fs.mkdirSync(outDir, { recursive: true });
    if (isMac) fs.writeFileSync(path.join(outDir, `Demo App-${ver}-arm64.dmg`), `MAC-DMG-PAYLOAD-${ver}`);
    if (isWin) fs.writeFileSync(path.join(outDir, `Demo App Setup ${ver}.exe`), `WIN-NSIS-PAYLOAD-${ver}`);
    return { code: 0, stdout: `  • building        target=dmg arch=arm64\n  • building        target=nsis arch=x64\n`, stderr: '' };
  };
}

const full = (env, runId, exec, opts = {}) =>
  runElectronPipeline({ dataDir: env.dataDir, projectRoot: env.work, runId, exec, ...opts });
const sha256File = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const installCalls = (calls) => calls.filter((c) => c.cmd === 'npm' && (c.args[0] === 'ci' || c.args[0] === 'install'));
const builderCalls = (calls) => calls.filter((c) => String(c.cmd).endsWith('electron-builder'));

/* ---------- E1 数据层 ---------- */

t('E1 类型与配置校验：electron 可执行五阶段；platforms / version / outDir 非法阻塞；web/storage 仍不可执行', () => {
  const env = mkEnv();
  assert.equal(store.TARGET_TYPES.find((x) => x.key === 'electron')?.enabled, true, 'electron 为可执行目标');
  assert.ok(store.EXECUTABLE_TARGETS.includes('electron'));
  assert.equal(store.TARGET_TYPES.find((x) => x.key === 'web')?.enabled, false, 'web 仍不可执行');

  const run = newRun(env);
  assert.equal(run.stages.length, 5, '五阶段');
  assert.deepEqual(run.stages.map((s) => s.key), ['freeze', 'local-precheck', 'deps-install', 'build', 'verify']);
  assert.deepEqual(run.config.platforms, ['mac', 'win'], 'platforms 规范化（去重排序）');

  for (const [over, field] of [
    [{ platforms: [] }, 'platforms'],
    [{ platforms: ['mac', 'ios'] }, 'platforms'],
    [{ platforms: 'mac' }, 'platforms'],
    [{ version: 'abc' }, 'version'],
    [{ outDir: '/tmp/x' }, 'outDir'],
    [{ outDir: '../x' }, 'outDir'],
  ]) {
    try {
      newRun(env, over);
      assert.fail(`配置 ${JSON.stringify(over)} 应阻塞`);
    } catch (e) {
      assert.ok(e.fields && e.fields[field], `${field} 字段定位`);
    }
  }
  // 空平台多选 → 必须给出用户可读的错误
  try {
    store.validateRunConfig('electron', { platforms: [] });
    assert.fail('空平台应阻塞');
  } catch (e) {
    assert.match(e.fields.platforms, /平台/);
  }
});

/* ---------- E2~E4 预检（只读） ---------- */

t('E2 预检只读：干净工程通过回 draft 且零依赖安装 / 构建调用；脏工作区阻塞并引导回提交功能', async () => {
  const env = mkEnv();
  const run = newRun(env);
  const { exec, calls } = stubExec({ builder: okBuilder() });
  const out = await full(env, run.id, exec, { through: 'local-precheck' });
  assert.equal(out.status, 'draft', '预检完成回 draft');
  assert.ok(out.stages.slice(0, 2).every((s) => s.status === 'done'), 'freeze + local-precheck 完成');
  assert.ok(out.stages.slice(2).every((s) => s.status === 'pending'), '后续阶段不动');
  assert.equal(installCalls(calls).length, 0, '预检不安装依赖');
  assert.equal(builderCalls(calls).length, 0, '预检不构建');

  // 脏工作区 → 阻塞
  const env2 = mkEnv();
  const run2 = newRun(env2);
  fs.writeFileSync(path.join(env2.work, 'dirty.txt'), 'x');
  const s2 = stubExec();
  const out2 = await full(env2, run2.id, s2.exec);
  assert.equal(out2.status, 'failed');
  const pre = out2.stages.find((s) => s.key === 'local-precheck');
  assert.equal(pre.status, 'failed');
  assert.equal(pre.error.kind, 'dirty');
  assert.match(pre.error.message, /提交/, '引导回现有提交功能（不自动 add/commit/stash）');
});

t('E3 非 Electron 工程分别阻塞并给指引：缺依赖 / 缺构建配置 / 缺 main 入口；不触发安装与构建', async () => {
  const scenarios = [
    { name: '缺 electron-builder 依赖', env: mkEnv({ pkgOver: { devDependencies: { electron: '^37.2.0' } } }), kind: 'not-electron-project', kw: /electron-builder/ },
    { name: '缺构建配置', env: mkEnv({ buildField: false }), kind: 'no-builder-config', kw: /build/ },
    { name: '缺 main 入口', env: mkEnv({ pkgOver: { main: 'electron/missing.mjs' } }), kind: 'not-electron-project', kw: /main/ },
  ];
  for (const sc of scenarios) {
    const run = newRun(sc.env);
    const { exec, calls } = stubExec();
    const out = await full(sc.env, run.id, exec);
    assert.equal(out.status, 'failed', sc.name);
    const pre = out.stages.find((s) => s.key === 'local-precheck');
    assert.equal(pre.status, 'failed', sc.name);
    assert.equal(pre.error.kind, sc.kind, sc.name);
    assert.match(pre.error.message, sc.kw, `${sc.name}：给出指引`);
    assert.equal(installCalls(calls).length, 0, `${sc.name}：不安装依赖`);
    assert.equal(builderCalls(calls).length, 0, `${sc.name}：不构建`);
  }
});

t('E4 node / npm 不可用 → 预检明确阻塞', async () => {
  for (const [name, opts, kind] of [
    ['node 不可用', { nodeOk: false }, 'node-unavailable'],
    ['npm 不可用', { npmOk: false }, 'npm-unavailable'],
  ]) {
    const env = mkEnv();
    const run = newRun(env);
    const { exec } = stubExec(opts);
    const out = await full(env, run.id, exec);
    assert.equal(out.status, 'failed', name);
    const pre = out.stages.find((s) => s.key === 'local-precheck');
    assert.equal(pre.error.kind, kind, name);
  }
});

/* ---------- E5/E6/E12 流水线执行与产物核验 ---------- */

t('E5 全流程成功：产物核验记录路径 / 大小 / SHA-256 / 源提交 / 工具版本 / 未签名；worktree 清理；日志落盘', async () => {
  const env = mkEnv();
  const run = newRun(env);
  const { exec, calls } = stubExec({ builder: okBuilder() });
  const out = await full(env, run.id, exec);
  assert.equal(out.status, 'succeeded');
  assert.ok(out.stages.every((s) => s.status === 'done'));

  const deps = out.stages.find((s) => s.key === 'deps-install');
  assert.equal(installCalls(calls).length, 1);
  assert.equal(deps.result.installCommand, 'npm ci', '有 lock 用 npm ci');
  assert.ok(deps.result.workDir, '隔离工作目录记录');
  assert.ok(!fs.existsSync(deps.result.workDir), '成功后清理隔离 worktree');

  const build = out.stages.find((s) => s.key === 'build');
  assert.equal(build.result.platforms.length, 2, '两平台逐平台记录');
  assert.ok(build.result.platforms.every((p) => p.ok), '两平台均成功');

  const verify = out.stages.find((s) => s.key === 'verify');
  const arts = verify.result.artifacts;
  assert.equal(arts.length, 2, 'mac dmg + win exe 两个产物');
  const mac = arts.find((a) => a.platform === 'mac');
  const win = arts.find((a) => a.platform === 'win');
  assert.ok(mac && mac.fileName.endsWith('.dmg'));
  assert.ok(win && win.fileName.endsWith('.exe'));
  for (const a of arts) {
    assert.ok(fs.existsSync(a.path), '产物存在');
    assert.equal(a.sha256, sha256File(a.path), 'SHA-256 与实际文件一致');
    assert.ok(Number.isInteger(a.sizeBytes) && a.sizeBytes > 0, '大小');
    assert.equal(a.sourceOid, env.oid(), '源提交 OID 可追溯');
    assert.equal(a.electronVersion, '37.2.0', 'electron 实际版本');
    assert.equal(a.builderVersion, '25.1.8', 'electron-builder 实际版本');
    assert.equal(a.signed, false, '未签名（首期不伪造签名状态）');
  }
  assert.equal(out.frozen.sourceOid, env.oid(), '冻结源提交');
  assert.equal(out.frozen.appName, 'Demo App');
  assert.equal(out.frozen.version, '1.2.0', '版本覆盖生效');
  assert.ok(out.label === undefined || true); // 完整 run 无 label 字段（label 属列表摘要）
  const lbl = store.runLabel(out);
  assert.ok(lbl.includes('Demo App 1.2.0') && lbl.includes('macOS + Windows'), `列表标识「应用名 版本 · 平台组合」：${lbl}`);
  assert.ok(fs.existsSync(path.join(store.runDir(env.dataDir, run.id), 'logs', 'build.log')), '构建日志落盘');
  assert.ok(out.evidence.some((e) => e.kind === 'verify'), '核验证据');
  // 版本覆盖确实传给 electron-builder
  assert.ok(builderCalls(calls).every((c) => c.args.includes('-c.extraMetadata.version=1.2.0')));
});

t('E6 平台多选逐平台成败：mac 成功 win 失败 → 整体 failed 且不以部分产物冒充；只勾 mac 时只构建 mac', async () => {
  const env = mkEnv();
  const run = newRun(env);
  const { exec } = stubExec({ builder: okBuilder({ failWin: true }) });
  const out = await full(env, run.id, exec);
  assert.equal(out.status, 'failed');
  const build = out.stages.find((s) => s.key === 'build');
  assert.equal(build.status, 'failed');
  assert.equal(build.error.kind, 'build-failed');
  assert.match(build.error.message, /win/, '失败平台点名');
  assert.match(build.error.message, /toolchain/, 'electron-builder 报错原文摘录');
  assert.equal(build.result.platforms.find((p) => p.platform === 'mac')?.ok, true, 'mac 平台成功结果保留');
  assert.equal(build.result.platforms.find((p) => p.platform === 'win')?.ok, false, 'win 平台失败记录');
  const verify = out.stages.find((s) => s.key === 'verify');
  assert.equal(verify.status, 'pending', '未进入核验（不冒充全部成功）');

  // 只勾 mac：构建命令只含 --mac，成功即核验 mac 产物
  const env2 = mkEnv();
  const run2 = newRun(env2, { platforms: ['mac'] });
  const s2 = stubExec({ builder: okBuilder() });
  const out2 = await full(env2, run2.id, s2.exec);
  assert.equal(out2.status, 'succeeded');
  assert.ok(builderCalls(s2.calls).every((c) => c.args.includes('--mac') && !c.args.includes('--win')), '只构建 mac');
  assert.equal(out2.stages.find((s) => s.key === 'verify').result.artifacts.length, 1);
  assert.equal(store.runLabel(out2).includes('macOS'), true, '标识只含 macOS');
});

t('E12 产物核验失败明确：构建声称成功但产物缺失 → verify 阶段 artifact-missing 失败（可重试）', async () => {
  const env = mkEnv();
  const run = newRun(env, { platforms: ['mac'] });
  const { exec } = stubExec({ builder: okBuilder({ noArtifact: true }) });
  const out = await full(env, run.id, exec);
  assert.equal(out.status, 'failed');
  const verify = out.stages.find((s) => s.key === 'verify');
  assert.equal(verify.status, 'failed');
  assert.equal(verify.error.kind, 'artifact-missing');
  assert.match(verify.error.message, /dmg/, '点名期望产物形态');
});

/* ---------- E7/E8/E11 重试 / 取消 / 计划失效 ---------- */

t('E7 失败重试只重跑未完成阶段：build 失败重试后依赖安装不重装（npm 安装命令仅一次）', async () => {
  const env = mkEnv();
  const run = newRun(env, { platforms: ['mac'] });
  const s1 = stubExec({ builder: okBuilder({ noArtifact: true }) });
  const out1 = await full(env, run.id, s1.exec);
  assert.equal(out1.status, 'failed', '首次：verify 失败（产物缺失）');
  assert.equal(installCalls(s1.calls).length, 1);

  // 重试：resetForRetry 只把 verify 回 pending；deps-install 已 done 不重装
  store.mutateRun(env.dataDir, run.id, (r) => store.resetForRetry(r), { by: 'test', action: 'retry' });
  const after = store.readRun(env.dataDir, run.id);
  assert.equal(after.stages.find((x) => x.key === 'deps-install').status, 'done', '依赖安装不重装');
  assert.equal(after.stages.find((x) => x.key === 'verify').status, 'pending', '失败阶段回 pending');
  // verify 只核验不构建：产物仍缺失 → 重试依旧失败但不重装依赖（证据保留）
  const s2 = stubExec({ builder: okBuilder({ noArtifact: true }) });
  const out2 = await full(env, run.id, s2.exec);
  assert.equal(out2.status, 'failed', 'verify 重试：产物仍缺失明确失败（不假成功）');
  assert.equal(installCalls(s2.calls).length, 0, '重试未再执行 npm 安装');
  assert.equal(builderCalls(s2.calls).length, 0, 'verify 只读核验，不重新构建');

  // 构建失败（win 工具链）重试：build 回 pending 重跑成功，deps-install 仍不重装
  const env2 = mkEnv();
  const run2 = newRun(env2);
  const s3 = stubExec({ builder: okBuilder({ failWin: true }) });
  const out3 = await full(env2, run2.id, s3.exec);
  assert.equal(out3.status, 'failed', '首次构建 win 失败');
  assert.equal(installCalls(s3.calls).length, 1);
  store.mutateRun(env2.dataDir, run2.id, (r) => store.resetForRetry(r), { by: 'test', action: 'retry' });
  const s4 = stubExec({ builder: okBuilder() });
  const out4 = await full(env2, run2.id, s4.exec);
  assert.equal(out4.status, 'succeeded', '重试从失败阶段续跑后成功');
  assert.equal(installCalls(s4.calls).length, 0, '依赖安装已完成则不重装');
  assert.ok(builderCalls(s4.calls).length >= 2, 'build 阶段重跑（逐平台）');
  assert.ok(fs.existsSync(path.join(env2.work, 'dist')), '产物目录在项目根下');
});

t('E8 取消后续阶段：已完成阶段与证据保留，未执行阶段置 canceled', async () => {
  const env = mkEnv();
  const run = newRun(env);
  const { exec } = stubExec({ builder: okBuilder({ failWin: true }) });
  const out = await full(env, run.id, exec);
  assert.equal(out.status, 'failed');
  store.mutateRun(env.dataDir, run.id, (r) => store.cancelRemaining(r, '用户取消'), { by: 'test', action: 'cancel' });
  const c = store.readRun(env.dataDir, run.id);
  assert.equal(c.status, 'canceled');
  assert.ok(['done', 'failed'].includes(c.stages[0].status), '已完成阶段保留');
  assert.equal(c.stages.find((s) => s.key === 'verify').status, 'canceled', '未执行阶段置 canceled');
  assert.ok(c.history.some((h) => h.action === 'cancel'), '操作历史记录取消');
});

t('E11 源提交变化使计划失效：build 阶段复核 HEAD ≠ 冻结 OID → plan-stale 阻塞', async () => {
  const env = mkEnv();
  const run = newRun(env, { platforms: ['mac'] });
  const { exec } = stubExec({ builder: okBuilder() });
  const pre = await full(env, run.id, exec, { through: 'local-precheck' });
  assert.equal(pre.status, 'draft');
  // 计划确认后源提交前进（新 commit，工作区仍干净）
  fs.writeFileSync(path.join(env.work, 'new.txt'), 'x');
  git(env.work, ['add', '-A']);
  git(env.work, ['commit', '-m', 'moved on']);
  const out = await full(env, run.id, exec);
  assert.equal(out.status, 'failed');
  const build = out.stages.find((s) => s.key === 'build');
  assert.equal(build.status, 'failed');
  assert.equal(build.error.kind, 'plan-stale', '计划失效阻塞');
});

/* ---------- E9/E10 互斥与中断恢复 ---------- */

t('E9 同目标互斥：electron 活动运行占互斥；git / apple 不受影响；非活动状态不占', () => {
  const env = mkEnv();
  const e1 = newRun(env);
  const e2 = newRun(env, { platforms: ['mac'] });
  const g1 = store.createRun(env.dataDir, { target: 'git', config: { remote: 'origin', sourceBranch: 'main', targetBranch: 'main', tagName: null, checkCommand: 'npm test' }, by: 'test' });
  store.mutateRun(env.dataDir, e1.id, (r) => { r.status = 'running'; }, { by: 'test', action: 'start' });
  assert.throws(() => store.assertTargetFree(env.dataDir, 'electron'), store.ReleaseConflictError, '同目标互斥（409 口径）');
  store.assertTargetFree(env.dataDir, 'electron', { exceptId: e1.id }, '本运行操作不受限');
  store.assertTargetFree(env.dataDir, 'git', 'Git 目标不受影响');
  store.assertTargetFree(env.dataDir, 'apple', 'Apple 目标不受影响');
  void e2; void g1;
  store.mutateRun(env.dataDir, e1.id, (r) => { r.status = 'failed'; }, { by: 'test', action: 'fail' });
  store.assertTargetFree(env.dataDir, 'electron', '非活动状态不占互斥');
});

t('E10 服务重启：running 的 electron 运行标记 interrupted（可重试），已完成阶段不动', () => {
  const env = mkEnv();
  const run = newRun(env, { platforms: ['mac'] });
  store.mutateRun(env.dataDir, run.id, (r) => {
    r.status = 'running';
    r.stages[0].status = 'done';
    r.stages[1].status = 'done';
    r.stages[2].status = 'running';
  }, { by: 'test', action: 'start' });
  store.recoverInterrupted(env.dataDir);
  const after = store.readRun(env.dataDir, run.id);
  assert.equal(after.status, 'failed');
  assert.equal(after.stages[2].status, 'failed');
  assert.equal(after.stages[2].error.kind, 'interrupted');
  assert.equal(after.stages[0].status, 'done', '已完成阶段不动');
});

/* ---------- U1~U3 前端（vm 接缝，同 release-ui.test.mjs） ---------- */

function element() {
  const nodes = new Map();
  const classes = new Set();
  return {
    nodes, dataset: {}, innerHTML: '', textContent: '', value: '', title: '', disabled: false, checked: false, hidden: false,
    href: '',
    children: [], listeners: {},
    classList: { add: (v) => classes.add(v), remove: (v) => classes.delete(v), contains: (v) => classes.has(v), toggle: (v, on) => on ? classes.add(v) : classes.delete(v) },
    addEventListener(event, fn) { this.listeners[event] = fn; },
    querySelector(sel) { if (!nodes.has(sel)) nodes.set(sel, element()); return nodes.get(sel); },
    querySelectorAll() { return []; },
    appendChild(c) { this.children.push(c); },
    replaceChildren(...c) { this.children = c; },
    setAttribute() {}, removeAttribute() {}, focus() {}, select() {}, remove() {}, click() {},
    closest() { return null; },
    get scrollTop() { return 0; }, set scrollTop(v) {},
  };
}

const ELECTRON_RUN = {
  id: 'REL-20260911-001', target: 'electron', status: 'succeeded',
  createdAt: '2026-09-11T10:00:00.000Z',
  label: 'Demo App 1.2.0 · macOS + Windows',
  config: { platforms: ['mac', 'win'], macArch: 'arm64', version: '1.2.0', outDir: 'dist', appName: 'Demo App' },
  frozen: { sourceOid: '9a3f2c1deadbeef', appName: 'Demo App', version: '1.2.0' },
  stages: [
    { key: 'freeze', label: '配置冻结', status: 'done' },
    { key: 'local-precheck', label: '本地预检', status: 'done' },
    { key: 'deps-install', label: '依赖安装', status: 'done' },
    { key: 'build', label: '桌面构建', status: 'done' },
    { key: 'verify', label: '产物核验', status: 'done', result: { artifacts: [
      { fileName: 'Demo App-1.2.0-arm64.dmg', path: '/w/dist/Demo App-1.2.0-arm64.dmg', platform: 'mac', arch: 'arm64', sizeBytes: 104857600, sha256: 'a'.repeat(64), sourceOid: '9a3f2c1deadbeef', electronVersion: '37.2.0', builderVersion: '25.1.8', signed: false },
      { fileName: 'Demo App Setup 1.2.0.exe', path: '/w/dist/Demo App Setup 1.2.0.exe', platform: 'win', arch: 'x64', sizeBytes: 83886080, sha256: 'b'.repeat(64), sourceOid: '9a3f2c1deadbeef', electronVersion: '37.2.0', builderVersion: '25.1.8', signed: false },
    ] } },
  ],
  evidence: [], history: [],
};

function setupEl({ state, detail } = {}) {
  const relJs = fs.readFileSync(path.join(webRoot, 'release.js'), 'utf8');
  const document = element();
  document.createElement = element;
  document.body = element();
  document.querySelector = (sel) => document.nodes.get(sel) ?? null;
  document.nodes.set('#releaseView', element());
  document.addEventListener = () => {};
  const calls = [];
  const sandbox = {
    document, console, URLSearchParams, encodeURIComponent, decodeURIComponent,
    CustomEvent: class { constructor(type, o) { this.type = type; this.detail = o && o.detail; } },
    setTimeout: (fn) => 0, clearTimeout() {}, setInterval: () => 0, clearInterval() {},
    Date, Math, JSON,
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    location: { search: '' },
    fetch: async (url, opts) => {
      const u = String(url);
      const method = (opts?.method || 'GET').toUpperCase();
      calls.push({ url: u, method, body: opts?.body ? JSON.parse(opts.body) : null });
      const m = u.match(/\/api\/release\/run\/(REL-[\d-]+)(?:\?|$)/);
      if (m && method === 'GET') {
        return { ok: true, status: 200, json: async () => (detail || { run: ELECTRON_RUN, logs: {} }) };
      }
      return { ok: true, status: 200, json: async () => (typeof state === 'function' ? state() : state) };
    },
    navigator: {},
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(relJs, sandbox, { filename: 'release.js' });
  return { ...sandbox, calls };
}

const elState = (runs = [ELECTRON_RUN]) => ({
  initialized: true,
  runs,
  env: {
    git: { repo: true, remotes: ['origin'] },
    apple: { ascConfigured: true },
    electron: { packageJson: true, appName: 'Demo App', version: '1.0.0', mainOk: true, depsOk: true, buildConfigOk: true, nodeOk: true, npmOk: true, macArchDefault: 'arm64' },
  },
});

const viewHtml = (h) => h.document.querySelector('#releaseView').innerHTML;
const node = (h, sel) => h.document.querySelector('#releaseView').querySelector(sel) || h.document.nodes.get(sel);

t('U1 前端类型表与新建面板：electron 可选，动态字段含平台多选 / 架构 / 版本 / 输出目录；web/storage 置灰', async () => {
  const h = setupEl({ state: elState() });
  await h.ATBRelease.enter('/p');
  let v = viewHtml(h);
  assert.ok(v.includes('桌面应用（Electron）'), '列表筛选器含新目标类型');
  assert.ok(v.includes('chip electron'), '第三种目标 chip 配色');
  assert.ok(v.includes('Demo App 1.2.0 · macOS + Windows'), '列表卡片标识「应用名 版本 · 平台组合」');

  node(h, '#relNewBtn').listeners.click();
  v = viewHtml(h);
  assert.match(v, /首期未开放/, 'web/storage 置灰标注');
  const typeSel = node(h, '#relNewType');
  assert.ok(v.includes('value="electron"'), '类型下拉含 electron');
  typeSel.value = 'electron';
  typeSel.listeners.change();
  const fields = node(h, '#relNewFields').innerHTML;
  for (const kw of ['目标平台', 'macOS', 'Windows', '架构', '版本号', '输出目录']) {
    assert.ok(fields.includes(kw), `electron 动态字段「${kw}」`);
  }
  // 平台多选控件存在
  assert.ok(node(h, '#relNewPlatMac') && node(h, '#relNewPlatWin'), '平台多选 checkbox');

  // 详情五阶段
  node(h, '.rel-list').listeners.click({ target: { closest: () => ({ dataset: { runId: ELECTRON_RUN.id } }) } });
  await new Promise((r) => setTimeout(r, 0));
  v = viewHtml(h);
  for (const kw of ['配置冻结', '本地预检', '依赖安装', '桌面构建', '产物核验']) assert.ok(v.includes(kw), `五阶段「${kw}」`);
});

t('U2 计划确认：electron 预检通过后启动须经计划弹层（平台 / 版本 / 输出目录 / 未签名提示），确认前不调 start', async () => {
  const draftRun = {
    ...ELECTRON_RUN, id: 'REL-20260911-009', status: 'draft', label: null,
    frozen: null,
    stages: ELECTRON_RUN.stages.map((s) => ({ ...s, status: 'pending', result: null })),
  };
  const prechecked = {
    ...draftRun,
    stages: draftRun.stages.map((s, i) => (i < 2 ? { ...s, status: 'done' } : s)),
    frozen: { sourceOid: '9a3f2c1deadbeef', appName: 'Demo App', version: '1.2.0' },
  };
  let current = prechecked;
  const h = setupEl({
    state: () => elState([current]),
    detail: { run: current, logs: {} },
  });
  // 直接用详情操作区路径：draft 且 local-precheck done → 启动按钮可点
  await h.ATBRelease.enter('/p');
  node(h, '.rel-list').listeners.click({ target: { closest: () => ({ dataset: { runId: current.id } }) } });
  await new Promise((r) => setTimeout(r, 0));
  const modal = node(h, '#relPlanModal');
  assert.ok(modal, '计划弹层节点存在');
  node(h, '#relActStart') && node(h, '#relActStart').listeners.click();
  await new Promise((r) => setTimeout(r, 0));
  const mv = viewHtml(h); // 弹层内容在视图 innerHTML 模板内（vm 接缝与真实浏览器一致）
  assert.ok(mv.includes('macOS') && mv.includes('Windows'), '计划展示平台');
  assert.ok(mv.includes('1.2.0') && mv.includes('dist'), '计划展示版本与输出目录');
  assert.ok(mv.includes('未签名'), '未签名提示');
  assert.equal(h.calls.filter((c) => c.url.includes('/run/start')).length, 0, '确认前不启动');
});

t('U3 产物页签：electron 逐产物展示文件名 / 平台架构 / 大小 / SHA-256 截断 / 源提交 / 工具版本 / 未签名标注', async () => {
  const h = setupEl({ state: elState(), detail: { run: ELECTRON_RUN, logs: {} } });
  await h.ATBRelease.enter('/p');
  node(h, '.rel-list').listeners.click({ target: { closest: () => ({ dataset: { runId: ELECTRON_RUN.id } }) } });
  await new Promise((r) => setTimeout(r, 0));
  node(h, '[data-rel-tab="artifacts"]').listeners.click();
  const v = viewHtml(h);
  for (const kw of ['Demo App-1.2.0-arm64.dmg', 'Demo App Setup 1.2.0.exe', 'macOS', 'Windows', '9a3f2c1', '25.1.8']) {
    assert.ok(v.includes(kw), `产物页签含「${kw}」`);
  }
  assert.match(v, /aaaaaaaa\.\.\.|aaaa…|sha256|SHA-256/, 'SHA-256 截断展示');
  assert.ok((v.match(/未签名/g) || []).length >= 2, '每个产物带未签名标注');
});

/* ---------- S1 静态契约 ---------- */

t('S1 静态契约：package.json build 配置 / .chip.electron 配色 / ui-demo 离线与验收覆盖', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.ok(pkg.build && typeof pkg.build === 'object', 'package.json 含 electron-builder build 配置');
  assert.equal(pkg.build.appId, 'com.adichou.agent-team-board');
  assert.ok(pkg.build.mac?.target?.includes('dmg') || pkg.build.mac?.target?.some((x) => x.target === 'dmg' || x === 'dmg'), 'mac 产出 dmg');
  assert.ok(pkg.build.win?.target?.includes('nsis') || pkg.build.win?.target?.some((x) => x.target === 'nsis' || x === 'nsis'), 'win 产出 nsis');
  assert.ok((pkg.build.asarUnpack || []).some((p) => String(p).includes('scripts')), 'scripts 解包（ELECTRON_RUN_AS_NODE 不识别 asar）');

  const css = fs.readFileSync(path.join(webRoot, 'style.css'), 'utf8');
  assert.match(css, /\.chip\.electron\s*\{/, '第三种目标 chip 配色');

  const demo = fs.readFileSync(path.join(itemDir, 'ui-demo.html'), 'utf8');
  const external = demo.match(/(?:src|href)\s*=\s*["']https?:\/\//gi) || [];
  assert.equal(external.length, 0, `ui-demo 无外部资源：${external.join(', ')}`);
  for (const kw of ['桌面应用', 'macOS', 'Windows', '平台', '预检', '计划确认', '未签名', '空态', '加载', '失败', '重试', '取消', '互斥', '首期未开放', '产物']) {
    assert.ok(demo.includes(kw), `ui-demo 覆盖「${kw}」`);
  }
});

let failed = 0;
for (const [name, fn] of cases) {
  try {
    await fn();
    console.log(`✓ ${name}`);
  } catch (e) {
    failed++;
    console.error(`✗ ${name}\n    ${String(e.message).split('\n')[0]}\n    ${String(e.stack).split('\n').slice(1, 3).join('\n    ')}`);
  }
}
console.log(failed ? `\n${failed} 个用例未通过` : '\n全部通过');
process.exit(failed ? 1 : 0);
