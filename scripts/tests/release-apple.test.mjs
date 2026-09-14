#!/usr/bin/env node
// REQ-20260910-029 发布模块 —— Apple 流水线适配器测试 A1~A8
// 模拟适配器（状态 / 故障注入 + 调用计数）；真实 Apple 联调不在本期测试范围，
// 模拟运行证据须显式标注 simulated，不得表述为真实上传成功。
// 用法：node scripts/tests/release-apple.test.mjs

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as core from '../lib/core.mjs';
import * as store from '../lib/release-store.mjs';
import { runApplePipeline } from '../lib/release-apple.mjs';

const cases = [];
const t = (name, fn) => cases.push([name, fn]);

const GIT_ENV = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' };

function git(cwd, args) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', env: GIT_ENV, timeout: 20000 });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} 失败：${r.stderr}`);
  return r.stdout.trim();
}

function mkEnv() {
  const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'atb-release-apple-')));
  const work = path.join(tmp, 'AppRepo');
  fs.mkdirSync(work);
  git(work, ['init', '-b', 'main']);
  git(work, ['config', 'user.email', 't@e.co']);
  git(work, ['config', 'user.name', 'T']);
  fs.writeFileSync(path.join(work, 'App.swift'), 'let x = 1\n');
  git(work, ['add', '-A']);
  git(work, ['commit', '-m', 'init']);
  core.initData(work);
  return { tmp, work, dataDir: core.dataDirFrom(work), headOid: () => git(work, ['rev-parse', 'HEAD']) };
}

// 模拟适配器：脚本化状态 + 调用计数（submitForReview 永不被模块调用）
function fakeAdapter(script = {}) {
  const calls = { upload: 0, submitForReview: 0, prepareReviewData: 0, queryProcessing: 0, build: 0 };
  const a = {
    calls,
    locateApp: script.locateApp || (({ config }) => {
      if (config && config.target) return { targets: [{ name: config.target, bundleId: `com.example.${config.target}` }], matchedSku: null };
      return { targets: [{ name: 'App', bundleId: 'com.example.App' }], matchedSku: null };
    }),
    checkEnv: script.checkEnv || (() => ({ ok: true, issues: [], xcodeVersion: '16.0' })),
    checkCredentials: script.checkCredentials || (() => ({ configured: true, issues: [], reference: '~/.appstoreconnect/config.json' })),
    checkMaterials: script.checkMaterials || (() => ({
      ok: true, issues: [],
      summary: { screenshots: 3, privacyManifest: true, encryptionDeclared: true, locales: ['zh-Hans'] },
      fingerprints: [{ name: 'meta-zh-Hans.json', sha256: 'ab12' }],
    })),
    compareBuild: script.compareBuild || (() => ({ exists: false })),
    build: script.build || (() => {
      calls.build++;
      return { ok: true, artifact: { path: '/tmp/xc/App.ipa', digest: 'sha256:deadbeef', sizeBytes: 1024 }, issues: [] };
    }),
    upload: script.upload || (() => {
      calls.upload++;
      return { uploadId: 'up-1' };
    }),
    queryProcessing: script.queryProcessing || (() => {
      calls.queryProcessing++;
      return { state: 'VALID' };
    }),
    checkSubmissionReadiness: script.checkSubmissionReadiness || (() => ({ ok: true, missing: [], ascEntry: 'https://appstoreconnect.apple.com/apps/1' })),
    prepareReviewData: script.prepareReviewData || (() => {
      calls.prepareReviewData++;
      return { versionCreated: true, bound: true, verified: true, issues: [] };
    }),
    fetchReleaseStatus: script.fetchReleaseStatus || (() => ({ reviewState: 'pending', ascEntry: 'https://appstoreconnect.apple.com/apps/1' })),
    submitForReview: () => {
      calls.submitForReview++;
      throw new Error('模块不得调用最终提审接口');
    },
  };
  return a;
}

const appleCfg = (over = {}) => ({
  projectPath: 'App.xcodeproj', scheme: 'App', platform: 'ios',
  version: '1.2.0', build: '42', ...over,
});
const newRun = (env, over = {}) =>
  store.createRun(env.dataDir, { target: 'apple', config: appleCfg(over), by: 'test' });
