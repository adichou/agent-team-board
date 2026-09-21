#!/usr/bin/env node
// REQ-20260921-012 发布模块文档编写三阶段流程 —— 分层测试。
// L1 纯逻辑（publish-flow：七态状态机 / AI 总结范围收窄 / AI 翻译提示词 / 基准变更检测 /
//    canTranslate / canFinalize / finalized / canCommit 叠加完结门禁）；
// L2 数据层（docs-translate-store 账本与独立锁；build-store 完结记录；summary 账本收窄）；
// L3 服务接口（translate start/current 门禁、docs/finalize、commit 完结前置、publish-plan
//    阶段字段、全局简报 kind=translate）；
// L4 前端静态契约（renderDocsPane 阶段条 + 六按钮 + 语言分组 + 门禁条；完结对核对话框；
//    禁用态 title 缺口）；
// L5 任务模块与全局面板（AI 翻译页签、kind=translate 标签 / 筛选 / 前缀兜底 / 计数口径）；
// L6 i18n（新增文案中英同步；旧门禁动态键随口径迁移）。
// 用法：node scripts/tests/req-20260921-012.test.mjs

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
import * as translateStore from '../lib/docs-translate-store.mjs';
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
const readsOf = (contents) => (f) => (Object.prototype.hasOwnProperty.call(contents, f) ? contents[f] : null);
const statsOf = (stats) => (f) => (Object.prototype.hasOwnProperty.call(stats, f) ? stats[f] : null);

const cases = [];
const t = (name, fn) => cases.push([name, fn]);

/* ---------- L1 纯逻辑（publish-flow.mjs） ---------- */

t('L1-1 七态枚举与文案：剩余语言 未翻译/正在翻译/已翻译待审核（reviewed 共用）', () => {
  assert.deepEqual(Object.keys(flow.DOCS_FLOW_LABEL), [
    'unsummarized', 'summarizing', 'summarized', 'untranslated', 'translating', 'translated', 'reviewed',
  ]);
  assert.equal(flow.DOCS_FLOW_LABEL.untranslated, '未翻译');
  assert.equal(flow.DOCS_FLOW_LABEL.translating, '正在翻译');
  assert.equal(flow.DOCS_FLOW_LABEL.translated, '已翻译待审核');
  assert.equal(flow.DOCS_FLOW_LABEL.reviewed, '已审核');
});

t('L1-2 evaluateDocsFlow 分组求值：剩余语言初始「未翻译」；translating/translated 生效；默认语言沿用四态', () => {
  const contents = {};
  for (const f of flow.publishDocFiles()) contents[f.file] = `# ${f.file}\n`;
  let r = flow.evaluateDocsFlow({}, readsOf(contents), {});
  assert.equal(r.files.length, 8);
  assert.deepEqual(r.defaultFiles.map((f) => f.file), ['README.md', 'CHANGELOG.md', 'FEATURES.md', 'AGENTS.md']);
  assert.deepEqual(r.restFiles.map((f) => f.file), ['README_en.md', 'CHANGELOG_en.md', 'FEATURES_en.md', 'AGENTS_en.md']);
  assert.ok(r.defaultFiles.every((f) => f.state === 'unsummarized'), '默认语言初始未总结');
  assert.ok(r.restFiles.every((f) => f.state === 'untranslated'), '剩余语言初始未翻译（不与未总结混排）');
  assert.equal(r.defaultReviewedCount, 0);
  assert.equal(r.restReviewedCount, 0);

  r = flow.evaluateDocsFlow({}, readsOf(contents), {
    summarizing: ['README.md'],
    summarized: ['CHANGELOG.md'],
    translating: ['README_en.md'],
    translated: ['CHANGELOG_en.md'],
  });
  assert.equal(r.files.find((f) => f.file === 'README.md').state, 'summarizing');
  assert.equal(r.files.find((f) => f.file === 'CHANGELOG.md').state, 'summarized');
  assert.equal(r.files.find((f) => f.file === 'README_en.md').state, 'translating');
  assert.equal(r.files.find((f) => f.file === 'CHANGELOG_en.md').state, 'translated');
});

t('L1-3 提示词：AI 总结仅默认语言 4 文件；AI 翻译以已审核默认语言为唯一基准 + atb translate 回执', () => {
  const p = flow.buildDocSummaryPrompt({
    projectRoot: '/tmp/proj-x', planId: 'BLD-20260921-012', runId: 'sum-20260921-010101-ab01',
    items: [{ itemId: 'REQ-20260921-012', commit: 'a'.repeat(40), title: '三阶段流程' }],
    atbPath: '/tmp/atb.mjs',
  });
  for (const f of ['README.md', 'CHANGELOG.md', 'FEATURES.md', 'AGENTS.md']) {
    assert.ok(p.includes(`${f}（`), `总结清单含默认语言 ${f}`);
  }
  assert.ok(!p.includes('README_en.md') && !p.includes('_en.md'), '总结清单不再包含剩余语言文件');

  const base = {
    'README.md': '# 默认语言基准内容\n[更新日志](CHANGELOG.md)\n',
    'CHANGELOG.md': '# 更新\n', 'FEATURES.md': '# 功能\n', 'AGENTS.md': '# 规则\n',
  };
  const tp = flow.buildDocTranslatePrompt({
    projectRoot: '/tmp/proj-x', planId: 'BLD-20260921-012', runId: 'tr-20260921-010101-cd01',
    items: [{ itemId: 'REQ-20260921-012', commit: 'a'.repeat(40), title: '三阶段流程' }],
    langs: ['cn', 'en'],
    readFile: readsOf(base),
    atbPath: '/tmp/atb.mjs',
  });
  assert.ok(tp.includes('tr-20260921-010101-cd01'), '翻译提示词带 runId');
  assert.ok(tp.includes('# 默认语言基准内容'), '翻译基准（已审核默认语言全文）嵌入提示词');
  assert.ok(tp.includes('唯一') && tp.includes('基准'), '声明唯一基准约束');
  for (const f of ['README_en.md', 'CHANGELOG_en.md', 'FEATURES_en.md', 'AGENTS_en.md']) {
    assert.ok(tp.includes(f), `翻译目标清单含 ${f}`);
  }
  assert.ok(tp.includes('translate file') && tp.includes('translate done') && tp.includes('translate fail'), 'atb translate 回执指令');
  assert.ok(tp.includes('不得编造') || tp.includes('不得引入基准外信息'), '翻译约束');
});

