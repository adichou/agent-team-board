#!/usr/bin/env node
// REQ-20260908-009 —— Bug 一律独立创建（去掉归属需求选项）+ 设计说明书（design.md）标明引入来源：
// ① CLI：atb new bug 不再接受 --req/--parent，正常创建走顶层 bugs/；
// ② core：createItem 拒绝 bug+parent；bugReadme 去掉归属行；新增 bugDesign 模板（引入来源节）；
// ③ server：POST /api/new 对 bug 传 parent 返回 400；
// ④ web：新建表单去掉归属下拉、不提交 parent；
// ⑤ 存量兼容：独立创建 + moveBug 归属的存量 Bug 仍可读取整理。
// 用法：node scripts/tests/bug-standalone-origin.test.mjs

import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as core from '../lib/core.mjs';

const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const ATB_CLI_PATH = path.join(PLUGIN_ROOT, 'scripts', 'atb.mjs');
const ATB_CLI = fs.readFileSync(ATB_CLI_PATH, 'utf8');
const APP_JS = fs.readFileSync(path.join(PLUGIN_ROOT, 'scripts', 'web', 'app.js'), 'utf8');
const INDEX_HTML = fs.readFileSync(path.join(PLUGIN_ROOT, 'scripts', 'web', 'index.html'), 'utf8');
const SKILL_MD = fs.readFileSync(path.join(PLUGIN_ROOT, 'skills', 'agent-team-board', 'SKILL.md'), 'utf8');

const cases = [];
const t = (name, fn) => cases.push([name, fn]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function tempProject(tag) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `atb-bug-std-${tag}-`));
  core.initData(root);
  return { root, dataDir: core.dataDirFrom(root) };
}

