#!/usr/bin/env node
// REQ-20260910-029 发布模块 —— 数据层（release-store）测试 S1~S5
// 覆盖：草稿创建与类型白名单、ID 递增、项目隔离、同目标并发互斥、重试/取消语义、
// 远端地址脱敏、sku-map 持久化、服务重启中断标记。
// 用法：node scripts/tests/release-store.test.mjs

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as core from '../lib/core.mjs';
import * as store from '../lib/release-store.mjs';

const cases = [];
const t = (name, fn) => cases.push([name, fn]);

function mkProject() {
  const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'atb-release-store-')));
  core.initData(tmp);
  return { tmp, dataDir: core.dataDirFrom(tmp) };
}

const gitConfig = (over = {}) => ({
  remote: 'origin', sourceBranch: 'main', targetBranch: 'main',
  tagName: null, checkCommand: 'npm test', ...over,
});
const appleConfig = (over = {}) => ({
  projectPath: '/tmp/App.xcodeproj', scheme: 'App', platform: 'ios',
  version: '1.2.0', build: '1', ...over,
});

t('S1 创建草稿：git/apple 配置校验；web/storage 类型拒绝（保留扩展枚举不可执行）', () => {
  const { dataDir } = mkProject();
  const run = store.createRun(dataDir, { target: 'git', config: gitConfig(), by: 'test' });
  assert.match(run.id, /^REL-\d{8}-\d{3}$/);
  assert.equal(run.status, 'draft');
  assert.equal(run.target, 'git');
  assert.equal(run.stages.length, 7, 'Git 七阶段');
  assert.ok(run.stages.every((s) => s.status === 'pending'));

  const apple = store.createRun(dataDir, { target: 'apple', config: appleConfig(), by: 'test' });
  assert.equal(apple.stages.length, 8, 'Apple 八阶段');

  // 类型白名单：非可执行类型 / 未知类型拒绝创建
  for (const bad of ['web', 'storage', 'docker', '']) {
    assert.throws(() => store.createRun(dataDir, { target: bad, config: {}, by: 'test' }), core.AtbError);
  }
  // 扩展枚举保留（首期未开放）
  const webType = store.TARGET_TYPES.find((x) => x.key === 'web');
  assert.ok(webType && webType.enabled === false, 'web 仅保留扩展位');

  // git 必填字段缺失 → fields 定位
  try {
    store.createRun(dataDir, { target: 'git', config: gitConfig({ remote: '' }), by: 'test' });
    assert.fail('缺 remote 应报错');
  } catch (e) {
    assert.ok(e.fields && e.fields.remote, '错误定位到 remote 字段');
  }
  try {
    store.createRun(dataDir, { target: 'apple', config: appleConfig({ projectPath: '' }), by: 'test' });
    assert.fail('缺 projectPath 应报错');
  } catch (e) {
    assert.ok(e.fields && e.fields.projectPath, '错误定位到 projectPath 字段');
  }
});

t('S2 ID 递增、列表按创建倒序、项目间隔离', () => {
  const a = mkProject();
  const b = mkProject();
  const r1 = store.createRun(a.dataDir, { target: 'git', config: gitConfig(), by: 'test' });
  const r2 = store.createRun(a.dataDir, { target: 'apple', config: appleConfig(), by: 'test' });
  assert.equal(r2.id.slice(-3), '002', '同项目 ID 递增');
  const b1 = store.createRun(b.dataDir, { target: 'git', config: gitConfig({ targetBranch: 'release' }), by: 'test' });
  assert.equal(b1.id.slice(-3), '001', '另一项目独立编号');

  const la = store.listRuns(a.dataDir);
  assert.equal(la.length, 2);
  assert.equal(la[0].id, r2.id, '最新在前');
  const lb = store.listRuns(b.dataDir);
  assert.equal(lb.length, 1);
  assert.equal(lb[0].id, b1.id);
  assert.equal(lb[0].label, 'origin → release', 'B 项目只含自己的运行');

  // 编号跨项目可相同（按 dataDir 隔离）：A 目录内同编号运行是 A 自己的
  const cross = store.readRun(a.dataDir, r1.id);
  assert.equal(cross.config.targetBranch, 'main', 'A 目录读到的 -001 是 A 的运行（目录级隔离）');
  void b1;
});