const drive = (env, runId, adapter, opts = {}) =>
  runApplePipeline({ dataDir: env.dataDir, projectRoot: env.work, runId, adapter, wait: { pollMs: 5, maxMs: 60 }, ...opts });
const stage = (run, key) => run.stages.find((s) => s.key === key);

t('A1 多 target 匹配歧义要求显式选择；SKU 首次收集默认 Bundle ID 并持久化复用', async () => {
  const env = mkEnv();
  const multi = fakeAdapter({ locateApp: () => ({ targets: [
    { name: 'App', bundleId: 'com.example.App' },
    { name: 'AppLite', bundleId: 'com.example.AppLite' },
  ], matchedSku: null }) });
  let run = newRun(env);
  let out = await drive(env, run.id, multi);
  assert.equal(out.status, 'failed');
  assert.equal(stage(out, 'locate').error.kind, 'ambiguous');
  assert.match(stage(out, 'locate').error.message, /AppLite|选择/);

  // 显式选择 target 后通过；SKU 无登记 → 收集（默认 Bundle ID）并持久化
  run = newRun(env, { target: 'AppLite' });
  out = await drive(env, run.id, fakeAdapter());
  assert.equal(stage(out, 'locate').status, 'done');
  assert.equal(stage(out, 'locate').result.bundleId, 'com.example.AppLite');
  assert.equal(stage(out, 'locate').result.sku, 'com.example.AppLite', '默认 SKU = Bundle ID');
  const m = store.readSkuMap(env.dataDir)['com.example.AppLite'];
  assert.equal(m.isDefault, true, '默认值标记');
  assert.ok(out.evidence.some((e) => e.kind === 'sku-collect'), 'SKU 收集入证据');
});

t('A2 凭据缺失 → 环境阶段阻塞给配置指引；凭据内容不进运行记录或日志', async () => {
  const env = mkEnv();
  const noCred = fakeAdapter({
    checkCredentials: () => ({ configured: false, issues: ['未找到 ~/.appstoreconnect/config.json'], reference: null }),
  });
  const run = newRun(env);
  const out = await drive(env, run.id, noCred);
  assert.equal(out.status, 'failed');
  const envStage = stage(out, 'env-credentials');
  assert.equal(envStage.status, 'failed');
  assert.match(envStage.error.message, /appstoreconnect|凭据|配置/);

  // 敏感内容不落盘：适配器内部含哨兵串，但只返回引用
  const secretAdapter = fakeAdapter({
    checkCredentials: () => ({
      configured: true, issues: [],
      reference: '~/.appstoreconnect/config.json',
      // 私有字段（模块不得持久化适配器内部状态）
      _secret: 'PRIVATE-KEY-CONTENT-SENTINEL',
    }),
  });
  const run2 = newRun(env, { version: '2.0.0' });
  const out2 = await drive(env, run2.id, secretAdapter);
  const runDir = store.runDir(env.dataDir, run2.id);
  const all = fs.readdirSync(path.join(runDir)).map((f) => {
    const p = path.join(runDir, f);
    return fs.statSync(p).isFile() ? fs.readFileSync(p, 'utf8') : fs.readdirSync(p).map((g) => fs.readFileSync(path.join(p, g), 'utf8')).join('');
  }).join('\n');
  assert.ok(!all.includes('PRIVATE-KEY-CONTENT-SENTINEL'), '密钥内容不进运行记录或日志');
  assert.ok(out2.simulated === true, '模拟适配器运行显式标注 simulated');
  void out2;
});

