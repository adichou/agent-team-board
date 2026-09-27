#!/usr/bin/env node
// REQ-20260927-001 需求/bug 创建成功时同步提交条目目录到 git（四通道统一内核）—— 分层测试。
// L1 git-flow 收口内核 commitItemCreation（真实 git 临时仓库）：C1–C8
// L2 三通道集成（CLI atb new / 服务端 POST /api/new / 批量登记 oncall.createItems）：C9–C12
// L3 「创建并接受」失败回滚不残留提交：C13
// L4 rebuild 留痕排除与收口幂等交互：C14 / C15
// L5 静态接线契约（四通道 + 导出）：C16
// 用法：node scripts/tests/req-20260927-001.test.mjs

import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as core from '../lib/core.mjs';
import * as gitFlow from '../lib/git-flow.mjs';
import * as oncall from '../lib/oncall-store.mjs';
import * as rebuild from '../lib/rebuild.mjs';
import { validateCommitSubject } from '../lib/commit-store.mjs';

const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const ATB = path.join(PLUGIN_ROOT, 'scripts', 'atb.mjs');
const SERVER = path.join(PLUGIN_ROOT, 'scripts', 'server.mjs');
const ATB_CLI = fs.readFileSync(ATB, 'utf8');
const SERVER_SRC = fs.readFileSync(SERVER, 'utf8');
const ONCALL_SRC = fs.readFileSync(path.join(PLUGIN_ROOT, 'scripts', 'lib', 'oncall-store.mjs'), 'utf8');
const MARKETING_SRC = fs.readFileSync(path.join(PLUGIN_ROOT, 'scripts', 'lib', 'marketing-store.mjs'), 'utf8');

const cases = [];
const t = (name, fn) => cases.push([name, fn]);

function git(root, args, opts = {}) {
  const r = spawnSync('git', ['-c', 'user.email=t@example.com', '-c', 'user.name=t', ...args], {
    cwd: root, encoding: 'utf8', timeout: 30_000,
  });
  if (!opts.canFail && r.status !== 0) throw new Error(`git ${args.join(' ')} 失败：${r.stderr || r.stdout}`);
  return r;
}

const porcelain = (root) => String(git(root, ['status', '--porcelain']).stdout || '');
const headSubject = (root) => String(git(root, ['log', '-1', '--format=%s']).stdout || '').trim();
const headFiles = (root) => String(git(root, ['show', '--name-only', '--format=', 'HEAD']).stdout || '')
  .split('\n').map((s) => s.trim()).filter(Boolean);
const revCount = (root) => String(git(root, ['rev-list', '--count', 'HEAD']).stdout).trim();
const showFile = (root, rel) => String(git(root, ['show', `HEAD:${rel}`]).stdout || '');

// git 化临时项目：initData（内部已 git init 并落 dev 分支）+ 身份配置 + 全量入库
function gitProject(tag, { items = 0, type = 'requirement' } = {}) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), `atb-newgit-${tag}-`)));
  core.initData(root);
  const dataDir = core.dataDirFrom(root);
  const created = [];
  for (let i = 0; i < items; i++) {
    created.push(core.createItem(dataDir, { type, title: `预置${type}${i + 1}`, by: 'test' }));
  }
  git(root, ['config', 'user.email', 't@example.com']);
  git(root, ['config', 'user.name', 't']);
  git(root, ['add', '.']);
  git(root, ['commit', '-q', '-m', 'chore: 初始化测试仓库']);
  return { root, dataDir, created };
}

const itemDirOf = (dataDir, id) => core.resolveItemDir(dataDir, id).dir;

/* ---------- L1 收口内核（C1–C8） ---------- */

