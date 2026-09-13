#!/usr/bin/env node
// REQ-20260913-001 构建模块（版本管理）—— 数据层测试 B1~B8。
// 覆盖：编号/默认名、校验、条目增删锁、信息编辑、合并状态机、列表读取、重启恢复、逐条目合并结果。
// 用法：node scripts/tests/build-store.test.mjs

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as core from '../lib/core.mjs';
import * as buildStore from '../lib/build-store.mjs';

const cases = [];
const t = (name, fn) => cases.push([name, fn]);

const H1 = 'a'.repeat(40);
const H2 = 'b'.repeat(40);

function mkData() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'atb-build-store-'));
  core.initData(tmp);
  return tmp;
}

const itemOf = (id, commit, title = `标题 ${id}`) => ({ itemId: id, commit, title });

t('B1 创建版本：编号 BLD-YYYYMMDD-NNN 递增；默认名称「版本 YYYYMMDD-HHMM」；draft 落盘', () => {
  const dataDir = core.dataDirFrom(mkData());
  const v1 = buildStore.createVersion(dataDir, { items: [itemOf('REQ-20260913-001', H1)] });
  assert.match(v1.id, /^BLD-\d{8}-\d{3}$/, '编号形态 BLD-YYYYMMDD-NNN');
  assert.match(v1.name, /^版本 \d{8}-\d{4}$/, '默认名称「版本 YYYYMMDD-HHMM」');
  assert.equal(v1.status, 'draft');
  assert.equal(v1.targetBranch, 'main');
  assert.deepEqual(v1.items.map((i) => [i.itemId, i.commit]), [['REQ-20260913-001', H1]]);
  const v2 = buildStore.createVersion(dataDir, { name: '自定义名', items: [itemOf('BUG-20260913-002', H2)] });
  assert.equal(v2.name, '自定义名');
  assert.notEqual(v2.id, v1.id, '同日编号递增不重复');
  const raw = JSON.parse(fs.readFileSync(path.join(dataDir, 'builds', 'versions', v1.id, 'version.json'), 'utf8'));
  assert.equal(raw.id, v1.id);
});

t('B2 校验：空条目 / 条目重复 / commit 缺失或非法 / 名称超长 → AtbError', () => {
  const dataDir = core.dataDirFrom(mkData());
  assert.throws(() => buildStore.createVersion(dataDir, { items: [] }), core.AtbError);
  assert.throws(() => buildStore.createVersion(dataDir, { items: [itemOf('REQ-20260913-001', H1), itemOf('REQ-20260913-001', H2)] }), core.AtbError);
  assert.throws(() => buildStore.createVersion(dataDir, { items: [{ itemId: 'REQ-20260913-001' }] }), core.AtbError);
  assert.throws(() => buildStore.createVersion(dataDir, { items: [itemOf('REQ-20260913-001', 'zzz')] }), core.AtbError);
  assert.throws(() => buildStore.createVersion(dataDir, { name: 'x'.repeat(81), items: [itemOf('REQ-20260913-001', H1)] }), core.AtbError);
});

t('B3 条目增删：add 追加（重复拒绝）、remove 移除；merging/merged 锁增删；其余条目 commit 不受影响', () => {
  const dataDir = core.dataDirFrom(mkData());
  const v = buildStore.createVersion(dataDir, { items: [itemOf('REQ-20260913-001', H1), itemOf('BUG-20260913-002', H2)] });
  let out = buildStore.addItems(dataDir, v.id, [itemOf('REQ-20260913-003', 'c'.repeat(40))]);
  assert.equal(out.items.length, 3);
  assert.throws(() => buildStore.addItems(dataDir, v.id, [itemOf('REQ-20260913-001', H1)]), core.AtbError, '重复添加拒绝');
  out = buildStore.removeItems(dataDir, v.id, ['BUG-20260913-002']);
  assert.equal(out.items.length, 2);
  assert.deepEqual(out.items.map((i) => i.itemId), ['REQ-20260913-001', 'REQ-20260913-003']);
  assert.equal(out.items.find((i) => i.itemId === 'REQ-20260913-001').commit, H1, '移出不破坏其余条目 commit');
  // merged 锁增删
  buildStore.beginMerge(dataDir, v.id, { baseBranch: 'dev' });
  buildStore.finishMerge(dataDir, v.id, { results: out.items.map((i) => ({ itemId: i.itemId, ok: true })) });
  assert.throws(() => buildStore.addItems(dataDir, v.id, [itemOf('BUG-20260913-009', H2)]), core.AtbError, '已合并锁定增删');
  assert.throws(() => buildStore.removeItems(dataDir, v.id, ['REQ-20260913-001']), core.AtbError, '已合并锁定移出');
});

