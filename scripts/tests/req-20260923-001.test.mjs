#!/usr/bin/env node
// REQ-20260923-001 发布文档豁免扩展（四类标准文档 + v.customDocs 自定义文档像根 README.md
// 一样豁免）—— 子进程实测 state-guard 两种模式。
// 用法：node scripts/tests/req-20260923-001.test.mjs
// 覆盖 test-cases.md R1–R4 / X1–X3 / C1–C3 / L1 / E1（B1 基线修订由 req-20260918-002 套件回归覆盖）。

import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const GUARD = path.join(pluginRoot, 'scripts', 'state-guard.mjs');
const ID = 'REQ-20260923-001';

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
const tmpNoLock = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'atb-req001-nolock-')));
// 软链别名（模拟插件缓存安装形态：别名 → 真实仓库根）
const aliasHome = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'atb-req001-alias-')));
const aliasRoot = path.join(aliasHome, 'cache-alias');
fs.symlinkSync(pluginRoot, aliasRoot, 'dir');
// fake-plugin（守卫以自身位置解析插件根；带 lib 依赖副本）+ 看板 + 版本记录（customDocs 事实源）
const fakeHome = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'atb-req001-fake-')));
const fakePlugin = path.join(fakeHome, 'fake-plugin');
fs.mkdirSync(path.join(fakePlugin, 'scripts', 'lib'), { recursive: true });
fs.copyFileSync(GUARD, path.join(fakePlugin, 'scripts', 'state-guard.mjs'));
fs.copyFileSync(path.join(pluginRoot, 'scripts', 'lib', 'commit-store.mjs'), path.join(fakePlugin, 'scripts', 'lib', 'commit-store.mjs'));
fs.copyFileSync(path.join(pluginRoot, 'scripts', 'lib', 'publish-flow.mjs'), path.join(fakePlugin, 'scripts', 'lib', 'publish-flow.mjs'));
const fakeGuard = path.join(fakePlugin, 'scripts', 'state-guard.mjs');
fs.writeFileSync(path.join(fakePlugin, 'README.md'), '# t\n');
fs.writeFileSync(path.join(fakePlugin, 'CHANGELOG.md'), '# c\n');
fs.mkdirSync(path.join(fakePlugin, 'agent-team-board', 'data'), { recursive: true });
const fakeVersions = path.join(fakePlugin, 'agent-team-board', 'runtime', 'builds', 'versions');
// 两条版本记录：customDocs 并集 = MIGRATION（新版本）+ GLOSSARY（旧版本）
fs.mkdirSync(path.join(fakeVersions, 'BLD-20260923-001'), { recursive: true });
fs.mkdirSync(path.join(fakeVersions, 'BLD-20260922-099'), { recursive: true });
fs.writeFileSync(path.join(fakeVersions, 'BLD-20260923-001', 'version.json'), JSON.stringify({ id: 'BLD-20260923-001', status: 'draft', customDocs: ['MIGRATION'] }));
fs.writeFileSync(path.join(fakeVersions, 'BLD-20260922-099', 'version.json'), JSON.stringify({ id: 'BLD-20260922-099', status: 'merged', customDocs: ['GLOSSARY'] }));

const cases = [];
const t = (name, fn) => cases.push([name, fn]);

// ---------- R 系列：编辑 / Bash 改写豁免放行 ----------

t('R1 无锁：file 模式编辑插件根第一层四类标准文档放行（绝对 / 软链别名 / 相对路径）', async () => {
  for (const name of ['README.md', 'CHANGELOG.md', 'FEATURES.md', 'AGENTS.md']) {
    const abs = await run('file', { file_path: path.join(pluginRoot, name) }, tmpNoLock);
    assert.equal(abs.code, 0, `${name} 绝对路径应放行：${abs.err}`);
  }
  const alias = await run('file', { file_path: path.join(aliasRoot, 'AGENTS.md') }, tmpNoLock);
  assert.equal(alias.code, 0, `软链别名路径应放行：${alias.err}`);
  const rel = await runGuard(fakeGuard, 'file', { file_path: 'CHANGELOG.md' }, fakePlugin);
  assert.equal(rel.code, 0, `相对路径（cwd=插件根，目标不存在=新建）应放行：${rel.err}`);
  // apply_patch 形态（Codex 宿主）：Update File 目标同样豁免
  const patch = await runGuard(fakeGuard, 'file', {
    command: `*** Begin Patch\n*** Update File: AGENTS.md\n@@\n-x\n+y\n*** End Patch`,
  }, fakePlugin);
  assert.equal(patch.code, 0, `apply_patch 目标应放行：${patch.err}`);
});