t('C1 git 仓库创建需求：一条 doc: 创建条目 提交、仅含条目目录、过规范核验、不切分支不配远端', () => {
  const { root, dataDir } = gitProject('c1');
  const st = core.createItem(dataDir, { type: 'requirement', title: '创建留痕需求', by: 'test' });
  const before = revCount(root);

  const gc = gitFlow.commitItemCreation({ projectRoot: root, itemId: st.id, itemDir: itemDirOf(dataDir, st.id) });
  assert.equal(gc.status, 'committed', `应产生同步提交：${gc.reason}`);
  assert.match(gc.commit.subject, new RegExp(`^doc: 创建条目 ${st.id}$`), '提交消息应为 doc 前缀 + 创建条目 + 单号');
  assert.equal(validateCommitSubject(gc.commit.subject, st.id), null, '提交消息应过规范核验');
  assert.match(gc.shortHash, /^[0-9a-f]{7}$/, '应返回提交短号');
  assert.equal(headSubject(root), gc.commit.subject, 'HEAD 应即创建提交');
  const files = headFiles(root);
  assert.ok(files.length, '提交应含文件');
  for (const p of files) {
    assert.ok(p.startsWith(`agent-team-board/data/requirements/${st.id}/`), `提交只应含新条目目录路径，实际含：${p}`);
  }
  assert.ok(files.some((p) => p.endsWith('/README.md')), 'README.md 应入库');
  assert.ok(files.some((p) => p.endsWith('/design.md')), 'design.md 应入库');
  assert.ok(files.some((p) => p.endsWith('/test-cases.md')), 'test-cases.md 应入库');
  assert.ok(!porcelain(root).includes(st.id), '工作区不应再残留该条目差异');
  assert.equal(revCount(root), String(Number(before) + 1), '应恰好新增一个提交');
  assert.equal(String(git(root, ['branch', '--show-current']).stdout).trim(), 'dev', '不得切换分支（initData 缺省 dev）');
  assert.equal(String(git(root, ['remote']).stdout).trim(), '', '不得配置远端（全程无 push）');
});

t('C2 Bug 条目同口径：data/bugs/<ID> 创建提交含单号、仅含条目目录', () => {
  const { root, dataDir } = gitProject('c2');
  const st = core.createItem(dataDir, { type: 'bug', title: '创建留痕缺陷', by: 'test' });
  const gc = gitFlow.commitItemCreation({ projectRoot: root, itemId: st.id, itemDir: itemDirOf(dataDir, st.id) });
  assert.equal(gc.status, 'committed', `Bug 创建应同步提交：${gc.reason}`);
  assert.match(gc.commit.subject, new RegExp(`^doc: 创建条目 ${st.id}$`));
  assert.ok(headFiles(root).every((p) => p.startsWith(`agent-team-board/data/bugs/${st.id}/`)), '应仅含 Bug 条目目录路径');
  assert.ok(!headFiles(root).some((p) => p.endsWith('/test-cases.md')), 'Bug 无 test-cases.md');
});

t('C3 不卷入无关改动：预置其他条目脏改动与板外脏文件 → 提交仅含新条目目录，预置差异原样保留', () => {
  const { root, dataDir, created } = gitProject('c3', { items: 1 });
  const [keeper] = created;
  const victim = core.createItem(dataDir, { type: 'requirement', title: '隔离创建', by: 'test' });
  // 预置脏改动：其他条目目录内改动 + 仓库根跟踪文件改动 + 未跟踪新文件
  fs.appendFileSync(path.join(itemDirOf(dataDir, keeper.id), 'README.md'), '\n预置脏改动\n');
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src', 'app.js'), 'base\n');
  git(root, ['add', 'src/app.js']);
  git(root, ['commit', '-q', '-m', 'chore: 预置跟踪文件']);
  fs.writeFileSync(path.join(root, 'src', 'app.js'), 'dirty\n');
  fs.writeFileSync(path.join(root, 'untracked.txt'), 'untracked\n');
  const preDirty = porcelain(root).split('\n').filter(Boolean).filter((l) => !l.includes(victim.id));
  assert.ok(preDirty.length, '前置：应存在预置差异');

  const gc = gitFlow.commitItemCreation({ projectRoot: root, itemId: victim.id, itemDir: itemDirOf(dataDir, victim.id) });
  assert.equal(gc.status, 'committed', `应产生同步提交：${gc.reason}`);
  const files = headFiles(root);
  assert.ok(files.length && files.every((p) => p.startsWith(`agent-team-board/data/requirements/${victim.id}/`)),
    `创建提交不得卷入无关路径：${files.join('、')}`);
  const after = porcelain(root).split('\n').filter(Boolean);
  for (const line of preDirty) {
    assert.ok(after.includes(line), `预置差异应原样保留：${line}`);
  }
  assert.ok(after.some((l) => l.includes(keeper.id)), '其他条目脏改动应保留');
  assert.ok(after.some((l) => l.includes('src/app.js')), '板外脏文件应保留');
  assert.ok(after.some((l) => l.includes('untracked.txt')), '未跟踪文件应保留');
});