t('B4 名称描述编辑：draft/failed/merged 可改；merging 拒绝；编辑不破坏条目与 commit 关联', () => {
  const dataDir = core.dataDirFrom(mkData());
  const v = buildStore.createVersion(dataDir, { items: [itemOf('REQ-20260913-001', H1)] });
  let out = buildStore.saveInfo(dataDir, v.id, { name: 'v1.0', description: '首个版本' });
  assert.equal(out.name, 'v1.0');
  assert.equal(out.description, '首个版本');
  assert.equal(out.items[0].commit, H1, '编辑不破坏 commit 关联');
  buildStore.beginMerge(dataDir, v.id, { baseBranch: 'dev' });
  assert.throws(() => buildStore.saveInfo(dataDir, v.id, { name: 'x', description: '' }), core.AtbError, '合并中禁止编辑');
  buildStore.finishMerge(dataDir, v.id, { results: [{ itemId: 'REQ-20260913-001', ok: true }] });
  out = buildStore.saveInfo(dataDir, v.id, { name: 'v1.0-最终', description: '已合并仍可改信息' });
  assert.equal(out.name, 'v1.0-最终');
});

t('B5 合并状态机：draft→merging→merged/failed；failed→merging 重试；非法流转拒绝', () => {
  const dataDir = core.dataDirFrom(mkData());
  const v = buildStore.createVersion(dataDir, { items: [itemOf('REQ-20260913-001', H1)] });
  let m = buildStore.beginMerge(dataDir, v.id, { baseBranch: 'dev' });
  assert.equal(m.status, 'merging');
  assert.equal(m.merge.baseBranch, 'dev');
  assert.throws(() => buildStore.beginMerge(dataDir, v.id, { baseBranch: 'dev' }), core.AtbError, 'merging 不可再 begin');
  m = buildStore.finishMerge(dataDir, v.id, { results: [{ itemId: 'REQ-20260913-001', ok: true }] });
  assert.equal(m.status, 'merged');
  assert.throws(() => buildStore.beginMerge(dataDir, v.id, { baseBranch: 'dev' }), core.AtbError, 'merged 不可重试');
  // failed → merging → failed
  const v2 = buildStore.createVersion(dataDir, { items: [itemOf('BUG-20260913-002', H2)] });
  buildStore.beginMerge(dataDir, v2.id, { baseBranch: 'dev' });
  const f = buildStore.finishMerge(dataDir, v2.id, { results: [{ itemId: 'BUG-20260913-002', ok: false, error: 'conflict' }] });
  assert.equal(f.status, 'failed');
  const r = buildStore.beginMerge(dataDir, v2.id, { baseBranch: 'dev' });
  assert.equal(r.status, 'merging', 'failed 可重试回 merging');
});

t('B6 列表与读取：listVersions 按创建倒序；readVersion 未知 id 报错', () => {
  const dataDir = core.dataDirFrom(mkData());
  const a = buildStore.createVersion(dataDir, { items: [itemOf('REQ-20260913-001', H1)] });
  const b = buildStore.createVersion(dataDir, { items: [itemOf('REQ-20260913-002', H2)] });
  const list = buildStore.listVersions(dataDir);
  assert.deepEqual(list.map((v) => v.id), [b.id, a.id], '创建倒序');
  assert.throws(() => buildStore.readVersion(dataDir, 'BLD-19990101-999'), core.AtbError);
});

t('B7 服务重启恢复：merging 版本标记 failed（不自动重跑）', () => {
  const dataDir = core.dataDirFrom(mkData());
  const v = buildStore.createVersion(dataDir, { items: [itemOf('REQ-20260913-001', H1)] });
  buildStore.beginMerge(dataDir, v.id, { baseBranch: 'dev' });
  const n = buildStore.recoverMerging(dataDir);
  assert.equal(n, 1);
  const after = buildStore.readVersion(dataDir, v.id);
  assert.equal(after.status, 'failed');
  assert.match(after.merge.error || '', /重启|中断/);
  assert.equal(buildStore.recoverMerging(dataDir), 0, '已恢复的不再重复处理');
});

t('B8 合并结果逐条目落 mergedAt / mergeError', () => {
  const dataDir = core.dataDirFrom(mkData());
  const v = buildStore.createVersion(dataDir, { items: [itemOf('REQ-20260913-001', H1), itemOf('BUG-20260913-002', H2)] });
  buildStore.beginMerge(dataDir, v.id, { baseBranch: 'dev' });
  const out = buildStore.finishMerge(dataDir, v.id, {
    results: [
      { itemId: 'REQ-20260913-001', ok: true },
      { itemId: 'BUG-20260913-002', ok: false, error: 'merge conflict' },
    ],
  });
  assert.equal(out.status, 'failed', '任一失败版本置 failed');
  const okItem = out.items.find((i) => i.itemId === 'REQ-20260913-001');
  const badItem = out.items.find((i) => i.itemId === 'BUG-20260913-002');
  assert.ok(okItem.mergedAt, '成功条目落 mergedAt');
  assert.equal(badItem.mergedAt, null);
  assert.equal(badItem.mergeError, 'merge conflict');
});

let failed = 0;
for (const [name, fn] of cases) {
  try { await fn(); console.log(`✓ ${name}`); }
  catch (e) { failed++; console.error(`✗ ${name}\n${e.stack}`); }
}
console.log(`\n${cases.length} 个用例，失败 ${failed}`);
process.exitCode = failed ? 1 : 0;
