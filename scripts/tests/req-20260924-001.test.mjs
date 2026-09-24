#!/usr/bin/env node
// REQ-20260924-001 文档编写整体审查步骤优化 —— 分层测试。
// L1 纯逻辑（docs-review-checks：语言一致性 / 链接解析与可达性；publish-flow：AI 校对提示词）；
// L2 数据层（docs-check-store 校对账本与独立锁；atb docscheck CLI 全链路）；
// L3 服务接口（review-checks 自动检查 / docs-proofread start+current 门禁 / publish-plan docsCheck /
//    全局简报 kind=docscheck）；
// L4 前端静态契约（整体审查对话框自动检查项 ✓/✗ + 明细 + 「运行自动检查」「AI 校对」按钮）；
// L6 i18n（新增文案中英同步）。
// 用法：node scripts/tests/req-20260924-001.test.mjs

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
import * as checkStore from '../lib/docs-check-store.mjs';
import * as checks from '../lib/docs-review-checks.mjs';
import '../web/i18n.js';

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const atb = path.join(pluginRoot, 'scripts', 'atb.mjs');
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
const readsOf = (contents) => (f) => (Object.prototype.hasOwnProperty.call(contents, f) ? contents[f] : null);

const cases = [];
const t = (name, fn) => cases.push([name, fn]);

/* ---------- L1 纯逻辑（docs-review-checks.mjs） ---------- */

t('L1-1 语言一致性：cn 中文 ✓；en 文件残留中文 ✗；en 英文 ✓；ja 缺假名 ✗ / 含假名 ✓；ko、ru 判定；代码块剥离；过短文本不通过', () => {
  const cn = '# 项目简介\n\n这是一个中文发布文档，介绍本版本的主要变化与使用方式，用于语言一致性自动检查。\n';
  const en = '# About this project\n\nThis release note describes the main changes and usage of the current version in English.\n';
  const jp = '# プロジェクト紹介\n\nこれは日本語のリリースドキュメントであり、本次版本の主な変更を説明します。\n';
  const ko = '# 프로젝트 소개\n\n이 문서는 한국어 릴리스 문서이며, 이번 버전의 주요 변경 사항을 설명합니다.\n';
  const ru = '# Описание проекта\n\nЭтот документ описывает основные изменения текущей версии на русском языке.\n';
  const docFiles = [
    { key: 'README', lang: 'cn', file: 'README.md' },
    { key: 'README', lang: 'en', file: 'README_en.md' },
    { key: 'README', lang: 'jp', file: 'README_jp.md' },
    { key: 'README', lang: 'ko', file: 'README_ko.md' },
    { key: 'README', lang: 'ru', file: 'README_ru.md' },
  ];
  // 全部语言内容正确 → 每个文件 ✓
  let r = checks.checkDocLangs(docFiles, readsOf({
    'README.md': cn, 'README_en.md': en, 'README_jp.md': jp, 'README_ko.md': ko, 'README_ru.md': ru,
  }));
  assert.equal(r.ok, true);
  for (const f of r.files) assert.equal(f.ok, true, `${f.file} 应判定为对应语言：${f.detail}`);

  // en 文件残留中文内容（未翻译）→ ✗ 且带文件名与说明
  r = checks.checkDocLangs(docFiles, readsOf({
    'README.md': cn, 'README_en.md': cn, 'README_jp.md': jp, 'README_ko.md': ko, 'README_ru.md': ru,
  }));
  assert.equal(r.ok, false);
  const enFile = r.files.find((f) => f.file === 'README_en.md');
  assert.equal(enFile.ok, false, '英文文件放中文内容应不通过');
  assert.ok(enFile.detail && enFile.detail.length > 0, '不通过须带说明');

  // ja 文件放纯中文（无假名）→ ✗（假名是日语的判定性文字体系）
  r = checks.checkDocLangs([{ key: 'README', lang: 'jp', file: 'README_jp.md' }], readsOf({ 'README_jp.md': cn }));
  assert.equal(r.files[0].ok, false, '日语文件无假名应不通过');

  // 围栏代码块（英文代码）不影响中文判定
  const withCode = `${cn}\n\`\`\`bash\nnpm install something-english --save\nconsole.log("hello world");\n\`\`\`\n`;
  r = checks.checkDocLangs([{ key: 'README', lang: 'cn', file: 'README.md' }], readsOf({ 'README.md': withCode }));
  assert.equal(r.files[0].ok, true, '代码块不应把中文文档误判成英文');

  // 过短文本：无法判定 → 不通过并说明
  r = checks.checkDocLangs([{ key: 'README', lang: 'en', file: 'README_en.md' }], readsOf({ 'README_en.md': '# T\n' }));
  assert.equal(r.files[0].ok, false);
  assert.match(r.files[0].detail, /过短|无法判定/);
});

