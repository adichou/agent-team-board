#!/usr/bin/env node
// BUG-20260921-018 隔离分析误判已在 main 的共享提交为混合提交，合并被误阻断。
// 根因：analyzePublishIsolation 的 shared 计算不区分提交是否已在目标分支上——执行侧
// mergeIsolatedIntoMain 对已是目标分支祖先的提交幂等记成功（alreadyIncluded），分析侧却把
// 「基线大提交主题列多个单号 → 多条目共享同一 hash」一律判混合并 blocked，与执行语义
// 自相矛盾，把必然幂等成功的合并整体挡住（BLD-20260920-001 被基线提交 6f2ead6009aa 误伤）。
// 修复：共享 hash 若 isAncestorOf(root, commit, targetBranch)（与执行侧同一判定函数同一
// 口径），不列入 blocked，降级为 exempted + notes 豁免提示（不静默）；不在目标分支上的
// 共享 hash 维持 blocked 与既有文案（重放按（条目 × 提交）展开不跨条目去重，会双重
// cherry-pick 失败，前置阻断优于执行中途失败）。
// 本文件回归：
// B1 已在 main 的共享提交：豁免混合判定（blocked 空、exempted/shared 如实记录、notes
//     提示豁免），且不产生未选祖先（依赖分析不受影响）；
// B2 分析口径与执行语义一致：同一输入隔离合并不被挡——已在 main 的共享提交
//     alreadyIncluded 幂等成功，混入未在 main 的正常提交仍重放成功；
// B3 不在 main 的共享提交仍阻断：blocked 文案不变、exempted 空；
// B4 前端与 i18n 契约：合并页豁免单行提示（bld-iso-note、非 alert）+ title 明细，
//     EN_DYNAMIC 双语词条同步且中英往返不变形。
// 用法：node scripts/tests/bug-20260921-018.test.mjs

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as buildGit from '../lib/build-git.mjs';
import '../web/i18n.js';

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const GIT_ENV = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' };

function git(cwd, args) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', env: GIT_ENV, timeout: 20000 });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} 失败：${r.stderr || r.stdout}`);
  return r.stdout.trim();
}
function tmpdir(prefix) {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
}
function mkRepo(dir) {
  fs.mkdirSync(dir, { recursive: true });
  git(dir, ['init', '-b', 'main']);
  git(dir, ['config', 'user.email', 't@e.co']);
  git(dir, ['config', 'user.name', 'T']);
  return dir;
}

const cases = [];
const t = (name, fn) => cases.push([name, fn]);

// 场景构造：main 上 init + 基线大提交（主题列两个单号，已在目标分支）；dev 上再落一个
// 正常提交（未在 main）。返回 { dir, shared, devC } 供各用例复用同构场景。
function setupExemptScene() {
  const dir = mkRepo(tmpdir('atb-b18-exempt-'));
  fs.writeFileSync(path.join(dir, 'base.txt'), 'base');
  git(dir, ['add', '-A']); git(dir, ['commit', '-m', 'init']);
  fs.writeFileSync(path.join(dir, 'shared.txt'), 's');
  git(dir, ['add', '-A']); git(dir, ['commit', '-m', 'feat: 基线 REQ-20260921-001 REQ-20260921-002']);
  const shared = git(dir, ['rev-parse', 'HEAD']);
  git(dir, ['switch', '-c', 'dev']);
  fs.writeFileSync(path.join(dir, 'dev.txt'), 'd');
  git(dir, ['add', '-A']); git(dir, ['commit', '-m', 'feat: C REQ-20260921-003']);
  const devC = git(dir, ['rev-parse', 'HEAD']);
  return { dir, shared, devC };
}

t('B1 已在 main 的共享提交：豁免混合判定（blocked 空 / exempted+notes 如实提示），不产生未选祖先', () => {
  const { dir, shared } = setupExemptScene();
  const items = [
    { itemId: 'REQ-20260921-001', commit: shared },
    { itemId: 'REQ-20260921-002', commit: shared },
  ];
  assert.equal(buildGit.isAncestorOf(dir, shared, 'main'), true, '前置：共享提交确实已在 main');
  const an = buildGit.analyzePublishIsolation(dir, items);
  assert.equal(an.blocked.length, 0, '已在 main 的共享提交不得列入 blocked（合并不被误阻断）');
  assert.equal(an.shared.length, 1, 'shared 仍如实记录共享 hash');
  assert.equal(an.shared[0].commit, shared);
  assert.equal(an.exempted.length, 1, '豁免明细单独记录');
  assert.equal(an.exempted[0].commit, shared);
  assert.equal(an.exempted[0].itemIds.length, 2, '豁免明细含关联条目');
  assert.ok(
    an.notes.some((n) => /豁免/.test(n) && n.includes('main')),
    `notes 应给出豁免提示（不静默）：${JSON.stringify(an.notes)}`,
  );
  for (const per of an.perItem) {
    assert.equal(per.count, 0, `已在 main 的提交不产生未选祖先（${per.itemId}）`);
  }
});