t('R2 无锁：Bash 改写插件根第一层四类标准文档（sed -i / > / >> / tee）放行', async () => {
  const commands = [
    `sed -i '' 's/a/b/' ${pluginRoot}/CHANGELOG.md`,
    `echo x > ${pluginRoot}/FEATURES.md`,
    `echo x >> ${pluginRoot}/AGENTS.md`,
    `echo x | tee ${pluginRoot}/CHANGELOG.md`,
    `sed -i 's/a/b/' ${aliasRoot}/FEATURES.md`,
  ];
  for (const command of commands) {
    const r = await run('bash', { command }, tmpNoLock);
    assert.equal(r.code, 0, `改写标准发布文档应放行（${command}）：${r.err}`);
  }
});

t('R3 无锁：清单内自定义文档编辑 / 改写放行（含多版本记录并集），移出清单后恢复拦截', async () => {
  const inList = [
    await runGuard(fakeGuard, 'file', { file_path: path.join(fakePlugin, 'MIGRATION.md') }, tmpNoLock),
    await runGuard(fakeGuard, 'file', { file_path: path.join(fakePlugin, 'GLOSSARY.md') }, tmpNoLock),
    await runGuard(fakeGuard, 'bash', { command: `echo x > ${fakePlugin}/MIGRATION.md` }, tmpNoLock),
    await runGuard(fakeGuard, 'bash', { command: `sed -i '' 's/a/b/' ${fakePlugin}/GLOSSARY.md` }, tmpNoLock),
  ];
  for (const r of inList) {
    assert.equal(r.code, 0, `清单内自定义文档（任一版本记录列出）应放行：${r.err}`);
  }
  // 联动：MIGRATION 移出唯一列出它的版本记录 → 不再豁免
  fs.writeFileSync(path.join(fakeVersions, 'BLD-20260923-001', 'version.json'), JSON.stringify({ id: 'BLD-20260923-001', status: 'draft', customDocs: [] }));
  const afterRemove = [
    await runGuard(fakeGuard, 'file', { file_path: path.join(fakePlugin, 'MIGRATION.md') }, tmpNoLock),
    await runGuard(fakeGuard, 'bash', { command: `echo x > ${fakePlugin}/MIGRATION.md` }, tmpNoLock),
  ];
  for (const r of afterRemove) {
    assert.equal(r.code, 2, '移出清单后自定义文档应恢复拦截');
  }
  // 对照：仍在清单的 GLOSSARY 不受影响
  const keep = await runGuard(fakeGuard, 'file', { file_path: path.join(fakePlugin, 'GLOSSARY.md') }, tmpNoLock);
  assert.equal(keep.code, 0, `仍在清单的自定义文档应放行：${keep.err}`);
});

t('R4 无锁：同批命令改受保护源码仍拦（保护面不弱化）', async () => {
  const commands = [
    `echo x > ${pluginRoot}/CHANGELOG.md; echo y > ${pluginRoot}/scripts/r4.tmp`,
    `echo y > ${pluginRoot}/skills/agent-team-board/SKILL.md`,
    `echo y > ${pluginRoot}/commands/r4.md`,
  ];
  for (const command of commands) {
    const r = await run('bash', { command }, tmpNoLock);
    assert.equal(r.code, 2, `改受保护源码应拦截（${command}）`);
  }
});

// ---------- X 系列：豁免范围精确 ----------

t('X1 无锁：根下其他文件与语言变体仍拦（不因待确认项弱化）', async () => {
  const targets = [
    path.join(pluginRoot, 'package.json'),
    path.join(pluginRoot, 'index.html'),
    path.join(pluginRoot, 'LICENSE.md'), // 单文件类不在豁免（待确认 2 保守）
    path.join(pluginRoot, 'README_en.md'), // 语言变体不豁免（待确认 1 保守）
    path.join(pluginRoot, 'README.en.md'), // 点号命名不豁免
  ];
  for (const file_path of targets) {
    const r = await run('file', { file_path }, tmpNoLock);
    assert.equal(r.code, 2, `根下非豁免文件应拦截（${file_path}）`);
  }
  const variant = await runGuard(fakeGuard, 'file', { file_path: path.join(fakePlugin, 'GLOSSARY_en.md') }, tmpNoLock);
  assert.equal(variant.code, 2, `自定义文档语言变体（GLOSSARY_en.md）应拦截`);
});

t('X2 无锁：目录内同名文件与清单外自定义文档不获豁免仍拦', async () => {
  const targets = [
    path.join(fakePlugin, 'skills', 'x', 'CHANGELOG.md'),
    path.join(fakePlugin, 'scripts', 'AGENTS.md'),
    path.join(fakePlugin, 'NOTES.md'), // 清单外自定义文档名
  ];
  for (const file_path of targets) {
    const r = await runGuard(fakeGuard, 'file', { file_path }, tmpNoLock);
    assert.equal(r.code, 2, `不应豁免（${file_path}）`);
  }
  // 对照：docs/ 历史豁免不受影响
  const docs = await runGuard(fakeGuard, 'file', { file_path: path.join(fakePlugin, 'docs', 'AGENTS.md') }, tmpNoLock);
  assert.equal(docs.code, 0, `对照：docs/ 目录豁免保持：${docs.err}`);
});

