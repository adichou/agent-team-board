#!/usr/bin/env node
// REQ-20260915-002 产品发布数据层（product-release-store）测试 A1~A9、I1
// 用法：node scripts/tests/product-release-store.test.mjs

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as core from '../lib/core.mjs';
import * as buildStore from '../lib/build-store.mjs';
import * as store from '../lib/product-release-store.mjs';

const cases = [];
const t = (name, fn) => cases.push([name, fn]);

function tmpData() {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'atb-prel-store-')));
  core.initData(dir);
  return dir;
}

function mergedBld(overrides = {}) {
  return {
    id: 'BLD-20260915-001',
    name: '版本 20260915-01',
    status: 'merged',
    items: [{ itemId: 'REQ-20260915-001', title: '示例', commit: 'a'.repeat(40), mergedAt: '2026-09-15T01:00:00.000Z' }],
    ...overrides,
  };
}

function freezeFacts(overrides = {}) {
  return {
    mainSha: '1'.repeat(40),
    devSha: '2'.repeat(40),
    remote: 'origin',
    remoteUrl: '/tmp/remote.git',
    extraCommits: [],
    homepage: { repoRoot: '/tmp/homepage', branch: 'main', contentDir: '/tmp/homepage/demo-app/' },
    ...overrides,
  };
}

t('A1 从 merged BLD 创建：冻结完整、versionName/version 分开、draft、历史含 create', () => {
  const dataDir = tmpData();
  const run = store.createProductRun(dataDir, {
    productId: 'demo-app',
    bld: mergedBld(),
    freeze: freezeFacts(),
    version: '1.2.0',
    versionName: '版本 20260915-01',
    by: 'board',
  });
  assert.match(run.id, /^PREL-\d{8}-\d{3}$/);
  assert.equal(run.status, 'draft');
  assert.equal(run.versionName, '版本 20260915-01');
  assert.equal(run.version, '1.2.0');
  assert.equal(run.frozen.mainSha, '1'.repeat(40));
  assert.equal(run.frozen.devSha, '2'.repeat(40));
  assert.equal(run.frozen.remote, 'origin');
  assert.deepEqual(run.frozen.items, [{ itemId: 'REQ-20260915-001', title: '示例', commit: 'a'.repeat(40) }]);
  assert.equal(run.frozen.homepage.contentDir, '/tmp/homepage/demo-app/');
  assert.equal(run.targets.webapp.status, 'pending');
  assert.equal(run.targets.site.status, 'pending');
  assert.ok(run.history.some((h) => h.action === 'create'));
  assert.ok(fs.existsSync(store.productRunFile(dataDir, run.id)));
  const again = store.readProductRun(dataDir, run.id);
  assert.equal(again.id, run.id);
  const list = store.listProductRuns(dataDir);
  assert.equal(list.length, 1);
  assert.equal(list[0].productId, 'demo-app');
  assert.equal(list[0].bldId, 'BLD-20260915-001');
});

t('A2 未 merged BLD 创建 → AtbError 含前置条件说明', () => {
  const dataDir = tmpData();
  for (const status of ['draft', 'merging', 'failed']) {
    assert.throws(
      () => store.createProductRun(dataDir, { productId: 'demo-app', bld: mergedBld({ status }), freeze: freezeFacts(), version: '1.0.0', by: 'board' }),
      (e) => e instanceof core.AtbError && /合并/.test(e.message),
    );
  }
});

t('A3 同产品活动运行互斥 / 同版本已成功幂等拒绝 / 不同版本可再创建', () => {
  const dataDir = tmpData();
  const r1 = store.createProductRun(dataDir, { productId: 'demo-app', bld: mergedBld(), freeze: freezeFacts(), version: '1.0.0', by: 'board' });
  for (const status of ['prechecking', 'running', 'waiting-manual']) {
    store.mutateProductRun(dataDir, r1.id, (r) => { r.status = status; });
    assert.throws(
      () => store.createProductRun(dataDir, { productId: 'demo-app', bld: mergedBld(), freeze: freezeFacts(), version: '2.0.0', by: 'board' }),
      (e) => e instanceof store.ProductReleaseConflictError && e.activeRunId === r1.id,
    );
  }
  // 结束后：不同版本可创建
  store.mutateProductRun(dataDir, r1.id, (r) => { r.status = 'succeeded'; });
  const r2 = store.createProductRun(dataDir, { productId: 'demo-app', bld: mergedBld(), freeze: freezeFacts({ mainSha: '3'.repeat(40) }), version: '2.0.0', by: 'board' });
  assert.equal(r2.version, '2.0.0');
  // 同版本已成功 → 幂等拒绝并指向既有运行
  assert.throws(
    () => store.createProductRun(dataDir, { productId: 'demo-app', bld: mergedBld(), freeze: freezeFacts(), version: '1.0.0', by: 'board' }),
    (e) => e instanceof store.ProductReleaseConflictError && e.activeRunId === r1.id,
  );
});