t('B2 豁免与执行口径一致：同一输入隔离合并不被挡——共享提交 alreadyIncluded 幂等成功，未在 main 的提交仍重放', () => {
  const { dir, shared, devC } = setupExemptScene();
  const items = [
    { itemId: 'REQ-20260921-001', commit: shared },
    { itemId: 'REQ-20260921-002', commit: shared },
    { itemId: 'REQ-20260921-003', commit: devC },
  ];
  const an = buildGit.analyzePublishIsolation(dir, items);
  assert.equal(an.blocked.length, 0, '分析不阻断（否则执行无法进行）');
  const r = buildGit.mergeIsolatedIntoMain(dir, { versionId: 'BLD-20260921-018', versionName: '测试', items });
  assert.equal(r.results.length, 3, '（条目 × 提交）逐行展开');
  const sharedRows = r.results.filter((x) => x.commit === shared);
  assert.equal(sharedRows.length, 2, '两条目共享同一 hash 各记一行');
  assert.ok(sharedRows.every((x) => x.ok && x.alreadyIncluded), '已在 main 的共享提交幂等记成功');
  const cRow = r.results.find((x) => x.commit === devC);
  assert.ok(cRow.ok, `未在 main 的提交应重放成功：${cRow.error || ''}`);
  assert.equal(git(dir, ['show', 'main:dev.txt']).trim(), 'd', '重放后 main 含 C 的变更');
  assert.equal(git(dir, ['branch', '--show-current']), 'dev', '当前目录仍在 dev');
});

t('B3 不在 main 的共享提交仍阻断：blocked 文案不变、exempted 空', () => {
  const dir = mkRepo(tmpdir('atb-b18-block-'));
  fs.writeFileSync(path.join(dir, 'x.txt'), 'x');
  git(dir, ['add', '-A']); git(dir, ['commit', '-m', 'init']);
  git(dir, ['switch', '-c', 'dev']);
  fs.writeFileSync(path.join(dir, 'y.txt'), 'y');
  git(dir, ['add', '-A']); git(dir, ['commit', '-m', 'feat: A+B REQ-20260921-001 REQ-20260921-002']);
  const c = git(dir, ['rev-parse', 'HEAD']);
  const an = buildGit.analyzePublishIsolation(dir, [
    { itemId: 'REQ-20260921-001', commit: c },
    { itemId: 'REQ-20260921-002', commit: c },
  ]);
  assert.ok(an.blocked.length >= 1 && /混|同一提交/.test(an.blocked[0]), '不在 main 的共享提交仍阻断并解释');
  assert.equal(an.exempted.length, 0, '不在 main 的共享提交不豁免');
});

t('B4 前端与 i18n 契约：豁免单行提示（非 alert）+ title 明细；EN_DYNAMIC 双语同步且往返不变形', () => {
  const buildJs = fs.readFileSync(path.join(pluginRoot, 'scripts', 'web', 'build.js'), 'utf8');
  assert.ok(buildJs.includes('an.exempted'), '合并页应读取 mergeAnalysis.exempted');
  const m = buildJs.match(/const exemptLine[\s\S]{0,600}?:\s*'';/);
  assert.ok(m, '合并页应定义豁免单行提示（exemptLine）');
  assert.ok(m[0].includes('bld-iso-note'), '豁免行沿用单行状态条样式');
  assert.ok(!m[0].includes('role="alert"'), '豁免是提示不是阻断，不得用 alert 语义');
  assert.ok(m[0].includes('itemIds'), 'title 应含关联条目明细');
  const I = globalThis.ATBI18N;
  const { EN_DYNAMIC } = I._dict;
  const zhKey = '已豁免 ◇ 处共享提交的混合判定（提交已在 ◇ 上，合并时幂等记成功）';
  assert.ok(zhKey in EN_DYNAMIC, 'EN_DYNAMIC 应含豁免单行词条');
  // en 翻译：计数与分支名双插值；再切回 zh 往返还原（不变形）
  const zhText = '已豁免 2 处共享提交的混合判定（提交已在 master 上，合并时幂等记成功）';
  I.setLang('en');
  const enText = I.t(zhText);
  assert.notEqual(enText, zhText, 'en 界面应翻译豁免行');
  assert.ok(enText.includes('2') && enText.includes('master'), `插值应保留（实际：${enText}）`);
  I.setLang('zh');
  assert.equal(I.t(enText), zhText, '切回中文往返还原');
});

for (const [name, fn] of cases) {
  fn();
  console.log(`✓ ${name}`);
}
console.log(`\n共 ${cases.length} 例，全部通过`);
