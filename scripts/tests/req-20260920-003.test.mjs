#!/usr/bin/env node
// REQ-20260920-003 构建和发布流程整改 —— 分层测试。
// L1 纯逻辑（publish-flow：版本号提取 / 八文档清单 / 双提示词 / 计划号边界匹配 /
//    官网时间窗扫描 / 文档状态机与门禁）；
// L2 数据层（build-store：范围指纹、文档提交记录、范围变化失效、推送起点、官网扫描落盘）；
// L3 Git 隔离（build-git：dev 前置 / 影响分析 / cherry-pick 重放隔离合并（A 不随 B 入 main）/
//    冲突阻断与现场保护 / 主分支推送）；
// L4 服务接口（文档读存提交 / 合并门禁与隔离 / 推送主分支 / 官网检测语义）；
// L5 前端静态契约（导航「发布」、五步流程、i18n 同步）。
// 用法：node scripts/tests/req-20260920-003.test.mjs

import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as core from '../lib/core.mjs';
import * as flow from '../lib/publish-flow.mjs';
import * as buildStore from '../lib/build-store.mjs';
import * as buildGit from '../lib/build-git.mjs';
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

const cases = [];
const t = (name, fn) => cases.push([name, fn]);

/* ---------- L1 纯逻辑（publish-flow.mjs） ---------- */

t('L1-1 版本号提取：取计划编号后两段、保留前导零；非法输入返回 null', () => {
  assert.equal(flow.versionNumberOf('BLD-20260920-001'), '20260920-001');
  assert.equal(flow.versionNumberOf('BLD-20260920-010'), '20260920-010', '前导零保留');
  assert.equal(flow.versionNumberOf('BLD-20260920-1'), null);
  assert.equal(flow.versionNumberOf('bld-20260920-001'), null);
  assert.equal(flow.versionNumberOf(''), null);
  assert.equal(flow.versionNumberOf(null), null);
});

t('L1-2 发布文档清单：四类 × 双语共八个文件，命名与需求一致', () => {
  const files = flow.publishDocFiles();
  assert.equal(files.length, 8);
  assert.deepEqual(
    files.map((f) => f.file).sort(),
    ['AGENTS.en.md', 'AGENTS.md', 'CHANGELOG.en.md', 'CHANGELOG.md', 'FEATURES.en.md', 'FEATURES.md', 'README.en.md', 'README.md'].sort(),
  );
  for (const f of files) assert.ok(['zh', 'en'].includes(f.lang) && f.key, '每条含 key/lang');
  assert.equal(flow.docFileOf('CHANGELOG', 'en'), 'CHANGELOG.en.md');
});

t('L1-3 README 互链口径：按语言链接 CHANGELOG 与 FEATURES，其余文档无链接要求', () => {
  assert.deepEqual(flow.readmeDocLinks('README.md'), ['CHANGELOG.md', 'FEATURES.md']);
  assert.deepEqual(flow.readmeDocLinks('README.en.md'), ['CHANGELOG.en.md', 'FEATURES.en.md']);
  assert.deepEqual(flow.readmeDocLinks('AGENTS.md'), []);
});

t('L1-4 AI 写作提示词：技术写作角色 + 子代理流程 + 项目路径/计划号/版本号/关联范围/八文档清单/写作约束', () => {
  const p = flow.buildDocWritingPrompt({
    projectRoot: '/tmp/projX',
    planId: 'BLD-20260920-001',
    items: [{ itemId: 'REQ-20260920-009', commit: 'a'.repeat(40), title: '示例' }],
  });
  for (const s of ['/tmp/projX', 'BLD-20260920-001', '20260920-001', 'REQ-20260920-009', '技术写作', '子代理', '不得编造']) {
    assert.ok(p.includes(s), `提示词应含 ${s}`);
  }
  for (const f of flow.publishDocFiles().map((x) => x.file)) assert.ok(p.includes(f), `提示词应列 ${f}`);
});

t('L1-5 官网 AI 写作提示词：在官网仓库执行、读已发布 CHANGELOG/FEATURES 双语、提交消息含完整计划号', () => {
  const p = flow.buildSiteWritingPrompt({
    projectRoot: '/tmp/projX',
    siteRoot: '/tmp/siteX',
    planId: 'BLD-20260920-001',
    baseline: 'deadbeef',
  });
  for (const s of ['/tmp/siteX', '/tmp/projX', 'BLD-20260920-001', 'CHANGELOG', 'FEATURES']) {
    assert.ok(p.includes(s), `官网提示词应含 ${s}`);
  }
  assert.ok(p.includes('提交'), '提示词应要求完成提交且消息带完整计划号');
});

