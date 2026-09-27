#!/usr/bin/env node
// BUG-20260927-001 发布文档引用的本地图片随文档一并提交——子进程实测 state-guard 两种模式。
// 用法：node scripts/tests/bug-20260927-001.test.mjs
// 覆盖 README 验收说明 1–5：提交放行（文档+图片 / 仅图片配套）、写入侧对齐、
// 静态核验回归（未引用图片 / 源码夹带 / 裸提交 / --amend / 主题不合规 / magic·glob）、
// 端到端真实落库不夹带 staged 源码。

import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const GUARD = path.join(pluginRoot, 'scripts', 'state-guard.mjs');
const ID = 'BUG-20260927-001';

function runGuard(guardPath, mode, toolInput, cwd) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [guardPath, mode], {
      cwd: cwd || pluginRoot,
      env: { ...process.env },
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

// ---------- 固件 ----------

// 无锁 cwd（无看板即无锁）
const tmpNoLock = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'atb-bug927-nolock-')));
// fake-plugin（守卫以自身位置解析插件根；带 lib 依赖副本）+ 看板 + 版本记录（customDocs 事实源）
const fakeHome = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'atb-bug927-fake-')));
const fakePlugin = path.join(fakeHome, 'fake-plugin');
fs.mkdirSync(path.join(fakePlugin, 'scripts', 'lib'), { recursive: true });
fs.copyFileSync(GUARD, path.join(fakePlugin, 'scripts', 'state-guard.mjs'));
fs.copyFileSync(path.join(pluginRoot, 'scripts', 'lib', 'commit-store.mjs'), path.join(fakePlugin, 'scripts', 'lib', 'commit-store.mjs'));
fs.copyFileSync(path.join(pluginRoot, 'scripts', 'lib', 'publish-flow.mjs'), path.join(fakePlugin, 'scripts', 'lib', 'publish-flow.mjs'));
const fakeGuard = path.join(fakePlugin, 'scripts', 'state-guard.mjs');
// 标准发布文档 README.md：引用本地图片（Markdown）+ HTML img + 各类不入集合的引用形态
fs.writeFileSync(path.join(fakePlugin, 'README.md'), [
  '# t',
  '',
  '![界面](image/README/x.png)',
  '',
  '<img src="image/html.png" width="100">',
  '',
  '![外部](https://example.com/a.png)',
  '![受保护](scripts/evil.png)',
  '![看板](agent-team-board/data/x.png)',
  '![非图片](image/notes.txt)',
  '![逃逸](../outside.png)',
  '',
].join('\n'));
fs.writeFileSync(path.join(fakePlugin, 'CHANGELOG.md'), '# c\n');
fs.writeFileSync(path.join(fakePlugin, 'GLOSSARY.md'), '![术语图](image/g.png)\n');
fs.writeFileSync(path.join(fakePlugin, 'README_en.md'), '![变体](image/en.png)\n'); // 语言变体不豁免，其引用不入集合
fs.mkdirSync(path.join(fakePlugin, 'image', 'README'), { recursive: true });
fs.writeFileSync(path.join(fakePlugin, 'image', 'README', 'x.png'), 'png-x');
fs.writeFileSync(path.join(fakePlugin, 'image', 'html.png'), 'png-html');
fs.writeFileSync(path.join(fakePlugin, 'image', 'g.png'), 'png-g');
fs.writeFileSync(path.join(fakePlugin, 'image', 'other.png'), 'png-other-unreferenced');
fs.writeFileSync(path.join(fakePlugin, 'image', 'notes.txt'), 'txt');
fs.mkdirSync(path.join(fakePlugin, 'agent-team-board', 'data'), { recursive: true });
const fakeVersions = path.join(fakePlugin, 'agent-team-board', 'runtime', 'builds', 'versions');
fs.mkdirSync(path.join(fakeVersions, 'BLD-20260927-099'), { recursive: true });
fs.writeFileSync(path.join(fakeVersions, 'BLD-20260927-099', 'version.json'), JSON.stringify({ id: 'BLD-20260927-099', status: 'draft', customDocs: ['GLOSSARY'] }));

