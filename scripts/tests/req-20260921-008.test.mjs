#!/usr/bin/env node
// REQ-20260921-008 发布模块的文档编写页面优化 —— 分层测试。
// L1 纯逻辑（publish-flow：四态状态机求值 evaluateDocsFlow / AI 总结提示词 buildDocSummaryPrompt；
// REQ-20260921-012 起总结范围收窄为默认语言 4 文件、剩余语言初始「未翻译」；
// BUG-20260926-002 起提交回归「全部已审核」门禁，本测试随之调整）；
// L2 数据层（docs-summary-store 账本与独立锁；build-store 审核记录 recordDocsReview）；
// L3 服务接口（docs-summary start/current、docs/review、docs/commit 门禁与 dev 前置、publish-plan docsFlow）；
// L4 前端静态契约（renderDocsPane 三段布局 / 审查对话框双栏同步滚动 / 文案更名）；
// L5 任务模块与全局面板（AI 总结页签、kind=summary 简报）；
// L6 i18n（新增文案中英同步；「AI 写作」文档页键清理）。
// 用法：node scripts/tests/req-20260921-008.test.mjs

import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import * as core from '../lib/core.mjs';
import * as flow from '../lib/publish-flow.mjs';
import * as buildStore from '../lib/build-store.mjs';
import * as summaryStore from '../lib/docs-summary-store.mjs';
import * as nodeCrypto from 'node:crypto';
import '../web/i18n.js';

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const GIT_ENV = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' };