t('L1-2 链接解析：行内链接与图片、行号；围栏 / 行内代码中的链接跳过；纯锚点与 mailto 跳过；尖括号目标', () => {
  const text = [
    '# 标题',
    '',
    '[更新日志](CHANGELOG.md)',
    '![徽标](./image/logo.png)',
    '[章节](#section) 与 [邮件](mailto:a@b.co) 不检查',
    '`[行内代码不检查](x.md)`',
    '',
    '```md',
    '[代码块内不检查](y.md)',
    '```',
    '',
    '带尖括号 [目标](<a b.md>) 与普通 [末尾](z.md)',
  ].join('\n');
  const links = checks.extractMarkdownLinks(text);
  const hrefs = links.map((l) => l.href);
  assert.ok(hrefs.includes('CHANGELOG.md'), '行内链接');
  assert.ok(hrefs.includes('./image/logo.png'), '图片目标');
  assert.ok(hrefs.includes('a b.md'), '尖括号目标去尖括号');
  assert.ok(hrefs.includes('z.md'), '普通链接');
  assert.ok(!hrefs.includes('x.md') && !hrefs.includes('y.md'), '行内代码 / 围栏代码内的链接不检查');
  assert.ok(!hrefs.some((h) => h.startsWith('#') || h.startsWith('mailto:')), '纯锚点与 mailto 跳过');
  const changelog = links.find((l) => l.href === 'CHANGELOG.md');
  assert.equal(changelog.line, 3, '记录行号（1 起）');
});

t('L1-3 链接检查：本地存在 / 缺失死链、锚点剥离、远程 HEAD ✓、405 回退 GET、HTTP 404 与网络错误死链带原因', async () => {
  const text = [
    '# 文档',
    '[更新日志](CHANGELOG.md#v1)',
    '[功能](FEATURES.md)',
    '[缺失页](MISSING.md)',
    '[官网](https://example.com/)',
  ].join('\n');
  const docFiles = [{ key: 'README', lang: 'cn', file: 'README.md' }];
  const exists = (f) => f === 'CHANGELOG.md' || f === 'FEATURES.md';
  const calls = [];
  const fetchFn = async (url, opts = {}) => {
    calls.push({ url, method: opts.method || 'GET' });
    if (url === 'https://example.com/' && (opts.method || 'GET') === 'GET' && calls.filter((c) => c.url === url).length >= 3) {
      return { ok: false, status: 405, statusText: 'Method Not Allowed' };
    }
    return { ok: true, status: 200, statusText: 'OK' };
  };
  const r = await checks.checkDocLinks(docFiles, readsOf({ 'README.md': text }), { existsFile: exists, fetchFn });
  assert.equal(r.ok, false, '存在死链整体不通过');
  const f = r.files[0];
  assert.equal(f.file, 'README.md');
  assert.equal(f.total, 4, '四个可检查链接（锚点已剥离计入本地目标）');
  assert.equal(r.deadTotal, 1, '本地缺失一条死链（远程可达不计）');
  const missing = f.dead.find((d) => d.href === 'MISSING.md');
  assert.ok(missing, '缺失本地链接入死链');
  assert.ok(/不存在|缺失/.test(missing.reason), '死链带原因');
  assert.equal(missing.line, 4, '死链带行号');
  assert.ok(!f.dead.some((d) => d.href.startsWith('CHANGELOG.md')), '存在的本地链接不误报（含 # 锚点剥离）');

  // 远程：HEAD 200 → ✓；HEAD 405 回退 GET → ✓
  const okRun = await checks.checkDocLinks(
    docFiles,
    readsOf({ 'README.md': '[官网](https://example.com/)' }),
    { existsFile: exists, fetchFn: async () => ({ ok: true, status: 200, statusText: 'OK' }) },
  );
  assert.equal(okRun.ok, true, '远程可达整体通过');
  const fallbackCalls = [];
  const fbRun = await checks.checkDocLinks(
    docFiles,
    readsOf({ 'README.md': '[官网](https://example.com/)' }),
    {
      existsFile: exists,
      fetchFn: async (url, opts = {}) => {
        fallbackCalls.push(opts.method || 'GET');
        if ((opts.method || 'GET') === 'HEAD') return { ok: false, status: 405, statusText: 'Method Not Allowed' };
        return { ok: true, status: 200, statusText: 'OK' };
      },
    },
  );
  assert.equal(fbRun.ok, true, 'HEAD 405 回退 GET 判可达');
  assert.deepEqual(fallbackCalls, ['HEAD', 'GET'], '先 HEAD 后 GET');

  // HTTP 404 → 死链；网络错误 → 死链带原因
  const badRun = await checks.checkDocLinks(
    docFiles,
    readsOf({ 'README.md': '[a](https://a.co/) [b](https://b.co/)' }),
    {
      existsFile: exists,
      fetchFn: async (url) => {
        if (String(url).startsWith('https://a.co/')) return { ok: false, status: 404, statusText: 'Not Found' };
        throw new Error('getaddrinfo ENOTFOUND');
      },
    },
  );
  assert.equal(badRun.ok, false);
  const dead = badRun.files[0].dead;
  assert.equal(dead.length, 2);
  assert.match(dead.find((d) => d.href === 'https://a.co/').reason, /404/);
  assert.match(dead.find((d) => d.href === 'https://b.co/').reason, /ENOTFOUND|网络|失败/);

  // 多文件聚合：无链接文件平凡通过
  const multi = await checks.checkDocLinks(
    [{ key: 'A', lang: 'cn', file: 'A.md' }, { key: 'B', lang: 'cn', file: 'B.md' }],
    readsOf({ 'A.md': '# A', 'B.md': '[x](x.md)' }),
    { existsFile: () => true, fetchFn: async () => ({ ok: true, status: 200 }) },
  );
  assert.equal(multi.ok, true);
  assert.equal(multi.files.find((x) => x.file === 'A.md').total, 0);
});

