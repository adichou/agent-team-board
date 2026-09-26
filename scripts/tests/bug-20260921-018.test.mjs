#!/usr/bin/env node
// BUG-20260921-018 隔离分析误判已在 main 的共享提交为混合提交，合并被误阻断。
// 根因与修复历史：analyzePublishIsolation 的 shared 计算不区分提交是否已在目标分支上，
// 执行侧幂等成功而分析侧 blocked，自相矛盾。REQ-20260926-002 起条目与提交是多对多关系，
// 「混合提交阻断 / 豁免」机制整体移除：共享提交（无论是否已在目标分支）不再判混合、
// 不再阻断，shared 如实记录；执行侧 mergeIsolatedIntoMain 按提交 hash 去重只执行一次
//（已在 main 的提交幂等记成功，各关联条目展示一致结果），notes 说明该语义（不静默）。
// 本文件回归（按新口径改写）：
// B1 已在 main 的共享提交：不判混合（无 blocked / exempted 概念），shared 如实记录，
//     notes 说明只执行一次，且不产生未选祖先（依赖分析不受影响）；
// B2 分析口径与执行语义一致：同一输入隔离合并不被挡——共享提交按 hash 去重只执行一次
//     （已在 main 的 alreadyIncluded 幂等成功），未在 main 的正常提交仍重放；
// B3 不在 main 的共享提交：同样不阻断，shared 如实记录、notes 说明只执行一次；
// B4 前端与 i18n 契约：合并页共享提交单行说明（bld-iso-note、非 alert）+ title 明细，
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

t('B1 已在 main 的共享提交：不判混合（阻断机制已移除），shared 如实记录 + notes 说明只执行一次，不产生未选祖先', () => {
  const { dir, shared } = setupExemptScene();
  const items = [
    { itemId: 'REQ-20260921-001', commit: shared },
    { itemId: 'REQ-20260921-002', commit: shared },
  ];
  assert.equal(buildGit.isAncestorOf(dir, shared, 'main'), true, '前置：共享提交确实已在 main');
  const an = buildGit.analyzePublishIsolation(dir, items);
  assert.equal(an.blocked, undefined, '混合提交阻断随 REQ-20260926-002 移除（无 blocked 概念）');
  assert.equal(an.exempted, undefined, '豁免机制随阻断一并移除（共享提交一律不判混合）');
  assert.equal(an.shared.length, 1, 'shared 仍如实记录共享 hash');
  assert.equal(an.shared[0].commit, shared);
  assert.deepEqual(an.shared[0].itemIds.slice().sort(), ['REQ-20260921-001', 'REQ-20260921-002'], 'shared 含关联条目');
  assert.ok(
    an.notes.some((n) => /一次/.test(n) && /去重/.test(n)),
    `notes 应说明共享提交只执行一次（不静默）：${JSON.stringify(an.notes)}`,
  );
  for (const per of an.perItem) {
    assert.equal(per.count, 0, `已在 main 的提交不产生未选祖先（${per.itemId}）`);
  }
});

t('B2 分析口径与执行语义一致：同一输入隔离合并不被挡——共享提交按 hash 去重只执行一次（已在 main 幂等成功），未在 main 的提交仍重放', () => {
  const { dir, shared, devC } = setupExemptScene();
  const items = [
    { itemId: 'REQ-20260921-001', commit: shared },
    { itemId: 'REQ-20260921-002', commit: shared },
    { itemId: 'REQ-20260921-003', commit: devC },
  ];
  const an = buildGit.analyzePublishIsolation(dir, items);
  assert.equal(an.blocked, undefined, '分析不阻断（否则执行无法进行）');
  const before = Number(git(dir, ['rev-list', '--count', 'main']));
  const r = buildGit.mergeIsolatedIntoMain(dir, { versionId: 'BLD-20260921-018', versionName: '测试', items });
  assert.equal(r.results.length, 3, '（条目 × 提交）逐行展开');
  const sharedRows = r.results.filter((x) => x.commit === shared);
  assert.equal(sharedRows.length, 2, '两条目共享同一 hash 各记一行（结果一致）');
  assert.ok(sharedRows.every((x) => x.ok && x.alreadyIncluded), '已在 main 的共享提交幂等记成功');
  const cRow = r.results.find((x) => x.commit === devC);
  assert.ok(cRow.ok, `未在 main 的提交应重放成功：${cRow.error || ''}`);
  assert.equal(r.replays.length, 1, '重放证据只含未在 main 的那一个提交（共享提交不重放）');
  assert.equal(Number(git(dir, ['rev-list', '--count', 'main'])), before + 1, 'main 只新增一个重放提交');
  assert.equal(git(dir, ['show', 'main:dev.txt']).trim(), 'd', '重放后 main 含 C 的变更');
  assert.equal(git(dir, ['branch', '--show-current']), 'dev', '当前目录仍在 dev');
});