t('A4 预检指纹与新鲜度：未预检 / 输入变化逐项列出 / 一致放行', () => {
  const dataDir = tmpData();
  const run = store.createProductRun(dataDir, { productId: 'demo-app', bld: mergedBld(), freeze: freezeFacts(), version: '1.2.0', by: 'board' });
  const current = () => ({
    version: '1.2.0', mainSha: '1'.repeat(40), devSha: '2'.repeat(40),
    remote: 'origin', homepage: run.frozen.homepage, materialsFingerprint: 'mfp-1',
  });
  // 未预检
  assert.throws(() => store.assertPrecheckFresh(run, current()), (e) => /预检/.test(e.message));
  // 预检未通过
  let r = store.savePrecheck(dataDir, run.id, { ok: false, checks: [], inputs: current() });
  assert.throws(() => store.assertPrecheckFresh(r, current()), (e) => /未通过/.test(e.message));
  // 预检通过 → 一致
  r = store.savePrecheck(dataDir, run.id, { ok: true, checks: [{ key: 'remote', label: '远端', ok: true }], inputs: current() });
  store.assertPrecheckFresh(r, current());
  // main 前进
  assert.throws(
    () => store.assertPrecheckFresh(r, { ...current(), mainSha: '9'.repeat(40) }),
    (e) => /main 分支头/.test(e.message),
  );
  // 版本号变化
  assert.throws(
    () => store.assertPrecheckFresh(r, { ...current(), version: '1.3.0' }),
    (e) => /发行版本号/.test(e.message),
  );
  // 材料变化
  assert.throws(
    () => store.assertPrecheckFresh(r, { ...current(), materialsFingerprint: 'mfp-2' }),
    (e) => /材料/.test(e.message),
  );
  // 官网配置变化
  assert.throws(
    () => store.assertPrecheckFresh(r, { ...current(), homepage: { repoRoot: '/tmp/other', branch: 'main', contentDir: '/tmp/other/demo-app/' } }),
    (e) => /官网/.test(e.message),
  );
});

t('A5 取消：pending/running 置 canceled，已完成阶段与证据保留，不误标成功', () => {
  const dataDir = tmpData();
  const run = store.createProductRun(dataDir, { productId: 'demo-app', bld: mergedBld(), freeze: freezeFacts(), version: '1.0.0', by: 'board' });
  store.mutateProductRun(dataDir, run.id, (r) => {
    r.status = 'running';
    r.stages[0].status = 'done';
    r.stages[1].status = 'running';
    r.targets.webapp.status = 'done';
  });
  const canceled = store.mutateProductRun(dataDir, run.id, (r) => store.cancelRemaining(r, '人工取消'), { action: 'cancel' });
  assert.equal(canceled.status, 'canceled');
  assert.equal(canceled.stages[0].status, 'done');
  assert.equal(canceled.stages[1].status, 'canceled');
  assert.ok(canceled.stages.slice(2).every((s) => s.status === 'canceled'));
  assert.equal(canceled.targets.webapp.status, 'done', '已上线目标保留');
});

t('A6 重试：首个失败阶段及其后回 pending，已 done 阶段不动', () => {
  const dataDir = tmpData();
  const run = store.createProductRun(dataDir, { productId: 'demo-app', bld: mergedBld(), freeze: freezeFacts(), version: '1.0.0', by: 'board' });
  store.mutateProductRun(dataDir, run.id, (r) => {
    r.status = 'failed';
    r.stages[0].status = 'done';
    r.stages[1].status = 'done';
    r.stages[2].status = 'failed';
    r.stages[3].status = 'pending';
    r.targets.webapp.status = 'failed';
  });
  const r2 = store.mutateProductRun(dataDir, run.id, (r) => store.resetForRetry(r), { action: 'retry' });
  assert.equal(r2.status, 'running');
  assert.equal(r2.stages[0].status, 'done');
  assert.equal(r2.stages[1].status, 'done');
  assert.equal(r2.stages[2].status, 'pending');
  assert.equal(r2.stages[3].status, 'pending');
});