t('L1-4 AI 校对提示词：默认语言文件清单（不含剩余语言与 LICENSE）/ runId / docscheck 四步回执 / 只读不改与不编造约束', () => {
  const p = flow.buildDocProofreadPrompt({
    projectRoot: '/tmp/proj-x', planId: 'BLD-20260924-001', runId: 'chk-20260924-101010-ab01',
    langs: ['cn', 'en'], customDocs: ['MIGRATION'], atbPath: '/tmp/atb.mjs',
  });
  assert.ok(p.includes('chk-20260924-101010-ab01'), '提示词带 runId');
  for (const f of ['README.md', 'CHANGELOG.md', 'FEATURES.md', 'AGENTS.md', 'MIGRATION.md']) {
    assert.ok(p.includes(f), `校对清单含默认语言 ${f}`);
  }
  assert.ok(!p.includes('README_en.md') && !p.includes('MIGRATION_en.md'), '剩余语言文件不在校对范围');
  assert.ok(!p.includes('LICENSE.md'), '单文件类 LICENSE 不进校对');
  assert.ok(p.includes('docscheck file') && p.includes('docscheck done') && p.includes('docscheck fail'), 'atb docscheck 回执指令');
  assert.ok(p.includes('pass') && p.includes('fail') && p.includes('--issues'), '逐文件 pass/fail + issues 回执');
  assert.ok(p.includes('错别字'), '错别字检查');
  assert.ok(p.includes('规范') || p.includes('语言习惯'), '行文规范检查');
  assert.ok(p.includes('不修改') || p.includes('只读'), '只读不改文档约束');
  assert.ok(p.includes('不编造'), '不编造问题约束');
});

/* ---------- L2 数据层（docs-check-store.mjs + CLI） ---------- */

function mkData(tmp) {
  const proj = mkRepo(path.join(tmp, 'proj'));
  fs.writeFileSync(path.join(proj, 'base.txt'), 'base');
  git(proj, ['add', '-A']); git(proj, ['commit', '-m', 'init']);
  core.initData(proj);
  return { proj, dataDir: core.dataDirFrom(proj) };
}