t('A3 资料与合规问题逐项列举；材料只留摘要与指纹', async () => {
  const env = mkEnv();
  const bad = fakeAdapter({
    checkMaterials: () => ({
      ok: false,
      issues: [
        { kind: 'screenshot', message: '6.7 寸截图数量不足（2/3）' },
        { kind: 'privacy', message: '隐私问卷未完成' },
        { kind: 'encryption', message: '加密声明缺失' },
      ],
      summary: null, fingerprints: [],
    }),
  });
  const run = newRun(env);
  const out = await drive(env, run.id, bad);
  assert.equal(out.status, 'failed');
  const m = stage(out, 'materials');
  assert.equal(m.status, 'failed');
  assert.match(m.error.message, /截图/);
  assert.match(m.error.message, /隐私/);
  assert.match(m.error.message, /加密/);

  // 正常材料：结果只存 summary + fingerprints（不含原始内容）
  const run2 = newRun(env, { version: '3.0.0' });
  const out2 = await drive(env, run2.id, fakeAdapter());
  const mr = stage(out2, 'materials').result;
  assert.equal(mr.summary.screenshots, 3);
  assert.deepEqual(mr.fingerprints, [{ name: 'meta-zh-Hans.json', sha256: 'ab12' }]);
});

t('A4 构建产物记录路径 / 摘要 / 源 OID / 构建身份；重复 build 可检测', async () => {
  const env = mkEnv();
  const dup = fakeAdapter({ compareBuild: () => ({ exists: true }) });
  let run = newRun(env);
  let out = await drive(env, run.id, dup);
  assert.equal(out.status, 'failed');
  assert.equal(stage(out, 'build').error.kind, 'duplicate-build', '重复版本 build 阻塞');

  run = newRun(env, { version: '1.3.0' });
  const adapter = fakeAdapter();
  out = await drive(env, run.id, adapter);
  const b = stage(out, 'build').result;
  assert.equal(b.artifact.digest, 'sha256:deadbeef');
  assert.equal(b.artifact.path, '/tmp/xc/App.ipa');
  assert.equal(b.sourceOid, env.headOid(), '产物可追溯到源提交');
  assert.equal(b.xcodeVersion, '16.0', '记录 Xcode 版本');
  assert.ok(b.identity.includes('1.3.0') && b.identity.includes('42'), '构建身份含版本与 build');
});

t('A5 上传后等待处理：INVALID 失败带原因；等待超时可恢复（非终局失败）', async () => {
  const env = mkEnv();
  const invalid = fakeAdapter({ queryProcessing: () => ({ state: 'INVALID', reason: 'ITMS-90000: 缺少 Info.plist 键' }) });
  let run = newRun(env);
  let out = await drive(env, run.id, invalid);
  assert.equal(out.status, 'failed');
  const up = stage(out, 'upload');
  assert.equal(up.status, 'failed');
  assert.match(up.error.message, /INVALID|Info\.plist/, '处理失败展示原因');
  assert.equal(up.result.uploadId, 'up-1', '上传标识保留供重试查询');

  // 等待超时：可恢复（重试先查询，不重复上传）
  let polled = 0;
  const slow = fakeAdapter({
    queryProcessing: () => { polled++; return { state: 'PROCESSING' }; },
  });
  run = newRun(env, { version: '2.0.0' });
  out = await drive(env, run.id, slow, { wait: { pollMs: 5, maxMs: 20 } });
  assert.equal(out.status, 'failed');
  assert.equal(stage(out, 'upload').error.kind, 'wait-timeout', '超时保持可恢复状态');
  assert.match(stage(out, 'upload').error.message, /重试|查询/);

  // 重试：适配器已处理完成 → 只查询，不再上传
  const recovered = fakeAdapter({
    queryProcessing: () => ({ state: 'PROCESSING' }),
    ...({}),
  });
  recovered.queryProcessing = () => ({ state: 'VALID' });
  store.mutateRun(env.dataDir, run.id, (r) => store.resetForRetry(r), { by: 'test', action: 'retry' });
  out = await drive(env, run.id, recovered);
  assert.equal(out.status, 'waiting-manual', '重试后推进到待人工提审');
  assert.equal(recovered.calls.upload, 0, '重试只查询已有上传，不重复上传');
  assert.ok(polled >= 1);
});