function git(cwd, args, env = GIT_ENV) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', env, timeout: 20000 });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} 失败：${r.stderr || r.stdout}`);
  return r.stdout.trim();
}
function gitAt(cwd, args, at) {
  return git(cwd, args, { ...GIT_ENV, GIT_AUTHOR_DATE: at, GIT_COMMITTER_DATE: at });
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
const sha256 = (s) => nodeCrypto.createHash('sha256').update(String(s)).digest('hex');

const cases = [];
const t = (name, fn) => cases.push([name, fn]);

/* ---------- L1 纯逻辑（publish-flow.mjs） ---------- */

t('L1-1 状态枚举与文案唯一事实源：默认语言四态 + 剩余语言三态 + 单文件类两态（REQ-20260922-002 扩展）', () => {
  assert.deepEqual(
    Object.keys(flow.DOCS_FLOW_LABEL),
    ['unsummarized', 'summarizing', 'summarized', 'untranslated', 'translating', 'translated', 'reviewed', 'unwritten', 'pending'],
  );
  assert.deepEqual(flow.DOCS_FLOW_LABEL, {
    unsummarized: '未总结', summarizing: '正在总结', summarized: '已总结待审核',
    untranslated: '未翻译', translating: '正在翻译', translated: '已翻译待审核', reviewed: '已审核',
    unwritten: '未编写', pending: '待审核',
  });
});

const readsOf = (contents) => (f) => (Object.prototype.hasOwnProperty.call(contents, f) ? contents[f] : null);

t('L1-2 evaluateDocsFlow 基础求值：无审核无总结 → 全未总结；summarizing/summarized 标记生效', () => {
  const contents = {};
  for (const f of flow.publishDocFiles()) contents[f.file] = `# ${f.file}\n`;
  let r = flow.evaluateDocsFlow({}, readsOf(contents), {});
  assert.equal(r.files.length, 9, '4 × 2 + LICENSE（REQ-20260922-002）');
  assert.ok(r.defaultFiles.filter((f) => !f.single).every((f) => f.state === 'unsummarized'), '默认语言无审核无总结全未总结');
  assert.ok(r.restFiles.every((f) => f.state === 'untranslated'), '剩余语言初始未翻译（REQ-20260921-012）');
  assert.equal(r.files.find((f) => f.file === 'LICENSE.md').state, 'pending', 'LICENSE 在盘未审为待审核（单文件类不经 AI）');
  assert.equal(r.reviewedCount, 0);
  assert.equal(r.canCommit, false);

  r = flow.evaluateDocsFlow({}, readsOf(contents), {
    summarizing: ['README.md'],
    summarized: ['CHANGELOG.md'],
  });
  assert.equal(r.files.find((f) => f.file === 'README.md').state, 'summarizing');
  assert.equal(r.files.find((f) => f.file === 'CHANGELOG.md').state, 'summarized');
});

t('L1-3 审核与回退：hash 一致 reviewed；内容修改回退 summarized；scopeStale 失效回退', () => {
  const contents = { 'README.md': 'a', 'README_en.md': 'b' };
  const review = { files: { 'README.md': { hash: sha256('a'), at: '2026-09-21T00:00:00Z' } } };
  let r = flow.evaluateDocsFlow({ review }, readsOf(contents), {});
  assert.equal(r.files.find((f) => f.file === 'README.md').state, 'reviewed');
  assert.equal(r.files.find((f) => f.file === 'README_en.md').state, 'untranslated', '剩余语言初始未翻译');
  assert.equal(r.reviewedCount, 1);

  // 已审核文件被编辑（内部或外部 IDE）→ 回退已总结待审核
  const edited = { ...contents, 'README.md': 'a-changed' };
  r = flow.evaluateDocsFlow({ review }, readsOf(edited), {});
  assert.equal(r.files.find((f) => f.file === 'README.md').state, 'summarized', '编辑后回退待审核');

  // scopeStale：审核整体失效（发布范围变化须重新核对，不弱化提交门禁）
  r = flow.evaluateDocsFlow({ review, docs: { scopeStale: true, commitHash: 'x' } }, readsOf(contents), {});
  assert.equal(r.files.find((f) => f.file === 'README.md').state, 'summarized', '范围过期审核失效');
  assert.equal(r.canCommit, false);
});

t('L1-4 直接审查路径：未总结文件不经 AI 总结直接给审核记录 → reviewed', () => {
  const contents = { 'AGENTS.md': 'rules' };
  const review = { files: { 'AGENTS.md': { hash: sha256('rules'), at: '2026-09-21T00:00:00Z' } } };
  const r = flow.evaluateDocsFlow({ review }, readsOf(contents), {});
  assert.equal(r.files.find((f) => f.file === 'AGENTS.md').state, 'reviewed', '不经总结直接审核可用');
});

t('L1-5 提交门禁求值：canCommit 仅 8/8 reviewed；missing 列出缺口文件与状态', () => {
  const contents = {};
  for (const f of flow.publishDocFiles()) contents[f.file] = `# ${f.key}`;
  const files = {};
  for (const f of flow.publishDocFiles()) files[f.file] = { hash: sha256(contents[f.file]), at: '2026-09-21T00:00:00Z' };
  // 先只审 6 个（LICENSE 也不审——单文件类同口径进门禁，REQ-20260922-002）
  const partial = { 'README.md': files['README.md'], 'README_en.md': files['README_en.md'], 'CHANGELOG.md': files['CHANGELOG.md'], 'CHANGELOG_en.md': files['CHANGELOG_en.md'], 'FEATURES.md': files['FEATURES.md'], 'FEATURES_en.md': files['FEATURES_en.md'] };
  let r = flow.evaluateDocsFlow({ review: { files: partial } }, readsOf(contents), {});
  assert.equal(r.reviewedCount, 6);
  assert.equal(r.canCommit, false, '未满 9/9 不可提交');
  assert.equal(r.missing.length, 3);
  assert.deepEqual(r.missing.map((m) => m.file).sort(), ['AGENTS.md', 'AGENTS_en.md', 'LICENSE.md']);
  assert.equal(r.missing.find((m) => m.file === 'AGENTS.md').state, 'unsummarized', '默认语言缺口带状态');
  assert.equal(r.missing.find((m) => m.file === 'AGENTS_en.md').state, 'untranslated', '剩余语言缺口带状态');
  assert.equal(r.missing.find((m) => m.file === 'LICENSE.md').state, 'pending', 'LICENSE 缺口为待审核');

  r = flow.evaluateDocsFlow({ review: { files } }, readsOf(contents), {});
  assert.ok(!('canFinalize' in r), 'BUG-20260926-002：canFinalize 字段随完结阶段移除');
  assert.equal(r.canCommit, true, '9/9 reviewed 即可提交（BUG-20260926-002 回归全审门禁，不叠加完结）');
  assert.deepEqual(r.missing, []);
  r = flow.evaluateDocsFlow({ review: { files, finalized: { at: '2026-09-21T02:00:00Z', langsKey: 'cn,en', files: {} } } }, readsOf(contents), {});
  assert.equal(r.canCommit, true, '9/9 reviewed + 历史完结快照被忽略仍可提交');
});

t('L1-6 AI 总结提示词：计划号/版本号/项目路径/八文档/逐文件进度回执 CLI 指令/写作约束', () => {
  const p = flow.buildDocSummaryPrompt({
    projectRoot: '/tmp/proj-x', planId: 'BLD-20260921-001', runId: 'sum-20260921-010101-ab01',
    items: [{ itemId: 'REQ-20260921-008', commit: 'a'.repeat(40), title: '文档编写页优化' }],
    atbPath: '/tmp/atb.mjs',
  });
  assert.ok(p.includes('BLD-20260921-001') && p.includes('20260921-001'), '计划号与版本号');
  assert.ok(p.includes('/tmp/proj-x'), '项目路径');
  assert.ok(p.includes('README.md') && p.includes('AGENTS.md'), '默认语言四文档清单');
  assert.ok(!p.includes('README_en.md') && !p.includes('_en.md'), '总结清单不含剩余语言文件（REQ-20260921-012 阶段一收窄）');
  assert.ok(p.includes('sum-20260921-010101-ab01'), '带 runId');
  assert.ok(!p.includes('文档编写页优化'), 'BUG-20260921-005：关联范围不内嵌条目标题');
  assert.ok(p.includes('summary file') && p.includes('summary done') && p.includes('summary fail'), '逐文件进度回执 CLI 指令');
  assert.ok(p.includes('不得编造'), '写作约束保留');
});

/* ---------- L2 数据层（docs-summary-store / build-store） ---------- */

function mkData(tmp) {
  const proj = mkRepo(path.join(tmp, 'proj'));
  fs.writeFileSync(path.join(proj, 'base.txt'), 'base');
  git(proj, ['add', '-A']); git(proj, ['commit', '-m', 'init']);
  core.initData(proj);
  return { proj, dataDir: core.dataDirFrom(proj) };
}

t('L2-1 账本与独立锁：createSummaryRun 八文件 pending + 占用 summary.lock；重复 start 拒绝', () => {
  const { dataDir } = mkData(tmpdir('atb-008-l21-'));
  const run = summaryStore.createSummaryRun(dataDir, { verId: 'BLD-20260921-001', owner: 'sum-1' });
  assert.match(run.runId, /^sum-\d{8}-\d{6}-[0-9a-f]{4,}$/);
  assert.equal(run.phase, 'running');
  assert.equal(Object.keys(run.files).length, 4, 'REQ-20260921-012：仅默认语言 4 文件');
  assert.ok(Object.values(run.files).every((s) => s === 'pending'));

  const lockFile = path.join(dataDir, 'runtime', '.locks', 'summary.lock');
  assert.ok(fs.existsSync(lockFile), '运行期间占用 summary.lock');
  assert.equal(JSON.parse(fs.readFileSync(lockFile, 'utf8')).runId, run.runId);

  assert.throws(
    () => summaryStore.createSummaryRun(dataDir, { verId: 'BLD-20260921-002', owner: 'sum-2' }),
    /已有进行中的 AI 总结/,
    '同一时间至多一个 AI 总结任务',
  );
});

t('L2-2 markSummaryFile：进度流转与非法入参拒绝', () => {
  const { dataDir } = mkData(tmpdir('atb-008-l22-'));
  const run = summaryStore.createSummaryRun(dataDir, { verId: 'BLD-20260921-001', owner: 'sum-1' });
  summaryStore.markSummaryFile(dataDir, run.runId, 'README.md', 'summarizing');
  summaryStore.markSummaryFile(dataDir, run.runId, 'README.md', 'summarized');
  assert.equal(summaryStore.getSummaryRun(dataDir, run.runId).files['README.md'], 'summarized');
  assert.throws(() => summaryStore.markSummaryFile(dataDir, run.runId, 'evil.txt', 'summarizing'), /非发布文档/);
  assert.throws(() => summaryStore.markSummaryFile(dataDir, run.runId, 'AGENTS.md', 'done'), /state/);
});

t('L2-3 收尾与聚合：done/fail 释放锁；fail 不悬挂「正在总结」；marksForVer 聚合', () => {
  const { dataDir } = mkData(tmpdir('atb-008-l23-'));
  const run = summaryStore.createSummaryRun(dataDir, { verId: 'BLD-20260921-001', owner: 'sum-1' });
  summaryStore.markSummaryFile(dataDir, run.runId, 'README.md', 'summarized');
  summaryStore.markSummaryFile(dataDir, run.runId, 'CHANGELOG.md', 'summarizing');
  summaryStore.finishSummaryRun(dataDir, run.runId, { result: 'failed', reason: '网络中断' });
  const lockFile = path.join(dataDir, 'runtime', '.locks', 'summary.lock');
  assert.ok(!fs.existsSync(lockFile), '收尾释放锁');

  const after = summaryStore.getSummaryRun(dataDir, run.runId);
  assert.equal(after.phase, 'failed');
  assert.equal(after.files['CHANGELOG.md'], 'pending', '中断文件不悬挂「正在总结」');
  assert.equal(after.reason, '网络中断');

  const marks = summaryStore.summaryMarksForVer(dataDir, 'BLD-20260921-001');
  assert.deepEqual(marks.summarized, ['README.md'], '已完成文件保留 summarized 标记');
  assert.deepEqual(marks.summarizing, [], '无活动 run 不占 summarizing');

  // 失败后可重启（新 run），最新视图切换
  const run2 = summaryStore.createSummaryRun(dataDir, { verId: 'BLD-20260921-001', owner: 'sum-1' });
  const latest = summaryStore.latestSummaryRun(dataDir);
  assert.equal(latest.runId, run2.runId);
  const view = summaryStore.summaryRunView(latest);
  assert.equal(view.phase, 'running');
  assert.equal(view.counts.total, 4, 'REQ-20260921-012：默认语言 4 文件');
  assert.ok('currentFile' in view, '视图带当前文件字段');
});

t('L2-4 锁隔离与审核记录：summary 进行中不产生 impl/refine 锁；recordDocsReview 写 v.review 不动 v.docs', () => {
  const { proj, dataDir } = mkData(tmpdir('atb-008-l24-'));
  const commitA = git(proj, ['rev-parse', 'HEAD']);
  const reqA = core.createItem(dataDir, { type: 'requirement', title: 'A', by: 'test' });
  for (const s of ['accepted', 'in-progress', 'done']) core.setStatus(dataDir, reqA.id, s, { by: 'test' });
  const v = buildStore.createVersion(dataDir, { items: [{ itemId: reqA.id, commit: commitA }] });
  void commitA;

  const run = summaryStore.createSummaryRun(dataDir, { verId: v.id, owner: 'sum-1' });
  const locksDir = path.join(dataDir, 'runtime', '.locks');
  const names = fs.readdirSync(locksDir);
  assert.ok(names.includes('summary.lock'), 'AI 总结占用独立锁');
  assert.ok(!names.includes('impl.lock'), '不占 AI 开发锁');
  assert.ok(!names.includes('refine.lock'), '不占 AI 分析锁');

  fs.writeFileSync(path.join(proj, 'README.md'), '# r');
  const out = buildStore.recordDocsReview(dataDir, v.id, { file: 'README.md' });
  assert.equal(out.review.files['README.md'].hash, sha256('# r'), '审核记录当前磁盘 hash');
  assert.equal(out.docs, undefined, '不写 v.docs（提交记录语义隔离）');
  assert.throws(() => buildStore.recordDocsReview(dataDir, v.id, { file: 'x.txt' }), /非发布文档/);
  summaryStore.finishSummaryRun(dataDir, run.runId, { result: 'done', summary: '完成' });
});

/* ---------- L3 服务接口 ---------- */

function req(port, method, pathname, body) {
  return new Promise((resolve, reject) => {
    const payload = body == null ? null : JSON.stringify(body);
    const r = http.request({
      hostname: '127.0.0.1', port, path: pathname, method,
      headers: payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {},
      timeout: 10000,
    }, (rs) => {
      const chunks = [];
      rs.on('data', (c) => chunks.push(c));
      rs.on('end', () => {
        const buf = Buffer.concat(chunks);
        let json = null;
        try { json = JSON.parse(buf.toString() || '{}'); } catch {}
        resolve({ status: rs.statusCode, json, text: buf.toString() });
      });
    });
    r.on('error', reject);
    r.on('timeout', () => { r.destroy(); reject(new Error('timeout')); });
    if (payload) r.write(payload);
    r.end();
  });
}

t('L3 服务接口：AI 总结流水线 / 审查 / 提交门禁与 dev 前置 / publish-plan docsFlow / 全局简报', async () => {
  const tmp = tmpdir('atb-008-serve-');
  const proj = mkRepo(path.join(tmp, 'proj'));
  fs.writeFileSync(path.join(proj, 'base.txt'), 'base');
  git(proj, ['add', '-A']); gitAt(proj, ['commit', '-m', 'init'], '2026-09-21T01:00:00 +0000');
  git(proj, ['switch', '-c', 'dev']);
  fs.writeFileSync(path.join(proj, 'a.txt'), 'A');
  git(proj, ['add', '-A']); gitAt(proj, ['commit', '-m', 'feat: A REQ-20260921-001'], '2026-09-21T01:01:00 +0000');
  const commitA = git(proj, ['rev-parse', 'HEAD']);
  core.initData(proj);
  const dataDir = core.dataDirFrom(proj);
  const reqA = core.createItem(dataDir, { type: 'requirement', title: '条目 A', by: 'test' });
  for (const s of ['accepted', 'in-progress', 'done']) core.setStatus(dataDir, reqA.id, s, { by: 'test' });

  const reg = path.join(tmp, 'reg.json');
  let server = null;
  let port = 0;
  for (let i = 0; i < 6 && !server; i++) {
    const p = 33500 + Math.floor(Math.random() * 20000);
    const child = spawn(process.execPath, [path.join(pluginRoot, 'scripts', 'server.mjs')], {
      cwd: proj,
      env: { ...process.env, ATB_PORT: String(p), ATB_REGISTRY: reg },
      stdio: ['ignore', 'ignore', 'ignore'],
    });
    for (let k = 0; k < 40; k++) {
      await sleep(150);
      try { const h = await req(p, 'GET', '/api/health'); if (h.json && h.json.port === p) { server = child; port = p; break; } } catch {}
      if (child.exitCode !== null) break;
    }
    if (!server) child.kill('SIGTERM');
  }
  assert.ok(server, '服务应启动');
  const P = `?project=${encodeURIComponent(proj)}`;
  try {
    let r = await req(port, 'POST', `/api/build/version${P}`, { items: [{ itemId: reqA.id, commit: commitA }] });
    assert.equal(r.status, 201, `创建版本：${r.text}`);
    const vid = r.json.version.id;

    // publish-plan：docsFlow 4×2 + LICENSE + summary 字段；docsPrompt 移除
    r = await req(port, 'GET', `/api/build/publish-plan${P}&id=${vid}`);
    assert.equal(r.status, 200);
    assert.equal(r.json.docsFlow.files.length, 9, 'docsFlow 4 × 2 + LICENSE（REQ-20260922-002）');
    assert.equal(r.json.docsFlow.files.find((f) => f.file === 'LICENSE.md').state, 'unwritten', 'LICENSE 初始未编写');
    assert.ok(r.json.docsFlow.files.filter((f) => f.isDefault && !f.single).every((f) => f.state === 'unsummarized'), '全新版本默认语言全未总结');
    assert.ok(r.json.docsFlow.files.filter((f) => !f.isDefault).every((f) => f.state === 'untranslated'), '剩余语言初始未翻译');
    assert.equal(r.json.docsFlow.canCommit, false);
    assert.ok(r.json.summary === null || r.json.summary.phase, 'summary 字段存在');
    assert.equal(r.json.docsPrompt, undefined, '提示词改由 start 按需生成');

    // AI 总结启动：返回 runId + 提示词；current 反映进度
    r = await req(port, 'POST', `/api/build/docs-summary/start${P}`, { id: vid });
    assert.equal(r.status, 200, `start：${r.text}`);
    const runId = r.json.runId;
    assert.ok(runId, '返回 runId');
    assert.ok(r.json.prompt.includes(runId) && r.json.prompt.includes('summary file'), '提示词带回执指令');
    r = await req(port, 'POST', `/api/build/docs-summary/start${P}`, { id: vid });
    assert.equal(r.status, 400, '已有进行中的 AI 总结任务时重复 start 拒绝');

    // 逐文件进度：README 已总结
    summaryStore.markSummaryFile(dataDir, runId, 'README.md', 'summarized');
    r = await req(port, 'GET', `/api/build/docs-summary/current${P}`);
    assert.equal(r.status, 200);
    assert.equal(r.json.run.runId, runId);
    assert.equal(r.json.run.phase, 'running');
    assert.equal(r.json.run.counts.summarized, 1, '进度 1/4（默认语言四文件）');

    // 审查：README.md 通过审核 → reviewed；编辑保存后回退
    fs.writeFileSync(path.join(proj, 'README.md'), '# README\n[更新日志](CHANGELOG.md) [功能](FEATURES.md)\n');
    r = await req(port, 'POST', `/api/build/docs/review${P}`, { id: vid, file: 'README.md' });
    assert.equal(r.status, 200, `review：${r.text}`);
    assert.equal(r.json.docsFlow.files.find((f) => f.file === 'README.md').state, 'reviewed');
    r = await req(port, 'POST', `/api/build/docs/save${P}`, { id: vid, file: 'README.md', content: '# README 改\n[更新日志](CHANGELOG.md) [功能](FEATURES.md)\n' });
    assert.equal(r.status, 200);
    r = await req(port, 'GET', `/api/build/publish-plan${P}&id=${vid}`);
    assert.equal(r.json.docsFlow.files.find((f) => f.file === 'README.md').state, 'summarized', '编辑后回退待审核');

    // 提交门禁：未全审核 400 带缺口明细
    r = await req(port, 'POST', `/api/build/docs/commit${P}`, { id: vid });
    assert.equal(r.status, 400, '未全审核不可提交');
    assert.match(r.json.error || '', /已审核|未总结/, '带缺口说明');

    // 全部审核 → 提交成功（当前在 dev）。BUG-20260926-002：回归「全部已审核」门禁，
    // 不再叠加完结确认；写盘顺序默认语言先行（README.md 先于 README_en.md），避免 mtime 基准变更误报
    const contents = {};
    contents['README.md'] = '# README\n[更新日志](CHANGELOG.md) [功能](FEATURES.md)\n';
    contents['README_en.md'] = '# README\n[Changelog](CHANGELOG_en.md) [Features](FEATURES_en.md)\n';
    for (const f of flow.publishDocFiles()) {
      if (!contents[f.file]) contents[f.file] = `# ${f.key} ${f.lang}\n`;
      fs.writeFileSync(path.join(proj, f.file), contents[f.file]);
    }
    for (const f of flow.publishDocFiles()) {
      r = await req(port, 'POST', `/api/build/docs/review${P}`, { id: vid, file: f.file });
      assert.equal(r.status, 200, `review ${f.file}：${r.text}`);
    }
    r = await req(port, 'GET', `/api/build/publish-plan${P}&id=${vid}`);
    assert.ok(!('canFinalize' in r.json.docsFlow), 'BUG-20260926-002：canFinalize 字段随完结阶段移除');
    assert.equal(r.json.docsFlow.canCommit, true, '9/9 已审核（含 LICENSE）即解锁提交，无完结步');

    // 不在 dev：提交被阻止（不自动切分支）
    git(proj, ['switch', 'main']);
    r = await req(port, 'POST', `/api/build/docs/commit${P}`, { id: vid });
    assert.equal(r.status, 400, '非 dev 提交被阻止');
    assert.match(r.json.error || '', /dev/);
    git(proj, ['switch', 'dev']);

    r = await req(port, 'POST', `/api/build/docs/commit${P}`, { id: vid });
    assert.equal(r.status, 200, `提交：${r.text}`);
    const docHash = r.json.commitHash;
    assert.ok(/^[0-9a-f]{40}$/.test(docHash));
    const stat = git(proj, ['show', '--name-only', '--format=', docHash]).split('\n').filter(Boolean);
    assert.deepEqual(stat.sort(), Object.keys(contents).sort(), 'pathspec 只含清单内文档（4×2 + LICENSE）');
    // 提交后门禁衔接：docsFlow 全 reviewed 且 overall=committed 满足合并前置
    r = await req(port, 'GET', `/api/build/publish-plan${P}&id=${vid}`);
    assert.equal(r.json.docsFlow.canCommit, true, '提交后内容未变保持已审核');
    assert.equal(r.json.docs.overall, 'committed', '合并前置不弱化');

    // AI 总结收尾：done 释放锁；全局面板收尾移出
    summaryStore.finishSummaryRun(dataDir, runId, { result: 'done', summary: '八个文件总结完成' });
    r = await req(port, 'GET', `/api/build/docs-summary/current${P}`);
    assert.equal(r.json.run.phase, 'done', '任务模块可见已完成状态');
    r = await req(port, 'GET', '/api/batch/global');
    const row = (r.json.projects || []).find((p) => p.root === proj);
    assert.ok(row, '项目已注册进全局聚合');
    assert.ok(!(row.tasks || []).some((x) => x.kind === 'summary'), '收尾后全局面板移出');

    // 进行中的 AI 总结出现在全局面板（kind=summary 简报）
    const run2 = summaryStore.createSummaryRun(dataDir, { verId: vid, owner: 'sum-9' });
    summaryStore.markSummaryFile(dataDir, run2.runId, 'AGENTS.md', 'summarized');
    r = await req(port, 'GET', '/api/batch/global');
    const row2 = (r.json.projects || []).find((p) => p.root === proj);
    const brief = (row2.tasks || []).find((x) => x.kind === 'summary');
    assert.ok(brief, '进行中 AI 总结进入全局面板');
    assert.equal(brief.counts.total, 4, 'REQ-20260921-012：总结账本默认语言 4 文件');
    assert.equal(brief.counts.done, 1, '进度计数 1/8');
    summaryStore.finishSummaryRun(dataDir, run2.runId, { result: 'failed', reason: '测试收尾' });
  } finally {
    server.kill('SIGTERM');
  }
});

/* ---------- L4 前端静态契约（build.js） ---------- */

function extractFn(source, name) {
  const m = source.match(new RegExp(`  function ${name}\\(([a-zA-Z]*)\\) \\{[\\s\\S]*?\\n  \\}`));
  assert.ok(m, `build.js 中应存在 ${name} 函数`);
  return m[0];
}

function vmRun(fnSource, context, expr) {
  const context2 = vm.createContext(context);
  vm.runInContext(fnSource, context2);
  return vm.runInContext(expr, context2);
}

const FLOW_STUB = {
  DOCS_FLOW_LABEL: flow.DOCS_FLOW_LABEL,
  DOCS_FLOW_CLS: { unsummarized: 'st-mute', summarizing: 'st-run', summarized: 'st-wait', untranslated: 'st-mute', translating: 'st-run', translated: 'st-wait', reviewed: 'st-ok' },
  DOCS_FLOW_ICON: { unsummarized: '○', summarizing: '◐', summarized: '●', untranslated: '○', translating: '◐', translated: '●', reviewed: '✔' },
  DOC_KEYS: ['README', 'CHANGELOG', 'FEATURES', 'AGENTS'],
  DOC_SINGLE_KEYS: ['LICENSE'], // REQ-20260922-002 单文件类（审查对话框页签含 LICENSE）
  // REQ-20260921-010 起文档清单按语言集动态展开（原模块级 DOC_FILES 常量下线）
  DEFAULT_DOC_LANGS: ['cn', 'en'],
  langNameOf: (l) => String(l),
  docFilesOf: (langs) => flow.publishDocFiles(Array.isArray(langs) && langs.length ? langs : flow.DEFAULT_DOC_LANGS),
};

t('L4-1 renderDocsPane：副标题 + 六按钮 + 八文件行七态 chip + 门禁条（REQ-20260921-012 三阶段口径）', () => {
  const source = fs.readFileSync(new URL('../web/build.js', import.meta.url), 'utf8');
  const fns = ['summaryBtnText', 'translateBtnText', 'normalizeFlowEval', 'translateBtnHtml', 'commitBtnHtml', 'docsStageBar', 'renderDocsPane']
    .map((n) => extractFn(source, n)).join('\n');
  const html = vmRun(fns, {
    pfOf: (v) => v.pf,
    esc: (s) => String(s),
    short: (h) => String(h || '').slice(0, 8),
    fmtTime: () => 't',
    ...FLOW_STUB,
  }, `renderDocsPane({
    id: 'BLD-20260921-001',
    pf: {
      phase: 'ready',
      plan: {
        docsFlow: { files: [
          { file: 'README.md', lang: 'cn', state: 'summarized', isDefault: true }, { file: 'README_en.md', lang: 'en', state: 'untranslated', isDefault: false },
          { file: 'CHANGELOG.md', lang: 'cn', state: 'summarizing', isDefault: true }, { file: 'CHANGELOG_en.md', lang: 'en', state: 'translated', isDefault: false },
          { file: 'FEATURES.md', lang: 'cn', state: 'unsummarized', isDefault: true }, { file: 'FEATURES_en.md', lang: 'en', state: 'reviewed', isDefault: false },
          { file: 'AGENTS.md', lang: 'cn', state: 'unsummarized', isDefault: true }, { file: 'AGENTS_en.md', lang: 'en', state: 'untranslated', isDefault: false },
        ], reviewedCount: 1, canCommit: false, missing: [{ file: 'README.md', state: 'summarized' }] },
        summary: { phase: 'running', counts: { summarized: 2, total: 4 }, currentFile: 'CHANGELOG.md' },
        translate: null,
        docs: { overall: 'none' },
      },
    },
  })`);
  // 副标题与五步按钮（REQ-20260921-012 新增 AI 翻译；完结按钮随 BUG-20260926-002 去除）
  assert.match(html, /AI 总结/, '副标题阐述 AI 总结工作流');
  for (const btn of ['data-pf-refresh', 'data-pf-summary', 'data-pf-translate', 'data-pf-review', 'data-pf-commit']) {
    assert.ok(html.includes(btn), `按钮之一 ${btn} 存在`);
  }
  // 八文件行 + 七态 chip（文字 + 图标，不只靠颜色）
  for (const f of ['README.md', 'README_en.md', 'CHANGELOG.md', 'CHANGELOG_en.md', 'FEATURES.md', 'FEATURES_en.md', 'AGENTS.md', 'AGENTS_en.md']) {
    assert.ok(html.includes(f), `文件行 ${f}`);
  }
  for (const label of ['未总结', '正在总结', '已总结待审核', '未翻译', '已翻译待审核', '已审核']) {
    assert.ok(html.includes(label), `状态文字 ${label}`);
  }
  // 阶段条两阶段（BUG-20260926-002）
  for (const st of ['① 默认语言先行', '② AI 翻译与审查']) {
    assert.ok(html.includes(st), `阶段 ${st}`);
  }
  assert.ok(!html.includes('③ 整体审查完结'), '完结阶段随 BUG-20260926-002 去除');
  // 门禁条：默认语言 / 剩余语言分组计数 + 缺口
  assert.match(html, /默认语言 0\/4/, '门禁条默认语言计数（本例默认语言未审）');
  assert.match(html, /剩余语言 1\/4/, '门禁条剩余语言计数');
  // 文案更名：文档编写页签不再出现「AI 写作」（官网侧旧文案在另一函数，REQ-20260921-007 起统一更名）
  assert.ok(!html.includes('AI 写作'), 'AI 写作文案已更名 AI 总结');
});

t('L4-2 提交按钮门禁与失败态：aria-disabled + title 缺口；加载失败保留按钮与错误反馈', () => {
  const source = fs.readFileSync(new URL('../web/build.js', import.meta.url), 'utf8');
  const fn = ['summaryBtnText', 'translateBtnText', 'normalizeFlowEval', 'translateBtnHtml', 'commitBtnHtml', 'docsStageBar', 'renderDocsPane']
    .map((n) => extractFn(source, n)).join('\n');
  const ctx = {
    pfOf: (v) => v.pf, esc: (s) => String(s), short: (h) => String(h || '').slice(0, 8), fmtTime: () => 't',
    ...FLOW_STUB,
  };
  const blocked = vmRun(fn, ctx, `renderDocsPane({
    id: 'V', pf: { phase: 'ready', plan: { docsFlow: { files: [
      { file: 'README.md', state: 'unsummarized' }], reviewedCount: 0, canCommit: false,
      missing: [{ file: 'README.md', state: 'unsummarized' }] }, docs: {} } } })`);
  assert.match(blocked, /aria-disabled="true"/, '未达 8/8 时提交按钮禁用态');
  assert.match(blocked, /title="[^"]*README\.md/, 'title 缺口明细');

  const failed = vmRun(fn, ctx, `renderDocsPane({
    id: 'V', pf: { phase: 'error', error: '磁盘读取失败', plan: null } })`);
  assert.ok(failed.includes('data-pf-refresh') && failed.includes('data-pf-review'), '失败态仍渲染按钮');
  assert.ok(failed.includes('磁盘读取失败'), '失败态展示错误');
  assert.ok(failed.includes('重试'), '失败态提供重试');
});

