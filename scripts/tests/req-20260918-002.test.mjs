#!/usr/bin/env node
// REQ-20260918-002 根 README.md 豁免实施互斥锁 —— 子进程实测 state-guard 两种模式
// 用法：node scripts/tests/req-20260918-002.test.mjs
// 覆盖 test-cases.md R1–R3 / X1–X3 / C1–C4 / L1 / E1 / D1。

import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const GUARD = path.join(pluginRoot, 'scripts', 'state-guard.mjs');
const README = path.join(pluginRoot, 'README.md');
const SRC = path.join(pluginRoot, 'scripts', 'web', 'app.js'); // 受保护源码样本

function runGuard(guardPath, mode, toolInput, cwd, env = {}) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [guardPath, mode], {
      cwd: cwd || pluginRoot,
      env: { ...process.env, ...env },
      stdio: ['pipe', 'ignore', 'pipe'],
    });
    let err = '';
    p.stderr.on('data', (c) => { err += c; });
    p.on('close', (code) => resolve({ code, err }));
    p.stdin.write(JSON.stringify({ tool_name: mode === 'file' ? 'Write' : 'Bash', cwd: cwd || pluginRoot, tool_input: toolInput }));
    p.stdin.end();
  });
}
const run = (mode, toolInput, cwd) => runGuard(GUARD, mode, toolInput, cwd);

const cases = [];
const t = (name, fn) => cases.push([name, fn]);

// 无锁 cwd（无看板即无锁）
const tmpNoLock = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'atb-req002-nolock-')));
// 软链别名（模拟插件缓存安装形态：别名 → 真实仓库根）
const aliasHome = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'atb-req002-alias-')));
const aliasRoot = path.join(aliasHome, 'cache-alias');
fs.symlinkSync(pluginRoot, aliasRoot, 'dir');
// fake-plugin（守卫以自身位置解析插件根；带 lib 依赖副本）
const fakeHome = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'atb-req002-fake-')));
const fakePlugin = path.join(fakeHome, 'fake-plugin');
fs.mkdirSync(path.join(fakePlugin, 'scripts', 'lib'), { recursive: true });
fs.copyFileSync(GUARD, path.join(fakePlugin, 'scripts', 'state-guard.mjs'));
fs.copyFileSync(path.join(pluginRoot, 'scripts', 'lib', 'commit-store.mjs'), path.join(fakePlugin, 'scripts', 'lib', 'commit-store.mjs'));
const fakeGuard = path.join(fakePlugin, 'scripts', 'state-guard.mjs');
fs.writeFileSync(path.join(fakePlugin, 'README.md'), '# t\n');

// ---------- R 系列：编辑豁免放行 ----------

t('R1 无锁：file 模式 Write/Edit 插件根 README.md 放行（绝对 / 软链别名 / 相对路径）', async () => {
  const abs = await run('file', { file_path: README }, tmpNoLock);
  assert.equal(abs.code, 0, `绝对路径应放行：${abs.err}`);
  const alias = await run('file', { file_path: path.join(aliasRoot, 'README.md') }, tmpNoLock);
  assert.equal(alias.code, 0, `软链别名路径应放行：${alias.err}`);
  const rel = await runGuard(fakeGuard, 'file', { file_path: 'README.md' }, fakePlugin);
  assert.equal(rel.code, 0, `相对路径（cwd=插件根）应放行：${rel.err}`);
});

t('R2 无锁：Bash 改写插件根 README.md（sed -i / > / >> / tee）放行', async () => {
  const commands = [
    `sed -i '' 's/a/b/' ${README}`,
    `sed -i 's/a/b/' ${README}`,
    `echo x > ${README}`,
    `echo x >> ${README}`,
    `echo x | tee ${README}`,
    `sed -i '' 's/a/b/' ${aliasRoot}/README.md`,
  ];
  for (const command of commands) {
    const r = await run('bash', { command }, tmpNoLock);
    assert.equal(r.code, 0, `改写根 README.md 应放行（${command}）：${r.err}`);
  }
});