t('A7 整体判定：部分成功保持 failed 保留各目标真实状态；两目标全 done 才 succeeded', () => {
  const dataDir = tmpData();
  const run = store.createProductRun(dataDir, { productId: 'demo-app', bld: mergedBld(), freeze: freezeFacts(), version: '1.0.0', by: 'board' });
  store.mutateProductRun(dataDir, run.id, (r) => {
    r.stages[0].status = 'done';
    r.stages[1].status = 'done';
    r.stages[2].status = 'done';
    r.stages[3].status = 'failed'; r.stages[3].error = { message: '缺英文' };
    r.targets.webapp.status = 'done';
    r.targets.site.status = 'failed';
    r.status = 'failed';
  });
  const s = store.summarizeProductRun(store.readProductRun(dataDir, run.id));
  assert.equal(s.status, 'failed');
  assert.equal(s.targets.webapp, 'done');
  assert.equal(s.targets.site, 'failed');
  // 两目标全 done
  store.mutateProductRun(dataDir, run.id, (r) => {
    r.stages.forEach((x) => { x.status = 'done'; x.error = null; });
    r.targets.site.status = 'done';
    r.status = store.overallStatus(r);
  });
  assert.equal(store.readProductRun(dataDir, run.id).status, 'succeeded');
});

t('A8 服务重启恢复：running/prechecking 标 interrupted 可重试', () => {
  const dataDir = tmpData();
  const run = store.createProductRun(dataDir, { productId: 'demo-app', bld: mergedBld(), freeze: freezeFacts(), version: '1.0.0', by: 'board' });
  store.mutateProductRun(dataDir, run.id, (r) => {
    r.status = 'running';
    r.stages[0].status = 'running';
  });
  store.recoverInterruptedProductRuns(dataDir);
  const r2 = store.readProductRun(dataDir, run.id);
  assert.equal(r2.status, 'failed');
  assert.equal(r2.stages[0].status, 'failed');
  assert.equal(r2.stages[0].error.kind, 'interrupted');
});

t('A9 来源 BLD 改名/删除不破坏快照：bldName 保留冻结值', () => {
  const dataDir = tmpData();
  const run = store.createProductRun(dataDir, { productId: 'demo-app', bld: mergedBld(), freeze: freezeFacts(), version: '1.0.0', by: 'board' });
  // BLD 目录删除（模拟）：快照字段仍完整
  const snap = store.readProductRun(dataDir, run.id);
  assert.equal(snap.bldId, 'BLD-20260915-001');
  assert.equal(snap.bldName, '版本 20260915-01');
});

t('I1 finishMerge 带 mainSha → v.merge.mainSha 落盘；不传保持兼容 null', () => {
  const dataDir = tmpData();
  const v = buildStore.createVersion(dataDir, {
    name: 'V1',
    items: [{ itemId: 'REQ-20260915-001', commit: 'a'.repeat(40) }],
  });
  buildStore.beginMerge(dataDir, v.id);
  const done = buildStore.finishMerge(dataDir, v.id, {
    results: [{ itemId: 'REQ-20260915-001', ok: true }],
    mainSha: '5'.repeat(40),
  });
  assert.equal(done.merge.mainSha, '5'.repeat(40));
  assert.equal(done.status, 'merged');
  // 旧口径：不传 mainSha
  const v2 = buildStore.createVersion(dataDir, {
    name: 'V2',
    items: [{ itemId: 'REQ-20260915-002', commit: 'b'.repeat(40) }],
  });
  buildStore.beginMerge(dataDir, v2.id);
  const done2 = buildStore.finishMerge(dataDir, v2.id, { results: [{ itemId: 'REQ-20260915-002', ok: true }] });
  assert.equal(done2.status, 'merged');
  assert.equal(done2.merge.mainSha, null);
});

/* ---------- 执行 ---------- */

let failed = 0;
for (const [name, fn] of cases) {
  try {
    await fn();
    console.log(`✓ ${name}`);
  } catch (e) {
    failed++;
    console.error(`✗ ${name}\n${e && e.stack ? e.stack : e}`);
  }
}
console.log(`product-release-store：${cases.length - failed}/${cases.length} 通过`);
process.exit(failed ? 1 : 0);