t('L1-4 canTranslate 门禁：默认语言未 4/4 已审核前 false 且 translateMissing 带缺口；单语言集 false', () => {
  const contents = {};
  for (const f of flow.publishDocFiles()) contents[f.file] = `# ${f.key}\n`;
  const files = {};
  for (const f of flow.publishDocFiles()) files[f.file] = { hash: sha256(contents[f.file]), at: '2026-09-21T00:00:00Z' };
  const two = {};
  for (const f of ['README.md', 'CHANGELOG.md']) two[f] = files[f];
  let r = flow.evaluateDocsFlow({ review: { files: two } }, readsOf(contents), {});
  assert.equal(r.defaultReviewedCount, 2);
  assert.equal(r.canTranslate, false, '默认语言未全审不可翻译');
  assert.deepEqual(r.translateMissing.map((m) => m.file), ['FEATURES.md', 'AGENTS.md'], '缺口明细为默认语言文件');

  const four = {};
  for (const f of ['README.md', 'CHANGELOG.md', 'FEATURES.md', 'AGENTS.md']) four[f] = files[f];
  r = flow.evaluateDocsFlow({ review: { files: four } }, readsOf(contents), {});
  assert.equal(r.canTranslate, true, '默认语言 4/4 已审核解锁 AI 翻译');
  assert.deepEqual(r.translateMissing, []);

  r = flow.evaluateDocsFlow({ langs: ['cn'], review: { files: four } }, readsOf({ 'README.md': '# r' }), {});
  assert.equal(r.restFiles.length, 0, '单语言集无剩余语言');
  assert.equal(r.canTranslate, false, '单语言集不可 AI 翻译（无文件可翻）');
});

t('L1-5 基准变更检测（mtime）：默认语言文档更新 → 剩余语言（含已审核）回退「未翻译」，完结失效；相同 / 缺失不回退', () => {
  const contents = {};
  for (const f of flow.publishDocFiles()) contents[f.file] = `# ${f.key}\n`;
  const review = {};
  for (const f of flow.publishDocFiles()) review[f.file] = { hash: sha256(contents[f.file]), at: '2026-09-21T00:00:00Z' };
  const finalized = { at: '2026-09-21T01:00:00Z', langsKey: 'cn,en', files: {} };
  const v = { review: { files: review, finalized } };

  // 无 statFile（纯函数缺省）：不做检测
  let r = flow.evaluateDocsFlow(v, readsOf(contents), {});
  assert.equal(r.files.find((f) => f.file === 'README_en.md').state, 'reviewed');
  assert.deepEqual(r.baselineShift, []);

  // 默认语言晚于剩余语言 → 回退
  const stats = {};
  for (const f of flow.publishDocFiles()) stats[f.file] = 100;
  stats['README.md'] = 200; // 默认语言 README 更新（外部编辑器落盘 / 界面保存同样更新 mtime）
  assert.deepEqual(flow.detectBaselineShift(['cn', 'en'], statsOf(stats)), ['README_en.md'], '纯函数检测命中');
  r = flow.evaluateDocsFlow(v, readsOf(contents), {}, { statFile: statsOf(stats) });
  assert.equal(r.files.find((f) => f.file === 'README_en.md').state, 'untranslated', '受影响翻译文档回退未翻译');
  assert.equal(r.files.find((f) => f.file === 'CHANGELOG_en.md').state, 'reviewed', '未受影响文件保持已审核');
  assert.deepEqual(r.baselineShift, ['README_en.md']);
  assert.equal(r.canFinalize, false, '基准变更使整体完结失效');
  assert.equal(r.finalized, null, '完结标识失效回退');
  assert.equal(r.canCommit, false, '提交门禁不放行');

  // 相同 mtime / stat 缺失：不回退（弱信号，严格大于才命中）
  stats['README.md'] = 100;
  r = flow.evaluateDocsFlow(v, readsOf(contents), {}, { statFile: statsOf(stats) });
  assert.equal(r.files.find((f) => f.file === 'README_en.md').state, 'reviewed', 'mtime 相同不回退');
  delete stats['README_en.md'];
  r = flow.evaluateDocsFlow(v, readsOf(contents), {}, { statFile: statsOf(stats) });
  assert.equal(r.files.find((f) => f.file === 'README_en.md').state, 'reviewed', 'stat 缺失不回退');
});

t('L1-6 canFinalize / finalized / canCommit：全审方可完结；完结前提交不放行；scopeStale / 语言集变化失效', () => {
  const contents = {};
  for (const f of flow.publishDocFiles()) contents[f.file] = `# ${f.key}\n`;
  const files = {};
  for (const f of flow.publishDocFiles()) files[f.file] = { hash: sha256(contents[f.file]), at: '2026-09-21T00:00:00Z' };
  const finalized = { at: '2026-09-21T01:00:00Z', langsKey: 'cn,en', files: {} };

  let r = flow.evaluateDocsFlow({ review: { files } }, readsOf(contents), {});
  assert.equal(r.canFinalize, true, '全部已审核可整体完结');
  assert.equal(r.finalized, null, '未有人工完结动作');
  assert.equal(r.canCommit, false, '整体审查未完结前提交不放行（叠加门禁）');

  r = flow.evaluateDocsFlow({ review: { files, finalized } }, readsOf(contents), {});
  assert.deepEqual(r.finalized, { at: finalized.at }, '完结记录有效');
  assert.equal(r.canCommit, true, '全审 + 已完结可提交');

  // scopeStale：审核与完结一并失效
  r = flow.evaluateDocsFlow({ review: { files, finalized }, docs: { scopeStale: true } }, readsOf(contents), {});
  assert.equal(r.finalized, null);
  assert.equal(r.canFinalize, false);
  assert.equal(r.canCommit, false);

  // 语言集变化（新增语言）：文件集变化，完结失效
  const fr = { ...contents, 'README_fr.md': '# fr', 'CHANGELOG_fr.md': '# fr', 'FEATURES_fr.md': '# fr', 'AGENTS_fr.md': '# fr' };
  r = flow.evaluateDocsFlow({ langs: 'cn,en,fr', review: { files, finalized } }, readsOf(fr), {});
  assert.equal(r.files.length, 12);
  assert.equal(r.finalized, null, '语言集变化完结失效回退');

  // 部分审核：不可完结
  const partial = { 'README.md': files['README.md'] };
  r = flow.evaluateDocsFlow({ review: { files: partial, finalized } }, readsOf(contents), {});
  assert.equal(r.canFinalize, false);
  assert.equal(r.canCommit, false);
});