t('L4-3 审查对话框：四类型页签 × 中英双栏 / 只读预览（BUG-20260925-006 移除编辑保存）/ 通过审核 / 同步滚动绑定', () => {
  const source = fs.readFileSync(new URL('../web/build.js', import.meta.url), 'utf8');
  // REQ-20260921-011：预览态改 Markdown 富文本渲染，renderReviewModal 新依赖 renderMd /
  // sanitizeHtml 一并提取（本 vm 上下文无 window，renderMd 自动落入源码回退分支，断言口径不变）
  const html = vmRun(
    [extractFn(source, 'sanitizeHtml'), extractFn(source, 'renderMd'), extractFn(source, 'renderReviewModal')].join('\n'),
    {
      pfOf: (v) => v.pf,
      esc: (s) => String(s),
      ...FLOW_STUB,
    }, `renderReviewModal({
    id: 'BLD-20260921-001',
    pf: {
      review: { open: true, key: 'README',
        contents: { 'README.md': '# 中', 'README_en.md': '# EN' } },
      plan: { docsFlow: { files: [
        { key: 'README', lang: 'cn', file: 'README.md', state: 'reviewed' }, { key: 'README', lang: 'en', file: 'README_en.md', state: 'unsummarized' },
        { key: 'CHANGELOG', lang: 'cn', file: 'CHANGELOG.md', state: 'unsummarized' }, { key: 'CHANGELOG', lang: 'en', file: 'CHANGELOG_en.md', state: 'unsummarized' },
        { key: 'FEATURES', lang: 'cn', file: 'FEATURES.md', state: 'unsummarized' }, { key: 'FEATURES', lang: 'en', file: 'FEATURES_en.md', state: 'unsummarized' },
        { key: 'AGENTS', lang: 'cn', file: 'AGENTS.md', state: 'unsummarized' }, { key: 'AGENTS', lang: 'en', file: 'AGENTS_en.md', state: 'unsummarized' },
      ], reviewedCount: 1 } } } })`);
  for (const k of ['README', 'CHANGELOG', 'FEATURES', 'AGENTS']) {
    assert.ok(html.includes(`data-review-tab="${k}"`), `类型页签 ${k}`);
  }
  assert.ok(html.includes('README.md') && html.includes('README_en.md'), '页签内中英双栏');
  // BUG-20260925-006：审查对话框只读化——编辑/预览切换与保存控件移除，编辑走「② 二次编辑」
  assert.ok(!html.includes('data-review-mode') && !html.includes('data-review-save') && !html.includes('bld-review-editor'), '无编辑/预览切换与保存控件');
  assert.ok(html.includes('data-review-approve'), '通过审核按钮');
  assert.match(html, /已审核 \d+\/8|1\/8/, '页脚已审核计数');
  assert.match(html, /同步滚动/, '双栏同步滚动说明/标注');

  // 文件名标识豁免（BUG-20260921-004 口径沿用）
  assert.match(html, /data-i18n-skip/, '文件名 data-i18n-skip 豁免');

  // 同步滚动实现契约：按 scrollHeight 比例 + 互斥标志防回环
  assert.match(source, /syncReviewScroll|scrollRatio/, '存在同步滚动绑定函数');
  assert.match(source, /scrollHeight/, '按滚动高度比例跟随');
});

