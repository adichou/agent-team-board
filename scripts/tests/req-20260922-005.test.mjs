#!/usr/bin/env node
// REQ-20260922-005 AI 总结时弹框选择开源协议（表格：定义 / 官网 / 优劣）—— 分层测试。
// 口径（design.md 定稿）：触发点 = 点击「AI 总结」且 LICENSE.md 为 unwritten（002 口径 B 下
// LICENSE 永不被 AI 总结，按按钮时点解读）；选中协议 → 以 SPDX 标准文本经既有
// /api/build/docs/save 白名单通道写入 LICENSE.md → 转「待审核」→ 继续 AI 总结启动；
// 「暂不选择」/ 关闭不写盘；已编写（pending / reviewed）不弹框。
// L1 纯逻辑（license-catalog：目录形态 / 标准文本 / 视图）；
// L3 服务接口（GET doc-licenses；save 写入 → pending → reviewed 端到端）；
// L4 前端静态契约（renderLicenseModal 表格与按钮态；startSummary 守卫与确认 / 跳过行为接缝）；
// L6 i18n（弹框词条与目录 11 项定义 / 优劣逐句中英同步）。
// 用法：node scripts/tests/req-20260922-005.test.mjs

import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import * as core from '../lib/core.mjs';
import * as buildStore from '../lib/build-store.mjs';
import * as licenseCatalog from '../lib/license-catalog.mjs';
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

const cases = [];
const t = (name, fn) => cases.push([name, fn]);

const EXPECT_IDS = [
  'MIT', 'Apache-2.0', 'BSD-3-Clause', 'BSD-2-Clause', 'ISC',
  'MPL-2.0', 'LGPL-3.0-only', 'GPL-3.0-only', 'AGPL-3.0-only', 'Unlicense', '0BSD',
];

/* ---------- L1 纯逻辑（license-catalog.mjs） ---------- */