/* ---------- L2 数据层（docs-translate-store / build-store / summary 收窄） ---------- */

function mkData(tmp) {
  const proj = mkRepo(path.join(tmp, 'proj'));
  fs.writeFileSync(path.join(proj, 'base.txt'), 'base');
  git(proj, ['add', '-A']); git(proj, ['commit', '-m', 'init']);
  core.initData(proj);
  return { proj, dataDir: core.dataDirFrom(proj) };
}

t('L2-1 AI 翻译账本与独立锁：仅剩余语言文件、translate.lock、重复 start 拒绝、单语言集报错、与 summary 互不占用', () => {
  const { dataDir } = mkData(tmpdir('atb-012-l21-'));
  const run = translateStore.createTranslateRun(dataDir, { verId: 'BLD-20260921-001', owner: 'tr-1', langs: ['cn', 'en'] });
  assert.match(run.runId, /^tr-\d{8}-\d{6}-[0-9a-f]{4,}$/);
  assert.equal(run.phase, 'running');
  assert.deepEqual(Object.keys(run.files).sort(), ['AGENTS_en.md', 'CHANGELOG_en.md', 'FEATURES_en.md', 'README_en.md'], '仅剩余语言 4 文件');
  assert.ok(Object.values(run.files).every((s) => s === 'pending'));

  const lockFile = path.join(dataDir, 'runtime', '.locks', 'translate.lock');
  assert.ok(fs.existsSync(lockFile), '运行期间占用 translate.lock');
  assert.equal(JSON.parse(fs.readFileSync(lockFile, 'utf8')).runId, run.runId);
  const locks = fs.readdirSync(path.join(dataDir, 'runtime', '.locks'));
  assert.ok(!locks.includes('summary.lock') && !locks.includes('impl.lock') && !locks.includes('refine.lock'), '不占其他锁');

  assert.throws(
    () => translateStore.createTranslateRun(dataDir, { verId: 'BLD-20260921-002', owner: 'tr-2', langs: ['cn', 'en'] }),
    /已有进行中的 AI 翻译/,
    '同一时间至多一个 AI 翻译任务',
  );
  assert.throws(
    () => translateStore.createTranslateRun(dataDir, { verId: 'BLD-20260921-003', owner: 'tr-3', langs: ['cn'] }),
    /无剩余语言/,
    '单语言集不可启动 AI 翻译',
  );
  translateStore.finishTranslateRun(dataDir, run.runId, { result: 'done', summary: '完成' });
  assert.ok(!fs.existsSync(lockFile), '收尾释放锁');
});

t('L2-2 markTranslateFile / finishTranslateRun / marks 聚合：进度流转、集合外拒绝、不悬挂可续跑', () => {
  const { dataDir } = mkData(tmpdir('atb-012-l22-'));
  const run = translateStore.createTranslateRun(dataDir, { verId: 'BLD-20260921-001', owner: 'tr-1', langs: ['cn', 'en'] });
  translateStore.markTranslateFile(dataDir, run.runId, 'README_en.md', 'translating');
  translateStore.markTranslateFile(dataDir, run.runId, 'README_en.md', 'translated');
  translateStore.markTranslateFile(dataDir, run.runId, 'CHANGELOG_en.md', 'translating');
  assert.equal(translateStore.getTranslateRun(dataDir, run.runId).files['README_en.md'], 'translated');
  assert.throws(() => translateStore.markTranslateFile(dataDir, run.runId, 'README.md', 'translating'), /非 AI 翻译目标文件/, '默认语言文件不在翻译账本');
  assert.throws(() => translateStore.markTranslateFile(dataDir, run.runId, 'evil.txt', 'translating'), /非 AI 翻译目标文件/);
  assert.throws(() => translateStore.markTranslateFile(dataDir, run.runId, 'README_en.md', 'done'), /state/);

  translateStore.finishTranslateRun(dataDir, run.runId, { result: 'failed', reason: '网络中断' });
  const after = translateStore.getTranslateRun(dataDir, run.runId);
  assert.equal(after.files['CHANGELOG_en.md'], 'pending', '中断文件不悬挂「正在翻译」');
  assert.equal(after.files['README_en.md'], 'translated', '已翻译完成跨 run 保留');

  const marks = translateStore.translateMarksForVer(dataDir, 'BLD-20260921-001');
  assert.deepEqual(marks.translated, ['README_en.md']);
  assert.deepEqual(marks.translating, []);

  const view = translateStore.translateRunView(translateStore.latestTranslateRun(dataDir));
  assert.equal(view.counts.total, 4);
  assert.equal(view.counts.translated, 1);
  assert.equal(view.lock, 'translate');
  const brief = translateStore.translateBrief(after);
  assert.equal(brief.kind, 'translate');
  assert.equal(brief.counts.total, 4);
});