t('C4 创建带附件：attachments/ 一并随创建提交入库', () => {
  const { root, dataDir } = gitProject('c4');
  const st = core.createItem(dataDir, {
    type: 'requirement', title: '带附件创建', by: 'test',
    attachments: [{ name: 'shot.png', dataBase64: Buffer.from('fake-png-bytes').toString('base64') }],
  });
  const gc = gitFlow.commitItemCreation({ projectRoot: root, itemId: st.id, itemDir: itemDirOf(dataDir, st.id) });
  assert.equal(gc.status, 'committed', `应产生同步提交：${gc.reason}`);
  assert.ok(headFiles(root).some((p) => p === `agent-team-board/data/requirements/${st.id}/attachments/shot.png`),
    '附件应随创建提交入库');
});

t('C5 非 git 仓库：skipped 注明无法同步提交，创建照常成功不抛错', () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'atb-newgit-c5-')));
  core.initData(root);
  fs.rmSync(path.join(root, '.git'), { recursive: true, force: true }); // 构造非 git 仓库
  const dataDir = core.dataDirFrom(root);
  const st = core.createItem(dataDir, { type: 'requirement', title: '非git创建', by: 'test' });
  const gc = gitFlow.commitItemCreation({ projectRoot: root, itemId: st.id, itemDir: itemDirOf(dataDir, st.id) });
  assert.equal(gc.status, 'skipped', '非 git 仓库应跳过同步提交');
  assert.match(gc.reason, /非 git 仓库，无法同步提交/, 'reason 应注明非 git 仓库');
  assert.ok(fs.existsSync(itemDirOf(dataDir, st.id)), '条目目录应照常存在');
});

t('C6 条目目录在仓库外 / 已不存在：均 skipped，不产生空提交', () => {
  const { root } = gitProject('c6');
  const before = revCount(root);
  const outside = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'atb-newgit-c6-out-')));
  const outsideItem = path.join(outside, 'REQ-20990101-901');
  fs.mkdirSync(outsideItem, { recursive: true }); // 仓库外真实存在的条目目录
  const gcOut = gitFlow.commitItemCreation({ projectRoot: root, itemId: 'REQ-20990101-901', itemDir: outsideItem });
  assert.equal(gcOut.status, 'skipped', '仓库外条目目录应跳过');
  assert.match(gcOut.reason, /不在当前 git 仓库内/, 'reason 应注明仓库外');
  const gcGone = gitFlow.commitItemCreation({ projectRoot: root, itemId: 'REQ-20990101-902', itemDir: path.join(root, 'agent-team-board', 'data', 'requirements', 'REQ-20990101-902') });
  assert.equal(gcGone.status, 'skipped', '已不存在目录应跳过');
  assert.match(gcGone.reason, /条目目录不存在/, 'reason 应注明目录不存在');
  assert.equal(revCount(root), before, '跳过不得产生提交');
});

t('C7 提交失败不阻断：预置 index.lock → failed 带指引、差异留工作区，解锁后可重试入库', () => {
  const { root, dataDir } = gitProject('c7', { items: 1 }); // 预置条目保证看板内已有跟踪文件，新条目差异以自身路径呈现
  const st = core.createItem(dataDir, { type: 'requirement', title: '提交失败容错', by: 'test' });
  fs.writeFileSync(path.join(root, '.git', 'index.lock'), 'lock'); // 构造提交失败
  const gc = gitFlow.commitItemCreation({ projectRoot: root, itemId: st.id, itemDir: itemDirOf(dataDir, st.id) });
  assert.equal(gc.status, 'failed', 'index.lock 下提交应失败');
  assert.match(gc.reason, /同步提交失败/, 'reason 应含失败说明');
  assert.match(gc.reason, /人工补提交/, 'reason 应含人工补提交指引');
  assert.ok(fs.existsSync(itemDirOf(dataDir, st.id)), '条目目录不得回滚');
  assert.ok(porcelain(root).split('\n').some((l) => l.includes(st.id)), '创建差异应保留在工作区');

  fs.rmSync(path.join(root, '.git', 'index.lock'));
  const retry = gitFlow.commitItemCreation({ projectRoot: root, itemId: st.id, itemDir: itemDirOf(dataDir, st.id) });
  assert.equal(retry.status, 'committed', `解锁后应可补提交入库：${retry.reason}`);
  assert.match(headSubject(root), new RegExp(st.id), '补提交消息应含单号');
  assert.ok(!porcelain(root).includes(st.id), '入库后工作区不应再残留该差异');
});

