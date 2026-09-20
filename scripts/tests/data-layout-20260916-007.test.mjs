#!/usr/bin/env node
// REQ-20260916-007 用户数据与应用数据分离 —— 新目录布局核心测试（L1–L7）
// 用法：node scripts/tests/data-layout-20260916-007.test.mjs
// 覆盖（见条目 test-cases.md L1–L7）：
//   · initData 新布局（data/ + runtime/，根 .gitignore 单条忽略，不再创建 docs/agent-team-board）；
//   · 条目文档仅落 data/，status.json 迁 runtime/status/<ID>.json，全链路（list/claim/report）正常；
//   · 计数器与认领锁落 runtime；check-ignore 两类数据口径；
//   · state-guard 新布局拦截（file/bash 两模式）；
//   · report 自动收口提交不含任何 runtime/ 路径。

import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as core from '../lib/core.mjs';

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const ATB = path.join(pluginRoot, 'scripts', 'atb.mjs');
const GUARD = path.join(pluginRoot, 'scripts', 'state-guard.mjs');

const cases = [];
const t = (name, fn) => cases.push([name, fn]);

function git(root, args) {
  const r = spawnSync('git', args, { cwd: root, encoding: 'utf8', timeout: 60_000 });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} 失败：${r.stderr || r.stdout}`);
  return r;
}

function atb(args, cwd) {
  const r = spawnSync(process.execPath, [ATB, ...args, '--dir', cwd], { encoding: 'utf8', timeout: 90_000 });
  return { code: r.status, out: r.stdout || '', err: r.stderr || '' };
}

function mkProj() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atb-layout-'));
  git(root, ['init', '-q', '-b', 'main']);
  git(root, ['config', 'user.email', 't@example.com']);
  git(root, ['config', 'user.name', 't']);
  fs.writeFileSync(path.join(root, 'app.txt'), 'hello\n');
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', 'init']);
  return root;
}

function runGuard(mode, toolInput, cwd) {
  return spawnSync(process.execPath, [GUARD, mode], {
    input: JSON.stringify({ cwd, tool_name: 'Bash', tool_input: toolInput }),
    encoding: 'utf8', timeout: 30_000,
  });
}

t('L1 initData 新布局：data+runtime、根 .gitignore 单条忽略、不建 docs/agent-team-board、板内无 .gitignore', () => {
  const root = mkProj();
  const dir = core.initData(root);
  assert.equal(dir, path.join(root, 'agent-team-board'));
  for (const p of [
    'agent-team-board/data/requirements',
    'agent-team-board/data/bugs',
    'agent-team-board/runtime/status',
    'agent-team-board/runtime/.locks',
    'agent-team-board/runtime/config.json',
    'agent-team-board/runtime/README.md',
  ]) assert.ok(fs.existsSync(path.join(root, p)), `应存在 ${p}`);
  assert.ok(!fs.existsSync(path.join(root, 'docs')), '不应创建 docs/ 目录');
  assert.ok(!fs.existsSync(path.join(dir, '.gitignore')), '板内不应再有 .gitignore');
  const gi = fs.readFileSync(path.join(root, '.gitignore'), 'utf8');
  assert.ok(gi.split('\n').includes('agent-team-board/runtime/'), '根 .gitignore 应含 agent-team-board/runtime/');
  assert.ok(!gi.includes('status.json'), '忽略规则不应再逐文件点名 status.json');
});

t('L2 createItem/listItems/claim/report：文档在 data/，状态在 runtime/status/，条目目录无 status.json', () => {
  const root = mkProj();
  const dir = core.initData(root);
  const st = core.createItem(dir, { type: 'requirement', title: '布局验证', description: 'x' });
  const itemDir = path.join(dir, 'data', 'requirements', st.id);
  assert.ok(fs.existsSync(path.join(itemDir, 'README.md')), 'README 应在 data/ 条目目录');
  assert.ok(!fs.existsSync(path.join(itemDir, 'status.json')), '条目目录不应再有 status.json');
  const statusFile = path.join(dir, 'runtime', 'status', `${st.id}.json`);
  assert.ok(fs.existsSync(statusFile), `状态应落 runtime/status/${st.id}.json`);
  // 状态读取（外部调用口径：传条目目录）
  assert.equal(core.readStatus(itemDir).id, st.id);
  // list / 状态机全链路
  core.setStatus(dir, st.id, 'accepted', { by: 'human', note: '接受' });
  let items = core.listItems(dir);
  assert.equal(items.find((x) => x.id === st.id).status, 'accepted');
  core.claim(dir, st.id, 'worker-1');
  assert.equal(core.readStatus(itemDir).status, 'in-progress');
  core.report(dir, st.id, { coverage: 90, framework: 'node', summary: 'ok', by: 'worker-1' });
  assert.ok(fs.existsSync(path.join(itemDir, 'test-report.md')), 'test-report.md 落条目目录');
  core.setStatus(dir, st.id, 'done', { by: 'human' });
  items = core.listItems(dir);
  assert.equal(items.find((x) => x.id === st.id).status, 'done');
});

t('L2b 归属 Bug（嵌套）与 deleteItem：状态同样落 runtime，删除条目同步清理状态文件', () => {
  const root = mkProj();
  const dir = core.initData(root);
  const req = core.createItem(dir, { type: 'requirement', title: '父需求' });
  // 手工构造存量归属 Bug（新建一律独立，这里模拟旧结构验证布局兼容）
  const bugDir = path.join(dir, 'data', 'requirements', req.id, 'bugs', 'BUG-20990101-001');
  fs.mkdirSync(bugDir, { recursive: true });
  fs.writeFileSync(path.join(bugDir, 'README.md'), '# BUG-20990101-001\n');
  core.writeStatus(bugDir, {
    id: 'BUG-20990101-001', type: 'bug', title: '嵌套', status: 'submitted',
    parent: req.id, owner: null, createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(), agentCompletedAt: null, lastReport: null, history: [],
  });
  assert.ok(fs.existsSync(path.join(dir, 'runtime', 'status', 'BUG-20990101-001.json')), '嵌套 Bug 状态也应落 runtime/status/');
  const items = core.listItems(dir);
  assert.ok(items.some((x) => x.id === 'BUG-20990101-001'), 'listItems 应含嵌套 Bug');
  // 删除待接受条目：目录与状态文件一并清理
  core.deleteItem(dir, 'BUG-20990101-001');
  assert.ok(!fs.existsSync(bugDir));
  assert.ok(!fs.existsSync(path.join(dir, 'runtime', 'status', 'BUG-20990101-001.json')), '删除条目应清理 runtime 状态文件');
});

t('L3 计数器与认领锁路径：runtime/config.json、runtime/.locks/<ID>.lock', () => {
  const root = mkProj();
  const dir = core.initData(root);
  const id1 = core.nextId(dir, 'requirement');
  const cfg = JSON.parse(fs.readFileSync(path.join(dir, 'runtime', 'config.json'), 'utf8'));
  assert.equal(cfg.counters.requirement, 1);
  assert.ok(/REQ-\d{8}-001$/.test(id1));
  const st = core.createItem(dir, { type: 'bug', title: '锁路径' });
  core.setStatus(dir, st.id, 'accepted', { by: 'human' });
  core.claim(dir, st.id, 'worker-x');
  assert.ok(fs.existsSync(path.join(dir, 'runtime', '.locks', `${st.id}.lock`)), '认领锁应落 runtime/.locks/');
});

t('L4 check-ignore：runtime/ 命中忽略；data/ 代表性用户数据路径不命中且可跟踪', () => {
  const root = mkProj();
  const dir = core.initData(root);
  const st = core.createItem(dir, { type: 'requirement', title: '忽略口径' });
  core.setStatus(dir, st.id, 'accepted', { by: 'human' });
  const itemDir = path.join(dir, 'data', 'requirements', st.id);
  fs.writeFileSync(path.join(itemDir, 'licenses.md'), '# licenses\n');
  fs.writeFileSync(path.join(itemDir, 'ui-demo.html'), '<html></html>');
  fs.writeFileSync(path.join(itemDir, 'decisions.md'), '# decisions\n');
  fs.mkdirSync(path.join(itemDir, 'attachments'), { recursive: true });
  fs.writeFileSync(path.join(itemDir, 'attachments', 'a.png'), 'png');
  const rel = (p) => path.relative(root, p).split(path.sep).join('/');
  const ignored = (p) => spawnSync('git', ['check-ignore', '-q', rel(p)], { cwd: root }).status === 0;
  assert.ok(ignored(path.join(dir, 'runtime', 'config.json')), 'runtime/config.json 应被忽略');
  assert.ok(ignored(path.join(dir, 'runtime', 'status', `${st.id}.json`)), 'runtime/status/<ID>.json 应被忽略');
  assert.ok(ignored(path.join(dir, 'runtime', 'README.md')), 'runtime/README.md 应被忽略');
  for (const f of ['README.md', 'design.md', 'test-cases.md', 'licenses.md', 'ui-demo.html', 'decisions.md', 'attachments/a.png']) {
    assert.ok(!ignored(path.join(itemDir, f)), `${f} 不应被忽略`);
  }
  // 可被 git 正常跟踪（add 不报错、ls-files 在列）
  git(root, ['add', rel(itemDir)]);
  const tracked = String(git(root, ['ls-files', '--', rel(itemDir)]).stdout).trim().split('\n').filter(Boolean);
  assert.ok(tracked.includes(`${rel(itemDir)}/README.md`), 'data/ 文档应可被 git 跟踪');
});

t('L5 守卫 file 模式：拦 runtime/status/<ID>.json 直写，放行 data/ 条目文档', () => {
  const root = mkProj();
  const dir = core.initData(root);
  const st = core.createItem(dir, { type: 'requirement', title: '守卫' });
  const statusAbs = path.join(dir, 'runtime', 'status', `${st.id}.json`);
  const r1 = runGuard('file', { file_path: statusAbs, new_string: 'x' }, root);
  assert.equal(r1.status, 2, `直写 runtime 状态应被拦（exit=${r1.status}）: ${r1.stderr}`);
  assert.match(r1.stderr, /status.*机器状态|状态文件|status\.json/i);
  const r2 = runGuard('file', { file_path: path.join(dir, 'data', 'requirements', st.id, 'README.md'), new_string: 'x' }, root);
  assert.equal(r2.status, 0, `编辑条目文档应放行: ${r2.stderr}`);
});

t('L6 守卫 bash 模式：拦改写 runtime 状态与流程外 commit；放行只读', () => {
  const root = mkProj();
  const dir = core.initData(root);
  const st = core.createItem(dir, { type: 'requirement', title: '守卫bash' });
  const statusAbs = path.join(dir, 'runtime', 'status', `${st.id}.json`);
  const r1 = runGuard('bash', { command: `echo x > ${statusAbs}` }, root);
  assert.equal(r1.status, 2, '重定向改写 runtime 状态应被拦');
  const r2 = runGuard('bash', { command: `cat ${statusAbs}` }, root);
  assert.equal(r2.status, 0, '只读 cat 应放行');
  const r3 = runGuard('bash', { command: 'git commit -m x' }, root);
  assert.equal(r3.status, 2, '流程外 git commit 应仍被拦（新板根识别）');
});

t('L6b 守卫源码保护：无锁改插件源码拦、持 runtime 认领锁放行', () => {
  const root = mkProj();
  const dir = core.initData(root);
  const st = core.createItem(dir, { type: 'requirement', title: '源码锁' });
  const target = path.join(pluginRoot, 'scripts', 'lib', 'core.mjs');
  const r1 = runGuard('bash', { command: `echo x >> ${target}` }, root);
  assert.equal(r1.status, 2, '无锁改插件源码应被拦');
  core.setStatus(dir, st.id, 'accepted', { by: 'human' });
  core.claim(dir, st.id, 'worker-g');
  const r2 = runGuard('bash', { command: `echo x >> ${target}` }, root);
  assert.equal(r2.status, 0, `持 runtime 认领锁应放行: ${r2.stderr}`);
});

t('L7 report 自动收口：提交不含 runtime/ 路径，doc 组落 data/', () => {
  const root = mkProj();
  const dir = core.initData(root);
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', 'board init']);
  const st = core.createItem(dir, { type: 'requirement', title: '收口验证' });
  core.setStatus(dir, st.id, 'accepted', { by: 'human' });
  core.claim(dir, st.id, 'worker-c');
  // 本单改动：源码 + 条目文档 + 测试
  fs.appendFileSync(path.join(root, 'app.txt'), 'change\n');
  fs.mkdirSync(path.join(root, 'scripts', 'tests'), { recursive: true });
  fs.writeFileSync(path.join(root, 'scripts', 'tests', 'demo.test.mjs'), 'assert(true)\n');
  fs.writeFileSync(path.join(root, 'agent-team-board', 'data', 'requirements', st.id, 'design.md'), '# design\n');
  // report 走 CLI（无 --run：手动 /dev 收口，report 后系统自动提交本单改动）
  const rep = atb(['report', st.id, '--coverage', '100', '--framework', 'node', '--summary', 'ok', '--by', 'worker-c'], root);
  assert.equal(rep.code, 0, `report 应成功: ${rep.err || rep.out}`);
  const log = String(git(root, ['log', '--name-only', '--format=commit-%H']).stdout);
  assert.ok(!log.split('\n').some((l) => l.includes('runtime/')), '任何提交都不应包含 runtime/ 路径');
  const files = String(git(root, ['show', '--name-only', '--format=', 'HEAD']).stdout).trim().split('\n');
  assert.ok(files.includes('app.txt') || String(git(root, ['log', '--name-only', '--format=%H%x09%s']).stdout).includes('app.txt'), '业务改动应入库');
  const logAll = String(git(root, ['log', '--name-only', '--format=#%s']).stdout);
  assert.ok(logAll.includes(`agent-team-board/data/requirements/${st.id}/design.md`), 'doc 组应收纳 data/ 条目文档');
});

// ---------- 执行 ----------
let failed = 0;
for (const [name, fn] of cases) {
  try {
    await fn();
    console.log(`✓ ${name}`);
  } catch (e) {
    failed++;
    console.error(`✗ ${name}\n  ${e && e.stack ? e.stack.split('\n').slice(0, 6).join('\n  ') : e}`);
  }
}
console.log(failed ? `\n${failed} 个用例失败` : '\n全部通过');
process.exit(failed ? 1 : 0);
