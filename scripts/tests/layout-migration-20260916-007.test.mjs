#!/usr/bin/env node
// REQ-20260916-007 旧布局一键迁移测试（M1–M3）
// 用法：node scripts/tests/layout-migration-20260916-007.test.mjs
// 覆盖（见条目 test-cases.md M1–M3）：
//   · 迁移：条目文档 git mv 至 data/（--follow 历史保留）、status/config/settings 移入
//     runtime 且退出跟踪（本地保留）、旧目录移除、根 .gitignore 更新、条目清单一致；
//   · 幂等：重复执行 no-op；已是新布局提示；迁移后 atb 全流程正常；
//   · CLI `atb migrate` 与服务接口 /api/layout/state、/api/migrate 等价。

import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as core from '../lib/core.mjs';
import * as migrate from '../lib/migrate-layout.mjs';

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const ATB = path.join(pluginRoot, 'scripts', 'atb.mjs');
const SERVER = path.join(pluginRoot, 'scripts', 'server.mjs');

const cases = [];
const t = (name, fn) => cases.push([name, fn]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function git(root, args) {
  const r = spawnSync('git', args, { cwd: root, encoding: 'utf8', timeout: 60_000 });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} 失败：${r.stderr || r.stdout}`);
  return r;
}

function atb(args, cwd) {
  const r = spawnSync(process.execPath, [ATB, ...args, '--dir', cwd], { encoding: 'utf8', timeout: 90_000 });
  return { code: r.status, out: r.stdout || '', err: r.stderr || '' };
}

// 构造旧布局项目（docs/agent-team-board 单目录，模拟 REQ-20260916-007 之前的形态）
function mkLegacyProj() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atb-mig-'));
  git(root, ['init', '-q', '-b', 'main']);
  git(root, ['config', 'user.email', 't@example.com']);
  git(root, ['config', 'user.name', 't']);
  fs.writeFileSync(path.join(root, 'app.txt'), 'hello\n');
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', 'init']);

  const L = path.join(root, 'docs', 'agent-team-board');
  const reqDir = path.join(L, 'requirements', 'REQ-20990101-001');
  fs.mkdirSync(reqDir, { recursive: true });
  fs.writeFileSync(path.join(reqDir, 'README.md'), '# REQ-20990101-001 旧需求\n');
  fs.writeFileSync(path.join(reqDir, 'design.md'), '# design\n');
  fs.writeFileSync(path.join(reqDir, 'status.json'), JSON.stringify({
    id: 'REQ-20990101-001', type: 'requirement', title: '旧需求', status: 'done',
    parent: null, owner: null, createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z', agentCompletedAt: null, lastReport: null, history: [],
  }, null, 2));
  fs.mkdirSync(path.join(reqDir, 'attachments'), { recursive: true });
  fs.writeFileSync(path.join(reqDir, 'attachments', 'shot.png'), 'png');
  // 嵌套归属 Bug
  const bugDir = path.join(reqDir, 'bugs', 'BUG-20990101-001');
  fs.mkdirSync(bugDir, { recursive: true });
  fs.writeFileSync(path.join(bugDir, 'README.md'), '# BUG-20990101-001\n');
  fs.writeFileSync(path.join(bugDir, 'status.json'), JSON.stringify({
    id: 'BUG-20990101-001', type: 'bug', title: '嵌套Bug', status: 'submitted',
    parent: 'REQ-20990101-001', owner: null, createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z', agentCompletedAt: null, lastReport: null, history: [],
  }, null, 2));
  // 独立 Bug（未跟踪文档：模拟运行中新增）
  const bug2 = path.join(L, 'bugs', 'BUG-20990101-002');
  fs.mkdirSync(bug2, { recursive: true });
  fs.writeFileSync(path.join(bug2, 'README.md'), '# BUG-20990101-002\n');
  fs.writeFileSync(path.join(bug2, 'status.json'), JSON.stringify({
    id: 'BUG-20990101-002', type: 'bug', title: '独立Bug', status: 'submitted',
    parent: null, owner: null, createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z', agentCompletedAt: null, lastReport: null, history: [],
  }, null, 2));
  // 应用数据：config.json（跟踪）、dispatch/settings.json（跟踪）、.locks（未跟踪）
  fs.writeFileSync(path.join(L, 'config.json'), JSON.stringify({ version: 1, date: '20990101', counters: { requirement: 1, bug: 2 } }, null, 2));
  fs.mkdirSync(path.join(L, 'dispatch'), { recursive: true });
  fs.writeFileSync(path.join(L, 'dispatch', 'settings.json'), '{}\n');
  fs.mkdirSync(path.join(L, '.locks'), { recursive: true });
  fs.writeFileSync(path.join(L, '.locks', 'x.lock'), '{}');
  fs.writeFileSync(path.join(L, 'README.md'), '# 数据目录\n');
  fs.writeFileSync(path.join(L, '.gitignore'), '.locks/\ndispatch/runs/\n');
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', 'legacy board']);
  return root;
}

t('M1 迁移：data/runtime 拆分、git mv 历史、应用数据退出版本控制且本地保留、旧目录移除、清单一致', () => {
  const root = mkLegacyProj();
  const r = migrate.migrateLayout(root);
  assert.ok(r.changed, '应报告发生迁移');
  const board = path.join(root, 'agent-team-board');
  // 用户数据落位
  assert.ok(fs.existsSync(path.join(board, 'data', 'requirements', 'REQ-20990101-001', 'README.md')), '需求文档应迁 data/');
  assert.ok(fs.existsSync(path.join(board, 'data', 'requirements', 'REQ-20990101-001', 'attachments', 'shot.png')), '附件应随迁');
  assert.ok(fs.existsSync(path.join(board, 'data', 'requirements', 'REQ-20990101-001', 'bugs', 'BUG-20990101-001', 'README.md')), '嵌套 Bug 文档应迁 data/');
  assert.ok(fs.existsSync(path.join(board, 'data', 'bugs', 'BUG-20990101-002', 'README.md')), '独立 Bug 文档应迁 data/');
  // 状态迁 runtime
  assert.ok(fs.existsSync(path.join(board, 'runtime', 'status', 'REQ-20990101-001.json')), '需求状态应迁 runtime/status/');
  assert.ok(fs.existsSync(path.join(board, 'runtime', 'status', 'BUG-20990101-001.json')), '嵌套 Bug 状态应迁 runtime/status/');
  assert.ok(!fs.existsSync(path.join(board, 'data', 'requirements', 'REQ-20990101-001', 'status.json')), '条目目录不应残留 status.json');
  // 应用数据本地保留
  assert.ok(fs.existsSync(path.join(board, 'runtime', 'config.json')), 'config.json 应迁 runtime（本地保留）');
  assert.ok(fs.existsSync(path.join(board, 'runtime', 'dispatch', 'settings.json')), 'dispatch/settings.json 应迁 runtime');
  assert.ok(fs.existsSync(path.join(board, 'runtime', '.locks', 'x.lock')), '.locks 应迁 runtime');
  // 旧目录移除
  assert.ok(!fs.existsSync(path.join(root, 'docs')), '旧 docs/ 目录应移除');
  // 根 .gitignore
  const gi = fs.readFileSync(path.join(root, '.gitignore'), 'utf8');
  assert.ok(gi.split('\n').includes('agent-team-board/runtime/'), '根 .gitignore 应含新忽略规则');
  // 版本控制口径：文档仍被跟踪（暂存为 rename），应用数据退出索引
  const tracked = new Set(String(git(root, ['ls-files']).stdout).trim().split('\n').filter(Boolean));
  assert.ok(tracked.has('agent-team-board/data/requirements/REQ-20990101-001/README.md'), '迁移后文档应在索引（rename）');
  assert.ok(!tracked.has('agent-team-board/runtime/config.json'), 'runtime/config.json 不应被跟踪');
  assert.ok(!tracked.has('agent-team-board/runtime/status/REQ-20990101-001.json'), '状态文件不应被跟踪');
  assert.ok(![...tracked].some((p) => p.startsWith('docs/agent-team-board')), '旧前缀不应有残留跟踪');
  // 暂存区应含 rename 记录（git mv 保留历史的成对搬移；入库后 --follow 生效）
  const porcelain = String(git(root, ['status', '--porcelain']).stdout);
  assert.match(porcelain, /R\s+docs\/agent-team-board\/requirements\/REQ-20990101-001\/README\.json? -> agent-team-board\/data\/requirements\/REQ-20990101-001\/README\.md|R {2}.*README\.md.*-> /);
  // 提交后 --follow 追溯旧位置历史（迁移不自动 commit；此处模拟收口提交）
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', 'migrate layout REQ-20260916-007']);
  const follow = String(git(root, ['log', '--follow', '--oneline', '--', 'agent-team-board/data/requirements/REQ-20990101-001/README.md']).stdout);
  assert.ok(follow.includes('legacy board'), `git log --follow 应追溯到旧位置历史（实际：${follow}）`);
  // runtime 被忽略
  assert.equal(spawnSync('git', ['check-ignore', '-q', 'agent-team-board/runtime/config.json'], { cwd: root }).status, 0, 'runtime 应命中忽略');
  // 条目清单一致 + atb 读得动
  const items = core.listItems(board);
  assert.equal(items.length, 3, `应识别 3 个条目（实际 ${items.length}）`);
  assert.equal(items.find((x) => x.id === 'REQ-20990101-001').status, 'done');
});

t('M2 迁移幂等与迁移后全流程', () => {
  const root = mkLegacyProj();
  const r1 = migrate.migrateLayout(root);
  assert.ok(r1.changed);
  const r2 = migrate.migrateLayout(root);
  assert.ok(!r2.changed, '重复迁移应 no-op');
  assert.match(r2.reason, /已是新布局/);
  // 迁移后 atb 全流程：新登记 / 接受 / 认领 / 上报
  const created = atb(['new', 'req', '迁移后新需求', '--dir', root], root);
  assert.equal(created.code, 0, created.err);
  const m = /REQ-\d{8}-\d{3}/.exec(created.out);
  assert.ok(m, `应输出新单号：${created.out}`);
  const id = m[0];
  assert.ok(fs.existsSync(path.join(root, 'agent-team-board', 'runtime', 'status', `${id}.json`)), '新单状态应落 runtime');
  assert.equal(atb(['status', id, 'accepted', '--dir', root], root).code, 0);
  assert.equal(atb(['claim', id, '--by', 'w', '--dir', root], root).code, 0);
  assert.equal(atb(['report', id, '--coverage', '80', '--summary', 'ok', '--by', 'w', '--dir', root], root).code, 0);
  const list = JSON.parse((() => {
    const r = atb(['list', '--json', '--dir', root], root);
    const i = r.out.lastIndexOf('\n{');
    return r.out.slice(i + 1);
  })());
  assert.ok(list.items.some((x) => x.id === id && x.status === 'in-progress'), '新单应出现在列表');
});

t('M2b 无旧布局报错指引 / 无 git 项目纯文件搬移', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atb-mig2-'));
  assert.throws(() => migrate.migrateLayout(root), /未找到旧布局/);
  // 无 git：旧布局文件搬移（不涉及 git 命令）
  const L = path.join(root, 'docs', 'agent-team-board', 'requirements', 'REQ-20990101-001');
  fs.mkdirSync(L, { recursive: true });
  fs.writeFileSync(path.join(L, 'README.md'), '# x\n');
  fs.writeFileSync(path.join(L, 'status.json'), JSON.stringify({ id: 'REQ-20990101-001', type: 'requirement', title: 'x', status: 'submitted', createdAt: 'z', updatedAt: 'z', history: [] }));
  const r = migrate.migrateLayout(root);
  assert.ok(r.changed);
  assert.ok(fs.existsSync(path.join(root, 'agent-team-board', 'data', 'requirements', 'REQ-20990101-001', 'README.md')));
  assert.ok(fs.existsSync(path.join(root, 'agent-team-board', 'runtime', 'status', 'REQ-20990101-001.json')));
});

t('M3 CLI atb migrate 与服务接口 /api/layout/state、/api/migrate', async () => {
  // CLI
  const root = mkLegacyProj();
  const r = atb(['migrate', '--dir', root], root);
  assert.equal(r.code, 0, `atb migrate 应成功: ${r.err}`);
  assert.ok(fs.existsSync(path.join(root, 'agent-team-board', 'runtime', 'status', 'REQ-20990101-001.json')), 'CLI 迁移应落位');

  // 服务接口（独立旧布局项目）
  const root2 = mkLegacyProj();
  const port = 18990 + Math.floor(Math.random() * 100);
  const env = { ...process.env, ATB_PORT: String(port), ATB_REGISTRY: path.join(root2, 'reg.json') };
  const proc = spawn(process.execPath, [SERVER], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  try {
    await sleep(1500);
    const state = await reqJson(port, 'POST', '/api/layout/state', { path: root2 });
    assert.equal(state.legacy, true, 'layout/state 应探测到旧布局');
    assert.equal(state.modern, false);
    const mig = await reqJson(port, 'POST', '/api/migrate', { path: root2 });
    assert.ok(mig.changed !== false, `api/migrate 应执行迁移: ${JSON.stringify(mig).slice(0, 200)}`);
    assert.ok(fs.existsSync(path.join(root2, 'agent-team-board', 'data', 'requirements', 'REQ-20990101-001', 'README.md')), '服务迁移应落位');
    const state2 = await reqJson(port, 'POST', '/api/layout/state', { path: root2 });
    assert.equal(state2.modern, true, '迁移后应探测到新布局');
    const again = await reqJson(port, 'POST', '/api/migrate', { path: root2 });
    assert.equal(again.changed, false, '重复迁移应 no-op');
  } finally {
    proc.kill('SIGKILL');
  }
});

function reqJson(port, method, pathname, body) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const r = http.request({
      hostname: '127.0.0.1', port, path: pathname, method,
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
      timeout: 15000,
    }, (rs) => {
      let data = '';
      rs.on('data', (c) => { data += c; });
      rs.on('end', () => {
        try { resolve(JSON.parse(data)); } catch (e) { reject(new Error(`${pathname} 响应非 JSON：${data.slice(0, 200)}`)); }
      });
    });
    r.on('error', reject);
    r.on('timeout', () => { r.destroy(); reject(new Error('timeout')); });
    r.write(payload);
    r.end();
  });
}

// ---------- 执行 ----------
let failed = 0;
for (const [name, fn] of cases) {
  try {
    await fn();
    console.log(`✓ ${name}`);
  } catch (e) {
    failed++;
    console.error(`✗ ${name}\n  ${e && e.stack ? e.stack.split('\n').slice(0, 8).join('\n  ') : e}`);
  }
}
console.log(failed ? `\n${failed} 个用例失败` : '\n全部通过');
process.exit(failed ? 1 : 0);