t('R3 无锁：同批命令改受保护源码仍拦（保护面不弱化）', async () => {
  const commands = [
    `echo x > ${README}; echo y > ${pluginRoot}/scripts/r3.tmp`,
    `echo y > ${pluginRoot}/commands/r3.md`,
    `sed -i '' 's/a/b/' ${pluginRoot}/skills/agent-team-board/SKILL.md`,
    `echo y > ${pluginRoot}/hooks/r3.json`,
  ];
  for (const command of commands) {
    const r = await run('bash', { command }, tmpNoLock);
    assert.equal(r.code, 2, `改受保护源码应拦截（${command}）`);
  }
});

// ---------- X 系列：豁免范围精确 ----------

t('X1 无锁：插件根其他直接子文件改写仍拦', async () => {
  const targets = [
    path.join(pluginRoot, 'AGENTS.md'),
    path.join(pluginRoot, 'package.json'),
    path.join(pluginRoot, 'index.html'),
    path.join(pluginRoot, 'README.en.md'),
    path.join(pluginRoot, 'bin', 'x1.tmp'), // 新建文件（bin/ 保护）
  ];
  for (const file_path of targets) {
    const r = await run('file', { file_path }, tmpNoLock);
    assert.equal(r.code, 2, `根下其他文件应拦截（${file_path}）`);
  }
});

t('X2 无锁：scripts/、skills/ 内同名 README.md 不获豁免仍拦', async () => {
  const targets = [
    path.join(fakePlugin, 'scripts', 'README.md'),
    path.join(fakePlugin, 'skills', 'x', 'README.md'),
  ];
  for (const file_path of targets) {
    const r = await runGuard(fakeGuard, 'file', { file_path }, tmpNoLock);
    assert.equal(r.code, 2, `目录内同名 README.md 应拦截（${file_path}）`);
  }
  const root = await runGuard(fakeGuard, 'file', { file_path: path.join(fakePlugin, 'README.md') }, tmpNoLock);
  assert.equal(root.code, 0, `对照：fake-plugin 根 README.md 应放行：${root.err}`);
});

t('X3 既有守卫规则回归不变', async () => {
  const tmpProj = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'atb-req002-x3-')));
  const board = path.join(tmpProj, 'agent-team-board');
  fs.mkdirSync(path.join(board, 'runtime', 'status'), { recursive: true });
  const sj = path.join(board, 'runtime', 'status', 'REQ-20260918-099.json');
  const w = await run('file', { file_path: sj }, tmpProj);
  assert.equal(w.code, 2, 'runtime/status 直写仍应拦截');
  const commands = [
    `echo '{}' > ${sj}`,
    `node ${pluginRoot}/scripts/atb.mjs status REQ-20260918-002 accepted`,
    `node ${pluginRoot}/scripts/atb.mjs new req --title x --accept`,
    `node ${pluginRoot}/scripts/atb.mjs hold answer HOLD-1 yes`,
    `node ${pluginRoot}/scripts/atb.mjs confirm verify CFM-1`,
    `curl -s -X POST http://127.0.0.1:8888/api/item/REQ-1/status -d to=done`,
  ];
  for (const command of commands) {
    const r = await run('bash', { command }, tmpProj);
    assert.equal(r.code, 2, `人工专属/状态保护应保持拦截（${command}）`);
  }
});

// ---------- C 系列：提交豁免（cwd=插件根，看板项目内） ----------

const ID = 'REQ-20260918-002';
const ITEM_DOC = `agent-team-board/data/requirements/${ID}/README.md`;

t('C1 无锁：仅含根 README.md、主题合规的 git commit 放行', async () => {
  const commands = [
    `git commit -m "doc: 更新说明 ${ID}" README.md`,
    `git commit -m "doc: 更新说明 ${ID}" ${README}`,
    `git commit -m "doc: 更新说明 ${ID}" -- README.md`,
    `git -C ${pluginRoot} commit -m "doc: 更新说明 ${ID}" README.md`,
    `git commit --message="doc: 更新说明 ${ID}" README.md`,
    `git commit -m "doc: 更新说明 ${ID}" -m "补充细节" README.md`,
  ];
  for (const command of commands) {
    const r = await run('bash', { command }, pluginRoot);
    assert.equal(r.code, 0, `README 提交应放行（${command}）：${r.err}`);
  }
  // 误报回归：参数文本中的 git commit 字样（命令位不是 git）不拦
  const mention = await run('bash', { command: `chore: x git commit -m "参数文本提及不算提交"` }, pluginRoot);
  assert.equal(mention.code, 0, `参数文本提及 git commit 应放行：${mention.err}`);
});

