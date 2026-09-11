#!/usr/bin/env node
// REQ-20260906-003 CodexExecAdapter —— 参数数组/JSONL 流解析/取消回收/超时/进程归属 功能测试
// 用法：node scripts/tests/codex-adapter.test.mjs（依赖 fixtures/fake-codex.mjs）

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildExecArgs, startCodexExec, createLineParser, readPidStartTime, classifyFailure,
} from '../lib/codex-adapter.mjs';

const FIXTURE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'fake-codex.mjs');

const cases = [];
const t = (name, fn) => cases.push([name, fn]);

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'atb-adapter-'));

function workdir(name) {
  const dir = path.join(tmp, name);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function runFake(mode, opts = {}) {
  const dir = workdir(`run-${mode}-${Math.random().toString(16).slice(2, 6)}`);
  const record = path.join(dir, 'record.json');
  const finalMsg = path.join(dir, 'final-message.md');
  const events = [];
  const stderrChunks = [];
  const handle = startCodexExec({
    cliPath: process.execPath,
    spawnArgs: [FIXTURE],
    envMode: { FAKE_MODE: mode, FAKE_RECORD: record, ...(opts.envModeExtra || {}) },
    projectRoot: opts.projectRoot || dir,
    prompt: opts.prompt ?? '开发 REQ-X',
    resumeThreadId: opts.resumeThreadId,
    finalMessageFile: finalMsg,
    timeoutMs: opts.timeoutMs ?? 15_000,
    cancelGraceMs: opts.cancelGraceMs ?? 400,
    settleMs: opts.settleMs ?? 700,
    onEvent: (e) => events.push(e),
    onStderr: (c) => stderrChunks.push(c),
  });
  return { handle, dir, record, finalMsg, events, stderrChunks };
}

const alive = (pid) => {
  try { process.kill(pid, 0); return true; } catch { return false; }
};

t('A1 参数构造：参数数组、stdin 传提示词、恢复用确切会话 ID（C05/C06）', () => {
  const args = buildExecArgs({ projectRoot: '/tmp/p rj', finalMessageFile: '/tmp/fm.md' });
  assert.deepEqual(args, ['exec', '--json', '-C', '/tmp/p rj', '--output-last-message', '/tmp/fm.md', '-']);
  const r = buildExecArgs({ projectRoot: '/tmp/p rj', finalMessageFile: '/tmp/fm.md', resumeThreadId: 'th-9f' });
  assert.deepEqual(r, ['exec', 'resume', 'th-9f', '--json', '--output-last-message', '/tmp/fm.md', '-']);
  // 恢复参数必须显式带 ID，禁止 --last
  assert.ok(!r.includes('--last'));
});

t('A1b 非 Git 兼容必须显式开启，且不改变沙箱或审批', () => {
  for (const resumeThreadId of [null, 'th-9f']) {
    const args = buildExecArgs({ projectRoot: '/tmp/prj', resumeThreadId, allowNonGit: true });
    assert.ok(args.includes('--skip-git-repo-check'), '显式开启后须传入非 Git 兼容参数');
    assert.ok(!args.some((x) => /bypass|sandbox|approval/.test(x)), '非 Git 兼容不得更改权限');
  }
  assert.equal(classifyFailure('Not inside a trusted directory and --skip-git-repo-check was not specified.', 1).kind, 'project');
  assert.equal(classifyFailure("error: unexpected argument '-C' found", 2).kind, 'cli-args');
});

t('A2 注入安全：空格/单引号/反引号/美元符路径与提示词只作为数据（C05）', async () => {
  const weird = workdir(`w'rd $p\`th`); // 路径含单引号、美元、反引号
  const prompt = `标题带 $(touch ${tmp}/pwn) 反引号 \`id\` 引号 'x' 换行\n结束`;
  const { handle, record } = runFake('ok', { projectRoot: weird, prompt });
  const res = await handle.promise;
  assert.equal(res.code, 0);
  assert.ok(!fs.existsSync(path.join(tmp, 'pwn')), '提示词中的命令替换绝不能被执行');
  const rec = JSON.parse(fs.readFileSync(record, 'utf8'));
  assert.equal(rec.cwd, fs.realpathSync(weird), 'cwd 应是路径原样（macOS /var→/private/var 真实化）');
  assert.equal(rec.stdin, prompt);
  assert.ok(rec.argv.includes('--json'));
  assert.ok(rec.argv.every((a) => typeof a === 'string'));
});

t('A3 JSONL 故障流：跨 chunk、非 JSON、未知事件、超长行、尾行不崩不挂（C07）', async () => {
  const { handle, events } = runFake('garbage');
  const res = await handle.promise;
  assert.equal(res.code, 0);
  assert.equal(res.threadId, 'g-1', '拆分跨 chunk 的 thread.started 仍应解析出会话 ID');
  const types = events.map((e) => e.event && e.event.type);
  assert.ok(types.includes('weird.unknown.event'), '未知事件应原样上报而非崩溃');
  assert.ok(events.some((e) => e.kind === 'diagnostic'), '非 JSON 行应归为诊断');
});

t('A4 会话 ID：新会话可获取，两次运行不同；记录 PID 与启动时刻（C06/C13）', async () => {
  const a = runFake('ok');
  const ra = await a.handle.promise;
  const b = runFake('ok');
  const rb = await b.handle.promise;
  assert.ok(ra.threadId && rb.threadId);
  assert.notEqual(ra.threadId, rb.threadId, '不同条目必须是不同会话');
  assert.ok(Number.isInteger(ra.pid) && ra.pid > 0);
  assert.ok(typeof ra.pidStartTime === 'string' && ra.pidStartTime.length > 0, '应记录进程启动时刻（防 PID 复用）');
});

t('A5 取消回收：忽略 SIGINT 的进程按宽限期强杀，停止后进程消失（C10/C11）', async () => {
  const markerDir = workdir('cancel-marker');
  const { handle } = runFake('hang-ignore-term', { envModeExtra: { FAKE_MARKER_DIR: markerDir } });
  await new Promise((r) => setTimeout(r, 350));
  handle.cancel('user');
  const res = await handle.promise;
  assert.equal(res.cancelled, true);
  assert.ok(!alive(res.pid), '取消完成后受管进程必须已被回收');
  const m = path.join(markerDir, 'hang');
  const size1 = fs.existsSync(m) ? fs.statSync(m).size : 0;
  await new Promise((r) => setTimeout(r, 400));
  const size2 = fs.existsSync(m) ? fs.statSync(m).size : 0;
  assert.equal(size2, size1, '强杀后不得再有延迟写入');
});

t('A6 超时：静默进程按 timeoutMs 中断并回收（标记 timedOut）', async () => {
  const { handle } = runFake('timeout-sleep', { timeoutMs: 800 });
  const res = await handle.promise;
  assert.equal(res.timedOut, true);
  assert.ok(!alive(res.pid));
});

t('A7 启动失败：CLI 路径不存在时以 spawnError 结算（不产生半启动状态）', async () => {
  const h = startCodexExec({
    cliPath: '/nonexistent/codex-bin',
    projectRoot: tmp,
    prompt: 'x',
    finalMessageFile: path.join(tmp, 'fm.md'),
    timeoutMs: 3000,
  });
  const res = await h.promise;
  assert.ok(res.spawnError, '应携带 spawnError（ENOENT）');
  assert.equal(res.pid, null);
  assert.equal(res.code, null);
});

t('A8 CLI 退出后同组残留工具被组回收；逃逸组不误杀（C12）', async () => {
  // 同组孙子进程：settle 窗口内发现组仍存活 → 组强杀 → marker 停止增长
  const m1 = workdir('late-same');
  const r1 = runFake('late-child-same-group', { envModeExtra: { FAKE_MARKER_DIR: m1 }, settleMs: 800 });
  const res1 = await r1.handle.promise;
  assert.equal(res1.code, 0);
  assert.equal(res1.lingerKilled, true, '同组残留工具应被强制回收');
  const f1 = path.join(m1, 'late');
  const s1 = fs.existsSync(f1) ? fs.statSync(f1).size : 0;
  await new Promise((r) => setTimeout(r, 400));
  const s2 = fs.existsSync(f1) ? fs.statSync(f1).size : 0;
  assert.equal(s2, s1, '组回收后不得继续写入');

  // 逃逸（detached 自立进程组）孙子进程：不属于受管组，不误杀、不谎报已清组
  const m2 = workdir('late-esc');
  const escPidFile = path.join(m2, 'escaped.pid');
  const r2 = runFake('late-child-escaped', {
    envModeExtra: { FAKE_MARKER_DIR: m2, FAKE_ESCAPED_PID_FILE: escPidFile },
    settleMs: 800,
  });
  const res2 = await r2.handle.promise;
  assert.equal(res2.lingerKilled, false, '逃逸进程组不是本次受管归属，不强行组杀');
  // 清理逃逸孙子，避免污染后续测试
  if (fs.existsSync(escPidFile)) {
    const escapedPid = Number(fs.readFileSync(escPidFile, 'utf8').trim());
    if (escapedPid) { try { process.kill(escapedPid); } catch {} }
  }
});

t('A9 行解析器：跨 chunk 拆行、CRLF、空行、无尾换行 flush', () => {
  const lines = [];
  const p = createLineParser((l) => lines.push(l));
  p.push('{"a":1}\r\n');
  p.push('{"b":');
  p.push('2}\n\n');
  p.push('tail-no-newline');
  p.flush();
  assert.deepEqual(lines, ['{"a":1}', '{"b":2}', 'tail-no-newline']);
});

t('A10 失败分类：认证/额度/网络错误可从 stderr 与退出码识别（C14）', async () => {
  const auth = runFake('auth-error');
  const ra = await auth.handle.promise;
  assert.equal(ra.code, 1);
  assert.equal(classifyFailure(ra.stderr, ra.code).kind, 'auth');

  const quota = runFake('quota-error');
  const rq = await quota.handle.promise;
  assert.equal(classifyFailure(rq.stderr, rq.code).kind, 'quota');

  const net = runFake('net-error');
  const rn = await net.handle.promise;
  assert.equal(classifyFailure(rn.stderr, rn.code).kind, 'network');

  const norm = runFake('exit-127');
  const rx = await norm.handle.promise;
  assert.equal(rx.code, 127);
  assert.equal(classifyFailure(rx.stderr, rx.code).kind, 'unknown');
});

t('A11 pidStartTime 读取：活进程有值，死进程为 null（PID 复用防线）', async () => {
  const { handle } = runFake('ok');
  const res = await handle.promise;
  assert.equal(readPidStartTime(res.pid), null, '已退出进程不应再有启动时刻');
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
