#!/usr/bin/env node
// REQ-20260906-015 全局搜索 /api/search 集成测试 —— 真实起 server（随机端口 + 临时项目）
// 用法：node scripts/tests/search-api.test.mjs
// 覆盖 test-cases.md 的 S1–S9。

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as core from '../lib/core.mjs';

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

// ---------- 测试环境 ----------

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'atb-search-'));
const project = fs.realpathSync(tmp);
fs.mkdirSync(project, { recursive: true });
core.initData(project);

// 条目：一个需求 + 一个归属 Bug + 一个独立 Bug
const req = core.createItem(core.dataDirFrom(project), { type: 'requirement', title: '登录页面支持验证码', by: 'test' });
const bug = core.createItem(core.dataDirFrom(project), { type: 'bug', title: '验证码输入框闪烁', by: 'test' });
core.moveBug(core.dataDirFrom(project), bug.id, req.id); // REQ-20260908-009：归属 Bug 经 move 构造（存量形态）
const solo = core.createItem(core.dataDirFrom(project), { type: 'bug', title: '无关的标题完全不同', by: 'test' });
assert.ok(req.id && bug.id && solo.id, '条目创建失败');

// 文档正文写入关键词（README 首行 H1 含单号与标题，用于验证 H1 不算内容命中）
const reqDir = path.join(core.dataDirFrom(project), 'requirements', req.id);
fs.appendFileSync(path.join(reqDir, 'design.md'), '\n## 实施记录\n\n方案采用 ZEBRA-CROSSING 布局算法。\n');
fs.appendFileSync(path.join(reqDir, 'README.md'), '\n## 补充\n\n正文里提到 ZEBRA-CROSSING 才算内容命中。\n');

// 项目文件
fs.mkdirSync(path.join(project, 'src', 'deep'), { recursive: true });
fs.writeFileSync(path.join(project, 'src', 'app.js'), 'console.log(1)\n');
fs.writeFileSync(path.join(project, 'src', 'deep', 'Logger.MJS'), 'export const L = 1\n'); // 大小写不敏感命中 logger
fs.writeFileSync(path.join(project, 'logger-notes.txt'), 'notes\n');
// 忽略目录中的同名文件（不应被搜到）
fs.mkdirSync(path.join(project, 'node_modules', 'pkg'), { recursive: true });
fs.writeFileSync(path.join(project, 'node_modules', 'pkg', 'logger.js'), 'x');
fs.mkdirSync(path.join(project, '.git'), { recursive: true });
fs.writeFileSync(path.join(project, '.git', 'logger.cfg'), 'x');
fs.mkdirSync(path.join(project, '.hidden'), { recursive: true });
fs.writeFileSync(path.join(project, '.hidden', 'logger.txt'), 'x');
// 截断用：61 个匹配文件
fs.mkdirSync(path.join(project, 'many'), { recursive: true });
for (let i = 0; i < 61; i++) fs.writeFileSync(path.join(project, 'many', `zzmatch-${String(i).padStart(2, '0')}.txt`), 'x');

// 未初始化项目（S9）
const rawProject = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'atb-search-raw-')));
fs.mkdirSync(path.join(rawProject, 'sub'), { recursive: true });
fs.writeFileSync(path.join(rawProject, 'solo-file.md'), 'x');

const registryFile = path.join(tmp, 'projects.json');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function request(method, url, body) {
  const u = new URL(url);
  return new Promise((resolve, reject) => {
    const r = http.request(
      { hostname: u.hostname, port: u.port, path: u.pathname + u.search, method, headers: body ? { 'Content-Type': 'application/json' } : {} },
      (res) => {
        let data = '';
        res.on('data', (c) => { data += c; });
        res.on('end', () => {
          let json = {};
          try { json = JSON.parse(data || '{}'); } catch {}
          resolve({ status: res.statusCode, json });
        });
      }
    );
    r.on('error', reject);
    if (body) r.write(JSON.stringify(body));
    r.end();
  });
}

const get = (url, expect = 200) => request('GET', url).then((r) => {
  assert.equal(r.status, expect, `GET ${url} → ${r.status}（期望 ${expect}）：${JSON.stringify(r.json)}`);
  return r.json;
});

let serverProc = null;
let port = 0;