t('C2 提交拦截不回退：混入源码 / 裸提交 / -a / --amend / 无 -m 均拦', async () => {
  const commands = [
    `git commit -m "doc: x ${ID}" README.md scripts/state-guard.mjs`,
    `git commit -m "doc: x ${ID}" README.md AGENTS.md`,
    `git commit -m "doc: x ${ID}" README.en.md`,
    `git add scripts/lib/core.mjs; git commit -m "doc: 夹带 ${ID}"`,
    `git add scripts/lib/core.mjs && git commit -m "doc: 裸夹带 ${ID}" README.md scripts/lib/core.mjs`,
    `git commit -a -m "doc: 全量 ${ID}" README.md`,
    `git commit --amend -m "doc: 改写 ${ID}" README.md`,
    `git commit README.md`,
  ];
  for (const command of commands) {
    const r = await run('bash', { command }, pluginRoot);
    assert.equal(r.code, 2, `非豁免提交形态应拦截（${command}）`);
    assert.match(r.err, /git commit|提交|流程外/, `拦截提示应指向既有提交通道：${r.err}`);
  }
});

t('C3 主题不合规拦：无单号 / 前缀类型不合 / 描述空 / 超长 / 单号不在主题行', async () => {
  const commands = [
    `git commit -m "doc: 更新说明" README.md`,
    `git commit -m "docs: 更新 ${ID}" README.md`,
    `git commit -m "更新说明 ${ID}" README.md`,
    `git commit -m "doc: ${ID}" README.md`,
    `git commit -m "doc: ${'x'.repeat(121)} ${ID}" README.md`,
    `git commit -m "doc: 更新说明" -m "${ID}" README.md`,
  ];
  for (const command of commands) {
    const r = await run('bash', { command }, pluginRoot);
    assert.equal(r.code, 2, `主题不合规应拦截（${command}）`);
  }
});

t('C4 回归：REQ-20260917-002 条目目录用户数据提交通道不变', async () => {
  const ok = await run('bash', { command: `git commit -m "doc: 讨论轮更新 ${ID}" ${ITEM_DOC}` }, pluginRoot);
  assert.equal(ok.code, 0, `条目文档提交应保持放行：${ok.err}`);
  const bad = await run('bash', { command: `git commit -m "doc: 无单号" ${ITEM_DOC}` }, pluginRoot);
  assert.equal(bad.code, 2, '条目文档提交无单号仍应拦截');
});

// ---------- L1 有锁路径回归 ----------

t('L1 有效认领锁：原放行行为不变（含根 README.md，豁免不引入新拒绝路径）', async () => {
  const tmpProj = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'atb-req002-lock-')));
  const locks = path.join(tmpProj, 'agent-team-board', 'runtime', '.locks');
  fs.mkdirSync(locks, { recursive: true });
  fs.writeFileSync(path.join(locks, 'REQ-TEST-009.lock'), JSON.stringify({ owner: 't', at: new Date().toISOString() }));
  const w = await run('file', { file_path: SRC }, tmpProj);
  assert.equal(w.code, 0, `有锁 Write 源码应放行：${w.err}`);
  const b = await run('bash', { command: `echo x > ${pluginRoot}/scripts/l1.tmp` }, tmpProj);
  assert.equal(b.code, 0, `有锁 Bash 改源码应放行：${b.err}`);
  const md = await run('file', { file_path: README }, tmpProj);
  assert.equal(md.code, 0, `有锁 Write 根 README.md 应放行：${md.err}`);
  const sed = await run('bash', { command: `sed -i '' 's/a/b/' ${README}` }, tmpProj);
  assert.equal(sed.code, 0, `有锁 Bash 改根 README.md 应放行：${sed.err}`);
});