t('B3 不在 main 的共享提交：同样不阻断，按 hash 去重只执行一次', () => {
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
  assert.equal(an.blocked, undefined, '共享提交不再判混合（多对多关系不阻断组版）');
  assert.equal(an.shared.length, 1, 'shared 如实记录');
  assert.ok(an.notes.some((n) => /一次/.test(n)), 'notes 说明只执行一次');
  // 执行侧：只 cherry-pick 一次，两条目各记一致成功行
  const r = buildGit.mergeIsolatedIntoMain(dir, { versionId: 'BLD-20260921-018', versionName: '测试', items: an.shared.flatMap((s) => s.itemIds.map((itemId) => ({ itemId, commit: s.commit }))) });
  const okRows = r.results.filter((x) => x.ok);
  assert.deepEqual(okRows.map((x) => x.itemId).sort(), ['REQ-20260921-001', 'REQ-20260921-002'], '各关联条目均记成功');
  assert.equal(r.replays.length, 1, '共享提交只重放一次（一条重放证据）');
  assert.equal(Number(git(dir, ['rev-list', '--count', 'main'])), 2, 'main 只新增一个重放提交');
});

t('B4 前端与 i18n 契约：共享提交单行说明（非 alert）+ title 明细；EN_DYNAMIC 双语同步且往返不变形', () => {
  const buildJs = fs.readFileSync(path.join(pluginRoot, 'scripts', 'web', 'build.js'), 'utf8');
  assert.ok(buildJs.includes('an.shared'), '合并页应读取 mergeAnalysis.shared');
  const m = buildJs.match(/const sharedLine[\s\S]{0,600}?:\s*'';/);
  assert.ok(m, '合并页应定义共享提交单行说明（sharedLine）');
  assert.ok(m[0].includes('bld-iso-note'), '共享提交行沿用单行状态条样式');
  assert.ok(!m[0].includes('role="alert"'), '共享提交是说明不是阻断，不得用 alert 语义');
  assert.ok(m[0].includes('itemIds'), 'title 应含关联条目明细');
  assert.ok(!buildJs.includes('一键加入所有未选祖先提交') && !buildJs.includes('data-iso-add-deps'), '一键纳入引导随流程移除（REQ-20260926-002）');
  const I = globalThis.ATBI18N;
  const { EN_DYNAMIC } = I._dict;
  const zhKey = '共享提交 ◇ 处按提交 hash 去重，挑选合并只执行一次（各关联条目展示一致的合入结果）';
  assert.ok(zhKey in EN_DYNAMIC, 'EN_DYNAMIC 应含共享提交单行词条');
  // en 翻译：计数插值；再切回 zh 往返还原（不变形）
  const zhText = '共享提交 2 处按提交 hash 去重，挑选合并只执行一次（各关联条目展示一致的合入结果）';
  I.setLang('en');
  const enText = I.t(zhText);
  assert.notEqual(enText, zhText, 'en 界面应翻译共享提交说明行');
  assert.ok(enText.includes('2'), `插值应保留（实际：${enText}）`);
  I.setLang('zh');
  assert.equal(I.t(enText), zhText, '切回中文往返还原');
});

for (const [name, fn] of cases) {
  fn();
  console.log(`✓ ${name}`);
}
console.log(`\n共 ${cases.length} 例，全部通过`);
