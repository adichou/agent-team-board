#!/usr/bin/env node
// BUG-20260928-003 发布文档提交流程不携带文档引用的本地图片，AI 翻译与 AI 校对不检查图片
// 语种一致性 —— 分层测试。
// L1 纯逻辑（publish-flow：翻译提示词图片语种对齐约束 + 校对提示词图片语种检查项）；
// L6 真实 git（build-git.commitPublishDocs：文档引用的本地图片并入提交范围，静态解析口径
//     对齐 BUG-20260927-001，noop / gitignore / 不夹带边界）。
// 用法：node scripts/tests/bug-20260928-003.test.mjs

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as flow from '../lib/publish-flow.mjs';
import * as buildGit from '../lib/build-git.mjs';

const cases = [];
const t = (name, fn) => cases.push([name, fn]);

/* ---------- L1 纯逻辑：翻译 / 校对提示词图片语种约束 ---------- */

function translatePrompt({ langs = ['cn', 'en'], customDocs = [] } = {}) {
  return flow.buildDocTranslatePrompt({
    projectRoot: '/tmp/proj-x', planId: 'BLD-20260928-003',
    runId: 'tr-20260928-090909-ab03', langs, customDocs, atbPath: '/tmp/atb.mjs',
  });
}

function proofreadPrompt({ langs = ['cn', 'en'], customDocs = [] } = {}) {
  return flow.buildDocProofreadPrompt({
    projectRoot: '/tmp/proj-x', planId: 'BLD-20260928-003',
    runId: 'chk-20260928-090909-ab03', langs, customDocs, atbPath: '/tmp/atb.mjs',
  });
}

t('L1-1 翻译约束含图片引用语种对齐：<name>.png 与 <name>_<lang>.png 惯例；一律改写为语种变体引用（BUG-20260928-008 口径：文件存在与否不影响改写、不阻塞、不强求）；不虚构图片', () => {
  const tp = translatePrompt();
  const idx = tp.indexOf('翻译约束：');
  assert.ok(idx >= 0, '存在「翻译约束：」节');
  const section = tp.slice(idx);
  assert.ok(section.includes('图片'), '翻译约束节应覆盖图片引用');
  assert.ok(/_en\.png|_<lang>|语种图片|_<目标语言>/.test(section), '应给出 <name>.png 与 <name>_en.png 既有惯例（或等价表述）');
  assert.ok(section.includes('语种'), '图片引用按语种对齐的口径应点明');
  // BUG-20260928-008：原「不存在则保持基准原引用」措辞歧义（被读作保持默认语言引用），
  // 改为一律改写为 <name>_<lang> 语种变体；文件存在与否不影响引用改写。
  assert.ok(/一律改写|一律.*改写为/.test(section), '本地图片引用一律改写为语种变体（不以文件存在为前提）');
  assert.ok(/是否存在不影响引用改写|存在与否不影响引用改写/.test(section), '图片文件存在与否不影响引用改写');
  assert.ok(!/不存在则保持|保持基准原引用/.test(section), '不再含「不存在则保持基准原引用」歧义句式');
  assert.ok(section.includes('不阻塞') || section.includes('不强求'), '不阻塞、不强求口径');
  assert.ok(section.includes('不') && section.includes('虚构'), '不得虚构图片文件');
});

t('L1-2 翻译既有约束不回归：基准唯一 / 链接互链 / 链接文本保持基准原文', () => {
  const tp = translatePrompt();
  assert.ok(tp.includes('唯一翻译基准') || tp.includes('唯一基准'), '基准唯一约束保持');
  assert.ok(tp.includes('README_en.md → CHANGELOG_en.md / FEATURES_en.md'), 'README 同语言互链约束保持');
  assert.ok(tp.includes('[AGENTS.md](./AGENTS_en.md)'), '链接文本保持基准原文示例保持（BUG-20260923-004）');
});