t('C8 条目目录被 .gitignore 忽略：无差异 → skipped 不产生空提交', () => {
  const { root, dataDir } = gitProject('c8');
  fs.appendFileSync(path.join(root, '.gitignore'), 'agent-team-board/data/\n');
  const before = revCount(root);
  const st = core.createItem(dataDir, { type: 'requirement', title: '被忽略创建', by: 'test' });
  const gc = gitFlow.commitItemCreation({ projectRoot: root, itemId: st.id, itemDir: itemDirOf(dataDir, st.id) });
  assert.equal(gc.status, 'skipped', '无差异应跳过');
  assert.match(gc.reason, /无 git 差异/, 'reason 应注明无差异');
  assert.equal(revCount(root), before, '不得产生空提交');
});

/* ---------- L2 三通道集成（C9–C12） ---------- */

const atb = (args, cwd) => {
  const r = spawnSync(process.execPath, [ATB, ...args, '--dir', cwd], { cwd, encoding: 'utf8', timeout: 90_000 });
  return { code: r.status, out: r.stdout || '', err: r.stderr || '' };
};

t('C9 CLI atb new：回显「↳ 已同步提交 <短号>：主题」，git log 含单号，工作区干净', () => {
  const { root, dataDir } = gitProject('c9');
  const a = atb(['new', 'req', '终端创建条目'], root);
  assert.equal(a.code, 0, `atb new 应成功：${a.err}`);
  const id = fs.readdirSync(path.join(dataDir, 'data', 'requirements')).find((n) => n.startsWith('REQ'));
  assert.ok(id, '应能从条目目录取到新单号');
  assert.match(a.out, new RegExp(`↳ 已同步提交 [0-9a-f]{7}：doc: 创建条目 ${id}`), `命令应回显提交结果：${a.out}`);
  assert.equal(headSubject(root), `doc: 创建条目 ${id}`, 'HEAD 应即创建提交');
  assert.ok(!porcelain(root).includes(id), '工作区不应残留该条目差异');
});

t('C10 CLI atb new --accept（创建并接受）：同样触发同步提交', () => {
  const { root, dataDir } = gitProject('c10');
  const a = atb(['new', 'bug', '一步接受缺陷', '--accept'], root);
  assert.equal(a.code, 0, `atb new --accept 应成功：${a.err}`);
  assert.match(a.out, /已接受/, '应提示创建并接受');
  const id = fs.readdirSync(path.join(dataDir, 'data', 'bugs')).find((n) => n.startsWith('BUG'));
  assert.ok(id, '应能取到新 Bug 单号');
  assert.match(a.out, new RegExp(`↳ 已同步提交 [0-9a-f]{7}：doc: 创建条目 ${id}`), `accept 路径应回显提交结果：${a.out}`);
  assert.equal(headSubject(root), `doc: 创建条目 ${id}`);
  assert.equal(core.readStatus(itemDirOf(dataDir, id)).status, 'accepted', '条目应为 accepted');
});

function httpRequest(port, method, p, body = null) {
  return new Promise((resolve, reject) => {
    const rq = http.request({ hostname: '127.0.0.1', port, path: p, method, timeout: 5000 }, (rs) => {
      let out = '';
      rs.on('data', (c) => { out += c; });
      rs.on('end', () => resolve({ code: rs.statusCode, body: out }));
    });
    rq.on('error', reject);
    rq.on('timeout', () => { rq.destroy(); reject(new Error('request timeout')); });
    if (body) rq.write(JSON.stringify(body));
    rq.end();
  });
}