t('L1-6 计划号精确匹配：标识边界，BLD-20260920-0010 不视为 BLD-20260920-001 命中', () => {
  assert.equal(flow.planIdTokenMatches('官网同步完成 BLD-20260920-001 更新', 'BLD-20260920-001'), true);
  assert.equal(flow.planIdTokenMatches('同步 BLD-20260920-0010 条目', 'BLD-20260920-001'), false, '更长编号不可误命中');
  assert.equal(flow.planIdTokenMatches('XBLD-20260920-001 同步', 'BLD-20260920-001'), false, '左侧无边界不可命中');
  assert.equal(flow.planIdTokenMatches('BLD-20260920-002', 'BLD-20260920-001'), false);
  assert.equal(flow.planIdTokenMatches('', 'BLD-20260920-001'), false);
});

t('L1-7 官网时间窗扫描：起点缺失→waiting；窗口内命中→hit 带证据；早于起点不参与；无命中→missed', () => {
  const planId = 'BLD-20260920-001';
  const commits = [
    { hash: 'c3', subject: `site: 同步 ${planId}`, committerDate: '2026-09-20T10:01:00Z' },
    { hash: 'c2', subject: 'site: 其他改动', committerDate: '2026-09-20T10:00:30Z' },
    { hash: 'c1', subject: `site: 旧版本也提到 ${planId}`, committerDate: '2026-09-20T09:00:00Z' },
  ];
  assert.equal(flow.scanSiteCommitsForPlan(commits, { planId, sinceIso: null }).status, 'waiting');
  const hit = flow.scanSiteCommitsForPlan(commits, { planId, sinceIso: '2026-09-20T10:00:00Z' });
  assert.equal(hit.status, 'hit');
  assert.equal(hit.evidence.hash, 'c3');
  const missed = flow.scanSiteCommitsForPlan([commits[1]], { planId, sinceIso: '2026-09-20T10:00:00Z' });
  assert.equal(missed.status, 'missed');
  // 边界：等于起点（含边界）参与匹配
  const edge = flow.scanSiteCommitsForPlan([{ hash: 'e', subject: `x ${planId}`, committerDate: '2026-09-20T10:00:00Z' }], { planId, sinceIso: '2026-09-20T10:00:00Z' });
  assert.equal(edge.status, 'hit', '提交者时间等于起点应参与匹配');
  // 相似编号 / 其他计划号不冒充命中
  const decoy = flow.scanSiteCommitsForPlan([{ hash: 'd', subject: 'site: BLD-20260920-0010', committerDate: '2026-09-20T10:00:30Z' }], { planId, sinceIso: '2026-09-20T10:00:00Z' });
  assert.equal(decoy.status, 'missed', '相似编号不可命中');
});

t('L1-8 扫描预算：未读完窗口显示 scanning（不可当作未命中）；读完才 missed', () => {
  const planId = 'BLD-20260920-001';
  const commits = [];
  for (let i = 0; i < 6; i++) commits.push({ hash: `h${i}`, subject: `n${i}`, committerDate: '2026-09-20T10:00:30Z' });
  const r = flow.scanSiteCommitsForPlan(commits, { planId, sinceIso: '2026-09-20T10:00:00Z', budget: 3 });
  assert.equal(r.status, 'scanning', '预算未读完窗口应显示扫描中');
  assert.equal(r.scanned, 3);
  const r2 = flow.scanSiteCommitsForPlan(commits.slice(0, 3), { planId, sinceIso: '2026-09-20T10:00:00Z', budget: 3 });
  assert.equal(r2.status, 'missed', '窗口读完无命中才是未命中');
});

t('L1-9 文档状态机：未提交 / 已提交 / 外部修改未提交 / 范围过期 / 缺文件', () => {
  const sha = (s) => nodeCrypto.createHash('sha256').update(s).digest('hex');
  const v = { items: [{ itemId: 'REQ-20260920-009', commit: 'a'.repeat(40) }], docs: null };
  const none = flow.evaluateDocsState(v, () => null);
  assert.equal(none.overall, 'none', '无记录且未编写 → 整体未开始');
  const disk = {
    'README.md': 'r1', 'README.en.md': 'r2', 'CHANGELOG.md': 'c1', 'CHANGELOG.en.md': 'c2',
    'FEATURES.md': 'f1', 'FEATURES.en.md': 'f2', 'AGENTS.md': 'a1', 'AGENTS.en.md': 'a2',
  };
  const files8 = {};
  for (const [f, c] of Object.entries(disk)) files8[f] = sha(c);
  const committed = flow.evaluateDocsState(
    { ...v, docs: { commitHash: 'c'.repeat(40), scopeFp: 'fp1', files: files8 } },
    (f) => disk[f] ?? null,
  );
  assert.equal(committed.overall, 'committed');
  const dirty = flow.evaluateDocsState(
    { ...v, docs: { commitHash: 'c'.repeat(40), scopeFp: 'fp1', files: { 'README.md': files8['README.md'] } } },
    (f) => (f === 'README.md' ? 'changed' : null),
  );
  assert.equal(dirty.overall, 'uncommitted', '外部/再次编辑后未提交');
  assert.ok(dirty.reasons.some((x) => x.includes('README.md')));
});