// 真实仓库现状（README.md 第 37 行引用 image/README/1790092127929.png）
const REAL_IMAGE = 'image/README/1790092127929.png';

const cases = [];
const t = (name, fn) => cases.push([name, fn]);

// ---------- A 系列：提交放行 ----------

t('A1 无锁：文档+引用图片同一提交、主题合规 → 放行（真实仓库 / fake-plugin / customDocs 图片）', async () => {
  const real = await run('bash', { command: `git commit -m "doc: 更新产品界面插图 ${ID}" README.md ${REAL_IMAGE}` }, pluginRoot);
  assert.equal(real.code, 0, `真实仓库 README.md + 被引用图片应放行：${real.err}`);
  const fake = await runGuard(fakeGuard, 'bash', { command: `git commit -m "doc: 更新产品界面插图 ${ID}" README.md image/README/x.png image/html.png` }, fakePlugin);
  assert.equal(fake.code, 0, `Markdown + HTML img 引用图片应放行：${fake.err}`);
  const custom = await runGuard(fakeGuard, 'bash', { command: `git commit -m "doc: 更新术语插图 ${ID}" GLOSSARY.md image/g.png` }, fakePlugin);
  assert.equal(custom.code, 0, `customDocs 文档引用图片应放行：${custom.err}`);
});

t('A2 无锁：仅图片配套授权提交（文档已在库或另行提交）→ 放行', async () => {
  const real = await run('bash', { command: `git commit -m "doc: 产品界面插图 ${ID}" ${REAL_IMAGE}` }, pluginRoot);
  assert.equal(real.code, 0, `真实仓库仅图片应放行：${real.err}`);
  const fake = await runGuard(fakeGuard, 'bash', { command: `git commit -m "doc: 插图 ${ID}" image/README/x.png` }, fakePlugin);
  assert.equal(fake.code, 0, `fake 仅图片应放行：${fake.err}`);
});

// ---------- W 系列：写入侧对齐 ----------

t('W1 无锁：写入被引用图片放行（file / Bash，已存在与新建两种形态）', async () => {
  const exist = await run('file', { file_path: path.join(pluginRoot, REAL_IMAGE) }, tmpNoLock);
  assert.equal(exist.code, 0, `无锁写已存在被引用图片应放行：${exist.err}`);
  const create = await run('file', { file_path: path.join(fakePlugin, 'image', 'README', 'new.png') }, tmpNoLock);
  assert.equal(create.code, 0, `无锁写新建被引用图片（祖先回溯）应放行：${create.err}`);
  const bash = await run('bash', { command: `echo x > ${fakePlugin}/image/README/new.png` }, tmpNoLock);
  assert.equal(bash.code, 0, `无锁 Bash 重定向写被引用图片应放行：${bash.err}`);
  const custom = await runGuard(fakeGuard, 'file', { file_path: path.join(fakePlugin, 'image', 'g.png') }, tmpNoLock);
  assert.equal(custom.code, 0, `无锁写 customDocs 文档引用图片应放行：${custom.err}`);
});

t('W2 无锁：写入集合外路径仍拦（未引用图片 / image 目录本身 / 非图片扩展 / 变体专属图 / 源码）', async () => {
  const targets = [
    path.join(fakePlugin, 'image', 'other.png'), // 未被任何豁免文档引用
    path.join(fakePlugin, 'image'), // 目录本身
    path.join(fakePlugin, 'image', 'notes.txt'), // 文档引用了但非图片扩展
    path.join(fakePlugin, 'image', 'en.png'), // 仅语言变体 README_en.md 引用（变体不豁免 → 不入集合）
  ];
  for (const file_path of targets) {
    const r = await runGuard(fakeGuard, 'file', { file_path }, tmpNoLock);
    assert.equal(r.code, 2, `集合外路径写入应拦截（${file_path}）`);
  }
  // 真实仓库未被引用图片（真实守卫按真实 README.md 内容解析集合）
  const realUnref = await run('file', { file_path: path.join(pluginRoot, 'image', 'README', '1790092216439_en.png') }, tmpNoLock);
  assert.equal(realUnref.code, 2, '真实仓库未被引用图片写入应拦截');
  const src = await run('file', { file_path: path.join(pluginRoot, 'scripts', 'web', 'app.js') }, tmpNoLock);
  assert.equal(src.code, 2, '源码写入照旧拦截');
});