t('X3 既有守卫规则回归不变', async () => {
  const tmpProj = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'atb-req001-x3-')));
  const board = path.join(tmpProj, 'agent-team-board');
  fs.mkdirSync(path.join(board, 'runtime', 'status'), { recursive: true });
  const sj = path.join(board, 'runtime', 'status', 'REQ-20260923-099.json');
  const w = await run('file', { file_path: sj }, tmpProj);
  assert.equal(w.code, 2, 'runtime/status 直写仍应拦截');
  const commands = [
    `echo '{}' > ${sj}`,
    `node ${pluginRoot}/scripts/atb.mjs status ${ID} accepted`,
    `node ${pluginRoot}/scripts/atb.mjs new req --title x --accept`,
    `node ${pluginRoot}/scripts/atb.mjs hold answer HOLD-1 yes`,
    `curl -s -X POST http://127.0.0.1:8888/api/item/REQ-1/status -d to=done`,
  ];
  for (const command of commands) {
    const r = await run('bash', { command }, tmpProj);
    assert.equal(r.code, 2, `人工专属/状态保护应保持拦截（${command}）`);
  }
  // 无锁改源码仍拦（file / bash 两模式）
  const src = await run('file', { file_path: path.join(pluginRoot, 'scripts', 'web', 'app.js') }, tmpNoLock);
  assert.equal(src.code, 2, '无锁 Write 受保护源码应拦截');
  const srcBash = await run('bash', { command: `echo x > ${pluginRoot}/scripts/web/app.js` }, tmpNoLock);
  assert.equal(srcBash.code, 2, '无锁 Bash 改受保护源码应拦截');
});

// ---------- C 系列：提交豁免（看板项目内） ----------

t('C1 无锁：仅含豁免发布文档、主题合规的 git commit 放行', async () => {
  const commands = [
    `git commit -m "doc: 更新 ${ID}" CHANGELOG.md`,
    `git commit -m "doc: 更新 ${ID}" AGENTS.md FEATURES.md README.md`,
    `git -C ${fakePlugin} commit -m "doc: 更新 ${ID}" GLOSSARY.md`,
    `git commit --message="doc: 更新 ${ID}" CHANGELOG.md`,
    `git commit -m "doc: 更新 ${ID}" -m "补充细节" AGENTS.md`,
  ];
  for (const command of commands) {
    const r = await runGuard(fakeGuard, 'bash', { command }, fakePlugin);
    assert.equal(r.code, 0, `豁免文档提交应放行（${command}）：${r.err}`);
  }
  // 真实插件根（本仓库）同样放行（标准文档为常量豁免，不依赖看板数据）
  const real = await run('bash', { command: `git commit -m "doc: 更新 ${ID}" CHANGELOG.md AGENTS.md` }, pluginRoot);
  assert.equal(real.code, 0, `真实插件根提交应放行：${real.err}`);
});

t('C2 提交拦截不回退：混入非豁免 / 裸提交 / -a / --amend / 主题不合规 / 清单外文档均拦', async () => {
  const commands = [
    `git commit -m "doc: x ${ID}" CHANGELOG.md scripts/state-guard.mjs`,
    `git commit -m "doc: x ${ID}" README.md LICENSE.md`,
    `git commit -m "doc: x ${ID}" NOTES.md`,
    `git commit -m "doc: x ${ID}" GLOSSARY_en.md`,
    `git commit -m "doc: x ${ID}"`,
    `git add CHANGELOG.md; git commit -m "doc: 裸提交 ${ID}"`,
    `git commit -a -m "doc: 全量 ${ID}" CHANGELOG.md`,
    `git commit --amend -m "doc: 改写 ${ID}" CHANGELOG.md`,
    `git commit -m "更新说明 ${ID}" CHANGELOG.md`,
    `git commit CHANGELOG.md`,
  ];
  for (const command of commands) {
    const r = await runGuard(fakeGuard, 'bash', { command }, fakePlugin);
    assert.equal(r.code, 2, `非豁免提交形态应拦截（${command}）`);
    assert.match(r.err, /git commit|提交|流程外/, `拦截提示应指向既有提交通道：${r.err}`);
  }
});

