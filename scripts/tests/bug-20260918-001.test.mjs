#!/usr/bin/env node
// BUG-20260918-001 serve 轮询实时 git 扫描持 index.lock，与终端 git 写操作互相锁冲突 —— 回归测试
// 用法：node scripts/tests/bug-20260918-001.test.mjs
// 覆盖（验收标准 1/2/3）：
//   · W1 并发实测（核心）：轮询链路 workingTreeSnapshot（/api/confirms → confirmScopeForRun
//     → git status --porcelain -uall 同源函数）扫描脏工作区期间，独立进程忙循环监视
//     .git/index.lock —— 修复后整个扫描窗口内锁文件不得出现（不再与终端 git add/commit
//     的持锁窗口重叠冲突）；
//   · W2 注入面：经 PATH shim 捕获真实 argv——workingTreeSnapshot / fileDiffText 链路的
//     只读命令（status / diff / ls-files / rev-parse 等）统一以 --no-optional-locks 全局
//     选项开头；
//   · W3 写链路不受影响：ensureDevWorkflow 的写命令（init / switch / branch）不注入该选项，
//     初始化行为照常（期望行为 4：report 收口等写链路行为不变）；
//   · W4 scheduler 工作区探针：scheduler.mjs 的 git status 探针（批量执行期 serve 进程内
//     4 秒周期扫描）同样带 --no-optional-locks；
//   · W5 口径不变：快照条目与直连 git status --porcelain -uall 的解析结果一致（期望行为 3：
//     待提交计数口径不变）；
//   · W6 并行写容错：终端侧持锁进行中（模拟 git add 已创建 index.lock）时轮询扫描仍成功、
//     结果口径一致。

import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as gitFlow from '../lib/git-flow.mjs';

const testsDir = path.dirname(fileURLToPath(import.meta.url));
const pluginRoot = path.resolve(testsDir, '..', '..');

const cases = [];
const t = (name, fn) => cases.push([name, fn]);