t('L2-1 校对账本与独立锁：默认语言非单文件 pending；docscheck.lock 独立；重复 start 拒绝；checking/pass/fail 流转；fail 必带 issues；收尾回落与放锁；view/brief 计数', () => {
  const { dataDir } = mkData(tmpdir('atb-024-l21-'));
  const run = checkStore.createCheckRun(dataDir, { verId: 'BLD-20260924-001', owner: 'chk-1', langs: ['cn', 'en'], customDocs: ['MIGRATION'] });
  assert.match(run.runId, /^chk-\d{8}-\d{6}-[0-9a-f]{4,}$/);
  assert.equal(run.phase, 'running');
  assert.deepEqual(Object.keys(run.files).sort(), ['AGENTS.md', 'CHANGELOG.md', 'FEATURES.md', 'MIGRATION.md', 'README.md'], '默认语言非单文件（4 类 + 自定义默认份）');
  assert.ok(Object.values(run.files).every((s) => s === 'pending'));

  const lockFile = path.join(dataDir, 'runtime', '.locks', 'docscheck.lock');
  assert.ok(fs.existsSync(lockFile), '运行期间占用 docscheck.lock');
  assert.equal(JSON.parse(fs.readFileSync(lockFile, 'utf8')).runId, run.runId);
  const locks = fs.readdirSync(path.join(dataDir, 'runtime', '.locks'));
  assert.ok(!locks.includes('summary.lock') && !locks.includes('translate.lock') && !locks.includes('impl.lock') && !locks.includes('refine.lock'), '不占其他锁');

  assert.throws(
    () => checkStore.createCheckRun(dataDir, { verId: 'BLD-20260924-002', owner: 'chk-2', langs: ['cn', 'en'] }),
    /已有进行中的 AI 校对/,
    '同一时间至多一个校对任务',
  );

  checkStore.markCheckFile(dataDir, run.runId, 'README.md', 'checking');
  checkStore.markCheckFile(dataDir, run.runId, 'README.md', 'pass');
  assert.throws(() => checkStore.markCheckFile(dataDir, run.runId, 'README_en.md', 'checking'), /校对目标文件/, '剩余语言文件不在账本');
  assert.throws(() => checkStore.markCheckFile(dataDir, run.runId, 'evil.txt', 'pass'), /校对目标文件/);
  assert.throws(() => checkStore.markCheckFile(dataDir, run.runId, 'CHANGELOG.md', 'done'), /state/, '非法 state 拒绝');
  assert.throws(() => checkStore.markCheckFile(dataDir, run.runId, 'CHANGELOG.md', 'fail'), /issues/, 'fail 必须带 issues');

  const ISSUES = '第 3 行：错别字「测式」应为「测试」；第 7 行：长句建议拆分';
  checkStore.markCheckFile(dataDir, run.runId, 'CHANGELOG.md', 'fail', ISSUES);
  let cur = checkStore.getCheckRun(dataDir, run.runId);
  assert.equal(cur.files['README.md'], 'pass');
  assert.equal(cur.issues['CHANGELOG.md'], ISSUES, 'issues 随 fail 入账');
  assert.equal(cur.issues['README.md'], undefined, 'pass 文件无 issues');

  checkStore.markCheckFile(dataDir, run.runId, 'FEATURES.md', 'checking');
  checkStore.finishCheckRun(dataDir, run.runId, { result: 'done', summary: '校对完成：1 项错别字' });
  const after = checkStore.getCheckRun(dataDir, run.runId);
  assert.equal(after.phase, 'done');
  assert.equal(after.files['FEATURES.md'], 'pending', '收尾时 checking 回落 pending 不悬挂');
  assert.equal(after.files['CHANGELOG.md'], 'fail', '已 fail 结果保留');
  assert.ok(!fs.existsSync(lockFile), '收尾释放锁');

  const view = checkStore.checkRunView(checkStore.latestCheckRun(dataDir, 'BLD-20260924-001'));
  assert.equal(view.counts.total, 5);
  assert.equal(view.counts.pass, 1);
  assert.equal(view.counts.fail, 1);
  assert.equal(view.counts.pending, 3);
  assert.equal(view.lock, 'docscheck');
  assert.equal(view.issues['CHANGELOG.md'], ISSUES);
  const brief = checkStore.checkBrief(checkStore.getCheckRun(dataDir, run.runId));
  assert.equal(brief.kind, 'docscheck');
  assert.equal(brief.counts.total, 5);

  // 单语言集（如 cn）也有默认语言 4 文件，可正常启动校对（锁已释放）
  const run1 = checkStore.createCheckRun(dataDir, { verId: 'BLD-20260924-003', owner: 'chk-3', langs: ['cn'] });
  assert.equal(Object.keys(run1.files).length, 4, '单语言集默认语言 4 文件');
  checkStore.finishCheckRun(dataDir, run1.runId, { result: 'failed', reason: '放弃' });

  // failed 收尾：必带 reason
  const run2 = checkStore.createCheckRun(dataDir, { verId: 'BLD-20260924-001', owner: 'chk-4', langs: ['cn', 'en'] });
  assert.throws(() => checkStore.finishCheckRun(dataDir, run2.runId, { result: 'failed' }), /reason/);
  checkStore.finishCheckRun(dataDir, run2.runId, { result: 'failed', reason: '网络中断' });
  assert.equal(checkStore.getCheckRun(dataDir, run2.runId).phase, 'failed');
});