// ---------- C 系列：提交拦截回归 ----------

t('C1 提交拦截不回退：混入源码 / 未引用图片 / 非图片扩展 / 变体专属图 / 看板数据 / 逃逸路径', async () => {
  const commands = [
    `git commit -m "doc: x ${ID}" README.md scripts/state-guard.mjs`,
    `git commit -m "doc: x ${ID}" README.md image/other.png`, // 未引用图片
    `git commit -m "doc: x ${ID}" image/notes.txt`, // 文档引用了但非图片扩展
    `git commit -m "doc: x ${ID}" image/en.png`, // 仅语言变体引用
    `git commit -m "doc: x ${ID}" agent-team-board/data/x.png`, // 看板数据不入图片通道
    `git commit -m "doc: x ${ID}" ../outside.png`, // 插件根之外
    `git commit -m "doc: x ${ID}" ${REAL_IMAGE} ${pluginRoot}/scripts/state-guard.mjs`,
  ];
  for (const command of commands) {
    const r = await runGuard(fakeGuard, 'bash', { command }, fakePlugin);
    assert.equal(r.code, 2, `非豁免提交形态应拦截（${command}）：${r.err}`);
  }
});

t('C2 不可静态核验形态依旧拦截：裸提交 / -a / --amend / 主题无单号 / 主题不合规 / glob / magic', async () => {
  const commands = [
    `git commit -m "doc: 插图 ${ID}"`, // 裸提交
    `git add image/README/x.png; git commit -m "doc: 裸提交 ${ID}"`,
    `git commit -a -m "doc: 全量 ${ID}" README.md image/README/x.png`,
    `git commit --amend -m "doc: 改写 ${ID}" image/README/x.png`,
    `git commit -m "更新插图" README.md image/README/x.png`, // 主题无单号
    `git commit -m "随便写的 ${ID}" README.md image/README/x.png`, // 主题缺「类型:」前缀
    `git commit -m "docs: 插图 ${ID}" README.md image/README/x.png`, // 主题前缀不在五类（docs）
    `git commit -m "doc: 插图 ${ID}" "image/README/*.png"`, // glob 通配
    `git commit -m "doc: 插图 ${ID}" ":(exclude)README.md" image/README/x.png`, // magic 前缀
    `git commit -m "doc: 插图 ${ID}" "^README.md" image/README/x.png`,
  ];
  for (const command of commands) {
    const r = await runGuard(fakeGuard, 'bash', { command }, fakePlugin);
    assert.equal(r.code, 2, `不可核验形态应拦截（${command}）：${r.err}`);
  }
});

t('C3 既有通道回归：条目目录用户数据与纯豁免文档提交不变', async () => {
  const itemDoc = `agent-team-board/data/bugs/${ID}/README.md`;
  const ok = await run('bash', { command: `git commit -m "doc: 讨论轮更新 ${ID}" ${itemDoc}` }, pluginRoot);
  assert.equal(ok.code, 0, `条目文档提交应保持放行：${ok.err}`);
  const doc = await run('bash', { command: `git commit -m "doc: 更新说明 ${ID}" README.md` }, pluginRoot);
  assert.equal(doc.code, 0, `纯豁免文档提交应保持放行：${doc.err}`);
});

// ---------- E1 端到端：fake-plugin 伪 git 仓库真实落库 ----------