t('L2-3 recordDocsFinalize：落 v.review.finalized（langsKey + 文件 hash），不动 v.docs', () => {
  const { proj, dataDir } = mkData(tmpdir('atb-012-l23-'));
  const commitA = git(proj, ['rev-parse', 'HEAD']);
  const reqA = core.createItem(dataDir, { type: 'requirement', title: 'A', by: 'test' });
  for (const s of ['accepted', 'in-progress', 'done']) core.setStatus(dataDir, reqA.id, s, { by: 'test' });
  const v = buildStore.createVersion(dataDir, { items: [{ itemId: reqA.id, commit: commitA }] });

  const contents = {};
  for (const f of flow.publishDocFiles()) contents[f.file] = `# ${f.key}\n`;
  const out = buildStore.recordDocsFinalize(dataDir, v.id, { langs: ['cn', 'en'], readFile: readsOf(contents) });
  assert.equal(out.review.finalized.langsKey, 'cn,en');
  assert.equal(Object.keys(out.review.finalized.files).length, 8, '完结快照覆盖语言集全文件');
  assert.equal(out.review.finalized.files['README_en.md'], sha256(contents['README_en.md']));
  assert.ok(out.review.finalized.at);
  assert.equal(out.docs, undefined, '不写 v.docs（提交记录语义隔离）');
});

