// 无提交的存量条目可纳入版本，保留严格的提交形态校验。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import * as core from '../lib/core.mjs';
import * as store from '../lib/build-store.mjs';
import { buildDocSummaryPrompt } from '../lib/publish-flow.mjs';
import { assertItemsIncluded } from '../lib/build-publish.mjs';
import { mergeIsolatedIntoMain } from '../lib/build-git.mjs';
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atb-empty-commits-'));
try {
  core.initData(root);
  const data = core.dataDirFrom(root);
  const v = store.createVersion(data, { items: [{ itemId: 'REQ-20260929-101', commits: [] }] });
  assert.deepEqual(v.items[0].commits, [], '空数组应成功落盘');
  const disk = JSON.parse(fs.readFileSync(path.join(data, 'runtime', 'builds', 'versions', v.id, 'version.json'), 'utf8'));
  assert.deepEqual(disk.items[0].commits, [], '落盘保留空数组');
  assert.equal('commit' in disk.items[0], false, '无首个提交时省略旧别名');
  const added = store.addItems(data, v.id, [{ itemId: 'BUG-20260929-102' }]);
  assert.deepEqual(added.items[1].commits, [], '省略提交应归一为空数组');
  for (const commits of [['bad'], [''], [null], 'bad']) {
    assert.throws(() => store.createVersion(data, { items: [{ itemId: 'REQ-20260929-103', commits }] }), /40 位/, '非法提交形态仍拒绝');
  }
  const legacy = store.createVersion(data, { items: [{ itemId: 'REQ-20260929-104', commit: 'a'.repeat(40) }] });
  assert.deepEqual(legacy.items[0].commits, ['a'.repeat(40)], '旧单提交兼容');
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git('init', '-b', 'main');
  git('config', 'user.name', '测试'); git('config', 'user.email', 'test@example.com');
  git('commit', '--allow-empty', '-m', '初始化');
  git('branch', '-f', 'main', 'HEAD');
  git('checkout', 'dev');
  const before = git('rev-parse', 'main');
  await assertItemsIncluded(root, added.items, before);
  const prompt = buildDocSummaryPrompt({ projectRoot: root, planId: v.id, items: added.items });
  assert.match(prompt, /REQ-20260929-101/, '发布文档保留无提交需求');
  assert.match(prompt, /修复了 1 个 bug/, '发布文档计入无提交缺陷');
  const merged = mergeIsolatedIntoMain(root, { items: added.items });
  assert.deepEqual(merged.results, [], '空提交条目不产生重放动作');
  assert.equal(git('rev-parse', 'main'), before, '无提交版本不改变主分支');
  store.beginMerge(data, v.id, { baseBranch: 'dev' });
  assert.equal(store.finishMerge(data, v.id, { results: merged.results }).status, 'merged', '无提交条目完成合并步骤');
  console.log('✓ 空提交创建、追加、非法提交、旧字段兼容与真实 Git 合并通过');
} finally { fs.rmSync(root, { recursive: true, force: true }); }