t('L1-3 校对约束含图片引用语种一致性检查：默认语言文档引用其他语种图片必须显式提示，交由用户确认处理', () => {
  const pp = proofreadPrompt();
  const idx = pp.indexOf('校对约束：');
  assert.ok(idx >= 0, '存在「校对约束：」节');
  const section = pp.slice(idx);
  assert.ok(section.includes('图片'), '校对约束节应覆盖图片引用');
  assert.ok(section.includes('语种') || section.includes('语言'), '图片引用语种一致性应点明');
  assert.ok(/显式提示|必须.*提示|以问题形式提示/.test(section), '不符合语种的引用必须在校对结果中显式提示');
  assert.ok(section.includes('_en') || section.includes('_<lang>') || /语种后缀/.test(section), '应给出其他语种图片（如 xxx_en.png）的判别口径');
  assert.ok(section.includes('用户') && (section.includes('确认') || section.includes('处理')), '交由用户确认处理');
  // 只读不改口径不回退
  assert.ok(pp.includes('只读核查') || pp.includes('不修改'), '只读不改约束保持');
});

t('L1-4 校对既有检查项不回归：错别字 / 行文规范 / 链接核查待确认 / 行号回执格式', () => {
  const pp = proofreadPrompt();
  assert.ok(pp.includes('错别字') && pp.includes('行文规范'), '错别字与行文规范检查项保持');
  assert.ok(pp.includes('待确认'), '链接无法验证标「待确认」口径保持（REQ-20260924-006）');
  assert.ok(pp.includes('独立一行') && pp.includes('行号开头'), '回执格式约束保持（REQ-20260924-004）');
  assert.ok(pp.includes('chk-20260928-090909-ab03'), '运行参数区保持');
});

/* ---------- L6 真实 git：commitPublishDocs 携带文档引用的本地图片 ---------- */

const GIT_ENV = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' };
const git = (cwd, ...args) => {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', env: GIT_ENV, timeout: 30000 });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} 失败：${r.stderr || r.stdout}`);
  return String(r.stdout).trim();
};

const mkProj = (name) => {
  const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), `atb-bug928-${name}-`)));
  const proj = path.join(tmp, 'proj');
  fs.mkdirSync(proj);
  git(proj, 'init', '-q', '-b', 'main');
  git(proj, 'config', 'user.email', 't@e.co');
  git(proj, 'config', 'user.name', 'T');
  fs.writeFileSync(path.join(proj, 'base.txt'), 'base\n');
  git(proj, 'add', '-A');
  git(proj, 'commit', '-q', '-m', 'init');
  return proj;
};

const headFiles = (proj) => git(proj, 'diff-tree', '--no-commit-id', '--name-only', '-r', 'HEAD').split('\n').filter(Boolean);
const isTracked = (proj, f) => {
  const r = spawnSync('git', ['ls-files', '--', f], { cwd: proj, encoding: 'utf8', env: GIT_ENV });
  return String(r.stdout || '').trim().length > 0;
};

const DOCS = ['README.md', 'README_en.md', 'CHANGELOG.md', 'CHANGELOG_en.md', 'FEATURES.md', 'FEATURES_en.md', 'AGENTS.md', 'AGENTS_en.md', 'LICENSE.md'];