// ---------- E1 端到端：fake-plugin 伪 git 仓库真实落库 ----------

t('E1 端到端：根 README.md 提交守卫放行、真实落库且不夹带 staged 源码', async () => {
  const git = (args) => spawnSync('git', ['-c', 'user.email=t@example.com', '-c', 'user.name=t', ...args], {
    cwd: fakePlugin, encoding: 'utf8', timeout: 30_000,
  });
  // 看板（commit 管辖）+ 伪 git 仓库
  fs.mkdirSync(path.join(fakePlugin, 'agent-team-board', 'data'), { recursive: true });
  fs.mkdirSync(path.join(fakePlugin, 'agent-team-board', 'runtime'), { recursive: true });
  git(['init', '-q', '-b', 'main']);
  git(['add', '.']);
  git(['commit', '-q', '-m', 'chore: 基线']);
  // 编辑根 README.md 后带 pathspec 提交（主题合规）
  fs.appendFileSync(path.join(fakePlugin, 'README.md'), '\n更新一段\n');
  const command = `git commit -m "doc: 更新说明 ${ID}" README.md`;
  const g = await runGuard(fakeGuard, 'bash', { command }, fakePlugin);
  assert.equal(g.code, 0, `README 提交应放行：${g.err}`);
  const real = git(['commit', '-m', `doc: 更新说明 ${ID}`, 'README.md']);
  assert.equal(real.status, 0, `真实提交应成功：${real.stderr}`);
  const subjects = git(['log', '--format=%s']).stdout.split('\n').filter(Boolean);
  assert.ok(subjects.includes(`doc: 更新说明 ${ID}`), '提交应落库且主题含单号');
  // 预先 git add 源码再 commit README.md：pathspec 限定下不夹带（git --only 语义）
  fs.appendFileSync(path.join(fakePlugin, 'scripts', 'lib', 'commit-store.mjs'), '\n// touch\n');
  git(['add', 'scripts/lib/commit-store.mjs']);
  fs.appendFileSync(path.join(fakePlugin, 'README.md'), '\n再更新一段\n');
  const g2 = await runGuard(fakeGuard, 'bash', { command }, fakePlugin);
  assert.equal(g2.code, 0, `add 源码后 README pathspec 提交应放行：${g2.err}`);
  const real2 = git(['commit', '-m', `doc: 更新说明 ${ID}`, 'README.md']);
  assert.equal(real2.status, 0, `第二次真实提交应成功：${real2.stderr}`);
  const files = git(['diff-tree', '--no-commit-id', '--name-only', '-r', 'HEAD']).stdout.split('\n').filter(Boolean);
  assert.deepEqual(files, ['README.md'], `pathspec 提交不应夹带 staged 源码：${JSON.stringify(files)}`);
});

// ---------- D1 文档同步 ----------

t('D1 文档口径同步：AGENTS.md / README.md / state-guard 顶部注释', async () => {
  const agents = fs.readFileSync(path.join(pluginRoot, 'AGENTS.md'), 'utf8');
  assert.ok(agents.includes('例外：根 `README.md`'), 'AGENTS.md 改前先登记条款应写明根 README.md 例外');
  assert.ok(/根 `README\.md`[^\n]*无需认领锁|无需认领锁[^\n]*根 `README\.md`/.test(agents), 'AGENTS.md 应写明无需认领锁可直接更新');
  const readme = fs.readFileSync(README, 'utf8');
  assert.ok(readme.includes('根 `README.md` 例外'), 'README.md 认领锁与源码守卫应写明根 README.md 例外');
  const guardSrc = fs.readFileSync(GUARD, 'utf8');
  assert.ok(guardSrc.slice(0, 2500).includes('REQ-20260918-002'), 'state-guard.mjs 顶部注释应同步豁免口径');
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
try {
  fs.rmSync(tmpNoLock, { recursive: true, force: true });
  fs.rmSync(aliasHome, { recursive: true, force: true });
  fs.rmSync(fakeHome, { recursive: true, force: true });
} catch {}
console.log(failed ? `\n${failed} 个用例未通过` : '\n全部通过');
process.exit(failed ? 1 : 0);