t('L1-10 五步门禁：空计划不可进合并/正式发布；文档未完成锁合并；merged 解锁正式发布', () => {
  const mk = (over = {}) => ({ status: 'draft', items: [], docs: null, ...over });
  let steps = flow.publishStepsState(mk(), { overall: 'none' });
  let merge = steps.find((s) => s.key === 'merge');
  assert.ok(merge.locked && /关联/.test(merge.reason), '空计划合并被锁且提示先关联');
  assert.ok(steps.find((s) => s.key === 'release').locked);
  steps = flow.publishStepsState(mk({ items: [{ itemId: 'REQ-20260920-009', commit: 'a'.repeat(40) }] }), { overall: 'none' });
  merge = steps.find((s) => s.key === 'merge');
  assert.ok(merge.locked && /文档/.test(merge.reason), '文档未完成锁合并');
  steps = flow.publishStepsState(mk({ items: [{ itemId: 'REQ-20260920-009', commit: 'a'.repeat(40) }] }), { overall: 'committed' });
  assert.ok(!steps.find((s) => s.key === 'merge').locked, '文档已提交解锁合并');
  assert.ok(steps.find((s) => s.key === 'release').locked, '未合并不可正式发布');
  steps = flow.publishStepsState(mk({ status: 'merged', items: [{ itemId: 'REQ-20260920-009', commit: 'a'.repeat(40) }] }), { overall: 'committed' });
  assert.ok(!steps.find((s) => s.key === 'release').locked, '已合并解锁正式发布');
});

/* ---------- L2 数据层（build-store.mjs） ---------- */

t('L2-1 范围指纹随条目/commit 变化；文档提交记录与门禁', () => {
  const dir = tmpdir('atb-pf-store-');
  const commitA = 'a'.repeat(40);
  const commitB = 'b'.repeat(40);
  const v = buildStore.createVersion(dir, { items: [{ itemId: 'REQ-20260920-009', commit: commitA }] });
  const fp1 = buildStore.scopeFingerprintOf(v);
  const v2 = buildStore.addItems(dir, v.id, [{ itemId: 'REQ-20260920-010', commit: commitB }]);
  assert.notEqual(buildStore.scopeFingerprintOf(v2), fp1, '范围变化指纹变化');
  const v3 = buildStore.setItemCommit(dir, v.id, 'REQ-20260920-009', commitB);
  assert.notEqual(buildStore.scopeFingerprintOf(v3), fp1, '换 commit 指纹变化');
});

t('L2-2 文档提交记录 / 范围变化后旧提交标识不放行', () => {
  const dir = tmpdir('atb-pf-store2-');
  const v = buildStore.createVersion(dir, { items: [{ itemId: 'REQ-20260920-009', commit: 'a'.repeat(40) }] });
  // 无文档记录 → 门禁拒绝
  assert.throws(() => buildStore.assertMergeDocsGate(dir, v.id, () => null), /文档/);
  // 记录提交（scopeFp 与当前一致）
  const files = {};
  for (const f of flow.publishDocFiles()) files[f.file] = `h(${f.file})`;
  const rec = buildStore.recordDocsCommit(dir, v.id, { commitHash: 'c'.repeat(40), files, scopeFp: buildStore.scopeFingerprintOf(v) });
  assert.equal(rec.docs.commitHash, 'c'.repeat(40));
  // 范围变化（新增条目）→ 旧提交标识失效
  buildStore.addItems(dir, v.id, [{ itemId: 'REQ-20260920-010', commit: 'b'.repeat(40) }]);
  const after = buildStore.readVersion(dir, v.id);
  assert.equal(after.docs.scopeStale, true, '范围变化标记文档需重新核对');
  assert.ok(after.docs.staleReason, '说明变化来源');
  assert.ok(after.docs.commitHash, '已写内容与提交记录保留');
});