t('C3 回归：条目目录用户数据通道与根 README.md 通道不变', async () => {
  const itemDoc = `agent-team-board/data/requirements/${ID}/README.md`;
  const ok = await run('bash', { command: `git commit -m "doc: 讨论轮更新 ${ID}" ${itemDoc}` }, pluginRoot);
  assert.equal(ok.code, 0, `条目文档提交应保持放行：${ok.err}`);
  const readme = await run('bash', { command: `git commit -m "doc: 更新说明 REQ-20260918-002" README.md` }, pluginRoot);
  assert.equal(readme.code, 0, `根 README.md 提交通道应保持放行：${readme.err}`);
  const noId = await run('bash', { command: `git commit -m "doc: 无单号" ${itemDoc}` }, pluginRoot);
  assert.equal(noId.code, 2, '条目文档提交无单号仍应拦截');
});

// ---------- L1 有锁路径回归 ----------

t('L1 有效认领锁：原放行行为不变（豁免不引入新拒绝路径）', async () => {
  const tmpProj = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'atb-req001-lock-')));
  const locks = path.join(tmpProj, 'agent-team-board', 'runtime', '.locks');
  fs.mkdirSync(locks, { recursive: true });
  fs.writeFileSync(path.join(locks, 'REQ-TEST-011.lock'), JSON.stringify({ owner: 't', at: new Date().toISOString() }));
  const w = await run('file', { file_path: path.join(pluginRoot, 'scripts', 'web', 'app.js') }, tmpProj);
  assert.equal(w.code, 0, `有锁 Write 源码应放行：${w.err}`);
  const b = await run('bash', { command: `echo x > ${pluginRoot}/scripts/l1.tmp` }, tmpProj);
  assert.equal(b.code, 0, `有锁 Bash 改源码应放行：${b.err}`);
  const md = await run('file', { file_path: path.join(pluginRoot, 'AGENTS.md') }, tmpProj);
  assert.equal(md.code, 0, `有锁 Write 根 AGENTS.md 应放行：${md.err}`);
});

// ---------- E1 端到端：fake-plugin 伪 git 仓库真实落库 ----------

t('E1 端到端：豁免文档提交守卫放行、真实落库且不夹带 staged 源码', async () => {
  const git = (args) => spawnSync('git', ['-c', 'user.email=t@example.com', '-c', 'user.name=t', ...args], {
    cwd: fakePlugin, encoding: 'utf8', timeout: 30_000,
  });
  // GLOSSARY.md 先于基线提交创建（pathspec 提交只覆盖已跟踪文件的改动）
  fs.writeFileSync(path.join(fakePlugin, 'GLOSSARY.md'), '# g\n');
  git(['init', '-q', '-b', 'main']);
  git(['add', '.']);
  git(['commit', '-q', '-m', 'chore: 基线']);
  fs.appendFileSync(path.join(fakePlugin, 'CHANGELOG.md'), '\n更新一段\n');
  fs.appendFileSync(path.join(fakePlugin, 'GLOSSARY.md'), '\n术语一段\n');
  const command = `git commit -m "doc: 更新说明 ${ID}" CHANGELOG.md GLOSSARY.md`;
  const g = await runGuard(fakeGuard, 'bash', { command }, fakePlugin);
  assert.equal(g.code, 0, `豁免文档提交应放行：${g.err}`);
  const real = git(['commit', '-m', `doc: 更新说明 ${ID}`, 'CHANGELOG.md', 'GLOSSARY.md']);
  assert.equal(real.status, 0, `真实提交应成功：${real.stderr}`);
  const files = git(['diff-tree', '--no-commit-id', '--name-only', '-r', 'HEAD']).stdout.split('\n').filter(Boolean);
  assert.deepEqual(files.sort(), ['CHANGELOG.md', 'GLOSSARY.md'], `pathspec 提交应只含豁免文档：${JSON.stringify(files)}`);
  // 预先 git add 源码再提交豁免文档：pathspec 限定下不夹带（git --only 语义）
  fs.appendFileSync(path.join(fakePlugin, 'scripts', 'lib', 'commit-store.mjs'), '\n// touch\n');
  git(['add', 'scripts/lib/commit-store.mjs']);
  fs.appendFileSync(path.join(fakePlugin, 'CHANGELOG.md'), '\n再更新一段\n');
  fs.appendFileSync(path.join(fakePlugin, 'GLOSSARY.md'), '\n再术语一段\n');
  const g2 = await runGuard(fakeGuard, 'bash', { command }, fakePlugin);
  assert.equal(g2.code, 0, `add 源码后豁免文档 pathspec 提交应放行：${g2.err}`);
  const real2 = git(['commit', '-m', `doc: 更新说明 ${ID}`, 'CHANGELOG.md', 'GLOSSARY.md']);
  assert.equal(real2.status, 0, `第二次真实提交应成功：${real2.stderr}`);
  const files2 = git(['diff-tree', '--no-commit-id', '--name-only', '-r', 'HEAD']).stdout.split('\n').filter(Boolean);
  assert.deepEqual(files2.sort(), ['CHANGELOG.md', 'GLOSSARY.md'], `pathspec 提交不应夹带 staged 源码：${JSON.stringify(files2)}`);
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