t('C11 服务端 POST /api/new：201 响应携带 gitCommit（committed + 短号），git log 含单号', async () => {
  const { root } = gitProject('c11');
  const port = 24000 + Math.floor(Math.random() * 8000);
  const registry = path.join(os.tmpdir(), `atb-reg-${process.pid}-${Math.random().toString(16).slice(2)}.json`);
  const child = spawn(process.execPath, [SERVER], {
    cwd: root,
    env: { ...process.env, ATB_PORT: String(port), ATB_HOST: '127.0.0.1', ATB_REGISTRY: registry },
    stdio: ['ignore', 'ignore', 'ignore'],
  });
  try {
    let up = false;
    for (let i = 0; i < 50 && !up; i++) {
      await new Promise((r) => setTimeout(r, 100));
      up = await httpRequest(port, 'GET', '/api/health').then((r) => r.code === 200).catch(() => false);
    }
    assert.ok(up, '测试服务应启动');

    const res = await httpRequest(port, 'POST', '/api/new', { type: 'req', title: '网页创建条目' });
    assert.equal(res.code, 201, `创建应成功：${res.body}`);
    const body = JSON.parse(res.body);
    assert.ok(body.id, '响应应含条目编号');
    assert.ok(body.gitCommit, '响应应携带 gitCommit 反馈');
    assert.equal(body.gitCommit.status, 'committed', '服务端创建应同步提交');
    assert.match(body.gitCommit.shortHash, /^[0-9a-f]{7}$/, '应返回提交短号');
    assert.equal(body.gitCommit.subject, `doc: 创建条目 ${body.id}`, '应回显提交主题');
    assert.equal(headSubject(root), `doc: 创建条目 ${body.id}`, 'HEAD 应即创建提交');
    assert.ok(!porcelain(root).includes(body.id), '工作区不应残留该差异');
  } finally {
    child.kill();
    try { fs.rmSync(root, { recursive: true, force: true }); } catch {}
    try { fs.rmSync(registry, { force: true }); } catch {}
  }
});

t('C12 批量登记 oncall.createItems：逐条结果带 gitCommit，提交内容含 README 补写来源行', () => {
  const { root, dataDir } = gitProject('c12');
  const ticket = oncall.createTicket(dataDir, { title: '咨询一', question: '问题', by: 'board' });
  const before = revCount(root);
  const res = oncall.createItems(dataDir, ticket.id, {
    by: 'board',
    items: [{ id: 'd1', type: 'requirement', title: '批量条目一', description: '描述', acceptance: '- [ ] 验收一' }],
  });
  assert.equal(res.results.length, 1);
  const r0 = res.results[0];
  assert.equal(r0.ok, true, `候选创建应成功：${JSON.stringify(r0)}`);
  assert.ok(r0.gitCommit, '结果应携带 gitCommit');
  assert.equal(r0.gitCommit.status, 'committed', `候选创建应同步提交：${r0.gitCommit.reason}`);
  assert.match(r0.gitCommit.shortHash, /^[0-9a-f]{7}$/);
  assert.match(r0.gitCommit.subject, new RegExp(`^doc: 创建条目 ${r0.itemId}$`));
  const readmeRel = `agent-team-board/data/requirements/${r0.itemId}/README.md`;
  assert.ok(showFile(root, readmeRel).includes('- 来源讨论：'), '提交内容应含补写的来源讨论行（补写后再提交）');
  assert.equal(revCount(root), String(Number(before) + 1), '应恰好新增一个提交');
});

/* ---------- L3 创建失败回滚（C13） ---------- */

t('C13 accept 失败回滚：不留条目目录、不产生创建提交；对已消失目录调用内核 skipped', () => {
  const { root, dataDir } = gitProject('c13');
  const reqRoot = path.join(dataDir, 'data', 'requirements');
  const beforeDirs = fs.readdirSync(reqRoot).length;
  const before = revCount(root);
  let createdId = null;
  const orig = fs.writeFileSync;
  fs.writeFileSync = function (f, d, ...rest) {
    if (String(f).startsWith(dataDir) && String(d).includes('"status": "accepted"')) {
      throw new Error('injected accept failure');
    }
    return orig.call(fs, f, d, ...rest);
  };
  try {
    const st = core.createItem(dataDir, { type: 'requirement', title: '回滚创建', by: 'test', accept: true });
    createdId = st.id; // 不应到达
  } catch (e) {
    assert.match(String(e.message), /injected accept failure/, '应注入接受失败');
  } finally {
    fs.writeFileSync = orig;
  }
  assert.equal(createdId, null, 'createItem 应抛错（无返回）');
  assert.equal(fs.readdirSync(reqRoot).length, beforeDirs, '失败不得留下条目目录（回滚删除）');
  assert.equal(revCount(root), before, '创建失败不得产生创建提交');
  // 防御口径：目录已消失时内核 skipped（不 failed、不空提交）
  const gc = gitFlow.commitItemCreation({ projectRoot: root, itemId: 'REQ-20990101-903', itemDir: path.join(reqRoot, 'REQ-20990101-903') });
  assert.equal(gc.status, 'skipped', '已消失目录应 skipped');
  assert.match(gc.reason, /条目目录不存在/, 'reason 应注明目录不存在');
});