t('L6-1 文档正文引用的本地图片（Markdown + HTML img）随文档一并提交，未引用文件不夹带', () => {
  const proj = mkProj('commit');
  fs.writeFileSync(path.join(proj, 'README.md'), [
    '# t', '',
    '![界面](image/README/x.png)', '',
    '<img src="image/html.png" width="100">', '',
    '英文版 ![ui](image/README/x_en.png)', '',
  ].join('\n'));
  for (const f of DOCS.slice(1)) fs.writeFileSync(path.join(proj, f), `# ${f}\n`);
  fs.mkdirSync(path.join(proj, 'image', 'README'), { recursive: true });
  fs.writeFileSync(path.join(proj, 'image', 'README', 'x.png'), 'png-x');
  fs.writeFileSync(path.join(proj, 'image', 'README', 'x_en.png'), 'png-x-en');
  fs.writeFileSync(path.join(proj, 'image', 'html.png'), 'png-html');
  fs.writeFileSync(path.join(proj, 'image', 'unref.png'), 'png-unreferenced'); // 未被引用 → 不夹带
  const r = buildGit.commitPublishDocs(proj, { message: 'docs: 发布文档 BLD-20260928-003', files: DOCS });
  assert.equal(r.noop, false, '应产生提交');
  assert.ok(r.commitHash, '应返回提交 hash');
  assert.deepEqual([...r.files].sort(), [...DOCS].sort(), 'files 仍为 .md 文档清单');
  assert.deepEqual([...r.images].sort(), ['image/README/x.png', 'image/README/x_en.png', 'image/html.png'].sort(), 'images = 文档正文引用的本地图片');
  assert.deepEqual(headFiles(proj).sort(), [...DOCS, 'image/README/x.png', 'image/README/x_en.png', 'image/html.png'].sort(), '提交应含文档 + 被引用图片，不含未引用图片');
  assert.ok(isTracked(proj, 'image/README/x.png'), '被引用图片应已入库（不再悬空）');
  assert.ok(!isTracked(proj, 'image/unref.png'), '未引用图片不得夹带');
  // hashes 仍为 .md 文档（recordDocsCommit 白名单兼容）
  assert.deepEqual(Object.keys(r.hashes).sort(), [...DOCS].sort(), 'hashes 只含 .md 文档');
});

t('L6-2 静态解析口径对齐 BUG-20260927-001：远程 / 绝对路径 / 锚点 / 非图片扩展名 / 逃逸 / 源码目录 / 看板目录均不入提交', () => {
  const proj = mkProj('parse');
  fs.writeFileSync(path.join(proj, 'README.md'), [
    '# t', '',
    '![远程](https://example.com/a.png)', '',
    '![协议相对](//cdn.example.com/b.png)', '',
    '![绝对](/root/c.png)', '',
    '![锚点](#frag)', '',
    '![非图片](image/notes.txt)', '',
    '![逃逸](../outside.png)', '',
    '![源码](scripts/evil.png)', '',
    '![看板](agent-team-board/data/b.png)', '',
    '![本地](image/ok.png)', '',
  ].join('\n'));
  for (const f of DOCS.slice(1)) fs.writeFileSync(path.join(proj, f), `# ${f}\n`);
  fs.mkdirSync(path.join(proj, 'image'), { recursive: true });
  fs.writeFileSync(path.join(proj, 'image', 'ok.png'), 'png-ok');
  fs.writeFileSync(path.join(proj, 'image', 'notes.txt'), 'txt');
  fs.mkdirSync(path.join(proj, 'scripts'), { recursive: true });
  fs.writeFileSync(path.join(proj, 'scripts', 'evil.png'), 'png-evil');
  fs.mkdirSync(path.join(proj, 'agent-team-board', 'data'), { recursive: true });
  fs.writeFileSync(path.join(proj, 'agent-team-board', 'data', 'b.png'), 'png-board');
  const r = buildGit.commitPublishDocs(proj, { message: 'docs: 发布文档 BLD-20260928-003', files: DOCS });
  assert.deepEqual(r.images, ['image/ok.png'], '仅仓库内相对图片入范围');
  assert.deepEqual(headFiles(proj).filter((f) => !f.endsWith('.md')), ['image/ok.png'], '提交只夹带被引用的合规图片');
});

t('L6-3 引用图片但磁盘缺失：不报错、不阻断提交（悬空引用交由用户自查）', () => {
  const proj = mkProj('missing');
  fs.writeFileSync(path.join(proj, 'README.md'), '# t\n\n![缺失](image/gone.png)\n');
  for (const f of DOCS.slice(1)) fs.writeFileSync(path.join(proj, f), `# ${f}\n`);
  const r = buildGit.commitPublishDocs(proj, { message: 'docs: 发布文档 BLD-20260928-003', files: DOCS });
  assert.deepEqual(r.images, [], '磁盘不存在的图片不入清单');
  assert.deepEqual(headFiles(proj).sort(), [...DOCS].sort(), '提交仍只含文档（不因缺图失败）');
});

