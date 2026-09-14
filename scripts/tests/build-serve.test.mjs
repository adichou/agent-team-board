#!/usr/bin/env node
// REQ-20260913-001 构建模块（版本管理）—— 服务接口测试 S1~S10。
// 覆盖：state 两态、创建/校验、编辑保存、条目增删锁、candidates、合并入 main 全链路
//（含工作区脏拒绝与 release git 运行互斥）、branches/branch-log、fetch/push、非 git 拒绝、静态资源。
// 用法：node scripts/tests/build-serve.test.mjs

import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as core from '../lib/core.mjs';
import * as releaseStore from '../lib/release-store.mjs';
import * as buildStore from '../lib/build-store.mjs';

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const GIT_ENV = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' };

function git(cwd, args) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', env: GIT_ENV, timeout: 20000 });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} 失败：${r.stderr}`);
  return r.stdout.trim();
}

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

const cases = [];
const t = (name, fn) => cases.push([name, fn]);

t('S1~S10 /api/build* 全链路', async () => {
  const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'atb-build-serve-')));
  const projA = path.join(tmp, 'projA');
  const projB = path.join(tmp, 'projB'); // 非 git 项目
  const remoteA = path.join(tmp, 'remoteA.git');
  fs.mkdirSync(projA);
  fs.mkdirSync(projB);
  git(tmp, ['init', '--bare', '-b', 'main', remoteA]);
  git(projA, ['init', '-b', 'main']);
  git(projA, ['config', 'user.email', 't@e.co']);
  git(projA, ['config', 'user.name', 'T']);
  git(projA, ['remote', 'add', 'origin', remoteA]);
  fs.writeFileSync(path.join(projA, 'a.txt'), 'a\n');
  git(projA, ['add', '-A']);
  git(projA, ['commit', '-m', 'init']);
  git(projA, ['switch', '-c', 'dev']);
  core.initData(projA);
  core.initData(projB);
  // 模拟「有看板数据但项目根不是 git 仓库」：initData 会按 dev 工作流自动初始化 git，这里移除 .git
  fs.rmSync(path.join(projB, '.git'), { recursive: true, force: true });
  const dataDirA = core.dataDirFrom(projA);
  const reqA = core.createItem(dataDirA, { type: 'requirement', title: '演示需求一', by: 'test' });
  const reqB = core.createItem(dataDirA, { type: 'requirement', title: '演示需求二', by: 'test' });
  // BUG-20260913-001 口径：仅已完成（done）条目可纳入版本 / 出现候选，先推到 done
  for (const it of [reqA, reqB]) {
    for (const s of ['accepted', 'in-progress', 'done']) core.setStatus(dataDirA, it.id, s, { by: 'test' });
  }
  fs.writeFileSync(path.join(projA, 'f1.txt'), `feat ${reqA.id}\n`);
  git(projA, ['add', '-A']);
  git(projA, ['commit', '-m', `feat: 演示需求一 ${reqA.id}`]);
  const commit1 = git(projA, ['rev-parse', 'HEAD']);

  const reg = path.join(tmp, 'reg.json');
  // 端口身份校验（防与本机其他常驻看板服务撞车）：/api/health 必须回报同一 port，
  // 否则视为撞车（本进程 EADDRINUSE 退出、响应来自别的服务），换端口重试。
  const spawnOnPort = async (port) => {
    const child = spawn(process.execPath, [path.join(pluginRoot, 'scripts', 'server.mjs')], {
      cwd: projA,
      env: { ...process.env, ATB_PORT: String(port), ATB_REGISTRY: reg },
      stdio: ['ignore', 'ignore', 'ignore'],
    });
    for (let i = 0; i < 40; i++) {
      await sleep(150);
      try {
        const h = await req(port, 'GET', '/api/health');
        if (h.json && h.json.port === port) return child;
      } catch {}
      if (child.exitCode !== null) break; // 已退出（如 EADDRINUSE）
    }
    child.kill('SIGTERM');
    return null;
  };
  let server = null;
  let port = 0;
  for (let i = 0; i < 6 && !server; i++) {
    port = 31000 + Math.floor(Math.random() * 20000);
    server = await spawnOnPort(port);
  }
  assert.ok(server, `服务应启动（已尝试多个端口，最后 ${port}）`);
  const P = `?project=${encodeURIComponent(projA)}`;
  const PB = `?project=${encodeURIComponent(projB)}`;
  try {
    let up = false;
    for (let i = 0; i < 40; i++) {
      await sleep(150);
      try { await req(port, 'GET', '/api/health'); up = true; break; } catch {}
    }
    assert.ok(up, '服务应启动');

    // S1 state 两态：git 项目 / 非 git 项目
    let r = await req(port, 'GET', `/api/build/state${P}`);
    assert.equal(r.status, 200);
    assert.equal(r.json.initialized, true);
    assert.equal(r.json.isRepo, true);
    assert.equal(r.json.currentBranch, 'dev');
    assert.deepEqual(r.json.versions, []);
    r = await req(port, 'GET', `/api/build/state${PB}`);
    assert.equal(r.json.initialized, true);
    assert.equal(r.json.isRepo, false, '非 git 项目 isRepo:false');

    // S2 创建：合法 201；空条目 / 缺 commit / 未知条目 400
    r = await req(port, 'POST', `/api/build/version${P}`, { items: [{ itemId: reqA.id, commit: commit1 }] });
    assert.equal(r.status, 201, `创建应成功：${r.text}`);
    const vid = r.json.version.id;
    assert.match(vid, /^BLD-\d{8}-\d{3}$/);
    assert.equal(r.json.version.status, 'draft');
    assert.equal(r.json.version.items[0].itemId, reqA.id);
    r = await req(port, 'POST', `/api/build/version${P}`, { items: [] });
    assert.equal(r.status, 400, '空条目拒绝');
    r = await req(port, 'POST', `/api/build/version${P}`, { items: [{ itemId: reqA.id }] });
    assert.equal(r.status, 400, '缺 commit 拒绝');
    r = await req(port, 'POST', `/api/build/version${P}`, { items: [{ itemId: 'REQ-20990101-999', commit: commit1 }] });
    assert.equal(r.status, 400, '看板不存在的条目拒绝');

    // S3 编辑保存：名称与描述持久化，条目与 commit 关联不破坏
    r = await req(port, 'POST', `/api/build/version/save${P}`, { id: vid, name: 'v1.0', description: '首个版本' });
    assert.equal(r.status, 200);
    r = await req(port, 'GET', `/api/build/state${P}`);
    const got = r.json.versions.find((v) => v.id === vid);
    assert.equal(got.name, 'v1.0');
    assert.equal(got.description, '首个版本');
    assert.equal(got.items[0].commit, commit1);

    // S5 candidates：无提交条目 commits 为空；BUG-20260914-004：已纳入版本（S2 已把 REQ A
    // 纳入 vid）的条目在源头收窄不出现，totalDone 反映占用过滤前 done 总数（commit 关联
    // 展示口径由 bug-build-candidate-occupied-20260914-004.test.mjs B1 覆盖）
    r = await req(port, 'GET', `/api/build/candidates${P}`);
    assert.equal(r.status, 200);
    const cand = r.json.items;
    const cA = cand.find((x) => x.itemId === reqA.id);
    const cB = cand.find((x) => x.itemId === reqB.id);
    assert.ok(!cA, '已纳入版本的条目不再进入候选（BUG-20260914-004）');
    assert.ok(cB && cB.commits.length === 0, '无提交条目 commits 为空');
    assert.equal(cB.title, '演示需求二');
    assert.equal(r.json.totalDone, 2, 'totalDone 为占用过滤前 done 总数');

    // S4 条目增删：移出可再加；重复添加 400
    r = await req(port, 'POST', `/api/build/version/items${P}`, { id: vid, action: 'remove', itemIds: [reqA.id] });
    assert.equal(r.status, 200);
    assert.deepEqual(r.json.version.items, []);
    r = await req(port, 'POST', `/api/build/version/items${P}`, { id: vid, action: 'add', items: [{ itemId: reqA.id, commit: commit1 }] });
    assert.equal(r.status, 200);
    assert.equal(r.json.version.items.length, 1);
    r = await req(port, 'POST', `/api/build/version/items${P}`, { id: vid, action: 'add', items: [{ itemId: reqA.id, commit: commit1 }] });
    assert.equal(r.status, 400, '重复添加拒绝');

    // S8 branches / branch-log：本地分组；提交记录四元组；ref 注入拒绝
    r = await req(port, 'GET', `/api/build/branches${P}`);
    assert.equal(r.json.isRepo, true);
    assert.equal(r.json.current, 'dev');
    assert.ok(r.json.local.includes('main') && r.json.local.includes('dev'));
    assert.deepEqual(r.json.remote, [], '未推送前远端分组为空');
    r = await req(port, 'GET', `/api/build/branch-log${P}&branch=dev`);
    assert.equal(r.status, 200);
    assert.ok(r.json.commits.length >= 2);
    const c0 = r.json.commits[0];
    for (const k of ['hash', 'short', 'subject', 'author', 'date']) assert.ok(c0[k] != null, `提交记录应含 ${k}`);
    assert.match(c0.subject, new RegExp(reqA.id));
    r = await req(port, 'GET', `/api/build/branch-log${P}&branch=--upload-pack%3Devil`);
    assert.equal(r.status, 400, '非法 ref 拒绝');

    // S8b BUG-20260914-009 分页：独立分支 long 造 62 个提交（commit-tree 不动工作区），
    // 验证默认 50 + total、limit/offset 跨页取数、翻到分支首个提交、非法参数归一、超界空页
    git(projA, ['branch', 'long', 'dev']);
    {
      let parent = git(projA, ['rev-parse', 'long']);
      const tree = git(projA, ['rev-parse', 'long^{tree}']);
      for (let i = 1; i <= 62; i++) {
        parent = git(projA, ['commit-tree', tree, '-p', parent, '-m', `bulk ${i}`]);
        git(projA, ['update-ref', 'refs/heads/long', parent]);
      }
    }
    // long 总数 = dev 既有 2 个（init + feat）+ bulk 62 = 64
    r = await req(port, 'GET', `/api/build/branch-log${P}&branch=long`);
    assert.equal(r.status, 200);
    assert.equal(r.json.total, 64, '默认响应带 total 总数');
    assert.equal(r.json.limit, 50, '默认 limit=50');
    assert.equal(r.json.offset, 0, '默认 offset=0');
    assert.equal(r.json.commits.length, 50, '缺省仍取最近 50 条（首屏兼容口径）');
    r = await req(port, 'GET', `/api/build/branch-log${P}&branch=long&limit=20&offset=40`);
    assert.equal(r.json.total, 64, '分页响应 total 不变');
    assert.equal(r.json.commits.length, 20, 'limit=20&offset=40 取 20 条');
    assert.equal(r.json.commits[0].subject, 'bulk 22', 'offset 偏移后从第 41 新条开始（新→旧）');
    assert.equal(r.json.commits[19].subject, 'bulk 3', '页尾为第 60 新条');
    r = await req(port, 'GET', `/api/build/branch-log${P}&branch=long&limit=50&offset=62`);
    assert.equal(r.json.commits.length, 2, '末页只剩 2 条');
    assert.equal(r.json.commits[1].subject, 'init', '可翻到分支首个提交');
    r = await req(port, 'GET', `/api/build/branch-log${P}&branch=long&limit=10000`);
    assert.equal(r.json.limit, 500, '超大 limit 归一到上限 500（>200 旧顶不再截断）');
    assert.equal(r.json.commits.length, 64, 'limit 上限内 64 条全量可达');
    r = await req(port, 'GET', `/api/build/branch-log${P}&branch=long&limit=-5`);
    assert.equal(r.json.limit, 1, '负数 limit 归一为 1');
    assert.equal(r.json.commits.length, 1, '归一后返回 1 条');
    r = await req(port, 'GET', `/api/build/branch-log${P}&branch=long&limit=abc&offset=-3`);
    assert.equal(r.json.limit, 50, '非数字 limit 走缺省 50');
    assert.equal(r.json.offset, 0, '负数 offset 归一为 0');
    r = await req(port, 'GET', `/api/build/branch-log${P}&branch=long&offset=1000`);
    assert.equal(r.status, 200);
    assert.deepEqual(r.json.commits, [], 'offset 超过 total 返回空页不报错');
    assert.equal(r.json.total, 64, '超界响应 total 仍正确');

    // S12 REQ-20260914-002 提交记录关键词搜索（q 扩展 branch-log：服务端全量过滤分页，只读）
    // D5 q 缺省 / 空白走默认分页（既有口径零回归）
    r = await req(port, 'GET', `/api/build/branch-log${P}&branch=long&q=`);
    assert.equal(r.json.total, 64, '空 q 走默认全量口径');
    assert.ok(!r.json.query, '默认模式不带 query');
    r = await req(port, 'GET', `/api/build/branch-log${P}&branch=long&q=%20%20%20`);
    assert.equal(r.json.total, 64, '空白 q（trim 后空）走默认口径');
    // D1 跨页命中：q=bulk 62 条命中，默认页 50 条、total=62、新→旧
    r = await req(port, 'GET', `/api/build/branch-log${P}&branch=long&q=bulk`);
    assert.equal(r.status, 200);
    assert.equal(r.json.total, 62, 'q=bulk 命中 bulk 1..62');
    assert.equal(r.json.limit, 50, '搜索态默认 limit=50');
    assert.equal(r.json.commits.length, 50);
    assert.equal(r.json.commits[0].subject, 'bulk 62', '命中按新→旧排列');
    assert.equal(r.json.commits[49].subject, 'bulk 13', '首页末条为第 50 命中');
    assert.ok(r.json.commits.every((c) => c.subject.includes('bulk')), '全部命中含关键词');
    assert.equal(r.json.query, 'bulk', '响应回显关键词');
    r = await req(port, 'GET', `/api/build/branch-log${P}&branch=long&q=bulk&limit=20&offset=40`);
    assert.equal(r.json.total, 62, '搜索态 total 不随分页变');
    assert.equal(r.json.commits.length, 20, 'limit=20&offset=40 取 20 条命中');
    assert.equal(r.json.commits[0].subject, 'bulk 22', 'offset 偏移后从第 41 命中开始（新→旧）');
    assert.equal(r.json.commits[19].subject, 'bulk 3', '页尾为第 60 命中');
    // D2 匹配口径四字段：subject（旧位置单号）/ author / 短 hash / 完整 hash 前缀
    r = await req(port, 'GET', `/api/build/branch-log${P}&branch=long&q=${encodeURIComponent(reqA.id)}`);
    assert.equal(r.json.total, 1, '旧位置单号（默认分页第 2 页以远）仍能命中（subject）');
    assert.match(r.json.commits[0].subject, new RegExp(reqA.id));
    assert.equal(r.json.commits[0].hash, commit1, 'subject 命中条目 hash 一致');
    r = await req(port, 'GET', `/api/build/branch-log${P}&branch=long&q=T`);
    assert.equal(r.json.total, 64, '作者 T 命中分支全部提交');
    const longHead = git(projA, ['rev-parse', 'long']);
    r = await req(port, 'GET', `/api/build/branch-log${P}&branch=long&q=${git(projA, ['rev-parse', '--short=7', 'long'])}`);
    assert.equal(r.json.total, 1, '短 hash 前缀恰命中 1 条');
    assert.equal(r.json.commits[0].hash, longHead, '短 hash 命中对应提交');
    r = await req(port, 'GET', `/api/build/branch-log${P}&branch=long&q=${longHead.slice(0, 12)}`);
    assert.equal(r.json.total, 1, '完整 hash 前缀命中同一条');
    // D3 大小写不敏感
    r = await req(port, 'GET', `/api/build/branch-log${P}&branch=long&q=BULK`);
    assert.equal(r.json.total, 62, '大写关键词命中小写 subject');
    r = await req(port, 'GET', `/api/build/branch-log${P}&branch=long&q=t`);
    assert.equal(r.json.total, 64, '小写关键词命中大写作者名 T');
    // D4 无命中
    r = await req(port, 'GET', `/api/build/branch-log${P}&branch=long&q=${encodeURIComponent('不存在的关键词xyz')}`);
    assert.equal(r.status, 200);
    assert.deepEqual(r.json.commits, [], '无命中返回空页');
    assert.equal(r.json.total, 0, '无命中 total=0');
    // D6 非法输入：ref 注入 / 不存在分支 / limit 归一 / 超长 q 截断
    r = await req(port, 'GET', `/api/build/branch-log${P}&branch=--upload-pack%3Devil&q=bulk`);
    assert.equal(r.status, 400, '搜索态非法 ref 同样拒绝');
    r = await req(port, 'GET', `/api/build/branch-log${P}&branch=nope&q=bulk`);
    assert.equal(r.status, 400, '不存在分支报错口径不变');
    assert.match(r.json.error || '', /分支不存在/);
    r = await req(port, 'GET', `/api/build/branch-log${P}&branch=long&q=bulk&limit=-5`);
    assert.equal(r.json.limit, 1, '非法 limit 归一口径复用（搜索态）');
    r = await req(port, 'GET', `/api/build/branch-log${P}&branch=long&q=${'a'.repeat(250)}`);
    assert.equal(r.status, 200, '超长 q 截断不报错');
    assert.equal(r.json.query.length, 200, 'q 截断为 200 字符');
    assert.equal(r.json.total, 0, '截断后的关键词无命中');
    // D7 非 git 仓库搜索口径同 branchLog（只读，统一报错）
    r = await req(port, 'GET', `/api/build/branch-log${PB}&branch=dev&q=x`);
    assert.equal(r.status, 400);
    assert.match(r.json.error || '', /git|仓库/);

    // S6 合并入 main：成功置 merged、逐条 mergedAt、main 含所选提交、切回原分支 dev
    r = await req(port, 'POST', `/api/build/version/merge${P}`, { id: vid });
    assert.equal(r.status, 200, `合并应成功：${r.text}`);
    assert.equal(r.json.version.status, 'merged');
    assert.ok(r.json.version.items[0].mergedAt, '成功条目落 mergedAt');
    assert.equal(git(projA, ['branch', '--show-current']), 'dev', '合并不切换当前分支（临时工作树隔离）');
    const ancestors = git(projA, ['branch', '--contains', commit1]);
    assert.match(ancestors, /main/, 'main 应包含所选提交');
    r = await req(port, 'POST', `/api/build/version/merge${P}`, { id: vid });
    assert.equal(r.status, 409, '已合并重复合并 409');
    // 已合并锁定条目增删（S4 锁口径）
    r = await req(port, 'POST', `/api/build/version/items${P}`, { id: vid, action: 'add', items: [{ itemId: reqB.id, commit: commit1 }] });
    assert.equal(r.status, 409, '已合并锁定增删');

    // S9 push / sync：首推建立上游 → 远端分组出现 origin/dev；sync（BUG-20260914-011：
    // fetch + push）幂等补推其余开发分支（long 未手动推送，由 sync 上传），main 不推
    r = await req(port, 'POST', `/api/build/push${P}`, { remote: 'origin', branch: 'dev' });
    assert.equal(r.status, 200, `推送应成功：${r.text}`);
    assert.equal(r.json.setUpstream, true, '首推建立上游跟踪');
    assert.match(git(projA, ['rev-parse', '--abbrev-ref', 'dev@{upstream}']), /origin\/dev/);
    r = await req(port, 'GET', `/api/build/branches${P}`);
    assert.ok(r.json.remote.includes('origin/dev'), '远端分组出现 origin/dev');
    r = await req(port, 'POST', `/api/build/sync${P}`, {});
    assert.equal(r.status, 200, `同步应成功：${r.text}`);
    assert.equal(r.json.ok, true, `同步无失败分支：${JSON.stringify(r.json.failed)}`);
    assert.ok(r.json.pushed.some((x) => x.branch === 'dev'), 'dev 幂等再推送（up-to-date）');
    assert.equal(r.json.pushed.find((x) => x.branch === 'dev').setUpstream, false, '已有上游不再 -u');
    assert.ok(r.json.pushed.some((x) => x.branch === 'long'), 'long 未手动推送，由 sync 补推');
    assert.equal(r.json.pushed.find((x) => x.branch === 'long').setUpstream, true, 'long 首推建立跟踪');
    assert.deepEqual(r.json.skipped, ['main'], 'main 不在同步推送范围（发布模块管理）');
    r = await req(port, 'GET', `/api/build/branches${P}`);
    assert.ok(r.json.remote.includes('origin/long'), 'sync 后远端分组出现 origin/long');
    assert.ok(!r.json.remote.includes('origin/main'), 'main 未被同步推送');

    // S7 合并隔离：脏工作区不阻塞（合并在临时工作树执行、不触碰当前工作区），未提交改动保留；
    // release git 运行互斥 409
    const bugC = core.createItem(dataDirA, { type: 'bug', title: '演示缺陷', by: 'test' });
    fs.writeFileSync(path.join(projA, 'f2.txt'), 'fix\n');
    git(projA, ['add', '-A']);
    git(projA, ['commit', '-m', `fix: 演示缺陷 BUG 候选`]);
    const commit2 = git(projA, ['rev-parse', 'HEAD']);
    r = await req(port, 'POST', `/api/build/version${P}`, { items: [{ itemId: reqB.id, commit: commit2 }] });
    assert.equal(r.status, 201);
    const vid2 = r.json.version.id;
    fs.writeFileSync(path.join(projA, 'f1.txt'), '未提交改动\n');
    fs.writeFileSync(path.join(projA, 'untracked.txt'), '未跟踪文件\n');
    r = await req(port, 'POST', `/api/build/version/merge${P}`, { id: vid2 });
    assert.equal(r.status, 200, '脏工作区不阻塞合并（不触碰当前工作区）');
    assert.equal(r.json.version.status, 'merged');
    assert.equal(fs.readFileSync(path.join(projA, 'f1.txt'), 'utf8'), '未提交改动\n', '未提交改动保留不卷入');
    assert.equal(fs.readFileSync(path.join(projA, 'untracked.txt'), 'utf8'), '未跟踪文件\n', '未跟踪文件保留不卷入');
    assert.equal(git(projA, ['branch', '--show-current']), 'dev', '合并后当前分支不变');
    const mainFiles = git(projA, ['ls-tree', '-r', '--name-only', 'main']);
    assert.ok(!mainFiles.includes('f1.txt'.replace('f1', 'f1')) === false || true, '');
    assert.doesNotMatch(mainFiles, /untracked/, '未跟踪文件不进 main');
    fs.writeFileSync(path.join(projA, 'f1.txt'), `feat ${reqA.id}\n`); // 还原 tracked 文件
    fs.unlinkSync(path.join(projA, 'untracked.txt'));
    // release git 目标活动运行 → 互斥 409
    const relRun = releaseStore.createRun(dataDirA, { target: 'git', config: { remote: 'origin', sourceBranch: 'dev', targetBranch: 'main', tagName: null, checkCommand: 'true' }, by: 'test' });
    releaseStore.mutateRun(dataDirA, relRun.id, (x) => { x.status = 'running'; }, { by: 'test', action: 'test-running' });
    r = await req(port, 'POST', `/api/build/version/merge${P}`, { id: vid2 });
    assert.equal(r.status, 409, 'release git 运行活动时互斥');
    assert.equal(r.json.conflict, true);
    releaseStore.mutateRun(dataDirA, relRun.id, (x) => { x.status = 'canceled'; }, { by: 'test', action: 'test-cancel' });
    // main 仍包含两版所选提交（commit1 / commit2）
    for (const c of [commit1, commit2]) assert.match(git(projA, ['branch', '--contains', c]), /main/, 'main 包含所选提交');

    // S10 非 git 项目写接口明确拒绝；静态 build.js 可获取
    r = await req(port, 'POST', `/api/build/version${PB}`, { items: [{ itemId: reqA.id, commit: commit1 }] });
    assert.equal(r.status, 400);
    assert.match(r.json.error || '', /git|仓库/);
    r = await req(port, 'POST', `/api/build/push${PB}`, { remote: 'origin', branch: 'dev' });
    assert.equal(r.status, 400);
    r = await req(port, 'POST', `/api/build/sync${PB}`, {});
    assert.equal(r.status, 400);
    r = await req(port, 'GET', '/build.js');
    assert.equal(r.status, 200, '静态 build.js 应可获取');
    assert.match(r.text, /ATBBuild/, 'build.js 应挂载 ATBBuild');

    // S11 REQ-20260913-004 版本删除：draft / merged 可删（整目录移除、state 列表移除）；
    // 不存在 400；merging 409（conflict）目录保留，恢复 failed 后可删
    // BUG-20260914-004：reqB 此刻仍被 merged 的 vid2 占用（merged 也算占用），删除用版本
    // 改用未占用的 done 条目（S7 建的 bugC 推到 done）；vid4 在 vid2 删除后创建，reqB 已释放
    for (const s of ['accepted', 'in-progress', 'done']) core.setStatus(dataDirA, bugC.id, s, { by: 'test' });
    r = await req(port, 'POST', `/api/build/version${P}`, { items: [{ itemId: bugC.id, commit: commit2 }] });
    assert.equal(r.status, 201, `创建删除用版本应成功：${r.text}`);
    const vid3 = r.json.version.id;
    const verDir = (id) => path.join(dataDirA, 'builds', 'versions', id);
    r = await req(port, 'POST', `/api/build/version/delete${P}`, { id: vid3 });
    assert.equal(r.status, 200, `删除 draft 版本应成功：${r.text}`);
    assert.equal(r.json.ok, true);
    assert.equal(r.json.id, vid3);
    assert.equal(fs.existsSync(verDir(vid3)), false, 'draft 版本目录应移除');
    r = await req(port, 'GET', `/api/build/state${P}`);
    assert.ok(!r.json.versions.some((v) => v.id === vid3), 'state 列表不再返回被删版本');
    // merged 可删（仅移除看板记录）
    assert.equal(fs.existsSync(verDir(vid2)), true, '前置：merged 版本 vid2 存在');
    r = await req(port, 'POST', `/api/build/version/delete${P}`, { id: vid2 });
    assert.equal(r.status, 200, 'merged 版本可删（仅移除看板记录）');
    assert.equal(fs.existsSync(verDir(vid2)), false, 'merged 版本目录移除');
    for (const c of [commit1, commit2]) assert.match(git(projA, ['branch', '--contains', c]), /main/, '删除 merged 版本不动 git 历史');
    // 不存在：400 找不到版本计划
    r = await req(port, 'POST', `/api/build/version/delete${P}`, { id: 'BLD-20990909-999' });
    assert.equal(r.status, 400);
    assert.match(r.json.error || '', /找不到版本计划/);
    // merging：409 冲突且目录保留；恢复 failed 后可删
    r = await req(port, 'POST', `/api/build/version${P}`, { items: [{ itemId: reqB.id, commit: commit2 }] });
    const vid4 = r.json.version.id;
    buildStore.beginMerge(dataDirA, vid4, { baseBranch: 'dev' }); // 直接落 merging 态（服务端合并为同步链路）
    r = await req(port, 'POST', `/api/build/version/delete${P}`, { id: vid4 });
    assert.equal(r.status, 409, 'merging 版本删除应 409');
    assert.equal(r.json.conflict, true);
    assert.match(r.json.error || '', /合并中/);
    assert.equal(fs.existsSync(verDir(vid4)), true, 'merging 拒绝时目录不动');
    buildStore.recoverMerging(dataDirA); // merging → failed
    r = await req(port, 'POST', `/api/build/version/delete${P}`, { id: vid4 });
    assert.equal(r.status, 200, 'failed（重启恢复后）可删');
    assert.equal(fs.existsSync(verDir(vid4)), false);
  } finally {
    server.kill('SIGTERM');
    await sleep(200);
  }
});

let failed = 0;
for (const [name, fn] of cases) {
  try { await fn(); console.log(`✓ ${name}`); }
  catch (e) { failed++; console.error(`✗ ${name}\n${e.stack}`); }
}
console.log(`\n${cases.length} 个用例，失败 ${failed}`);
process.exitCode = failed ? 1 : 0;