t('L2-3 推送起点：成功推送持久保存；同基准重试不重置；基准变化重置官网证据', () => {
  const dir = tmpdir('atb-pf-store3-');
  const v = buildStore.createVersion(dir, { items: [{ itemId: 'REQ-20260920-009', commit: 'a'.repeat(40) }] });
  const r1 = buildStore.recordPushSuccess(dir, v.id, { remote: 'origin', sha: 'a'.repeat(40) });
  assert.ok(r1.release.pushedAt, '记录推送完成时间');
  const r2 = buildStore.recordPushSuccess(dir, v.id, { remote: 'origin', sha: 'a'.repeat(40) });
  assert.equal(r2.release.pushedAt, r1.release.pushedAt, '同基准重试不重置起点');
  buildStore.recordSiteScan(dir, v.id, { status: 'hit', evidence: { hash: 'e1' } });
  const t0 = Date.now();
  while (Date.now() - t0 < 3) { /* 自旋等毫秒钟前进，保证基准变化的时间戳可区分 */ }
  const r3 = buildStore.recordPushSuccess(dir, v.id, { remote: 'origin', sha: 'b'.repeat(40) });
  assert.notEqual(r3.release.pushedAt, r1.release.pushedAt, '基准变化更新起点');
  assert.equal(r3.release.site.status, 'waiting', '旧命中证据失效回等待');
});

/* ---------- L3 Git 隔离（build-git.mjs） ---------- */

t('L3-1 dev 前置：非 dev / detached 阻止并提示自行切回；dev 放行', () => {
  const dir = mkRepo(tmpdir('atb-pf-git1-'));
  fs.writeFileSync(path.join(dir, 'x.txt'), 'x');
  git(dir, ['add', '-A']); git(dir, ['commit', '-m', 'init']);
  git(dir, ['switch', '-c', 'dev']);
  assert.equal(buildGit.assertOnDev(dir), 'dev');
  git(dir, ['switch', 'main']);
  assert.throws(() => buildGit.assertOnDev(dir), /切换回 dev/);
  git(dir, ['checkout', '--detach']);
  assert.throws(() => buildGit.assertOnDev(dir), /dev/);
});

t('L3-2 隔离合并：dev 上 A(未选) 先于 B(所选)，只发布 B 时 main 不新增 A 的变更；记录重放证据', () => {
  const dir = mkRepo(tmpdir('atb-pf-git2-'));
  fs.writeFileSync(path.join(dir, 'base.txt'), 'base');
  git(dir, ['add', '-A']); gitAt(dir, ['commit', '-m', 'init'], '2026-09-20T01:00:00 +0000');
  git(dir, ['switch', '-c', 'dev']);
  fs.writeFileSync(path.join(dir, 'a.txt'), 'A 改动');
  git(dir, ['add', '-A']); gitAt(dir, ['commit', '-m', 'feat: A REQ-20260920-001'], '2026-09-20T01:01:00 +0000');
  fs.writeFileSync(path.join(dir, 'b.txt'), 'B 改动');
  git(dir, ['add', '-A']); gitAt(dir, ['commit', '-m', 'feat: B REQ-20260920-002'], '2026-09-20T01:02:00 +0000');
  const commitB = git(dir, ['rev-parse', 'HEAD']);
  // dev 上留未提交修改：合并后必须保留
  fs.writeFileSync(path.join(dir, 'dirty.txt'), '未提交');
  const items = [{ itemId: 'REQ-20260920-002', commit: commitB }];
  const an = buildGit.analyzePublishIsolation(dir, items);
  assert.equal(an.targetBranch, 'main');
  const per = an.perItem.find((x) => x.itemId === 'REQ-20260920-002');
  assert.ok(per.intermediates.length >= 1, '分析应列出未选祖先 A（信息提示，不扩大范围）');
  const r = buildGit.mergeIsolatedIntoMain(dir, { versionId: 'BLD-20260920-009', versionName: '测试', items });
  assert.equal(r.results.length, 1);
  assert.equal(r.results[0].ok, true, `隔离合并应成功：${r.results[0].error || ''}`);
  assert.ok(r.replays.some((x) => x.original === commitB && /^[0-9a-f]{40}$/.test(x.replayed)), '记录重放证据');
  // main 检验：有 b.txt、无 a.txt；dev 不动；脏文件保留
  assert.equal(git(dir, ['show', `main:b.txt`]).trim(), 'B 改动', 'main 含 B 的变更');
  assert.notEqual(git(dir, ['ls-tree', '--name-only', 'main']).includes('a.txt'), true, 'main 不得夹带未选 A 的变更');
  assert.equal(git(dir, ['branch', '--show-current']), 'dev', '当前目录仍在 dev');
  assert.ok(fs.existsSync(path.join(dir, 'dirty.txt')), '未提交文件保留');
  assert.equal(git(dir, ['status', '--porcelain']).split('\n').filter((l) => l.includes('dirty.txt')).length, 1);
  assert.equal(buildGit.isAncestorOf(dir, commitB, 'main'), false, '原始提交非 main 祖先（重放）');
  assert.equal(buildGit.isAncestorOf(dir, r.replays[0].replayed, 'main'), true, '重放提交在 main 上');
});