t('L6-4 noop 判定含图片：文档无变化但图片新增 / 修改时仍产生提交；全部无变化才 noop', () => {
  const proj = mkProj('noop');
  fs.writeFileSync(path.join(proj, 'README.md'), '# t\n\n![界面](image/ui.png)\n');
  for (const f of DOCS.slice(1)) fs.writeFileSync(path.join(proj, f), `# ${f}\n`);
  fs.mkdirSync(path.join(proj, 'image'), { recursive: true });
  fs.writeFileSync(path.join(proj, 'image', 'ui.png'), 'png-1');
  buildGit.commitPublishDocs(proj, { message: 'docs: 发布文档 BLD-20260928-003', files: DOCS });
  // 文档与图片均无变化 → noop
  const n = buildGit.commitPublishDocs(proj, { message: 'docs: 发布文档 BLD-20260928-003', files: DOCS });
  assert.equal(n.noop, true, '全部无变化应为 noop');
  // 文档不变、图片内容更新 → 仍产生提交（只含图片）
  fs.writeFileSync(path.join(proj, 'image', 'ui.png'), 'png-2');
  const r2 = buildGit.commitPublishDocs(proj, { message: 'docs: 发布文档 BLD-20260928-003', files: DOCS });
  assert.equal(r2.noop, false, '图片有变化不应 noop');
  assert.deepEqual(headFiles(proj), ['image/ui.png'], '提交应只含图片');
  // 图片已入库后再新增被引用图片 → 提交只含新图
  fs.writeFileSync(path.join(proj, 'image', 'extra.png'), 'png-extra');
  fs.appendFileSync(path.join(proj, 'README.md'), '\n![补充](image/extra.png)\n');
  const r3 = buildGit.commitPublishDocs(proj, { message: 'docs: 发布文档 BLD-20260928-003', files: DOCS });
  assert.deepEqual(headFiles(proj).sort(), ['README.md', 'image/extra.png'].sort(), '文档与新增图片同入提交');
});

t('L6-5 .gitignore 忽略的图片不强收入库、不阻断提交；用户预先暂存的无关内容不夹带', () => {
  const proj = mkProj('ignore');
  fs.writeFileSync(path.join(proj, '.gitignore'), 'image/ignored.png\n');
  fs.writeFileSync(path.join(proj, 'README.md'), '# t\n\n![a](image/keep.png)\n![b](image/ignored.png)\n');
  for (const f of DOCS.slice(1)) fs.writeFileSync(path.join(proj, f), `# ${f}\n`);
  fs.mkdirSync(path.join(proj, 'image'), { recursive: true });
  fs.writeFileSync(path.join(proj, 'image', 'keep.png'), 'png-keep');
  fs.writeFileSync(path.join(proj, 'image', 'ignored.png'), 'png-ignored');
  // 用户预先暂存无关文件（不夹带回归：pathspec 限定）
  fs.writeFileSync(path.join(proj, 'user-note.txt'), 'user\n');
  git(proj, 'add', 'user-note.txt');
  const r = buildGit.commitPublishDocs(proj, { message: 'docs: 发布文档 BLD-20260928-003', files: DOCS });
  assert.deepEqual(r.images, ['image/keep.png'], '被忽略图片不入清单');
  assert.ok(!headFiles(proj).includes('image/ignored.png'), '被忽略图片不入提交');
  assert.ok(!headFiles(proj).includes('user-note.txt'), '用户预暂存内容不夹带');
  assert.ok(isTracked(proj, 'image/keep.png'), '未忽略的被引用图片正常入库');
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