t('A6 重试不重复上传；审核数据阶段复用已建版本（不重复创建）', async () => {
  const env = mkEnv();
  // 第一次运行推进到 review-data 完成（版本创建一次）
  let run = newRun(env);
  let adapter = fakeAdapter();
  let out = await drive(env, run.id, adapter);
  assert.equal(out.status, 'waiting-manual');
  assert.equal(adapter.calls.prepareReviewData, 1);
  assert.equal(stage(out, 'review-data').result.versionCreated, true);

  // 新运行（修订）同版本：适配器报告版本已存在 → 复用
  run = newRun(env, { build: '43' });
  adapter = fakeAdapter({
    prepareReviewData: () => {
      adapter.calls.prepareReviewData++;
      return { versionCreated: false, bound: true, verified: true, issues: [] };
    },
  });
  out = await drive(env, run.id, adapter);
  const rd = stage(out, 'review-data');
  assert.equal(rd.status, 'done');
  assert.equal(rd.result.versionCreated, false, '复用已建版本');
  assert.equal(adapter.calls.prepareReviewData, 1, '只重试未完成操作（prepare 一次到位）');
});

t('A7 审核数据回验后停在待人工提审并提供 ASC 链接；模块从不调用最终提审接口', async () => {
  const env = mkEnv();
  const adapter = fakeAdapter();
  const run = newRun(env);
  const out = await drive(env, run.id, adapter);
  assert.equal(out.status, 'waiting-manual');
  const rd = stage(out, 'review-data');
  assert.equal(rd.result.verified, true, '查询回验通过');
  assert.ok(rd.result.ascEntry.includes('appstoreconnect.apple.com'), '提供 ASC 后台链接');
  assert.equal(stage(out, 'track').status, 'pending', '最终提审由用户操作，track 等待');
  assert.equal(adapter.calls.submitForReview, 0, '模块不得调用最终提审接口');
});

t('A8 跟踪状态区分：被拒保留原因 / 待开发者发布不可提前完成 / 仅已上线标成功；被拒修订关联原运行', async () => {
  const env = mkEnv();
  const run = newRun(env);
  const adapter = fakeAdapter();
  let out = await drive(env, run.id, adapter);
  assert.equal(out.status, 'waiting-manual');

  // 逐状态刷新
  const states = [
    ['in_review', 'waiting-manual', '审核中'],
    ['pending_release', 'waiting-manual', '审核通过待发布（不可提前完成）'],
    ['processing', 'waiting-manual', '处理中'],
  ];
  for (const [reviewState, expectStatus] of states) {
    adapter.fetchReleaseStatus = () => ({ reviewState, ascEntry: 'https://appstoreconnect.apple.com/apps/1' });
    out = await runApplePipeline({ dataDir: env.dataDir, projectRoot: env.work, runId: run.id, adapter, refreshTrack: true });
    assert.equal(out.status, expectStatus, `${reviewState} → ${expectStatus}`);
  }

  // 被拒：保留原因，运行失败
  adapter.fetchReleaseStatus = () => ({
    reviewState: 'rejected', rejectionNotes: 'Guideline 2.1 - Performance: App crashed',
    ascEntry: 'https://appstoreconnect.apple.com/apps/1',
  });
  out = await runApplePipeline({ dataDir: env.dataDir, projectRoot: env.work, runId: run.id, adapter, refreshTrack: true });
  assert.equal(out.status, 'failed');
  const tr = stage(out, 'track');
  assert.equal(tr.status, 'failed');
  assert.match(tr.error.message, /Guideline 2\.1/, '被拒保留原因');
  assert.ok((tr.result.rejectionNotes || tr.error.message).includes('Guideline'));

  // 修订版本启动关联新运行（parentId 关联被拒运行）
  const rev = store.createRun(env.dataDir, { target: 'apple', config: appleCfg({ version: '1.2.1', build: '50' }), by: 'test', parentId: run.id });
  assert.equal(rev.parentId, run.id, '修订运行关联原运行');

  // 已上线：唯一标记成功的状态
  adapter.fetchReleaseStatus = () => ({ reviewState: 'released', ascEntry: 'https://apps.apple.com/app/id1' });
  const run3 = newRun(env, { version: '2.0.0' });
  let out3 = await drive(env, run3.id, fakeAdapter());
  out3 = await runApplePipeline({ dataDir: env.dataDir, projectRoot: env.work, runId: run3.id, adapter, refreshTrack: true });
  assert.equal(out3.status, 'succeeded', '仅确认商店上线才标成功');
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