t('L3-3 隔离合并冲突：B 依赖 A（同文件同行）时阻止并保留现场，main 不变', () => {
  const dir = mkRepo(tmpdir('atb-pf-git3-'));
  fs.writeFileSync(path.join(dir, 's.txt'), 'line\n');
  git(dir, ['add', '-A']); gitAt(dir, ['commit', '-m', 'init'], '2026-09-20T01:00:00 +0000');
  git(dir, ['switch', '-c', 'dev']);
  fs.writeFileSync(path.join(dir, 's.txt'), 'A 改了这一行\n');
  git(dir, ['add', '-A']); gitAt(dir, ['commit', '-m', 'feat: A REQ-20260920-001'], '2026-09-20T01:01:00 +0000');
  fs.writeFileSync(path.join(dir, 's.txt'), 'B 也改了这一行\n');
  git(dir, ['add', '-A']); gitAt(dir, ['commit', '-m', 'feat: B REQ-20260920-002'], '2026-09-20T01:02:00 +0000');
  const commitB = git(dir, ['rev-parse', 'HEAD']);
  const items = [{ itemId: 'REQ-20260920-002', commit: commitB }];
  const r = buildGit.mergeIsolatedIntoMain(dir, { versionId: 'BLD-20260920-009', versionName: '测试', items });
  assert.equal(r.results[0].ok, false, '依赖未选变化应失败');
  assert.match(r.results[0].error, /冲突|conflict/i, '失败原因含冲突说明');
  assert.equal(git(dir, ['show', 'main:s.txt']).trim(), 'line', 'main 保持不变');
  assert.equal(git(dir, ['branch', '--show-current']), 'dev');
});

t('L3-4 混合提交（同一 commit 关联多个条目）被分析阻止', () => {
  const dir = mkRepo(tmpdir('atb-pf-git4-'));
  fs.writeFileSync(path.join(dir, 'x.txt'), 'x');
  git(dir, ['add', '-A']); git(dir, ['commit', '-m', 'init']);
  git(dir, ['switch', '-c', 'dev']);
  fs.writeFileSync(path.join(dir, 'y.txt'), 'y');
  git(dir, ['add', '-A']); git(dir, ['commit', '-m', 'feat: A+B REQ-20260920-001 REQ-20260920-002']);
  const c = git(dir, ['rev-parse', 'HEAD']);
  const an = buildGit.analyzePublishIsolation(dir, [
    { itemId: 'REQ-20260920-001', commit: c },
    { itemId: 'REQ-20260920-002', commit: c },
  ]);
  assert.ok(an.blocked.length >= 1 && /混|同一提交/.test(an.blocked[0]), '同一提交关联多条目应阻止并解释');
});

t('L3-5 主分支推送：只推 main（不推 dev）、不强推；仅 master 仓库以 master 为目标', () => {
  const tmp = tmpdir('atb-pf-git5-');
  const remote = path.join(tmp, 'remote.git');
  git(tmp, ['init', '--bare', '-b', 'main', remote]);
  const dir = mkRepo(path.join(tmp, 'proj'));
  git(dir, ['remote', 'add', 'origin', remote]);
  fs.writeFileSync(path.join(dir, 'x.txt'), 'x');
  git(dir, ['add', '-A']); git(dir, ['commit', '-m', 'init']);
  git(dir, ['switch', '-c', 'dev']);
  fs.writeFileSync(path.join(dir, 'd.txt'), 'd');
  git(dir, ['add', '-A']); git(dir, ['commit', '-m', 'dev work']);
  git(dir, ['switch', 'main']);
  const r = buildGit.pushMainBranch(dir, { remote: 'origin' });
  assert.equal(r.branch, 'main');
  const refs = git(dir, ['ls-remote', 'origin']);
  assert.match(refs, /refs\/heads\/main/);
  assert.doesNotMatch(refs, /refs\/heads\/dev/, '不得顺带推送 dev');
  git(dir, ['switch', 'dev']);
});