t('S3 同目标并发互斥；重试 / 取消不受互斥限制', () => {
  const { dataDir } = mkProject();
  const g1 = store.createRun(dataDir, { target: 'git', config: gitConfig(), by: 'test' });
  const g2 = store.createRun(dataDir, { target: 'git', config: gitConfig({ targetBranch: 'release' }), by: 'test' });
  const ap = store.createRun(dataDir, { target: 'apple', config: appleConfig(), by: 'test' });

  store.mutateRun(dataDir, g1.id, (run) => { run.status = 'running'; }, { by: 'test', action: 'start' });
  assert.throws(() => store.assertTargetFree(dataDir, 'git'), store.ReleaseConflictError, '同目标活动运行互斥');
  store.assertTargetFree(dataDir, 'git', { exceptId: g1.id }, '本运行自身操作不受限');
  store.assertTargetFree(dataDir, 'apple', '另一目标不受影响');

  store.mutateRun(dataDir, g1.id, (run) => { run.status = 'waiting-manual'; }, { by: 'test', action: 'wait' });
  assert.throws(() => store.assertTargetFree(dataDir, 'git'), store.ReleaseConflictError, '等待人工也算活动（占互斥）');

  // 重试 / 取消走 exceptId：不被互斥拦截
  store.mutateRun(dataDir, g1.id, (run) => {
    run.status = 'failed';
    run.stages[2].status = 'failed';
  }, { by: 'test', action: 'fail' });
  store.assertTargetFree(dataDir, 'git', { exceptId: g1.id });
  // 已终止（succeeded/failed/canceled/draft）不占互斥
  store.assertTargetFree(dataDir, 'git');
  const active = store.activeRunOf(dataDir, 'git');
  assert.equal(active, null);
  void g2; void ap;
});

t('S4 重试只重跑失败阶段（已完成不动）；取消保留已完成证据', () => {
  const { dataDir } = mkProject();
  const run = store.createRun(dataDir, { target: 'git', config: gitConfig(), by: 'test' });
  store.mutateRun(dataDir, run.id, (r) => {
    r.status = 'failed';
    r.stages[0].status = 'done';
    r.stages[0].result = { sourceOid: 'abc' };
    r.stages[1].status = 'failed';
    r.stages[1].error = { message: '工作区不干净', kind: 'dirty' };
    r.evidence.push({ at: new Date().toISOString(), kind: 'freeze', note: 'OID abc' });
  }, { by: 'test', action: 'fail' });

  const failed = store.firstFailedStage(run.id ? store.readRun(dataDir, run.id) : run);
  assert.equal(failed && failed.key, 'local-precheck', '定位首个失败阶段');

  // resetForRetry：失败及其后阶段回 pending，已完成保留
  store.mutateRun(dataDir, run.id, (r) => store.resetForRetry(r), { by: 'test', action: 'retry' });
  const after = store.readRun(dataDir, run.id);
  assert.equal(after.stages[0].status, 'done', '已完成阶段不动');
  assert.equal(after.stages[0].result.sourceOid, 'abc', '已完成证据保留');
  assert.equal(after.stages[1].status, 'pending', '失败阶段可重跑');
  assert.equal(after.status, 'running');

  // 取消：pending 全部 canceled，已完成保留
  store.mutateRun(dataDir, run.id, (r) => store.cancelRemaining(r, '用户取消'), { by: 'test', action: 'cancel' });
  const c = store.readRun(dataDir, run.id);
  assert.equal(c.status, 'canceled');
  assert.equal(c.stages[0].status, 'done', '取消保留已完成阶段');
  assert.equal(c.stages[1].status, 'canceled');
  assert.ok(c.history.some((h) => h.action === 'cancel'), '操作历史记录取消');
});

t('S5 脱敏、sku-map 持久化复用、服务重启中断标记', () => {
  const { dataDir } = mkProject();
  assert.equal(
    store.sanitizeRemoteUrl('https://user:secret@github.com/o/r.git'),
    'https://github.com/o/r.git',
    '剥离 URL 凭据',
  );
  assert.equal(store.sanitizeRemoteUrl('ssh://git@host/r.git'), 'ssh://git@host/r.git');
  const scrubbed = store.scrubSecrets('Authorization: Bearer abc.def.ghi\nPRIVATE KEY-----\n正常行');
  assert.ok(!scrubbed.includes('abc.def.ghi'), '日志擦除 token');
  assert.ok(scrubbed.includes('正常行'), '非敏感内容保留');

  // sku-map：首次收集（默认 Bundle ID），持久化后复用
  assert.equal(store.readSkuMap(dataDir)['com.example.App'], undefined, '初始无映射');
  store.saveSkuMapping(dataDir, { bundleId: 'com.example.App', sku: 'com.example.App', isDefault: true });
  const m = store.readSkuMap(dataDir)['com.example.App'];
  assert.equal(m.sku, 'com.example.App');
  assert.equal(m.isDefault, true);

  // 中断标记：running 阶段在重启后 → failed/interrupted，不自动重跑
  const run = store.createRun(dataDir, { target: 'git', config: gitConfig(), by: 'test' });
  store.mutateRun(dataDir, run.id, (r) => {
    r.status = 'running';
    r.stages[0].status = 'done';
    r.stages[1].status = 'running';
  }, { by: 'test', action: 'start' });
  store.recoverInterrupted(dataDir);
  const after = store.readRun(dataDir, run.id);
  assert.equal(after.stages[1].status, 'failed');
  assert.equal(after.stages[1].error.kind, 'interrupted');
  assert.equal(after.status, 'failed');
  assert.equal(after.stages[0].status, 'done', '已完成阶段不受影响');
  // 幂等：再次执行不重复改写
  store.recoverInterrupted(dataDir);
  assert.equal(store.readRun(dataDir, run.id).stages[1].error.kind, 'interrupted');
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