async function tryStartServer(p) {
  const proc = spawn(process.execPath, [path.join(pluginRoot, 'scripts', 'server.mjs')], {
    cwd: project,
    env: { ...process.env, ATB_PORT: String(port), ATB_REGISTRY: registryFile },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let err = '';
  proc.stderr.on('data', (c) => { err += c; });
  for (let i = 0; i < 30; i++) {
    await sleep(200);
    try {
      const r = await request('GET', `http://127.0.0.1:${port}/api/health`);
      if (r.status === 200) return proc;
    } catch {}
  }
  proc.kill();
  throw new Error(`server 未能在端口 ${port} 启动：${err}`);
}

const cases = [];
const t = (name, fn) => cases.push([name, fn]);

const search = (q, proj = project) => get(`http://127.0.0.1:${port}/api/search?q=${encodeURIComponent(q)}&project=${encodeURIComponent(proj)}`);

t('S1 空/缺失/纯空白 q → 200 且三桶为空', async () => {
  for (const [label, url] of [
    ['缺失 q', `/api/search?project=${encodeURIComponent(project)}`],
    ['空 q', `/api/search?q=&project=${encodeURIComponent(project)}`],
    ['纯空白 q', `/api/search?q=${encodeURIComponent('   ')}&project=${encodeURIComponent(project)}`],
  ]) {
    const j = await get(`http://127.0.0.1:${port}${url}`);
    assert.deepEqual(j.items, [], `${label}：items 应为空`);
    assert.deepEqual(j.docs, [], `${label}：docs 应为空`);
    assert.deepEqual(j.files, [], `${label}：files 应为空`);
  }
});

t('S2 单号片段命中需求与 Bug，大小写不敏感', async () => {
  for (const q of ['REQ-', 'req-']) {
    const j = await search(q);
    const ids = j.items.map((it) => it.id);
    assert.ok(ids.includes(req.id), `q=${q} 应命中 ${req.id}（实际 ${ids}）`);
    assert.ok(!ids.includes(bug.id) && !ids.includes(solo.id), `q=${q} 不应命中 Bug 单号`);
    for (const it of j.items) {
      assert.ok(it.title && it.status && it.type, 'items 元素需含 type/title/status');
    }
  }
  const j2 = await search('bug-');
  assert.ok(j2.items.some((it) => it.id === bug.id), 'bug- 应命中 Bug');
  assert.ok(j2.items.some((it) => it.id === solo.id), 'bug- 应命中独立 Bug');
});

t('S3 标题关键词精确命中，无关条目不出现', async () => {
  const j = await search('验证码');
  const ids = j.items.map((it) => it.id);
  assert.ok(ids.includes(req.id) && ids.includes(bug.id), '「验证码」应命中需求与归属 Bug');
  assert.ok(!ids.includes(solo.id), '无关标题不应命中');
});

t('S4 文档正文命中返回 id/name/line/text', async () => {
  const j = await search('ZEBRA-CROSSING');
  const hits = j.docs.filter((d) => d.id === req.id);
  assert.ok(hits.length >= 2, `应至少命中 README 与 design.md 两处（实际 ${JSON.stringify(hits)}）`);
  const names = hits.map((h) => h.name).sort();
  assert.deepEqual(names, ['README.md', 'design.md'], '命中文档名');
  for (const h of hits) {
    assert.ok(Number.isInteger(h.line) && h.line >= 1, 'line 为 1 起的行号');
    assert.ok(h.text.includes('ZEBRA-CROSSING'), 'text 含关键词');
  }
});

t('S5 文档首行 H1 不算内容命中：搜单号不把 README 顶行顶出', async () => {
  // README 首行 `# REQ-xxx 标题`，标题无独有关键词；单号本身在 H1 —— docs 应为空
  const j = await search(solo.id);
  assert.deepEqual(j.docs, [], `搜 ${solo.id} 时 docs 应为空（H1 是标题冗余）（实际 ${JSON.stringify(j.docs)}）`);
});

t('S6 文件名大小写不敏感子串命中，返回相对路径', async () => {
  const j = await search('logger');
  const paths = j.files.map((f) => f.path);
  assert.ok(paths.includes('src/deep/Logger.MJS'), `应命中 src/deep/Logger.MJS（实际 ${paths}）`);
  assert.ok(paths.includes('logger-notes.txt'), '应命中根下 logger-notes.txt');
  for (const f of j.files) {
    assert.ok(typeof f.size === 'number' && f.mtime, 'files 元素需含 size/mtime');
  }
});

t('S7 文件搜索不进 node_modules/.git/隐藏目录', async () => {
  const j = await search('logger');
  const paths = j.files.map((f) => f.path).join('\n');
  assert.ok(!paths.includes('node_modules'), '不得搜到 node_modules 内文件');
  assert.ok(!paths.includes('.git'), '不得搜到 .git 内文件');
  assert.ok(!paths.includes('.hidden'), '不得搜到隐藏目录内文件');
});

t('S8 每类结果上限 50 条并带 truncated 标记', async () => {
  const j = await search('zzmatch');
  assert.equal(j.files.length, 50, `files 截断为 50（实际 ${j.files.length}）`);
  assert.ok(Array.isArray(j.truncated) && j.truncated.includes('files'), 'truncated 应标记 files');
});

t('S9 未初始化看板的项目仍可搜文件，items/docs 为空', async () => {
  const j = await search('solo-file', rawProject);
  assert.deepEqual(j.items, [], '未初始化项目 items 为空');
  assert.deepEqual(j.docs, [], '未初始化项目 docs 为空');
  assert.ok(j.files.some((f) => f.path === 'solo-file.md'), '应搜到项目文件');
});

let failed = 0;
(async () => {
  port = 20000 + Math.floor(Math.random() * 20000);
  serverProc = await tryStartServer(port);
  for (const [name, fn] of cases) {
    try {
      await fn();
      console.log(`✓ ${name}`);
    } catch (e) {
      failed++;
      console.error(`✗ ${name}\n    ${String(e.message).split('\n')[0]}`);
    }
  }
  serverProc?.kill();
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.rmSync(rawProject, { recursive: true, force: true });
  console.log(failed ? `\n${failed} 个用例未通过` : '\n全部通过');
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  serverProc?.kill();
  console.error(e);
  process.exit(1);
});