const runAtb = (args, cwd) => new Promise((resolve) => {
  const p = spawn(process.execPath, [ATB_CLI_PATH, ...args], { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  let err = '';
  p.stdout.on('data', (c) => { out += c; });
  p.stderr.on('data', (c) => { err += c; });
  p.on('error', (e) => resolve({ code: null, out, err: String(e.message) }));
  p.on('close', (code) => resolve({ code, out, err }));
});

function httpRequest(port, method, p, body) {
  return new Promise((resolve, reject) => {
    const payload = body == null ? null : JSON.stringify(body);
    const rq = http.request({
      hostname: '127.0.0.1', port, path: p, method,
      headers: payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {},
      timeout: 5000,
    }, (rs) => {
      let out = '';
      rs.on('data', (c) => { out += c; });
      rs.on('end', () => resolve({ code: rs.statusCode, body: out }));
    });
    rq.on('error', reject);
    rq.on('timeout', () => { rq.destroy(); reject(new Error('request timeout')); });
    if (payload) rq.write(payload);
    rq.end();
  });
}

// ---------- CLI（B1/B2） ----------

t('B1 CLI：atb new bug --req/--parent 报错退出，指引独立 Bug 与引入来源', async () => {
  const { root } = tempProject('b1');
  try {
    const r = await runAtb(['new', 'bug', '误用归属', '--req', 'REQ-20990101-001'], root);
    assert.notEqual(r.code, 0, '--req 应报错退出');
    assert.match(r.err, /独立/, '报错应说明 Bug 一律独立');
    assert.match(r.err, /引入来源/, '报错应指引把源单写入引入来源');
    const r2 = await runAtb(['new', 'bug', '误用别名', '--parent', 'REQ-20990101-001'], root);
    assert.notEqual(r2.code, 0, '--parent 应同样报错');
    assert.equal(core.listItems(core.dataDirFrom(root)).length, 0, '报错请求不得创建条目');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

t('B2 CLI：atb new bug 正常创建独立 Bug；usage 不再宣传 --req 归属用法', async () => {
  const { root } = tempProject('b2');
  try {
    const r = await runAtb(['new', 'bug', '正常缺陷', '--desc', '现象描述'], root);
    assert.equal(r.code, 0, `正常创建应成功（err=${r.err}）`);
    const id = r.out.match(/(BUG-\d{8}-\d{3})/)?.[0];
    assert.ok(id, '输出应含新单号');
    const st = core.listItems(core.dataDirFrom(root)).find((x) => x.id === id);
    assert.equal(st.parent, null, '新建 Bug 应为独立（parent null）');
    assert.ok(fs.existsSync(path.join(core.dataDirFrom(root), 'bugs', id)), '目录应在顶层 bugs/');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
  // usage 静态契约：new bug 行只剩 --desc；不再出现归属文案
  const usageLine = ATB_CLI.match(/atb new bug[^\n]*/)?.[0] || '';
  assert.doesNotMatch(usageLine, /--req/, 'usage 的 new bug 行不应再含 --req');
  assert.doesNotMatch(ATB_CLI, /创建 Bug（--req 指定归属需求/, '不应再保留归属需求说明文案');
});

// ---------- core（B3/B4） ----------

t('B3 core：createItem 拒绝 bug+parent；requirement 传 parent 仍报错；独立创建落顶层目录', () => {
  const { dataDir } = tempProject('b3');
  const req = core.createItem(dataDir, { type: 'requirement', title: '宿主', by: 'test' });
  assert.throws(() => core.createItem(dataDir, { type: 'bug', title: 'x', parent: req.id, by: 't' }),
    (e) => e instanceof core.AtbError && /独立/.test(e.message) && /引入来源/.test(e.message),
    'bug 带 parent 应抛 AtbError 并指引用户');
  assert.throws(() => core.createItem(dataDir, { type: 'requirement', title: 'y', parent: req.id, by: 't' }),
    core.AtbError, '需求归属需求仍应报错');
  const bug = core.createItem(dataDir, { type: 'bug', title: '独立缺陷', by: 't' });
  assert.equal(bug.parent, null, 'status.parent 应为 null');
  assert.ok(fs.existsSync(path.join(dataDir, 'bugs', bug.id)), '目录应在顶层 bugs/');
  assert.doesNotThrow(() => core.createItem(dataDir, { type: 'requirement', title: '普通需求', by: 't' }),
    '需求创建不受影响');
});

t('B4 core：新建 Bug 生成 README + design；README 无归属行；design 含引入来源节与填写指引', () => {
  const { dataDir } = tempProject('b4');
  const bug = core.createItem(dataDir, { type: 'bug', title: '溯源缺陷', description: '某页白屏', by: 't' });
  const dir = path.join(dataDir, 'bugs', bug.id);
  const readme = fs.readFileSync(path.join(dir, 'README.md'), 'utf8');
  assert.doesNotMatch(readme, /归属需求/, 'README 不应再有归属需求行');
  assert.match(readme, /独立 Bug/, 'README 应标注独立 Bug（源单见引入来源）');
  assert.ok(fs.existsSync(path.join(dir, 'design.md')), '应生成 design.md 设计说明书');
  const design = fs.readFileSync(path.join(dir, 'design.md'), 'utf8');
  assert.equal(design.split('\n')[0], `# 设计 — ${bug.id} 溯源缺陷`, 'design 首行应为标准标题');
  assert.match(design, /引入来源/, 'design 应含引入来源（源单）节');
  assert.match(design, /未定位（排查过程/, '应指引「未定位（排查过程：…）」写法');
  assert.match(design, /REQ-|BUG-/, '应指引填写 REQ-/BUG- 源单编号');
  const detail = core.getItemDetail(dataDir, bug.id);
  assert.ok(detail.docs.includes('design.md'), '详情 docs 列表应带出 design.md');
  // rename 同步应覆盖 bug 的 design 首行（syncDocTitles 按目录扫描，自动生效）
  core.renameItem(dataDir, bug.id, { title: '改名缺陷', by: 'h' });
  const renamed = fs.readFileSync(path.join(dir, 'design.md'), 'utf8').split('\n')[0];
  assert.equal(renamed, `# 设计 — ${bug.id} 改名缺陷`, 'design 首行应随改名同步');
});

// ---------- server HTTP（B5） ----------

t('B5 server：POST /api/new 对 bug 传 parent 返回 400；不传正常创建', async () => {
  const { root, dataDir } = tempProject('b5');
  const req = core.createItem(dataDir, { type: 'requirement', title: '宿主需求', by: 'test' });
  const port = 24500 + Math.floor(Math.random() * 8000);
  const registry = path.join(os.tmpdir(), `atb-reg-${process.pid}-${Math.random().toString(16).slice(2)}.json`);
  const child = spawn(process.execPath, [path.join(PLUGIN_ROOT, 'scripts', 'server.mjs')], {
    cwd: root,
    env: { ...process.env, ATB_PORT: String(port), ATB_HOST: '127.0.0.1', ATB_REGISTRY: registry },
    stdio: ['ignore', 'ignore', 'ignore'],
  });
  try {
    let up = false;
    for (let i = 0; i < 50 && !up; i++) {
      await sleep(100);
      up = await httpRequest(port, 'GET', '/api/health').then((r) => r.code === 200).catch(() => false);
    }
    assert.ok(up, '测试服务应启动');
    const bad = await httpRequest(port, 'POST', '/api/new', { type: 'bug', title: '网页误传归属', parent: req.id });
    assert.equal(bad.code, 400, 'bug 带 parent 应返回 400');
    assert.match(bad.body, /独立/, '错误信息应说明一律独立 Bug');
    const ok = await httpRequest(port, 'POST', '/api/new', { type: 'bug', title: '网页独立建单' });
    assert.equal(ok.code, 201, `不带 parent 应正常创建：${ok.body}`);
    const st = JSON.parse(ok.body);
    assert.equal(st.parent, null, '创建结果应为独立 Bug');
  } finally {
    child.kill();
    fs.rmSync(root, { recursive: true, force: true });
    try { fs.rmSync(registry, { force: true }); } catch {}
  }
});

// ---------- web 静态（B6） ----------

t('B6 web：新建表单去掉归属下拉（fParent），提交体不再含 parent 字段', () => {
  assert.doesNotMatch(INDEX_HTML, /fParent/, 'index.html 不应再含归属下拉');
  assert.doesNotMatch(APP_JS, /fParent/, 'app.js 不应再引用 fParent');
  // REQ-20260910-015 起 submitNew 带 { accept } 参数（创建并接受），签名按参数列表通配匹配
  const submit = APP_JS.match(/async function submitNew\([^)]*\) \{[\s\S]*?\n\}/)?.[0] || '';
  assert.ok(submit, '应找到 submitNew 函数');
  assert.doesNotMatch(submit, /parent/, '提交体不应再含 parent 字段');
});

// ---------- 存量兼容（B7） ----------

t('B7 兼容：独立创建 + moveBug 归属的存量 Bug 可读取；moveBug 可改回独立', () => {
  const { dataDir } = tempProject('b7');
  const req = core.createItem(dataDir, { type: 'requirement', title: '存量宿主', by: 'test' });
  const bug = core.createItem(dataDir, { type: 'bug', title: '存量归属 Bug', by: 'test' });
  core.moveBug(dataDir, bug.id, req.id);
  const nested = core.resolveItemDir(dataDir, bug.id);
  assert.equal(nested.nested, true, '归属后应能按嵌套目录定位');
  assert.equal(core.listItems(dataDir).find((x) => x.id === bug.id).parent, req.id, '列表应带出 parent');
  assert.equal(core.getItemDetail(dataDir, req.id).bugCount, 1, '宿主需求应统计下属 Bug');
  core.moveBug(dataDir, bug.id, null);
  assert.equal(core.resolveItemDir(dataDir, bug.id).nested, false, '改回独立后应落顶层 bugs/');
  assert.equal(core.listItems(dataDir).find((x) => x.id === bug.id).parent, null, 'parent 应清空');
});

// ---------- 文档同步（B8，附加） ----------

t('B8 SKILL.md：new bug 用法不再宣传 --req，改述一律独立 + 引入来源', () => {
  const line = SKILL_MD.match(/\$ATB new bug[^\n]*/)?.[0] || '';
  assert.doesNotMatch(line, /--req/, 'SKILL 的 new bug 行不应再含 --req');
  assert.match(SKILL_MD, /引入来源/, '应述及引入来源写法');
});

let failed = 0;
for (const [name, fn] of cases) {
  try { await fn(); console.log(`✓ ${name}`); }
  catch (e) { failed++; console.error(`✗ ${name}\n${e.stack}`); }
}
console.log(`\n${cases.length} 个用例，失败 ${failed}`);
process.exitCode = failed ? 1 : 0;