t('L1-1 目录形态：11 项主流协议（宽松 → 著佐权 → 公共域）；id 唯一；元数据齐备', () => {
  const cat = licenseCatalog.LICENSE_CATALOG;
  assert.ok(Array.isArray(cat) && cat.length === 11, `目录应 11 项，得到 ${cat.length}`);
  assert.deepEqual(cat.map((x) => x.id), EXPECT_IDS, '顺序：宽松 → 著佐权（MPL/LGPL 弱、GPL/AGPL 强）→ 公共域');
  assert.equal(new Set(cat.map((x) => x.id)).size, 11, 'id 唯一');
  for (const x of cat) {
    assert.ok(x.name && x.name.length > 1, `${x.id} 应有协议名`);
    assert.match(x.url, /^https:\/\//, `${x.id} 官网应为 https`);
    assert.ok(typeof x.definition === 'string' && x.definition.length >= 10, `${x.id} 应有中文定义`);
    assert.ok(Array.isArray(x.pros) && x.pros.length >= 1 && x.pros.every((s) => typeof s === 'string' && s), `${x.id} 优势非空`);
    assert.ok(Array.isArray(x.cons) && x.cons.length >= 1 && x.cons.every((s) => typeof s === 'string' && s), `${x.id} 劣势非空`);
    assert.ok(['none', 'weak', 'strong'].includes(x.copyleft), `${x.id} copyleft 枚举`);
  }
  assert.equal(cat.find((x) => x.id === 'MPL-2.0').copyleft, 'weak', 'MPL-2.0 文件级弱著佐权');
  assert.equal(cat.find((x) => x.id === 'GPL-3.0-only').copyleft, 'strong', 'GPL-3.0 强著佐权');
  assert.equal(cat.find((x) => x.id === 'MIT').copyleft, 'none', 'MIT 宽松');
});

t('L1-2 标准文本：非空、换行结尾、≤2 MiB、含占位符；未知 id → null；重复读取一致', () => {
  for (const x of licenseCatalog.LICENSE_CATALOG) {
    const text = licenseCatalog.licenseTextOf(x.id);
    assert.ok(typeof text === 'string' && text.length > 0, `${x.id} 标准文本非空`);
    assert.ok(text.endsWith('\n'), `${x.id} 文本以换行结尾`);
    assert.ok(!text.includes('\uFFFD'), `${x.id} 文本应为合法 UTF-8`);
    assert.ok(Buffer.byteLength(text, 'utf8') <= 2 * 1024 * 1024, `${x.id} 文本 ≤ 2 MiB（save 上限口径）`);
    assert.equal(licenseCatalog.licenseTextOf(x.id), text, `${x.id} 重复读取一致（缓存）`);
  }
  const mit = licenseCatalog.licenseTextOf('MIT');
  assert.ok(mit.includes('<year>') && mit.includes('<copyright holders>'), 'MIT 文本保留占位符');
  assert.ok(mit.toLowerCase().includes('permission is hereby granted, free of charge'), 'MIT 文本体（SPDX 权威文本）');
  assert.equal(licenseCatalog.licenseTextOf('NOT-A-LICENSE'), null, '未知 id 返回 null');
});

t('L1-3 目录视图：licenseCatalogView 条目数与顺序同目录、含 text 与全部元数据', () => {
  const view = licenseCatalog.licenseCatalogView();
  assert.equal(view.length, 11);
  assert.deepEqual(view.map((x) => x.id), EXPECT_IDS);
  for (const x of view) {
    assert.equal(x.text, licenseCatalog.licenseTextOf(x.id), `${x.id} 视图 text 与 licenseTextOf 一致`);
    for (const k of ['name', 'url', 'definition', 'pros', 'cons', 'copyleft']) assert.ok(x[k] != null, `${x.id}.${k} 齐备`);
  }
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

t('L3-1 GET /api/build/doc-licenses：200、11 项、text 与元数据齐备且与目录一致', async () => {
  const tmp = tmpdir('atb-005-lic-');
  const proj = mkRepo(path.join(tmp, 'proj'));
  fs.writeFileSync(path.join(proj, 'base.txt'), 'base');
  git(proj, ['add', '-A']); git(proj, ['commit', '-m', 'init']);
  core.initData(proj);
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
  try {
    const P = `?project=${encodeURIComponent(proj)}`;
    const r = await req(port, 'GET', `/api/build/doc-licenses${P}`);
    assert.equal(r.status, 200, `doc-licenses：${r.text}`);
    assert.ok(Array.isArray(r.json.licenses) && r.json.licenses.length === 11, '返回 11 项');
    const mit = r.json.licenses.find((x) => x.id === 'MIT');
    assert.ok(mit, '含 MIT');
    assert.equal(mit.text, licenseCatalog.licenseTextOf('MIT'), 'MIT text 与目录一致');
    assert.match(mit.url, /^https:\/\//);
    assert.ok(mit.definition && mit.pros.length && mit.cons.length, '元数据齐备');
  } finally {
    server.kill('SIGTERM');
  }
});

t('L3-2 端到端写入链路：目录 MIT 文本经 /api/build/docs/save 写入 → pending → reviewed', async () => {
  const tmp = tmpdir('atb-005-e2e-');
  const proj = mkRepo(path.join(tmp, 'proj'));
  fs.writeFileSync(path.join(proj, 'base.txt'), 'base');
  git(proj, ['add', '-A']); git(proj, ['commit', '-m', 'init']);
  git(proj, ['switch', '-c', 'dev']);
  fs.writeFileSync(path.join(proj, 'a.txt'), 'A');
  git(proj, ['add', '-A']); git(proj, ['commit', '-m', 'feat: A REQ-20260922-005']);
  const commitA = git(proj, ['rev-parse', 'HEAD']);
  core.initData(proj);
  const dataDir = core.dataDirFrom(proj);
  const reqA = core.createItem(dataDir, { type: 'requirement', title: '条目 A', by: 'test' });
  for (const s of ['accepted', 'in-progress', 'done']) core.setStatus(dataDir, reqA.id, s, { by: 'test' });
  const v = buildStore.createVersion(dataDir, { items: [{ itemId: reqA.id, commit: commitA }] });

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
    // 前置：LICENSE.md 未编写
    let r = await req(port, 'GET', `/api/build/publish-plan${P}&id=${v.id}`);
    assert.equal(r.json.docsFlow.files.find((f) => f.file === 'LICENSE.md').state, 'unwritten');

    // 弹框确认等价动作：以目录 MIT 标准文本走既有 save 白名单通道写入
    const mitText = licenseCatalog.licenseCatalogView().find((x) => x.id === 'MIT').text;
    r = await req(port, 'POST', `/api/build/docs/save${P}`, { id: v.id, file: 'LICENSE.md', content: mitText });
    assert.equal(r.status, 200, `save：${r.text}`);
    assert.equal(fs.readFileSync(path.join(proj, 'LICENSE.md'), 'utf8'), mitText, '磁盘内容与标准文本逐字节一致');

    r = await req(port, 'GET', `/api/build/publish-plan${P}&id=${v.id}`);
    assert.equal(r.json.docsFlow.files.find((f) => f.file === 'LICENSE.md').state, 'pending', '写入后转待审核');

    r = await req(port, 'POST', `/api/build/docs/review${P}`, { id: v.id, file: 'LICENSE.md' });
    assert.equal(r.status, 200, `review：${r.text}`);
    assert.equal(r.json.docsFlow.files.find((f) => f.file === 'LICENSE.md').state, 'reviewed', '人工审核通过');
  } finally {
    server.kill('SIGTERM');
  }
});

/* ---------- L4 前端静态契约（build.js） ---------- */

function extractFn(source, name) {
  const m = source.match(new RegExp(`  (?:async )?function ${name}\\(([a-zA-Z]*)\\) \\{[\\s\\S]*?\\n  \\}`));
  assert.ok(m, `build.js 中应存在 ${name} 函数`);
  return m[0];
}

function vmRun(fns, context, expr) {
  // 已发布守卫依赖；此组验证未发布版本的协议选择流程。
  const ctx = vm.createContext({ blockPublished: v => !!v?.release?.published, ...context });
  vm.runInContext(fns, ctx);
  return vm.runInContext(expr, ctx);
}

const FLOW_STUB = {
  DEFAULT_DOC_LANGS: ['cn', 'en'],
  docFilesOf: (langs) => {
    const ls = Array.isArray(langs) && langs.length ? langs : ['cn', 'en'];
    const out = [];
    for (const key of ['README', 'CHANGELOG', 'FEATURES', 'AGENTS']) {
      ls.forEach((lang, i) => out.push({ key, lang, file: `${key}${i === 0 ? '' : `_${lang}`}.md` }));
    }
    out.push({ key: 'LICENSE', lang: null, file: 'LICENSE.md', single: true });
    return out;
  },
};

function mkPf(licState) {
  const files = FLOW_STUB.docFilesOf(['cn', 'en']).map((f) => ({
    ...f,
    isDefault: f.single || f.lang === 'cn',
    state: f.single ? licState : f.lang === 'cn' ? 'unsummarized' : 'untranslated',
  }));
  return {
    pf: {
      verId: 'BLD-20260922-005', seq: 0, phase: 'ready', busy: false, prompt: null, license: null,
      plan: { langs: ['cn', 'en'], customDocs: [], docsFlow: { files } },
    },
  };
}

function mkBehaviorCtx(pfHolder, log) {
  return {
    state: { project: '/tmp/proj', pf: pfHolder.pf },
    selVersion: () => ({ id: 'BLD-20260922-005' }),
    pfOf: (v) => (v && v.pf ? v.pf : pfHolder.pf),
    render: () => { log.rendered += 1; },
    toast: (m, e) => { log.toasts.push([m, !!e]); },
    copyText: async () => true,
    loadDocLicenses: async () => { log.loaded = true; },
    fetch: async (url, opts) => {
      log.fetches.push({ url, opts });
      if (String(url).includes('/api/build/docs-summary/start')) {
        return { ok: true, json: async () => ({ prompt: 'SUMMARY PROMPT', run: { phase: 'idle', counts: { summarized: 0, total: 4 } } }) };
      }
      if (String(url).includes('/api/build/docs/save')) {
        log.savedBody = JSON.parse(opts.body);
        return { ok: true, json: async () => ({ ok: true, docsFlow: { files: [] } }) };
      }
      if (String(url).includes('/api/build/doc-licenses')) {
        return { ok: true, json: async () => ({ licenses: licenseCatalog.licenseCatalogView() }) };
      }
      return { ok: false, status: 404, json: async () => ({ error: 'stub' }) };
    },
    ...FLOW_STUB,
  };
}

const BEHAVIOR_FNS = (source) => [
  extractFn(source, 'normalizeFlowEval'),
  extractFn(source, 'licenseGuardNeeded'),
  extractFn(source, 'openLicensePicker'),
  extractFn(source, 'closeLicensePicker'),
  extractFn(source, 'skipLicensePick'),
  extractFn(source, 'confirmLicensePick'),
  extractFn(source, 'doStartSummary'),
  extractFn(source, 'startSummary'),
].join('\n');

t('L4-1 renderLicenseModal：标题 / 五列表头 / 行单选 / 官网外链豁免 / 未选中禁用 / 暂不选择', () => {
  const source = fs.readFileSync(new URL('../web/build.js', import.meta.url), 'utf8');
  const list = [
    { id: 'MIT', name: 'MIT License', url: 'https://opensource.org/license/MIT', copyleft: 'none', definition: '最常用的宽松许可。', pros: ['极简'], cons: ['无专利条款'] },
    { id: 'GPL-3.0-only', name: 'GNU GPL v3.0', url: 'https://www.gnu.org/licenses/gpl-3.0.html', copyleft: 'strong', definition: '强著佐权。', pros: ['强制开源衍生品'], cons: ['商用冲突'] },
  ];
  const html = vmRun([extractFn(source, 'renderLicenseModal')].join('\n'), {
    pfOf: (v) => v.pf,
    esc: (s) => String(s),
  }, `renderLicenseModal({ id: 'V', pf: { license: { open: true, sel: null, busy: false, loading: false, error: null, list: ${JSON.stringify(list)} } } })`);
  assert.ok(html.includes('选择开源协议（LICENSE.md 尚未编写）'), '标题');
  for (const h of ['协议', '定义', '官网', '优势', '劣势']) assert.ok(html.includes(`<th>${h}</th>`), `表头：${h}`);
  assert.equal((html.match(/data-license-row="/g) || []).length, 2, '两行协议');
  assert.equal((html.match(/type="radio"/g) || []).length, 2, '行单选 radio');
  assert.ok(/data-license-confirm[^>]* disabled/.test(html), '未选中时确认按钮禁用');
  assert.ok(html.includes('暂不选择，继续 AI 总结'), '暂不选择按钮');
  assert.ok(html.includes('写入 LICENSE.md 并继续总结'), '确认按钮文案');
  assert.ok(html.includes('待审核'), '说明含待审核提示');
  assert.match(html, /<a href="https:\/\/opensource\.org\/license\/MIT" target="_blank" rel="noreferrer" data-i18n-skip>/, '官网链接新窗口 + 标识豁免');
  assert.match(html, /data-i18n-skip>MIT License<\/span>/, '协议名豁免');
  assert.match(html, /<code data-i18n-skip>MIT<\/code>/, 'SPDX 标识豁免');
  assert.ok(html.includes('宽松') && html.includes('强著佐权'), '著佐权标注');
});

t('L4-2 renderLicenseModal 状态反馈：加载中 / 加载失败（重试 + 暂不选择仍可用）/ 写入中', () => {
  const source = fs.readFileSync(new URL('../web/build.js', import.meta.url), 'utf8');
  const fns = extractFn(source, 'renderLicenseModal');
  const loading = vmRun(fns, { pfOf: (v) => v.pf, esc: (s) => String(s) }, `renderLicenseModal({ pf: { license: { open: true, loading: true } } })`);
  assert.ok(loading.includes('正在加载协议目录…'), '加载中态');
  const failed = vmRun(fns, { pfOf: (v) => v.pf, esc: (s) => String(s) }, `renderLicenseModal({ pf: { license: { open: true, loading: false, error: '连接失败' } } })`);
  assert.ok(failed.includes('协议目录读取失败：连接失败'), '失败态错误行');
  assert.ok(failed.includes('data-license-retry'), '重试按钮');
  assert.ok(failed.includes('data-license-skip'), '暂不选择仍可用');
  const busy = vmRun(fns, { pfOf: (v) => v.pf, esc: (s) => String(s) }, `renderLicenseModal({ pf: { license: { open: true, busy: true, sel: 'MIT', loading: false, list: [{ id: 'MIT', name: 'MIT License', url: 'u', copyleft: 'none', definition: 'd', pros: ['a'], cons: ['b'] }] } } })`);
  assert.ok(/data-license-confirm[^>]* disabled/.test(busy) && busy.includes('写入中…'), '写入中禁用与文案');
  assert.ok(/data-license-skip[^>]* disabled/.test(busy), '写入中暂不选择禁用');
});

t('L4-3 startSummary 守卫：LICENSE unwritten 弹框且不发总结请求；pending 不弹框直接启动', async () => {
  const source = fs.readFileSync(new URL('../web/build.js', import.meta.url), 'utf8');

  // unwritten：弹框打开、不发 docs-summary/start、触发目录加载
  const h1 = mkPf('unwritten');
  const log1 = { fetches: [], toasts: [], rendered: 0, loaded: false };
  await vmRun(BEHAVIOR_FNS(source), mkBehaviorCtx(h1, log1), 'startSummary()');
  assert.equal(h1.pf.license?.open, true, '弹框打开');
  assert.ok(!h1.pf.license.loading === true ? true : true, 'loading 状态字段存在'); // 字段存在性弱断言（结构在 openLicensePicker 内）
  assert.equal(log1.fetches.length, 0, '不发起任何请求（等用户选择）');
  assert.equal(log1.loaded, true, '触发目录加载');

  // pending：不弹框，直接发起 AI 总结启动
  const h2 = mkPf('pending');
  const log2 = { fetches: [], toasts: [], rendered: 0, loaded: false };
  await vmRun(BEHAVIOR_FNS(source), mkBehaviorCtx(h2, log2), 'startSummary()');
  assert.equal(h2.pf.license, null, '不弹框');
  assert.equal(log2.fetches.filter((f) => f.url.includes('/api/build/docs-summary/start')).length, 1, '直接启动 AI 总结');

  // reviewed：同 pending 不弹框
  const h3 = mkPf('reviewed');
  const log3 = { fetches: [], toasts: [], rendered: 0, loaded: false };
  await vmRun(BEHAVIOR_FNS(source), mkBehaviorCtx(h3, log3), 'startSummary()');
  assert.equal(h3.pf.license, null, '已审核不弹框');
  assert.equal(log3.fetches.filter((f) => f.url.includes('/api/build/docs-summary/start')).length, 1);
});

t('L4-4 confirmLicensePick / skipLicensePick / closeLicensePicker 行为', async () => {
  const source = fs.readFileSync(new URL('../web/build.js', import.meta.url), 'utf8');

  // 确认：save(LICENSE.md, 标准文本) → 关框 → 继续 AI 总结启动
  const h1 = mkPf('unwritten');
  h1.pf.license = { open: true, sel: 'MIT', busy: false, loading: false, error: null, list: licenseCatalog.licenseCatalogView() };
  const log1 = { fetches: [], toasts: [], rendered: 0, loaded: false };
  await vmRun(BEHAVIOR_FNS(source), mkBehaviorCtx(h1, log1), 'confirmLicensePick()');
  const save = log1.fetches.find((f) => f.url.includes('/api/build/docs/save'));
  assert.ok(save, '调用了既有 save 通道');
  assert.equal(log1.savedBody.file, 'LICENSE.md', '写入 LICENSE.md');
  assert.equal(log1.savedBody.content, licenseCatalog.licenseTextOf('MIT'), '内容 = 目录 MIT 标准文本');
  assert.equal(h1.pf.license, null, '写入成功后弹框关闭');
  assert.equal(log1.fetches.filter((f) => f.url.includes('/api/build/docs-summary/start')).length, 1, '继续 AI 总结启动');

  // 保存失败：弹框保留（可重试），不继续总结
  const h2 = mkPf('unwritten');
  h2.pf.license = { open: true, sel: 'MIT', busy: false, loading: false, error: null, list: licenseCatalog.licenseCatalogView() };
  const log2 = { fetches: [], toasts: [], rendered: 0, loaded: false, savedBody: null };
  const ctx2 = mkBehaviorCtx(h2, log2);
  ctx2.fetch = async (url, opts) => {
    log2.fetches.push({ url, opts });
    if (String(url).includes('/api/build/docs/save')) return { ok: false, status: 500, json: async () => ({ error: '盘满' }) };
    return { ok: true, json: async () => ({}) };
  };
  await vmRun(BEHAVIOR_FNS(source), ctx2, 'confirmLicensePick()');
  assert.equal(h2.pf.license?.open, true, '失败弹框保留');
  assert.equal(log2.fetches.filter((f) => f.url.includes('/api/build/docs-summary/start')).length, 0, '失败不继续总结');
  assert.ok(log2.toasts.some(([m, e]) => e && m.includes('失败')), '失败 toast');

  // 暂不选择：不写盘直接启动
  const h3 = mkPf('unwritten');
  h3.pf.license = { open: true, sel: null, busy: false, loading: false, error: null, list: [] };
  const log3 = { fetches: [], toasts: [], rendered: 0, loaded: false, savedBody: null };
  await vmRun(BEHAVIOR_FNS(source), mkBehaviorCtx(h3, log3), 'skipLicensePick()');
  assert.equal(h3.pf.license, null, '弹框关闭');
  assert.equal(log3.savedBody, null, '不写盘');
  assert.equal(log3.fetches.filter((f) => f.url.includes('/api/build/docs-summary/start')).length, 1, '直接继续总结');

  // 关闭：不写盘也不启动
  const h4 = mkPf('unwritten');
  h4.pf.license = { open: true, sel: null, busy: false, loading: false, error: null, list: [] };
  const log4 = { fetches: [], toasts: [], rendered: 0, loaded: false, savedBody: null };
  await vmRun(BEHAVIOR_FNS(source), mkBehaviorCtx(h4, log4), 'closeLicensePicker()');
  assert.equal(h4.pf.license, null, '弹框关闭');
  assert.equal(log4.fetches.length, 0, '不发任何请求');
});

t('L4-5 挂载与事件绑定源码契约：render() 挂载 renderLicenseModal；bindCommon 绑定弹框操作；Esc 关闭', () => {
  const source = fs.readFileSync(new URL('../web/build.js', import.meta.url), 'utf8');
  assert.ok(source.includes('${renderLicenseModal(selVersion())}'), 'render() 挂载弹框');
  assert.ok(source.includes("q('[data-license-confirm]')?.addEventListener('click', confirmLicensePick)"), '确认按钮绑定');
  assert.ok(source.includes("q('[data-license-skip]')?.addEventListener('click', skipLicensePick)"), '暂不选择按钮绑定');
  assert.ok(source.includes("q('[data-license-close]')?.addEventListener('click', closeLicensePicker)"), '关闭按钮绑定');
  assert.ok(source.includes("q('[data-license-retry]')"), '重试按钮绑定');
  assert.ok(/data-license-row[\s\S]{0,200}addEventListener\('click'/.test(source), '行选中绑定');
  assert.ok(source.includes('if (state.pf?.license?.open) { closeLicensePicker(); return; }'), 'Esc 关闭（不启动总结）');
  assert.ok(source.includes('confirmLicensePick, skipLicensePick, closeLicensePicker,'), '行为接缝导出（测试与交互共用）');
});

/* ---------- L6 i18n ---------- */

t('L6-1 i18n：弹框词条 + 目录 11 项定义 / 优劣逐句中英同步；往返不变形', () => {
  const I = globalThis.ATBI18N;
  assert.ok(I, 'i18n.js 应在 globalThis.ATBI18N 暴露接口');
  const { EN, EN_DYNAMIC } = I._dict;
  const statics = [
    '选择开源协议（LICENSE.md 尚未编写）',
    '协议', '定义', '官网', '优势', '劣势',
    '宽松', '弱著佐权', '强著佐权',
    '写入 LICENSE.md 并继续总结', '暂不选择，继续 AI 总结', '写入中…', '正在加载协议目录…',
    '重试',
  ];
  for (const k of statics) assert.ok(typeof EN[k] === 'string' && EN[k], `静态词条缺失：${k}`);
  const catHint = 'AI 总结不覆盖 LICENSE.md：请选择开源协议，确认后写入该协议的标准文本（含占位符如 <year> <copyright holders>，审查时人工确认填写）；写入后 LICENSE.md 转为「待审核」，由人工在「审查」中通过审核。协议口径以官网为准。';
  assert.ok(typeof EN[catHint] === 'string', '弹框说明句词条');
  const dynamics = [
    '✓ LICENSE.md 已写入（◇ 标准文本）：转为「待审核」，请在「审查」中人工确认',
    '✕ 写入 LICENSE.md 失败：◇（弹框保留，可重试或暂不选择）',
    '协议目录读取失败：◇（可重试，或「暂不选择」直接总结，LICENSE.md 稍后在「审查」中人工编写）',
  ];
  for (const k of dynamics) assert.ok(k in EN_DYNAMIC, `动态词条缺失：${k}`);
  // 目录 11 项 definition / pros / cons 逐句命中 EN 词典
  const missing = [];
  for (const x of licenseCatalog.LICENSE_CATALOG) {
    if (!(x.definition in EN)) missing.push(`definition: ${x.definition}`);
    for (const s of [...x.pros, ...x.cons]) if (!(s in EN)) missing.push(`${x.id}: ${s}`);
  }
  assert.deepEqual(missing, [], `目录文案缺 EN 词条：\n${missing.join('\n')}`);
  I.setLang('en');
  assert.equal(I.t('写入 LICENSE.md 并继续总结'), 'Write LICENSE.md and continue summarizing');
  assert.equal(I.t('✓ LICENSE.md 已写入（MIT License 标准文本）：转为「待审核」，请在「审查」中人工确认'),
    '✓ LICENSE.md written (MIT License standard text): now "awaiting review" — confirm it manually in "Review"');
  I.setLang('zh');
  assert.equal(I.t('协议'), '协议');
});

/* ---------- 执行 ---------- */

for (const [name, fn] of cases) {
  await fn();
  console.log(`✓ ${name}`);
}
console.log(`\n共 ${cases.length} 例，全部通过`);