t('L4-4 文案更名与轮询：docs 页签「AI 写作」清零、官网侧已随 REQ-20260921-007 统一更名；AI 总结进度轮询存在', () => {
  const source = fs.readFileSync(new URL('../web/build.js', import.meta.url), 'utf8');
  const pane = source.match(/  function renderDocsPane\(v\) \{[\s\S]*?\n  \}/)[0];
  assert.ok(!pane.includes('AI 写作'), '文档编写页签内 AI 写作清零');
  // 008 当时官网侧保留不在本单范围；REQ-20260921-007 起随统一更名清理
  assert.ok(source.includes('官网 AI 总结'), '正式发布步官网 AI 总结（REQ-20260921-007 统一更名）');
  assert.ok(!source.includes('官网 AI 写作'), '正式发布步官网旧文案无残留');
  assert.ok(source.includes('docs-summary/current'), 'docs 步轮询 AI 总结进度');
  assert.ok(/summaryTimer|SUMMARY_POLL/.test(source), '轮询定时器管理存在');
});

/* ---------- L5 任务模块与全局面板（app.js / server 聚合） ---------- */

t('L5-1 任务模块：AI 总结页签与面板渲染（进度/当前文件/独立锁/失败/空态）', () => {
  const source = fs.readFileSync(new URL('../web/app.js', import.meta.url), 'utf8');
  assert.ok(source.includes('data-bmode="summary"'), '一级页签 AI 总结');
  assert.ok(source.includes('renderSummaryPanel'), '面板渲染函数');
  assert.ok(source.includes('refreshSummary'), '随轮询刷新函数');
  for (const s of ['独立锁', '当前：', 'AI 总结']) assert.ok(source.includes(s), `面板文案 ${s}`);
});