t('L3-6 官网主分支读取：本地 main 优先、无 main 回退 master；输出提交者时间', () => {
  const tmp = tmpdir('atb-pf-git6-');
  const site = mkRepo(path.join(tmp, 'site'));
  fs.writeFileSync(path.join(site, 'i.txt'), 'i');
  git(site, ['add', '-A']); gitAt(site, ['commit', '-m', 'init'], '2026-09-20T01:00:00 +0000');
  const log = buildGit.siteMainLog(site, { limit: 10 });
  assert.equal(log.branch, 'main');
  assert.ok(log.commits.length >= 1 && log.commits[0].committerDate, '提交者时间字段');
  // master-only 仓库回退
  const site2 = path.join(tmp, 'site2');
  fs.mkdirSync(site2);
  git(site2, ['init', '-b', 'master']);
  git(site2, ['config', 'user.email', 't@e.co']); git(site2, ['config', 'user.name', 'T']);
  fs.writeFileSync(path.join(site2, 'i.txt'), 'i');
  git(site2, ['add', '-A']); git(site2, ['commit', '-m', 'init']);
  assert.equal(buildGit.siteMainLog(site2, { limit: 10 }).branch, 'master');
});

/* ---------- L4 服务接口 ---------- */

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

t('L4 服务接口：文档流程 / 合并门禁与隔离 / 推送 / 官网检测', async () => {
  const tmp = tmpdir('atb-pf-serve-');
  const proj = mkRepo(path.join(tmp, 'proj'));
  const remote = path.join(tmp, 'remote.git');
  git(tmp, ['init', '--bare', '-b', 'main', remote]);
  git(proj, ['remote', 'add', 'origin', remote]);
  fs.writeFileSync(path.join(proj, 'base.txt'), 'base');
  git(proj, ['add', '-A']); gitAt(proj, ['commit', '-m', 'init'], '2026-09-20T02:00:00 +0000');
  git(proj, ['switch', '-c', 'dev']);
  fs.writeFileSync(path.join(proj, 'a.txt'), 'A');
  git(proj, ['add', '-A']); gitAt(proj, ['commit', '-m', 'feat: A REQ-20260920-001'], '2026-09-20T02:01:00 +0000');
  fs.writeFileSync(path.join(proj, 'b.txt'), 'B');
  git(proj, ['add', '-A']); gitAt(proj, ['commit', '-m', 'feat: B REQ-20260920-002'], '2026-09-20T02:02:00 +0000');
  const commitB = git(proj, ['rev-parse', 'HEAD']);
  core.initData(proj);
  const dataDir = core.dataDirFrom(proj);
  for (const id of ['REQ-20260920-001', 'REQ-20260920-002']) {
    core.createItem(dataDir, { type: 'requirement', title: `条目 ${id}`, by: 'test' });
    for (const s of ['accepted', 'in-progress', 'done']) core.setStatus(dataDir, id, s, { by: 'test' });
  }
  // 官网仓库（main）
  const site = mkRepo(path.join(tmp, 'site'));
  fs.writeFileSync(path.join(site, 'i.txt'), 'i');
  git(site, ['add', '-A']); gitAt(site, ['commit', '-m', 'init'], '2026-09-20T02:00:00 +0000');

  const reg = path.join(tmp, 'reg.json');
  let server = null;
  let port = 0;
  for (let i = 0; i < 6 && !server; i++) {
    const p = 33500 + Math.floor(Math.random() * 20000);
    const child = spawn(process.execPath, [path.join(pluginRoot, 'scripts', 'server.mjs')], {
      cwd: proj,
      env: {
        ...process.env, ATB_PORT: String(p), ATB_REGISTRY: reg,
        ATB_BUILD_PUBLISH_CONFIG: path.join(tmp, 'bp.json'),
      },
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
    // 创建版本（只关联 B）
    let r = await req(port, 'POST', `/api/build/version${P}`, { items: [{ itemId: 'REQ-20260920-002', commit: commitB }] });
    assert.equal(r.status, 201, `创建版本：${r.text}`);
    const vid = r.json.version.id;
    const planId = vid;

    // publish-plan：版本号 + 五步 + 提示词
    r = await req(port, 'GET', `/api/build/publish-plan${P}&id=${vid}`);
    assert.equal(r.status, 200, `publish-plan：${r.text}`);
    assert.equal(r.json.versionNumber, vid.replace(/^BLD-/, ''), '版本号 = 计划编号后两段');
    assert.deepEqual(r.json.steps.map((s) => s.key), ['plan', 'link', 'docs', 'merge', 'release']);
    assert.ok(r.json.docsPrompt.includes(planId) && r.json.docsPrompt.includes(proj), 'AI 写作提示词带计划号与项目路径');
    assert.ok(r.json.mergeAnalysis.perItem.length === 1, '合并分析含所选条目');

    // 未完成文档 → 合并被门禁拦截
    r = await req(port, 'POST', `/api/build/version/merge${P}`, { id: vid });
    assert.equal(r.status, 409, `文档未提交应 409：${r.text}`);
    assert.match(r.json.error || '', /文档/);

    // 文档保存（八文件 + README 互链）→ 状态未提交
    const contents = {};
    for (const f of flow.publishDocFiles()) contents[f.file] = `# ${f.key} ${f.lang}\n`;
    contents['README.md'] = '# README\n[更新日志](CHANGELOG.md) [功能](FEATURES.md)\n';
    contents['README.en.md'] = '# README\n[Changelog](CHANGELOG.en.md) [Features](FEATURES.en.md)\n';
    for (const [file, content] of Object.entries(contents)) {
      r = await req(port, 'POST', `/api/build/docs/save${P}`, { id: vid, file, content });
      assert.equal(r.status, 200, `保存 ${file}：${r.text}`);
    }
    r = await req(port, 'GET', `/api/build/docs${P}&id=${vid}&file=README.md`);
    assert.equal(r.status, 200);
    assert.equal(r.json.content, contents['README.md']);
    assert.equal(r.json.docs.overall, 'uncommitted', '已写未提交');
    r = await req(port, 'POST', `/api/build/docs/save${P}`, { id: vid, file: '../evil.txt', content: 'x' });
    assert.equal(r.status, 400, '非白名单文档名拒绝');

    // 工作区留无关脏文件：文档提交不得夹带
    fs.writeFileSync(path.join(proj, 'unrelated-draft.txt'), '业务草稿');

    // 无变化不空提交：先对未变更文件集合提交（此刻 8 文件均为新文件，有变化）
    r = await req(port, 'POST', `/api/build/docs/commit${P}`, { id: vid });
    assert.equal(r.status, 200, `文档提交：${r.text}`);
    const docCommitHash = r.json.commitHash;
    assert.ok(/^[0-9a-f]{40}$/.test(docCommitHash), '返回提交 hash');
    const stat = git(proj, ['show', '--name-only', '--format=', docCommitHash]).split('\n').filter(Boolean);
    assert.deepEqual(stat.sort(), Object.keys(contents).sort(), '提交范围只含八个文档');
    assert.ok(git(proj, ['status', '--porcelain']).includes('unrelated-draft.txt'), '无关工作区修改不被夹带');
    // 再次提交无变化 → noop
    r = await req(port, 'POST', `/api/build/docs/commit${P}`, { id: vid });
    assert.equal(r.status, 200);
    assert.equal(r.json.noop, true, '无变化不制造空提交');

    // 外部修改文档 → 未提交，合并再次被拦
    fs.writeFileSync(path.join(proj, 'FEATURES.md'), '# FEATURES 改动\n');
    r = await req(port, 'POST', `/api/build/version/merge${P}`, { id: vid });
    assert.equal(r.status, 409);
    assert.match(r.json.error || '', /未提交/);
    // 重新提交后放行
    r = await req(port, 'POST', `/api/build/docs/commit${P}`, { id: vid });
    assert.ok(r.json.commitHash, '重新提交成功');

    // 隔离合并：在 dev 上执行成功，main 不含 a.txt
    r = await req(port, 'POST', `/api/build/version/merge${P}`, { id: vid });
    assert.equal(r.status, 200, `合并：${r.text}`);
    assert.equal(r.json.version.status, 'merged');
    assert.equal(git(proj, ['branch', '--show-current']), 'dev', '合并后仍在 dev');
    assert.ok(git(proj, ['ls-tree', '--name-only', 'main']).includes('b.txt'), 'main 含 B');
    assert.ok(!git(proj, ['ls-tree', '--name-only', 'main']).includes('a.txt'), 'main 不含未选 A');
    assert.ok(git(proj, ['ls-tree', '--name-only', 'main']).includes('unrelated-draft.txt') === false, '业务草稿不入 main');
    const replays = r.json.version.merge.replays || [];
    assert.ok(replays.length === 1 && replays[0].original === commitB, '重放证据落账');

    // 后续发布检验认可隔离后的提交证据：PREL from-build 不因重放（原始 commit 非 main 祖先）误判缺失
    r = await req(port, 'POST', `/api/product-release/from-build${P}`, { bldId: vid, version: '1.0.0' });
    assert.equal(r.status, 201, `from-build 应认可重放证据：${r.text}`);

    // 非 dev 分支阻止合并 / 推送（切到 main 验证后切回）
    git(proj, ['switch', 'main']);
    const vMain = buildStore.readVersion(dataDir, vid);
    assert.throws(() => buildGit.assertOnDev(proj), /切换回 dev/, '合并/推送前置：非 dev 阻止');
    git(proj, ['switch', 'dev']);
    void vMain;

    // 推送主分支：成功记录起点；dev 不被推送
    r = await req(port, 'POST', `/api/build/release/push${P}`, { id: vid, remote: 'origin' });
    assert.equal(r.status, 200, `推送：${r.text}`);
    const pushedAt = r.json.version.release.pushedAt;
    assert.ok(pushedAt, '推送完成时间持久保存');
    const refs = git(proj, ['ls-remote', 'origin']);
    assert.match(refs, /refs\/heads\/main/);
    assert.doesNotMatch(refs, /refs\/heads\/dev/, '不顺带推送 dev');
    // 未推送过官网（未配置）→ 检测失败明确提示，不误报完成
    r = await req(port, 'POST', `/api/build/release/site-scan${P}`, { id: vid });
    assert.equal(r.status, 200);
    assert.equal(r.json.site.status, 'failed', '未配置官网仓库读取失败');
    assert.ok(r.json.site.reason, '失败带原因');

    // 配置官网仓库后：窗口外旧提交不命中；窗口内含完整计划号命中
    fs.writeFileSync(path.join(site, 'bump.txt'), String(Date.now()));
    git(site, ['add', '-A']); git(site, ['commit', '-m', 'site: 日常更新（提到 BLD-20260918-001）']);
    const cfg = { homepageRepoRoot: site, revision: 1 };
    fs.writeFileSync(path.join(tmp, 'bp.json'), JSON.stringify(cfg));
    r = await req(port, 'POST', `/api/build/release/site-scan${P}`, { id: vid, force: true });
    assert.equal(r.json.site.status, 'missed', '窗口内无本计划号 → 未命中（不冒充完成）');
    // 官网在起点之后的提交（含完整计划号）
    await sleep(1100); // 保证提交时间晚于 pushedAt
    fs.writeFileSync(path.join(site, 'rel.txt'), 'released');
    git(site, ['add', '-A']); git(site, ['commit', '-m', `site: 发布 ${planId} 官网更新`]);
    const siteHead = git(site, ['rev-parse', 'HEAD']);
    r = await req(port, 'POST', `/api/build/release/site-scan${P}`, { id: vid, force: true });
    assert.equal(r.json.site.status, 'hit', `应命中：${JSON.stringify(r.json.site)}`);
    assert.equal(r.json.site.evidence.hash, siteHead);
    assert.equal(r.json.site.branch, 'main');
    assert.ok(r.json.site.evidence.matchedAt, '命中证据含检测时间');
    assert.ok((r.json.notice || '').includes('每分钟') && (r.json.notice || '').includes('不代表'), '常驻提示：频率与不代表已推送/部署');
    // 相似编号不命中
    const v2 = buildStore.createVersion(dataDir, { items: [{ itemId: 'REQ-20260920-001', commit: git(proj, ['rev-parse', 'HEAD']) }] });
    void v2;
  } finally {
    server.kill('SIGTERM');
  }
});

/* ---------- L5 前端静态契约 ---------- */

t('L5-1 导航与模块命名：顶栏「构建」改为「发布」；五步流程与文档页关键结构存在', () => {
  const html = fs.readFileSync(path.join(pluginRoot, 'scripts', 'web', 'index.html'), 'utf8');
  assert.match(html, /data-view="build"[^>]*>发布</, '顶栏入口文案为「发布」');
  const buildJs = fs.readFileSync(path.join(pluginRoot, 'scripts', 'web', 'build.js'), 'utf8');
  assert.ok(buildJs.includes('data-step='), '五步导航 data-step 结构存在');
  for (const k of ['plan', 'link', 'docs', 'merge', 'release']) assert.ok(buildJs.includes(`'${k}'`), `五步导航含 ${k}`);
  assert.ok(buildJs.includes('发布流程') || buildJs.includes('五步'), '发布流程语义存在');
  for (const s of ['AI 写作', 'TRAE CN', 'TRAE', '提交文档到 Git', '官网 AI 写作', '立即检测']) {
    assert.ok(buildJs.includes(s), `文档/发布页关键入口：${s}`);
  }
  assert.ok(buildJs.includes('publishDoc') || buildJs.includes('docsPrompt'), '前端消费文档清单/提示词');
});

t('L5-2 i18n 同步：发布流程新增文案中英文同步', () => {
  const I = globalThis.ATBI18N;
  const { EN } = I._dict;
  for (const zh of ['发布', 'AI 写作', '提交文档到 Git', '官网 AI 写作', '立即检测', '正式发布', '文档编写', '关联条目与提交']) {
    assert.ok(zh in EN, `词典应含「${zh}」`);
  }
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
if (failed) {
  console.error(`\n${failed} 个用例失败`);
  process.exit(1);
}
console.log(`\n全部通过（${cases.length} 例）`);