function git(root, args) {
  const r = spawnSync('git', ['-c', 'user.email=t@example.com', '-c', 'user.name=t', ...args], {
    cwd: root, encoding: 'utf8', timeout: 30_000,
  });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} 失败：${r.stderr || r.stdout}`);
  return r;
}

function mkTmp(prefix) {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
}

// 已有提交的 git 仓库（可选预置脏路径：untracked 个未跟踪文件 + 1 个脏已跟踪文件）
function mkRepo(prefix, { untracked = 0, dirtyTracked = false } = {}) {
  const root = mkTmp(prefix);
  git(root, ['init', '-q', '-b', 'main']);
  fs.writeFileSync(path.join(root, 'base.txt'), 'base\n');
  git(root, ['add', '.']);
  git(root, ['commit', '-q', '-m', 'chore: init']);
  if (dirtyTracked) {
    fs.writeFileSync(path.join(root, 'base.txt'), 'base\nchanged\n');
  }
  for (let i = 1; i <= untracked; i += 1) {
    fs.writeFileSync(path.join(root, `u${i}.txt`), `content ${i}\n`);
  }
  return root;
}

// ---------- PATH shim：捕获 gitFlow 发出的真实 argv（每行一次调用，\x1f 分隔参数） ----------

const realGit = (() => {
  const r = spawnSync('/bin/sh', ['-c', 'command -v git'], { encoding: 'utf8' });
  return (r.stdout || '').trim() || '/usr/bin/git';
})();

function withGitArgCapture(fn) {
  const shimDir = mkTmp('atb-lockpoll-shim-');
  const log = path.join(shimDir, 'git-argv.log');
  fs.writeFileSync(path.join(shimDir, 'git'), [
    '#!/bin/sh',
    `printf '%s\\037' "$@" >> "$ATB_GIT_ARG_LOG"`,
    'printf "\\n" >> "$ATB_GIT_ARG_LOG"',
    'exec "$ATB_REAL_GIT" "$@"',
    '',
  ].join('\n'), { mode: 0o755 });
  const prevPath = process.env.PATH;
  const prevLog = process.env.ATB_GIT_ARG_LOG;
  const prevReal = process.env.ATB_REAL_GIT;
  process.env.PATH = `${shimDir}${path.delimiter}${prevPath}`;
  process.env.ATB_GIT_ARG_LOG = log;
  process.env.ATB_REAL_GIT = realGit;
  try {
    fn();
    return fs.readFileSync(log, 'utf8').split('\n')
      .filter(Boolean)
      .map((line) => line.split('\x1f').filter((x) => x !== ''));
  } finally {
    process.env.PATH = prevPath;
    if (prevLog === undefined) delete process.env.ATB_GIT_ARG_LOG; else process.env.ATB_GIT_ARG_LOG = prevLog;
    if (prevReal === undefined) delete process.env.ATB_REAL_GIT; else process.env.ATB_REAL_GIT = prevReal;
    fs.rmSync(shimDir, { recursive: true, force: true });
  }
}

// git 全局选项在前、子命令在后（--no-optional-locks 注入后 args[0] 即该选项）
const subcommandOf = (args) => args.find((a) => !a.startsWith('-')) || null;
const READ_CMDS = new Set(['status', 'diff', 'log', 'show', 'ls-files', 'rev-parse', 'rev-list']);
const flagged = (args) => args[0] === '--no-optional-locks';

// ---------- W1 并发实测：轮询扫描窗口内 .git/index.lock 不得出现 ----------

const WATCHER_SRC = [
  'const fs = require("node:fs");',
  'const lock = process.argv[1];',
  'const deadline = Date.now() + 12000;',
  'while (Date.now() < deadline) {',
  '  try { if (fs.existsSync(lock)) { process.stdout.write("SEEN"); process.exit(0); } } catch {}',
  '}',
  'process.stdout.write("NOT-SEEN");',
].join('\n');

// 独立子进程忙循环监视 index.lock，同步执行 scanFn（阻塞主线程不影响子进程观测）。
// exit 承诺必须在 spawn 后立即挂接——子进程可能在主线程同步扫描期间就已退出，
// 事后挂接会永远收不到事件（顶层 await 悬空 → node 静默退出码 13）。
async function scanUnderWatcher(root, lockPath, scanFn) {
  const watcher = spawn(process.execPath, ['-e', WATCHER_SRC, lockPath], { stdio: ['ignore', 'pipe', 'inherit'] });
  let out = '';
  watcher.stdout.on('data', (d) => { out += d; });
  const exited = new Promise((resolve) => {
    watcher.on('exit', () => resolve(true));
    watcher.on('error', () => resolve(false));
  });
  await new Promise((r) => setTimeout(r, 400)); // 等 watcher 进入忙循环
  scanFn();
  await new Promise((r) => setTimeout(r, 250)); // 扫描结束后的小观察窗
  if (!out) {
    watcher.kill('SIGKILL');
    await Promise.race([exited, new Promise((r) => setTimeout(r, 1000))]);
    return { seen: false };
  }
  await Promise.race([exited, new Promise((r) => setTimeout(r, 1000))]);
  return { seen: out.includes('SEEN') };
}

t('W1 轮询链路扫描（workingTreeSnapshot）期间不创建 .git/index.lock（900 个脏路径现场）', async () => {
  const root = mkRepo('atb-lockpoll-w1-', { untracked: 900, dirtyTracked: true });
  try {
    const snap = { value: null };
    const { seen } = await scanUnderWatcher(root, path.join(root, '.git', 'index.lock'), () => {
      snap.value = gitFlow.workingTreeSnapshot(root);
    });
    assert.equal(seen, false, '扫描窗口内出现了 .git/index.lock——轮询链路仍在做机会性 index 刷新（须注入 --no-optional-locks）');
    assert.ok(snap.value, '快照应成功');
    assert.equal(Object.keys(snap.value.entries).length, 901, '口径不变：900 未跟踪 + 1 脏已跟踪');
    assert.equal(snap.value.entries['u900.txt'], '??');
    assert.equal(snap.value.entries['base.txt'], ' M');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ---------- W2/W3 注入面（argv 捕获） ----------

t('W2 只读命令统一注入：workingTreeSnapshot / fileDiffText 链路的 status / diff / ls-files / rev-parse 均以 --no-optional-locks 开头', () => {
  const root = mkRepo('atb-lockpoll-w2-', { untracked: 3, dirtyTracked: true });
  try {
    const invocations = withGitArgCapture(() => {
      const snap = gitFlow.workingTreeSnapshot(root);
      assert.ok(snap, 'shim 透传下快照应照常成功');
      const diff = gitFlow.fileDiffText(root, 'base.txt');
      assert.ok(typeof diff === 'string' && diff.includes('+changed'), '已跟踪脏文件差异内容应照常可读');
    });
    assert.ok(invocations.length >= 3, `应捕获多次 git 调用（实际 ${invocations.length}）`);
    const subs = invocations.map(subcommandOf);
    for (const cmd of ['rev-parse', 'status', 'ls-files', 'diff']) {
      assert.ok(subs.includes(cmd), `链路应包含 ${cmd} 调用（实际：${[...new Set(subs)].join(',')}）`);
    }
    for (const args of invocations) {
      const cmd = subcommandOf(args);
      if (READ_CMDS.has(cmd)) {
        assert.ok(flagged(args), `只读命令 ${cmd} 须带 --no-optional-locks 全局选项（实际 argv：${args.join(' ')}）`);
      }
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

t('W3 写链路不注入且行为不变：ensureDevWorkflow 的 init / switch / branch 不携带 --no-optional-locks，初始化照常成功', () => {
  const root = mkTmp('atb-lockpoll-w3-');
  try {
    let result = null;
    const invocations = withGitArgCapture(() => {
      result = gitFlow.ensureDevWorkflow(root);
    });
    assert.equal(result.isRepo, true, '非 git 目录应被初始化为仓库（返回 isRepo=true）');
    assert.equal(gitFlow.gitBranchState(root).branch, 'dev', '工作区应已切到 dev');
    const subs = invocations.map(subcommandOf);
    for (const cmd of ['init', 'switch', 'branch']) {
      assert.ok(subs.includes(cmd), `应包含 ${cmd} 调用（实际：${[...new Set(subs)].join(',')}）`);
    }
    for (const args of invocations) {
      const cmd = subcommandOf(args);
      if (cmd === 'init' || cmd === 'switch' || cmd === 'branch') {
        assert.ok(!flagged(args), `写命令 ${cmd} 不应注入 --no-optional-locks（实际 argv：${args.join(' ')}）`);
      }
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ---------- W4 scheduler 探针（源扫描，仓库既有同类测试模式） ----------

t('W4 scheduler 工作区探针带 --no-optional-locks：git status 探针不再持 index.lock', () => {
  const src = fs.readFileSync(path.join(pluginRoot, 'scripts', 'lib', 'scheduler.mjs'), 'utf8');
  const m = /spawnSync\('git',\s*\[[^\]]*'status',\s*'--porcelain'[^\]]*\]/.exec(src);
  assert.ok(m, 'scheduler.mjs 应存在 git status --porcelain 工作区探针');
  assert.ok(
    m[0].includes("'--no-optional-locks'"),
    `探针调用须注入 --no-optional-locks（实际：${m[0]}）`,
  );
});

// ---------- W5/W6 口径与并行写容错 ----------

t('W5 口径不变：快照条目与直连 git status --porcelain -uall 解析一致（码 / 未跟踪哈希 / 已脏哈希）', () => {
  const root = mkRepo('atb-lockpoll-w5-', { untracked: 5, dirtyTracked: true });
  try {
    const snap = gitFlow.workingTreeSnapshot(root);
    const raw = git(root, ['status', '--porcelain', '-uall']).stdout;
    const expected = {};
    for (const line of raw.split('\n')) {
      if (!line) continue;
      expected[line.slice(3).trim()] = line.slice(0, 2);
    }
    assert.deepEqual(snap.entries, expected, '快照条目应与 git status 原生输出一致');
    assert.ok(snap.untracked['u1.txt'], '未跟踪文件应记录内容哈希');
    assert.ok(snap.trackedHashes['base.txt'], '预留时已脏的已跟踪文件应记录内容哈希');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

t('W6 并行写容错：终端持锁进行中（index.lock 已被占用）轮询扫描仍成功且口径一致', () => {
  const root = mkRepo('atb-lockpoll-w6-', { untracked: 4, dirtyTracked: true });
  const lockPath = path.join(root, '.git', 'index.lock');
  try {
    const before = gitFlow.workingTreeSnapshot(root);
    fs.writeFileSync(lockPath, `simulated terminal git add pid ${process.pid}\n`); // 模拟终端 git 写操作持锁中
    try {
      const during = gitFlow.workingTreeSnapshot(root);
      assert.ok(during, '并行写持锁期间轮询扫描应成功（不得报错退出）');
      assert.deepEqual(during.entries, before.entries, '持锁期间扫描口径应与空闲时一致');
    } finally {
      fs.rmSync(lockPath, { force: true });
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
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