t('L2-2 CLI：atb docscheck start/file/done/show 全链路（--issues 落盘；非法回执报错）', () => {
  const tmp = tmpdir('atb-024-cli-');
  const proj = mkRepo(path.join(tmp, 'proj'));
  fs.writeFileSync(path.join(proj, 'base.txt'), 'base');
  git(proj, ['add', '-A']); git(proj, ['commit', '-m', 'init']);
  core.initData(proj);
  const dataDir = core.dataDirFrom(proj);
  const v = buildStore.createVersion(dataDir, { items: [{ itemId: 'REQ-20260924-001', commit: 'a'.repeat(40) }] });

  const cli = (args) => spawnSync(process.execPath, [atb, ...args, '--dir', proj], { encoding: 'utf8', timeout: 30000 });
  let r = cli(['docscheck', 'start', '--id', v.id, '--by', 't', '--json']);
  assert.equal(r.status, 0, `docscheck start：${r.stderr || r.stdout}`);
  const started = JSON.parse(r.stdout);
  assert.match(started.runId, /^chk-/);
  assert.ok(started.prompt.includes('docscheck file'), 'start 输出提示词');

  r = cli(['docscheck', 'file', started.runId, '--file', 'README.md', '--state', 'checking']);
  assert.equal(r.status, 0, `file checking：${r.stderr || r.stdout}`);
  r = cli(['docscheck', 'file', started.runId, '--file', 'README.md', '--state', 'pass']);
  assert.equal(r.status, 0);
  r = cli(['docscheck', 'file', started.runId, '--file', 'CHANGELOG.md', '--state', 'fail']);
  assert.notEqual(r.status, 0, 'fail 缺 issues 报错');
  assert.match(r.stderr || r.stdout, /issues/);
  r = cli(['docscheck', 'file', started.runId, '--file', 'CHANGELOG.md', '--state', 'fail', '--issues', '第 2 行错别字']);
  assert.equal(r.status, 0);
  r = cli(['docscheck', 'file', started.runId, '--file', 'evil.txt', '--state', 'pass']);
  assert.notEqual(r.status, 0, '集合外文件报错');

  const cur = checkStore.getCheckRun(dataDir, started.runId);
  assert.equal(cur.files['README.md'], 'pass');
  assert.equal(cur.issues['CHANGELOG.md'], '第 2 行错别字');

  r = cli(['docscheck', 'done', started.runId, '--summary', '校对完成', '--json']);
  assert.equal(r.status, 0, `done：${r.stderr || r.stdout}`);
  assert.equal(JSON.parse(r.stdout).phase, 'done');

  // show：缺 --dir（且 cwd 非看板项目）报错不静默；带 --dir 缺省展示最新 run
  r = spawnSync(process.execPath, [atb, 'docscheck', 'show'], { encoding: 'utf8', cwd: os.tmpdir(), timeout: 30000 });
  assert.notEqual(r.status, 0, '缺 --dir 报错不静默');
  r = cli(['docscheck', 'show']);
  assert.equal(r.status, 0, `show：${r.stderr || r.stdout}`);
  assert.ok(r.stdout.includes('chk-'), 'show 显示最新 run');
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

t('L3 服务接口：review-checks 自动检查 / docs-proofread 门禁与 current / publish-plan docsCheck / 全局简报', async () => {
  const tmp = tmpdir('atb-024-serve-');
  const proj = mkRepo(path.join(tmp, 'proj'));
  fs.writeFileSync(path.join(proj, 'base.txt'), 'base');
  git(proj, ['add', '-A']); git(proj, ['commit', '-m', 'init']);
  git(proj, ['switch', '-c', 'dev']);
  fs.writeFileSync(path.join(proj, 'a.txt'), 'A');
  git(proj, ['add', '-A']); git(proj, ['commit', '-m', 'feat: A REQ-20260924-001']);
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

    // review-checks：en 文件残留中文（语言一致 ✗）+ 本地死链（详细提示）→ 两检查结果齐备
    fs.writeFileSync(path.join(proj, 'README.md'), '# 项目\n\n这是中文发布文档，介绍本版本的主要变化与使用方式说明。\n\n[更新日志](CHANGELOG.md)\n[缺失页](MISSING.md)\n');
    fs.writeFileSync(path.join(proj, 'CHANGELOG.md'), '# 更新日志\n\n本版本修复了若干问题，并优化了安装体验与文档结构。\n');
    fs.writeFileSync(path.join(proj, 'README_en.md'), '# 项目\n\n这是中文发布文档，介绍本版本的主要变化与使用方式说明。\n');
    r = await req(port, 'POST', `/api/build/docs/review-checks${P}`, { id: vid });
    assert.equal(r.status, 200, `review-checks：${r.text}`);
    assert.ok(r.json.lang, '返回语言一致性检查');
    const langEn = r.json.lang.files.find((f) => f.file === 'README_en.md');
    assert.equal(langEn.ok, false, 'en 文件残留中文内容判定不通过');
    const langCn = r.json.lang.files.find((f) => f.file === 'README.md');
    assert.equal(langCn.ok, true, 'cn 文件中文内容通过');
    assert.ok(r.json.links, '返回链接可达性检查');
    assert.equal(r.json.links.ok, false, '存在死链整体不通过');
    const readmeLinks = r.json.links.files.find((f) => f.file === 'README.md');
    const deadMissing = readmeLinks.dead.find((d) => d.href === 'MISSING.md');
    assert.ok(deadMissing && deadMissing.reason, '死链 MISSIING.md 带详细原因');
    assert.ok(deadMissing.line >= 5, '死链带行号');

    // review-checks：版本不存在 4xx（AtbError「找不到版本计划」→ 外层统一 400）
    r = await req(port, 'POST', `/api/build/docs/review-checks${P}`, { id: 'BLD-20260101-999' });
    assert.equal(r.status, 400, '版本不存在 400');

    // AI 校对门禁：默认语言未全审 400 带缺口
    for (const f of ['README.md', 'CHANGELOG.md', 'FEATURES.md', 'AGENTS.md']) {
      if (!fs.existsSync(path.join(proj, f))) fs.writeFileSync(path.join(proj, f), `# ${f}\n\n这是中文发布文档的占位内容，介绍本版本的主要变化与使用方式说明。\n`);
    }
    fs.writeFileSync(path.join(proj, 'FEATURES.md'), '# 功能\n\n本版本提供看板、批量执行与发布文档三阶段流程等功能说明。\n');
    fs.writeFileSync(path.join(proj, 'AGENTS.md'), '# 协作规则\n\n本文件描述开发本产品的协作规则与收口要求。\n');
    r = await req(port, 'POST', `/api/build/docs-proofread/start${P}`, { id: vid });
    assert.equal(r.status, 400, '默认语言未全审不可启动 AI 校对');
    assert.match(r.json.error || '', /默认语言|已审核/);

    // 逐文件通过审核（默认语言 4 文件）
    for (const f of ['README.md', 'CHANGELOG.md', 'FEATURES.md', 'AGENTS.md']) {
      r = await req(port, 'POST', `/api/build/docs/review${P}`, { id: vid, file: f });
      assert.equal(r.status, 200, `review ${f}：${r.text}`);
    }

    // AI 校对启动：200 返回 runId + 提示词；重复 start 拒绝
    r = await req(port, 'POST', `/api/build/docs-proofread/start${P}`, { id: vid });
    assert.equal(r.status, 200, `proofread start：${r.text}`);
    const chkRunId = r.json.runId;
    assert.match(chkRunId, /^chk-/);
    assert.ok(r.json.prompt.includes('docscheck file'), '提示词含 docscheck 回执指令');
    r = await req(port, 'POST', `/api/build/docs-proofread/start${P}`, { id: vid });
    assert.equal(r.status, 400, '已有进行中的校对任务拒绝重复 start');

    // current：回执 pass 后进度 1/4；publish-plan 带 docsCheck
    checkStore.markCheckFile(dataDir, chkRunId, 'README.md', 'pass');
    r = await req(port, 'GET', `/api/build/docs-proofread/current${P}&id=${vid}`);
    assert.equal(r.status, 200);
    assert.equal(r.json.run.runId, chkRunId);
    assert.equal(r.json.run.counts.pass, 1, '校对进度 1/4');
    assert.ok(r.json.docsFlow, 'current 带三阶段求值');
    r = await req(port, 'GET', `/api/build/publish-plan${P}&id=${vid}`);
    assert.ok(r.json.docsCheck && r.json.docsCheck.runId === chkRunId, 'publish-plan 带 docsCheck 字段');

    // 全局面板：进行中出现 kind=docscheck；收尾移出
    r = await req(port, 'GET', '/api/batch/global');
    let row = (r.json.projects || []).find((p) => p.root === proj);
    let brief = (row.tasks || []).find((x) => x.kind === 'docscheck');
    assert.ok(brief, '进行中 AI 校对进入全局面板');
    assert.equal(brief.counts.total, 4);
    checkStore.finishCheckRun(dataDir, chkRunId, { result: 'done', summary: '校对完成' });
    r = await req(port, 'GET', '/api/batch/global');
    row = (r.json.projects || []).find((p) => p.root === proj);
    assert.ok(!((row.tasks || []).some((x) => x.kind === 'docscheck')), '收尾后全局面板移出');

    // merging 拒绝启动
    buildStore.beginMerge(dataDir, vid, {});
    r = await req(port, 'POST', `/api/build/docs-proofread/start${P}`, { id: vid });
    assert.equal(r.status, 409, '版本合并中不可启动 AI 校对');
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
    unwritten: '未编写', pending: '待审核',
  },
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

function finalizeModalFns(source) {
  // 显式带 normalizeFlowEval（不依赖其他用例先运行对沙箱的注入）；
  // REQ-20260924-004 起 ③ 项明细经 splitProofreadIssues / parseIssueLineNo 逐条渲染，一并注入
  return [
    extractFn(source, 'normalizeFlowEval'),
    extractFn(source, 'splitProofreadIssues'),
    extractFn(source, 'parseIssueLineNo'),
    extractFn(source, 'renderFinalizeModal'),
  ].join('\n');
}

const READY_FLOW = { files: [], defaultReviewedCount: 4, restReviewedCount: 4, canFinalize: true, finalized: null };

t('L4-1 整体审查对话框：未运行态（◐ 提示）+「运行自动检查」「AI 校对」按钮 + 三条实际检查项（REQ-20260924-003 精简后无静态人工项）', () => {
  const source = fs.readFileSync(new URL('../web/build.js', import.meta.url), 'utf8');
  const html = vmRun(finalizeModalFns(source), L4_CTX, `renderFinalizeModal({ id: 'BLD-20260924-001', pf: {
    finalize: { open: true, busy: false },
    plan: { langs: ['cn', 'en'], docsFlow: ${JSON.stringify(READY_FLOW)} } } })`);
  assert.match(html, /整体审查完结（BLD-20260924-001）/, '对话框标题');
  // 自动检查按钮
  assert.ok(html.includes('data-pf-checks'), '「运行自动检查」按钮');
  assert.ok(html.includes('运行自动检查'), '按钮文案');
  assert.ok(html.includes('data-pf-proofread'), '「AI 校对」按钮');
  assert.ok(html.includes('AI 校对'), '按钮文案');
  // 三类检查项存在
  assert.ok(html.includes('各语言内容语义一致（以已审核默认语言为基准）'), '语言一致项保留');
  assert.ok(html.includes('README 按语言互链'), '链接项保留（扩展为全文档链接）');
  assert.ok(html.includes('默认语言错别字与行文规范'), 'AI 校对项');
  // 未运行提示
  assert.ok(html.includes('未运行'), '自动检查未运行提示');
  // REQ-20260924-003：静态人工项（本版范围一致 / LICENSE 口径）与门禁计数行不再渲染
  assert.ok(!html.includes('与本版发布范围一致'), '本版范围一致静态行随 REQ-20260924-003 移除');
  assert.ok(!html.includes('LICENSE 文件与项目实际开源口径一致'), 'LICENSE 口径静态行随 REQ-20260924-003 移除');
  assert.ok(html.includes('data-pf-finalize-cancel') && html.includes('data-pf-finalize-confirm'), '取消 / 确认完结按钮');
});

t('L4-2 整体审查对话框：自动检查结果 ✓/✗ 与死链 / 校对 fail 明细红叉', () => {
  const source = fs.readFileSync(new URL('../web/build.js', import.meta.url), 'utf8');
  const pfBase = {
    finalize: { open: true, busy: false },
    plan: { langs: ['cn', 'en'], docsFlow: READY_FLOW },
  };
  // 语言一致 ✓ + 死链 ✗ 明细
  const pf1 = {
    ...pfBase,
    checks: {
      busy: false, error: null,
      lang: { ok: true, files: [{ file: 'README.md', lang: 'cn', ok: true, detail: '' }, { file: 'README_en.md', lang: 'en', ok: true, detail: '' }] },
      links: {
        ok: false, deadTotal: 1,
        files: [{ file: 'README.md', total: 3, dead: [{ href: 'MISSING.md', line: 6, reason: '本地文件不存在：MISSING.md' }] }],
      },
    },
  };
  const html1 = vmRun(finalizeModalFns(source), L4_CTX, `renderFinalizeModal({ id: 'V', pf: ${JSON.stringify(pf1)} })`);
  assert.ok(html1.includes('MISSING.md'), '死链目标展示');
  assert.ok(html1.includes('本地文件不存在'), '死链原因展示');
  assert.match(html1, /st-fail/, '存在红叉状态');
  assert.match(html1, /st-ok/, '存在通过状态');

  // AI 校对结果：done + 1 fail（issues 明细）
  const pf2 = {
    ...pfBase,
    plan: { ...pfBase.plan, docsCheck: {
      runId: 'chk-20260924-101010-ab01', phase: 'done',
      files: { 'README.md': 'pass', 'CHANGELOG.md': 'fail', 'FEATURES.md': 'pass', 'AGENTS.md': 'pass' },
      issues: { 'CHANGELOG.md': '第 3 行：错别字「测式」应为「测试」' },
      counts: { pass: 3, fail: 1, pending: 0, total: 4 },
    } },
  };
  const html2 = vmRun(finalizeModalFns(source), L4_CTX, `renderFinalizeModal({ id: 'V', pf: ${JSON.stringify(pf2)} })`);
  assert.ok(html2.includes('第 3 行：错别字'), '校对 issues 明细展示');
  assert.ok(html2.includes('CHANGELOG.md'), 'fail 文件名展示');

  // AI 校对进行中：进度
  const pf3 = {
    ...pfBase,
    plan: { ...pfBase.plan, docsCheck: {
      runId: 'chk-20260924-101010-ab02', phase: 'running',
      files: { 'README.md': 'pass', 'CHANGELOG.md': 'checking', 'FEATURES.md': 'pending', 'AGENTS.md': 'pending' },
      issues: {}, counts: { pass: 1, fail: 0, pending: 2, total: 4 }, currentFile: 'CHANGELOG.md',
    } },
  };
  const html3 = vmRun(finalizeModalFns(source), L4_CTX, `renderFinalizeModal({ id: 'V', pf: ${JSON.stringify(pf3)} })`);
  assert.ok(html3.includes('校对进行中') || html3.includes('进行中'), '校对运行中提示');

  // 全部通过：语言一致 + 链接 + 校对全 ✓
  const pf4 = {
    ...pfBase,
    checks: {
      busy: false, error: null,
      lang: { ok: true, files: [{ file: 'README.md', lang: 'cn', ok: true, detail: '' }] },
      links: { ok: true, deadTotal: 0, files: [{ file: 'README.md', total: 2, dead: [] }] },
    },
    plan: { ...pfBase.plan, docsCheck: {
      runId: 'chk-20260924-101010-ab03', phase: 'done',
      files: { 'README.md': 'pass', 'CHANGELOG.md': 'pass', 'FEATURES.md': 'pass', 'AGENTS.md': 'pass' },
      issues: {}, counts: { pass: 4, fail: 0, pending: 0, total: 4 },
    } },
  };
  const html4 = vmRun(finalizeModalFns(source), L4_CTX, `renderFinalizeModal({ id: 'V', pf: ${JSON.stringify(pf4)} })`);
  assert.ok(!html4.includes('未运行'), '全检查后无未运行提示');
  assert.ok(html4.includes('data-pf-finalize-confirm'), '确认完结按钮仍在（完结仍为人工动作）');
});

/* ---------- L6 i18n ---------- */

t('L6-1 i18n：新增文案中英词条齐备；动态键编译；往返不变形', () => {
  const I = globalThis.ATBI18N;
  assert.ok(I, 'i18n.js 应在 globalThis.ATBI18N 暴露接口');
  const { EN, EN_DYNAMIC } = I._dict;
  const statics = [
    '运行自动检查', 'AI 校对', '检查中…', '校对中…', '已核查',
    '默认语言错别字与行文规范（AI 校对自动上报）',
    '所有文档内链接真实可达（README 按语言互链：同语言 CHANGELOG 与 FEATURES，链接必须真实可达）',
    '语言一致自动检查未运行：点击「运行自动检查」',
    '链接可达性自动检查未运行：点击「运行自动检查」',
    'AI 校对未运行：点击「AI 校对」派发 Agent 核查，结果自动回执',
    '✓ 自动检查通过：语言一致与链接可达均无问题',
    '自动检查发现问题：详见整体审查对话框逐项红叉与明细',
    '✓ AI 校对提示词已复制：交给 AI Agent 逐文件核查默认语言文档（错别字与行文规范），结果自动回执',
    '自动检查各语言内容语言一致性与全部文档内链接可达性（只读，不设门禁，结果即时呈现）',
    '生成 AI 校对提示词并复制：派发 Agent 核查默认语言文档错别字与行文规范，结果自动回执',
  ];
  for (const k of statics) assert.ok(typeof EN[k] === 'string' && EN[k], `静态词条缺失：${k}`);
  const dynamics = [
    '✕ 自动检查失败：◇',
    '✕ AI 校对启动失败：◇',
    '校对进行中：◇/◇',
    'AI 校对中断：◇',
    '通过 ◇/◇',
    '不通过 ◇/◇：◇',
    '死链 ◇ 个',
  ];
  for (const k of dynamics) assert.ok(k in EN_DYNAMIC, `动态词条缺失：${k}`);
  I.setLang('en');
  assert.equal(I.t('运行自动检查'), 'Run auto checks');
  assert.equal(I.t('AI 校对'), 'AI proofread');
  assert.equal(I.t('校对进行中：2/4'), 'Proofreading 2/4');
  I.setLang('zh');
  assert.equal(I.t('AI 校对'), 'AI 校对');
});

/* ---------- 执行 ---------- */

for (const [name, fn] of cases) {
  await fn();
  console.log(`✓ ${name}`);
}
console.log(`\n共 ${cases.length} 例，全部通过`);