t('L5-2 全局任务面板：kind=summary 标签 / 筛选 / 前缀兜底 / 计数口径', () => {
  const source = fs.readFileSync(new URL('../web/app.js', import.meta.url), 'utf8');
  assert.match(source, /GLOBAL_KIND_LABEL\s*=\s*\{[^}]*summary:\s*'AI 总结'/, '类型标签');
  assert.match(source, /GLOBAL_KIND_FILTERS[\s\S]*?\{ key: 'summary', label: 'AI 总结' \}/, '类型筛选档');
  assert.match(source, /\['sum-', 'summary'\]/, '前缀兜底');
});

/* ---------- L6 i18n ---------- */

t('L6-1 i18n：新增文案中英词条齐备；「AI 写作」文档页旧键清理；往返不变形', () => {
  const I = globalThis.ATBI18N;
  assert.ok(I, 'i18n.js 应在 globalThis.ATBI18N 暴露接口');
  const { EN } = I._dict;
  assert.equal(EN['AI 总结'], 'AI summary');
  for (const k of ['未总结', '正在总结', '已总结待审核', '已审核', '审查', '通过审核', '刷新']) {
    assert.ok(typeof EN[k] === 'string' && EN[k], `词条缺失：${k}`);
  }
  // 旧键清理：文档页「AI 写作」与「提交文档到 Git」按钮键随界面移除
  //（官网键 008 时保留；REQ-20260921-007 起统一更名「官网 AI 总结」，旧键清理）
  assert.ok(!('AI 写作' in EN), '「AI 写作」旧键清理');
  assert.ok(!('提交文档到 Git' in EN), '「提交文档到 Git」旧键清理');
  assert.ok('官网 AI 总结' in EN, '官网键已随 REQ-20260921-007 更名');
  assert.ok(!('官网 AI 写作' in EN), '官网旧键已清理');
  // 往返不变形
  I.setLang('en');
  assert.equal(I.t('AI 总结'), 'AI summary');
  I.setLang('zh');
  assert.equal(I.t('AI 总结'), 'AI 总结');
});