t('E1 端到端：README+图片提交落库、仅图片配套提交落库，均不夹带 staged 源码', async () => {
  const git = (args) => spawnSync('git', ['-c', 'user.email=t@example.com', '-c', 'user.name=t', ...args], {
    cwd: fakePlugin, encoding: 'utf8', timeout: 30_000,
  });
  git(['init', '-q', '-b', 'main']);
  git(['add', 'README.md', 'image']);
  git(['commit', '-q', '-m', 'chore: 基线']);
  // 检出基线：README 引用的 image/README/x.png 已在库
  const headFiles = () => git(['diff-tree', '--no-commit-id', '--name-only', '-r', 'HEAD']).stdout.split('\n').filter(Boolean);
  // 场景一：文档+图片同一提交（改 README 与图片后 pathspec 提交两者）
  fs.appendFileSync(path.join(fakePlugin, 'README.md'), '\n再引用一次 image/README/x.png\n');
  fs.appendFileSync(path.join(fakePlugin, 'image', 'README', 'x.png'), '-updated');
  const c1 = `git commit -m "doc: 更新插图 ${ID}" README.md image/README/x.png`;
  const g1 = await runGuard(fakeGuard, 'bash', { command: c1 }, fakePlugin);
  assert.equal(g1.code, 0, `文档+图片提交应放行：${g1.err}`);
  const r1 = git(['commit', '-m', `docs: 更新插图 ${ID}`, 'README.md', 'image/README/x.png']);
  assert.equal(r1.status, 0, `真实提交应成功：${r1.stderr}`);
  assert.deepEqual(headFiles().sort(), ['README.md', 'image/README/x.png'], `应只含文档与图片：${JSON.stringify(headFiles())}`);
  // 预先 git add 源码再提交：pathspec 限定下不夹带（git --only 语义）
  fs.appendFileSync(path.join(fakePlugin, 'scripts', 'lib', 'commit-store.mjs'), '\n// touch\n');
  git(['add', 'scripts/lib/commit-store.mjs']);
  fs.appendFileSync(path.join(fakePlugin, 'image', 'g.png'), '-updated');
  const c2 = `git commit -m "doc: 更新术语插图 ${ID}" image/g.png`;
  const g2 = await runGuard(fakeGuard, 'bash', { command: c2 }, fakePlugin);
  assert.equal(g2.code, 0, `仅图片配套提交应放行：${g2.err}`);
  const r2 = git(['commit', '-m', `docs: 更新术语插图 ${ID}`, 'image/g.png']);
  assert.equal(r2.status, 0, `真实提交应成功：${r2.stderr}`);
  assert.deepEqual(headFiles(), ['image/g.png'], `不应夹带 staged 源码：${JSON.stringify(headFiles())}`);
});

// ---------- L1 有锁路径回归 ----------

t('L1 有效认领锁：原放行行为不变', async () => {
  const tmpProj = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'atb-bug927-lock-')));
  const locks = path.join(tmpProj, 'agent-team-board', 'runtime', '.locks');
  fs.mkdirSync(locks, { recursive: true });
  fs.writeFileSync(path.join(locks, 'REQ-TEST-011.lock'), JSON.stringify({ owner: 't', at: new Date().toISOString() }));
  const w = await run('file', { file_path: path.join(pluginRoot, 'scripts', 'web', 'app.js') }, tmpProj);
  assert.equal(w.code, 0, `有锁 Write 源码应放行：${w.err}`);
  const b = await run('bash', { command: `echo x > ${pluginRoot}/scripts/l1.tmp` }, tmpProj);
  assert.equal(b.code, 0, `有锁 Bash 改源码应放行：${b.err}`);
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
  fs.rmSync(fakeHome, { recursive: true, force: true });
} catch {}
console.log(failed ? `\n${failed} 个用例未通过` : '\n全部通过');
process.exit(failed ? 1 : 0);