t('L2-4 AI 总结账本随范围收窄：createSummaryRun 仅默认语言 4 文件', () => {
  const { dataDir } = mkData(tmpdir('atb-012-l24-'));
  const run = summaryStore.createSummaryRun(dataDir, { verId: 'BLD-20260921-001', owner: 's', langs: ['cn', 'en'] });
  assert.deepEqual(Object.keys(run.files).sort(), ['AGENTS.md', 'CHANGELOG.md', 'FEATURES.md', 'README.md'], '总结只装默认语言文件');
  assert.equal(summaryStore.summaryRunView(run).counts.total, 4);
  assert.throws(() => summaryStore.markSummaryFile(dataDir, run.runId, 'README_en.md', 'summarizing'), /非发布文档文件/, '剩余语言文件不在总结账本');
  summaryStore.finishSummaryRun(dataDir, run.runId, { result: 'done', summary: '完成' });

  const run3 = summaryStore.createSummaryRun(dataDir, { verId: 'BLD-20260921-002', owner: 's', langs: ['en', 'cn', 'fr'] });
  assert.deepEqual(Object.keys(run3.files).sort(), ['AGENTS.md', 'CHANGELOG.md', 'FEATURES.md', 'README.md'], '默认语言为 en（首语言）');
  summaryStore.finishSummaryRun(dataDir, run3.runId, { result: 'done', summary: '完成' });
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

t('L3 服务接口：三阶段门禁 / AI 翻译 / 整体完结 / 提交前置 / 全局简报', async () => {
  const tmp = tmpdir('atb-012-serve-');
  const proj = mkRepo(path.join(tmp, 'proj'));
  fs.writeFileSync(path.join(proj, 'base.txt'), 'base');
  git(proj, ['add', '-A']); git(proj, ['commit', '-m', 'init']);
  git(proj, ['switch', '-c', 'dev']);
  fs.writeFileSync(path.join(proj, 'a.txt'), 'A');
  git(proj, ['add', '-A']); git(proj, ['commit', '-m', 'feat: A REQ-20260921-001']);
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

    // 阶段一：publish-plan 阶段字段 + 剩余语言初始未翻译
    r = await req(port, 'GET', `/api/build/publish-plan${P}&id=${vid}`);
    assert.equal(r.status, 200);
    const fe = r.json.docsFlow;
    assert.equal(fe.files.length, 8);
    assert.equal(fe.defaultReviewedCount, 0);
    assert.equal(fe.restReviewedCount, 0);
    assert.ok(fe.restFiles.every((f) => f.state === 'untranslated'), '剩余语言初始未翻译');
    assert.equal(fe.canTranslate, false);
    assert.equal(fe.canFinalize, false);
    assert.equal(fe.finalized, null);
    assert.equal(r.json.translate, null, 'translate 视图字段存在（无 run 为 null）');

    // AI 总结启动：提示词与账本收窄为默认语言 4 文件
    r = await req(port, 'POST', `/api/build/docs-summary/start${P}`, { id: vid });
    assert.equal(r.status, 200, `summary start：${r.text}`);
    const sumRunId = r.json.runId;
    assert.ok(!r.json.prompt.includes('README_en.md'), '总结提示词不含剩余语言文件');
    summaryStore.markSummaryFile(dataDir, sumRunId, 'README.md', 'summarized');
    r = await req(port, 'GET', `/api/build/docs-summary/current${P}&id=${vid}`);
    assert.equal(r.json.run.counts.total, 4, '进度 x/4');
    summaryStore.finishSummaryRun(dataDir, sumRunId, { result: 'done', summary: '默认语言完成' });

    // AI 翻译门禁：默认语言未全审 400 带缺口
    r = await req(port, 'POST', `/api/build/docs-translate/start${P}`, { id: vid });
    assert.equal(r.status, 400, '默认语言未全审不可启动 AI 翻译');
    assert.match(r.json.error || '', /默认语言|已审核/);

    // 默认语言 4 文件写入并审核（默认语言先写，避免基准变更误报）
    const defFiles = flow.publishDocFiles(['cn', 'en']).filter((f) => f.lang === 'cn');
    for (const f of defFiles) {
      fs.writeFileSync(path.join(proj, f.file), `# ${f.key}\n`);
      r = await req(port, 'POST', `/api/build/docs/review${P}`, { id: vid, file: f.file });
      assert.equal(r.status, 200, `review ${f.file}：${r.text}`);
    }
    r = await req(port, 'GET', `/api/build/publish-plan${P}&id=${vid}`);
    assert.equal(r.json.docsFlow.canTranslate, true, '默认语言 4/4 已审核解锁 AI 翻译');

    // 提交门禁：全部未审不可提交
    r = await req(port, 'POST', `/api/build/docs/commit${P}`, { id: vid });
    assert.equal(r.status, 400, '未全审不可提交');

    // AI 翻译启动：200 返回 runId + 提示词（基准嵌入）
    r = await req(port, 'POST', `/api/build/docs-translate/start${P}`, { id: vid });
    assert.equal(r.status, 200, `translate start：${r.text}`);
    const trRunId = r.json.runId;
    assert.ok(trRunId.startsWith('tr-'));
    assert.ok(r.json.prompt.includes('README_en.md') && r.json.prompt.includes('# README'), '翻译提示词含目标清单与基准');
    assert.deepEqual(r.json.baselineShift || [], [], '启动时无基准变更');
    // 重复 start 拒绝
    r = await req(port, 'POST', `/api/build/docs-translate/start${P}`, { id: vid });
    assert.equal(r.status, 400, '已有进行中的翻译任务拒绝重复 start');

    // 翻译进度：current 反映 1/4；全局面板出现 kind=translate
    translateStore.markTranslateFile(dataDir, trRunId, 'README_en.md', 'translated');
    r = await req(port, 'GET', `/api/build/docs-translate/current${P}&id=${vid}`);
    assert.equal(r.json.run.runId, trRunId);
    assert.equal(r.json.run.counts.translated, 1, '翻译进度 1/4');
    r = await req(port, 'GET', '/api/batch/global');
    let row = (r.json.projects || []).find((p) => p.root === proj);
    let brief = (row.tasks || []).find((x) => x.kind === 'translate');
    assert.ok(brief, '进行中 AI 翻译进入全局面板');
    assert.equal(brief.counts.total, 4);

    // 剩余语言文件落盘（翻译产出）并审核；收尾翻译 run
    const restFiles = flow.publishDocFiles(['cn', 'en']).filter((f) => f.lang !== 'cn');
    for (const f of restFiles) {
      fs.writeFileSync(path.join(proj, f.file), `# ${f.key} en\n`);
      r = await req(port, 'POST', `/api/build/docs/review${P}`, { id: vid, file: f.file });
      assert.equal(r.status, 200, `review ${f.file}：${r.text}`);
    }
    translateStore.finishTranslateRun(dataDir, trRunId, { result: 'done', summary: '翻译完成' });
    r = await req(port, 'GET', '/api/batch/global');
    row = (r.json.projects || []).find((p) => p.root === proj);
    assert.ok(!((row.tasks || []).some((x) => x.kind === 'translate')), '收尾后全局面板移出');

    // 全部已审核：可完结；完结前提交被阻止
    r = await req(port, 'GET', `/api/build/publish-plan${P}&id=${vid}`);
    assert.equal(r.json.docsFlow.canFinalize, true, '4×N 全部已审核可整体完结');
    assert.equal(r.json.docsFlow.finalized, null);
    assert.equal(r.json.docsFlow.canCommit, false, '完结前提交不放行');
    r = await req(port, 'POST', `/api/build/docs/commit${P}`, { id: vid });
    assert.equal(r.status, 400, '整体审查未完结不可提交');
    assert.match(r.json.error || '', /整体审查|完结/);

    // 整体审查完结：200 落记录；提交解锁
    r = await req(port, 'POST', `/api/build/docs/finalize${P}`, { id: vid });
    assert.equal(r.status, 200, `finalize：${r.text}`);
    assert.ok(r.json.docsFlow.finalized && r.json.docsFlow.finalized.at, '完结标识与时间');
    assert.equal(r.json.docsFlow.canCommit, true, '完结后提交解锁');
    r = await req(port, 'POST', `/api/build/docs/commit${P}`, { id: vid });
    assert.equal(r.status, 200, `commit：${r.text}`);
    assert.ok(/^[0-9a-f]{40}$/.test(r.json.commitHash));
    const show = git(proj, ['show', '--name-only', '--format=', r.json.commitHash]).split('\n').filter(Boolean);
    assert.equal(new Set(show).size, 8, 'pathspec 只含语言集内八文档');

    // 基准变更：外部修改默认语言文档（mtime 更新）→ 剩余语言回退未翻译、完结失效
    await sleep(20);
    fs.writeFileSync(path.join(proj, 'README.md'), '# README 改\n[更新日志](CHANGELOG.md) [功能](FEATURES.md)\n');
    r = await req(port, 'GET', `/api/build/publish-plan${P}&id=${vid}`);
    assert.deepEqual(r.json.docsFlow.baselineShift, ['README_en.md'], '基准变更检测命中（不依赖界面保存按钮）');
    assert.equal(r.json.docsFlow.files.find((f) => f.file === 'README_en.md').state, 'untranslated', '受影响翻译文档回退未翻译');
    assert.equal(r.json.docsFlow.finalized, null, '完结失效回退');
    assert.equal(r.json.docsFlow.canCommit, false, '提交重新锁上');
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

function vmRun(fns, context, expr) {
  const ctx = vm.createContext(context);
  vm.runInContext(fns, ctx);
  return vm.runInContext(expr, ctx);
}

const FLOW_STUB = {
  DOCS_FLOW_LABEL: {
    unsummarized: '未总结', summarizing: '正在总结', summarized: '已总结待审核',
    untranslated: '未翻译', translating: '正在翻译', translated: '已翻译待审核', reviewed: '已审核',
  },
  DOCS_FLOW_CLS: {
    unsummarized: 'st-mute', summarizing: 'st-run', summarized: 'st-wait',
    untranslated: 'st-mute', translating: 'st-run', translated: 'st-wait', reviewed: 'st-ok',
  },
  DOCS_FLOW_ICON: {
    unsummarized: '○', summarizing: '◐', summarized: '●',
    untranslated: '○', translating: '◐', translated: '●', reviewed: '✔',
  },
  DOC_KEYS: ['README', 'CHANGELOG', 'FEATURES', 'AGENTS'],
  DEFAULT_DOC_LANGS: ['cn', 'en'],
  langNameOf: (l) => String(l),
  docFilesOf: (langs) => flow.publishDocFiles(Array.isArray(langs) && langs.length ? langs : flow.DEFAULT_DOC_LANGS),
};

const L4_CTX = {
  pfOf: (v) => v.pf,
  esc: (s) => String(s),
  short: (h) => String(h || '').slice(0, 8),
  fmtTime: () => 't',
  ...FLOW_STUB,
};

function docsPaneFns(source) {
  return [
    extractFn(source, 'summaryBtnText'), extractFn(source, 'translateBtnText'),
    extractFn(source, 'normalizeFlowEval'),
    extractFn(source, 'translateBtnHtml'), extractFn(source, 'finalizeBtnHtml'),
    extractFn(source, 'commitBtnHtml'), extractFn(source, 'docsStageBar'),
    extractFn(source, 'renderDocsPane'), extractFn(source, 'renderFinalizeModal'),
  ].join('\n');
}

t('L4-1 renderDocsPane：阶段条三阶段 + 六按钮 + 语言成组文件列表 + 剩余语言「未翻译」+ 门禁条分组计数', () => {
  const source = fs.readFileSync(new URL('../web/build.js', import.meta.url), 'utf8');
  const html = vmRun(docsPaneFns(source), L4_CTX, `renderDocsPane({
    id: 'BLD-20260921-012',
    pf: { phase: 'ready', plan: {
      langs: ['cn', 'en'],
      docsFlow: {
        files: [
          { key: 'README', lang: 'cn', file: 'README.md', state: 'reviewed', isDefault: true },
          { key: 'README', lang: 'en', file: 'README_en.md', state: 'translated', isDefault: false },
          { key: 'CHANGELOG', lang: 'cn', file: 'CHANGELOG.md', state: 'reviewed', isDefault: true },
          { key: 'CHANGELOG', lang: 'en', file: 'CHANGELOG_en.md', state: 'translating', isDefault: false },
          { key: 'FEATURES', lang: 'cn', file: 'FEATURES.md', state: 'reviewed', isDefault: true },
          { key: 'FEATURES', lang: 'en', file: 'FEATURES_en.md', state: 'untranslated', isDefault: false },
          { key: 'AGENTS', lang: 'cn', file: 'AGENTS.md', state: 'reviewed', isDefault: true },
          { key: 'AGENTS', lang: 'en', file: 'AGENTS_en.md', state: 'untranslated', isDefault: false },
        ],
        reviewedCount: 4, defaultReviewedCount: 4, restReviewedCount: 0,
        canTranslate: true, translateMissing: [], canFinalize: false, finalized: null,
        canCommit: false, baselineShift: [],
        missing: [{ file: 'README_en.md', state: 'translated' }, { file: 'CHANGELOG_en.md', state: 'translating' }, { file: 'FEATURES_en.md', state: 'untranslated' }, { file: 'AGENTS_en.md', state: 'untranslated' }],
      },
      summary: null, translate: { phase: 'running', counts: { translated: 1, total: 4 }, currentFile: 'CHANGELOG_en.md' },
      docs: { overall: 'none' },
    } } })`);
  // 阶段条三阶段
  for (const s of ['① 默认语言先行', '② AI 翻译与审查', '③ 整体审查完结']) {
    assert.ok(html.includes(s), `阶段 ${s}`);
  }
  // 六按钮
  for (const btn of ['data-pf-refresh', 'data-pf-summary', 'data-pf-translate', 'data-pf-review', 'data-pf-finalize', 'data-pf-commit']) {
    assert.ok(html.includes(btn), `按钮 ${btn} 存在`);
  }
  // 语言成组：默认语言组头 + 剩余语言组头；剩余语言文件行
  assert.match(html, /默认语言（/, '默认语言组头');
  assert.match(html, /剩余语言（/, '剩余语言组头');
  assert.ok(html.includes('README_en.md'));
  // 七态文案（剩余语言三态出现）
  for (const label of ['未翻译', '正在翻译', '已翻译待审核', '已审核']) {
    assert.ok(html.includes(label), `状态文字 ${label}`);
  }
  // 门禁条分组计数：默认语言 4/4 · 剩余语言 0/4
  assert.match(html, /默认语言 4\/4/, '默认语言计数');
  assert.match(html, /剩余语言 0\/4/, '剩余语言计数');
  // 翻译运行中按钮进度
  assert.match(html, /翻译中 1\/4/, 'AI 翻译按钮进度');
  // 副标题三阶段说明
  assert.match(html, /先总结审查默认语言/, '副标题说明三阶段');
});

t('L4-2 禁用态：AI 翻译 / 整体审查 / 提交的 aria-disabled + title 缺口；整体审查完结前提交禁用', () => {
  const source = fs.readFileSync(new URL('../web/build.js', import.meta.url), 'utf8');
  const fns = docsPaneFns(source);
  // 默认语言未全审：AI 翻译禁用 + title 缺口（默认语言文件）
  const html = vmRun(fns, L4_CTX, `renderDocsPane({ id: 'V', pf: { phase: 'ready', plan: {
    langs: ['cn', 'en'],
    docsFlow: { files: [
      { key: 'README', lang: 'cn', file: 'README.md', state: 'summarized', isDefault: true },
      { key: 'README', lang: 'en', file: 'README_en.md', state: 'untranslated', isDefault: false },
      { key: 'CHANGELOG', lang: 'cn', file: 'CHANGELOG.md', state: 'reviewed', isDefault: true },
      { key: 'CHANGELOG', lang: 'en', file: 'CHANGELOG_en.md', state: 'untranslated', isDefault: false },
      { key: 'FEATURES', lang: 'cn', file: 'FEATURES.md', state: 'reviewed', isDefault: true },
      { key: 'FEATURES', lang: 'en', file: 'FEATURES_en.md', state: 'untranslated', isDefault: false },
      { key: 'AGENTS', lang: 'cn', file: 'AGENTS.md', state: 'reviewed', isDefault: true },
      { key: 'AGENTS', lang: 'en', file: 'AGENTS_en.md', state: 'untranslated', isDefault: false },
    ], reviewedCount: 3, defaultReviewedCount: 3, restReviewedCount: 0, canTranslate: false,
    translateMissing: [{ file: 'README.md', state: 'summarized' }], canFinalize: false, finalized: null,
    canCommit: false, baselineShift: [], missing: [{ file: 'README.md', state: 'summarized' }] },
    docs: {} } } })`);
  assert.match(html, /data-pf-translate[^>]*aria-disabled="true"/, 'AI 翻译未解锁禁用');
  assert.match(html, /data-pf-translate[^>]*title="[^"]*README\.md/, 'AI 翻译 title 列默认语言缺口');
  assert.match(html, /data-pf-finalize[^>]*aria-disabled="true"/, '整体审查未解锁禁用');

  // 全部已审核未完结：整体审查可用、提交仍禁用（完结条件叠加）
  const html2 = vmRun(fns, L4_CTX, `renderDocsPane({ id: 'V', pf: { phase: 'ready', plan: {
    langs: ['cn', 'en'],
    docsFlow: { files: [
      { key: 'README', lang: 'cn', file: 'README.md', state: 'reviewed', isDefault: true },
      { key: 'README', lang: 'en', file: 'README_en.md', state: 'reviewed', isDefault: false },
      { key: 'CHANGELOG', lang: 'cn', file: 'CHANGELOG.md', state: 'reviewed', isDefault: true },
      { key: 'CHANGELOG', lang: 'en', file: 'CHANGELOG_en.md', state: 'reviewed', isDefault: false },
      { key: 'FEATURES', lang: 'cn', file: 'FEATURES.md', state: 'reviewed', isDefault: true },
      { key: 'FEATURES', lang: 'en', file: 'FEATURES_en.md', state: 'reviewed', isDefault: false },
      { key: 'AGENTS', lang: 'cn', file: 'AGENTS.md', state: 'reviewed', isDefault: true },
      { key: 'AGENTS', lang: 'en', file: 'AGENTS_en.md', state: 'reviewed', isDefault: false },
    ], reviewedCount: 8, defaultReviewedCount: 4, restReviewedCount: 4, canTranslate: true,
    translateMissing: [], canFinalize: true, finalized: null, canCommit: false,
    baselineShift: [], missing: [] }, docs: {} } } })`);
  assert.doesNotMatch(html2, /data-pf-finalize[^>]*aria-disabled/, '全部已审核整体审查可用');
  assert.match(html2, /data-pf-commit[^>]*aria-disabled="true"/, '完结前提交禁用');
  assert.match(html2, /整体审查未完结/, '提交禁用原因说明完结缺口');
  assert.match(html2, /门禁|完结/, '门禁条呈现完结状态');

  // 已完结：提交可用 + 完结标识
  const html3 = vmRun(fns, L4_CTX, `renderDocsPane({ id: 'V', pf: { phase: 'ready', plan: {
    langs: ['cn', 'en'],
    docsFlow: { files: [], reviewedCount: 8, defaultReviewedCount: 4, restReviewedCount: 4,
    canTranslate: true, translateMissing: [], canFinalize: true,
    finalized: { at: '2026-09-21T02:00:00.000Z' }, canCommit: true, baselineShift: [], missing: [] },
    docs: {} } } })`);
  assert.ok(!/data-pf-commit[^>]*aria-disabled/.test(html3), '完结后提交可用');
  assert.match(html3, /整体审查已完结/, '完结终态标识');
});

t('L4-3 完结对核对话框：核对清单 + 确认完结 / 取消', () => {
  const source = fs.readFileSync(new URL('../web/build.js', import.meta.url), 'utf8');
  const fns = [extractFn(source, 'renderFinalizeModal'), extractFn(source, 'renderDocsPane')].join('\n');
  const html = vmRun(fns, L4_CTX, `renderFinalizeModal({ id: 'BLD-20260921-012', pf: {
    finalize: { open: true, busy: false },
    plan: { langs: ['cn', 'en'], docsFlow: { files: [], defaultReviewedCount: 4, restReviewedCount: 4 } } } })`);
  assert.match(html, /整体审查完结（BLD-20260921-012）/, '对话框标题');
  for (const item of ['默认语言文件已全部审核', '剩余语言文件已全部审核', '各语言内容语义一致', 'README 按语言互链', '与本版发布范围一致']) {
    assert.ok(html.includes(item), `核对项 ${item}`);
  }
  assert.ok(html.includes('data-pf-finalize-cancel') && html.includes('data-pf-finalize-confirm'), '取消 / 确认完结按钮');
  assert.match(html, /完结后「提交」方可使用/, '完结提示');
});

t('L4-4 审查对话框七态沿用 + 轮询吸收翻译进度', () => {
  const source = fs.readFileSync(new URL('../web/build.js', import.meta.url), 'utf8');
  const html = vmRun([extractFn(source, 'sanitizeHtml'), extractFn(source, 'renderMd'), extractFn(source, 'renderReviewModal')].join('\n'), {
    pfOf: (v) => v.pf, esc: (s) => String(s), ...FLOW_STUB,
  }, `renderReviewModal({ id: 'V', pf: {
    review: { open: true, key: 'README', modes: { 'README.md': 'preview', 'README_en.md': 'edit' }, contents: { 'README.md': '# 中', 'README_en.md': '# EN' } },
    plan: { docsFlow: { files: [
      { key: 'README', lang: 'cn', file: 'README.md', state: 'reviewed' }, { key: 'README', lang: 'en', file: 'README_en.md', state: 'translated' },
      { key: 'CHANGELOG', lang: 'cn', file: 'CHANGELOG.md', state: 'unsummarized' }, { key: 'CHANGELOG', lang: 'en', file: 'CHANGELOG_en.md', state: 'untranslated' },
      { key: 'FEATURES', lang: 'cn', file: 'FEATURES.md', state: 'unsummarized' }, { key: 'FEATURES', lang: 'en', file: 'FEATURES_en.md', state: 'untranslated' },
      { key: 'AGENTS', lang: 'cn', file: 'AGENTS.md', state: 'unsummarized' }, { key: 'AGENTS', lang: 'en', file: 'AGENTS_en.md', state: 'untranslated' },
    ], reviewedCount: 1 } } } })`);
  assert.ok(html.includes('已翻译待审核'), '翻译场景状态文案');
  assert.ok(html.includes('data-review-approve'), '通过审核按钮沿用');
  assert.match(source, /data\.translate/, '轮询吸收翻译 run 视图');
});

/* ---------- L5 任务模块与全局面板（app.js） ---------- */

t('L5-1 任务模块 AI 翻译页签与全局面板 kind=translate', () => {
  const source = fs.readFileSync(new URL('../web/app.js', import.meta.url), 'utf8');
  assert.ok(source.includes('data-bmode="translate"'), '一级页签 AI 翻译');
  assert.ok(source.includes('renderTranslatePanel'), '面板渲染函数');
  assert.ok(source.includes('refreshTranslate'), '随轮询刷新函数');
  assert.match(source, /GLOBAL_KIND_LABEL\s*=\s*\{[^}]*translate:\s*'AI 翻译'/, '类型标签');
  assert.match(source, /GLOBAL_KIND_FILTERS[\s\S]*?\{ key: 'translate', label: 'AI 翻译' \}/, '类型筛选档');
  assert.match(source, /\['tr-', 'translate'\]/, '前缀兜底');
  assert.match(source, /kind === 'translate'/, '计数口径分支');
});

/* ---------- L6 i18n ---------- */

t('L6-1 i18n：新增文案中英词条齐备；门禁动态键随口径迁移；往返不变形', () => {
  const I = globalThis.ATBI18N;
  assert.ok(I, 'i18n.js 应在 globalThis.ATBI18N 暴露接口');
  const { EN, EN_DYNAMIC } = I._dict;
  const statics = [
    'AI 翻译', '整体审查', '未翻译', '正在翻译', '已翻译待审核',
    '① 默认语言先行', '② AI 翻译与审查', '③ 整体审查完结', '已完成', '进行中', '未解锁', '阶段：',
    '确认完结', '取消',
    '各语言内容语义一致（以已审核默认语言为基准）',
    'README 按语言互链真实可达（同语言 CHANGELOG 与 FEATURES，链接必须真实可达）',
    '文档内容与本版发布范围一致（未纳入本版的功能不得写成已发布）',
    '提示：完结后「提交」方可使用；默认语言文档更新或发布范围变化会使完结失效回退。',
    '先总结审查默认语言四文档，审核完毕后 AI 翻译生成剩余语言文档，逐语言审查，最后整体审查完结后方可提交。',
    'AI 翻译已完成：待翻译文件均进入「已翻译待审核」，等待人工审查。',
    '✓ AI 翻译提示词已复制：交给 AI Agent 以已审核默认语言文档为基准逐文件翻译，进度在本页与任务模块自动刷新',
    '✓ 整体审查已完结：文档编写三阶段完成，「提交」已解锁',
  ];
  for (const k of statics) assert.ok(typeof EN[k] === 'string' && EN[k], `静态词条缺失：${k}`);
  const dynamics = [
    '翻译中 ◇/◇', 'AI 翻译进行中：◇/◇ · 当前：',
    'AI 翻译中断：◇——文件状态不悬挂「正在翻译」，可再次点击「AI 翻译」续跑（已翻译完成的文件保留待审核状态）。',
    '提交门禁：默认语言 ◇/◇ · 剩余语言 ◇/◇ 已审核 —— 提交禁用，尚缺：◇。',
    '提交门禁：默认语言 ◇/◇ · 剩余语言 ◇/◇ 已审核 —— 整体审查未完结（确认完结后可提交）。',
    '提交门禁：◇/◇ 已审核 · 整体审查已完结 —— 可提交到本地 dev 分支。',
    '默认语言文档已更新：◇ 个翻译文档需重新 AI 翻译（基准变更，相关审核已回退）',
    '文件（◇ · 默认语言 ◇/◇ 已审核 · 剩余语言 ◇/◇ 已审核）',
    '默认语言（◇，文件不带后缀）', '剩余语言（◇ · AI 翻译）',
    '整体审查完结（◇）', '默认语言文件已全部审核（◇/◇）', '剩余语言文件已全部审核（◇/◇）',
    'AI 翻译未解锁：默认语言尚缺 ◇ 个文件审核（◇）',
    '整体审查未解锁：尚缺 ◇ 个文件审核（◇）',
    '整体审查已完结 ✓（时间 ◇；提交已解锁）',
  ];
  for (const k of dynamics) assert.ok(k in EN_DYNAMIC, `动态词条缺失：${k}`);
  // 旧门禁动态键随口径迁移清理
  for (const k of [
    '提交门禁：◇/◇ 已审核 —— 全部文件已通过审查，可提交到本地 dev 分支。',
    '提交门禁：◇/◇ 已审核 —— 提交按钮禁用，尚缺：◇',
  ]) {
    assert.ok(!(k in EN_DYNAMIC), `旧门禁键应清理：${k.slice(0, 18)}…`);
  }
  I.setLang('en');
  assert.equal(I.t('AI 翻译'), 'AI translation');
  assert.equal(I.t('翻译中 1/4'), 'Translating 1/4');
  I.setLang('zh');
  assert.equal(I.t('AI 翻译'), 'AI 翻译');
});

t('L6-2 回归：evaluateDocsState / publishStepsState 零改动（合并门禁不受影响）', () => {
  assert.equal(flow.evaluateDocsState({}, readsOf({})).overall, 'none');
  assert.equal(flow.evaluateDocsState({}, readsOf({ 'README.md': '# r' })).overall, 'uncommitted');
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
  await fn();
  console.log(`✓ ${name}`);
}
console.log(`\n共 ${cases.length} 例，全部通过`);