t('L6-2 回归：evaluateDocsState / publishStepsState 零改动（合并门禁不受影响）', () => {
  // 无任何文件 → none；有已写文件但未提交记录 → uncommitted（存量口径：已写未提交）
  assert.equal(flow.evaluateDocsState({}, readsOf({})).overall, 'none', '存量状态机口径不变');
  assert.equal(flow.evaluateDocsState({}, readsOf({ 'README.md': '# r' })).overall, 'uncommitted');
  // 八文件齐且 hash 与提交记录一致 → committed（合并前置口径不变）
  const all = {};
  for (const f of flow.publishDocFiles()) all[f.file] = `# ${f.key}`;
  const rec = { commitHash: 'x', files: {} };
  for (const f of flow.publishDocFiles()) rec.files[f.file] = sha256(all[f.file]);
  assert.equal(flow.evaluateDocsState({ docs: rec }, readsOf(all)).overall, 'committed');
  const steps = flow.publishStepsState({ items: [{ itemId: 'X', commit: 'a' }], status: 'draft' }, { overall: 'none' });
  assert.equal(steps.find((s) => s.key === 'merge').locked, true, '文档未提交仍锁合并');
});

/* ---------- 执行 ---------- */

for (const [name, fn] of cases) {
  fn();
  console.log(`✓ ${name}`);
}
console.log(`\n共 ${cases.length} 例，全部通过`);