/* ---------- L4 rebuild 留痕排除与收口幂等交互（C14 / C15） ---------- */

t('C14 rebuild：仅创建留痕提交 → submitted 不误判 done；留痕 + 开发提交 → done 依据为开发提交', () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'atb-newgit-c14-')));
  git(root, ['init', '-q', '-b', 'main']);
  git(root, ['config', 'user.email', 't@example.com']);
  git(root, ['config', 'user.name', 't']);
  const board = path.join(root, 'agent-team-board');
  fs.writeFileSync(path.join(root, '.gitignore'), 'agent-team-board/runtime/\n');
  fs.mkdirSync(path.join(board, 'data', 'requirements'), { recursive: true });

  const a = core.createItem(board, { type: 'requirement', title: '仅创建', by: 'test' });
  const gcA = gitFlow.commitItemCreation({ projectRoot: root, itemId: a.id, itemDir: itemDirOf(board, a.id) });
  assert.equal(gcA.status, 'committed', gcA.reason);
  const b = core.createItem(board, { type: 'requirement', title: '创建后开发', by: 'test' });
  const gcB = gitFlow.commitItemCreation({ projectRoot: root, itemId: b.id, itemDir: itemDirOf(board, b.id) });
  assert.equal(gcB.status, 'committed', gcB.reason);
  // B 后续开发提交（非留痕）
  fs.writeFileSync(path.join(root, 'feature-b.txt'), 'b\n');
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', `feat: 实现 ${b.id}`]);
  fs.rmSync(path.join(board, 'runtime'), { recursive: true, force: true }); // 模拟 clone 后 runtime 为空

  const r = rebuild.rebuildBoardStatus(board);
  const la = r.lines.find((l) => l.id === a.id);
  const lb = r.lines.find((l) => l.id === b.id);
  assert.equal(la.status, 'submitted', '仅创建留痕提交不得判 done');
  assert.equal(la.basis, null, '仅留痕时依据应为 null');
  assert.equal(lb.status, 'done', '创建留痕 + 开发提交应判 done');
  assert.equal(lb.basis.subject, `feat: 实现 ${b.id}`, '依据应为开发提交而非创建提交');
  const stA = JSON.parse(fs.readFileSync(path.join(board, 'runtime', 'status', `${a.id}.json`), 'utf8'));
  assert.match(String(stA.history[0].note || ''), /留痕/, 'note 应注明仅有留痕提交');
});

t('C15 收口幂等交互：历史已含创建提交时 autoCommitForRun 仍按差集归因提交；无改动时幂等跳过不变', () => {
  const { root, dataDir } = gitProject('c15');
  const st = core.createItem(dataDir, { type: 'requirement', title: '收口归因单', by: 'test' });
  const gc = gitFlow.commitItemCreation({ projectRoot: root, itemId: st.id, itemDir: itemDirOf(dataDir, st.id) });
  assert.equal(gc.status, 'committed', gc.reason);
  const snapshot = gitFlow.workingTreeSnapshot(root); // 认领时快照：创建提交后、开发前
  // 本单开发改动：条目文档（doc 组）+ 板外源码（业务组）
  fs.appendFileSync(path.join(itemDirOf(dataDir, st.id), 'design.md'), '\n设计补充\n');
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src', 'app.js'), 'code\n');

  const run = { runId: 'run-test-c15', batchId: null, itemId: st.id, treeSnapshot: snapshot, autoCommit: null };
  const r = gitFlow.autoCommitForRun({ dataDir, projectRoot: root, run });
  assert.equal(r.status, 'committed', `历史含创建提交时不得整单跳过：${r.reason}`);
  const subjects = (r.commits || []).map((c) => c.subject);
  assert.ok(subjects.some((s) => s.startsWith('feat: ') && s.includes(st.id)), `业务组应归因提交：${subjects.join('、')}`);
  assert.ok(subjects.some((s) => s.startsWith('doc: ') && s.includes(st.id)), `doc 组应归因提交：${subjects.join('、')}`);

  const r2 = gitFlow.autoCommitForRun({ dataDir, projectRoot: root, run: { ...run, treeSnapshot: gitFlow.workingTreeSnapshot(root) } });
  assert.equal(r2.status, 'skipped', '无新改动应幂等跳过');
  assert.match(r2.reason, /幂等跳过/, '跳过原因应注明幂等');
});

/* ---------- L5 静态接线契约（C16） ---------- */

t('C16 静态接线：四通道均在 createItem 成功后调用 commitItemCreation；gitFlow 导出新函数与留痕判定', () => {
  assert.equal(typeof gitFlow.commitItemCreation, 'function', 'gitFlow 应导出 commitItemCreation');
  assert.equal(typeof gitFlow.isItemTraceCommitSubject, 'function', 'gitFlow 应导出 isItemTraceCommitSubject');
  assert.equal(gitFlow.isItemTraceCommitSubject('doc: 创建条目 REQ-20260927-001'), true, '创建留痕主题应识别');
  assert.equal(gitFlow.isItemTraceCommitSubject('doc: 删除待接受条目 BUG-20260927-002'), true, '删除留痕主题应识别');
  assert.equal(gitFlow.isItemTraceCommitSubject('doc: 标题 REQ-20260927-001'), false, '普通 doc 提交不是留痕');
  assert.equal(gitFlow.isItemTraceCommitSubject('feat: 标题 REQ-20260927-001'), false, '业务提交不是留痕');

  // CLI：new 分支内 createItem 在前、commitItemCreation 在后
  const cliNew = ATB_CLI.match(/if \(cmd === 'new'\) \{[\s\S]*?\n  \}/)?.[0] || '';
  assert.ok(cliNew, 'atb.mjs 应有 new 分支');
  assert.match(cliNew, /core\.createItem\(/, 'new 分支应调用 core.createItem');
  assert.match(cliNew, /commitItemCreation\(/, 'CLI 创建后应调用同步提交');
  assert.ok(cliNew.indexOf('core.createItem(') < cliNew.indexOf('commitItemCreation('), '提交应发生在创建成功之后');

  // 服务端：/api/new 处理块内 createItem 在前、commitItemCreation 在后，响应带 gitCommit
  const newIdx = SERVER_SRC.indexOf("pathname === '/api/new'");
  assert.ok(newIdx > 0, 'server.mjs 应有 /api/new 端点');
  const serverNew = SERVER_SRC.slice(newIdx, newIdx + 1600);
  assert.match(serverNew, /core\.createItem\(/, '/api/new 应调用 core.createItem');
  assert.match(serverNew, /commitItemCreation\(/, '/api/new 应调用同步提交');
  assert.ok(serverNew.indexOf('core.createItem(') < serverNew.indexOf('commitItemCreation('), '提交应发生在创建成功之后');
  assert.match(serverNew, /gitCommit/, '响应应携带 gitCommit 反馈');

  // 批量登记：createItems 内接线（补写文档之后提交）
  const oncallIdx = ONCALL_SRC.indexOf('export function createItems(');
  assert.ok(oncallIdx > 0, 'oncall-store 应有 createItems');
  const oncallBody = ONCALL_SRC.slice(oncallIdx, oncallIdx + 3200);
  assert.match(oncallBody, /commitItemCreation\(/, '批量登记创建应调用同步提交');

  // 营销：linkActivityReq 内接线
  const mktIdx = MARKETING_SRC.indexOf('export function linkActivityReq(');
  assert.ok(mktIdx > 0, 'marketing-store 应有 linkActivityReq');
  const mktBody = MARKETING_SRC.slice(mktIdx, mktIdx + 2600);
  assert.match(mktBody, /commitItemCreation\(/, '营销创建开发需求应调用同步提交');
});

/* ---------- 运行 ---------- */

let failed = 0;
for (const [name, fn] of cases) {
  try {
    await fn();
    console.log(`✓ ${name}`);
  } catch (e) {
    failed++;
    console.error(`✗ ${name}\n    ${String(e.stack || e).split('\n').slice(0, 6).join('\n')}`);
  }
}
console.log(`\n${cases.length} 个用例，失败 ${failed}`);
process.exit(failed ? 1 : 0);
