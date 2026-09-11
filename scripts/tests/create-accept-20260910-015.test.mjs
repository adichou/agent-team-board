#!/usr/bin/env node
// REQ-20260910-015 创建需求 / Bug 支持创建并接受 —— core / CLI / 服务 / 守卫测试 C1–C3、L1–L2、S1–S2、G1–G2。
// 用法：node scripts/tests/create-accept-20260910-015.test.mjs

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import * as core from '../lib/core.mjs';
import { readRefineStates, refineStateOf } from '../lib/refine-states.mjs';

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const atbCli = path.join(pluginRoot, 'scripts', 'atb.mjs');
const guard = path.join(pluginRoot, 'scripts', 'state-guard.mjs');

const cases = [];
const t = (name, fn) => cases.push([name, fn]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tmp = () => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'atb-create-accept-')));

const spawnProc = (cmd, args, cwd, timeoutMs = 30000) => new Promise((resolve) => {
  const p = spawn(cmd, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  let err = '';
  p.stdout.on('data', (c) => { out += c; });
  p.stderr.on('data', (c) => { err += c; });
  const timer = setTimeout(() => { p.kill(); resolve({ code: 124, out, err }); }, timeoutMs);
  p.on('error', (e) => { clearTimeout(timer); resolve({ code: null, err: String(e.message), out }); });
  p.on('close', (code) => { clearTimeout(timer); resolve({ code, out, err }); });
});
const runAtb = (args, cwd) => spawnProc(process.execPath, [atbCli, ...args], cwd);

function req(port, method, pathname, body) {
  return new Promise((resolve, reject) => {
    const payload = body == null ? null : JSON.stringify(body);
    const r = http.request({
      hostname: '127.0.0.1', port, path: pathname, method,
      headers: payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {},
      timeout: 6000,
    }, (rs) => {
      const chunks = [];
      rs.on('data', (c) => chunks.push(c));
      rs.on('end', () => {
        const buf = Buffer.concat(chunks);
        let json = null;
        try { json = JSON.parse(buf.toString() || '{}'); } catch {}
        resolve({ status: rs.statusCode, json, raw: buf.toString() });
      });
    });
    r.on('error', reject);
    r.on('timeout', () => { r.destroy(); reject(new Error('timeout')); });
    if (payload) r.write(payload);
    r.end();
  });
}

// 守卫子进程（bash 模式）：无锁临时目录运行，返回退出码与 stderr
function runGuard(command) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [guard, 'bash'], {
      cwd: fs.mkdtempSync(path.join(os.tmpdir(), 'atb-ca-guard-')),
      env: process.env,
      stdio: ['pipe', 'ignore', 'pipe'],
    });
    let err = '';
    p.stderr.on('data', (c) => { err += c; });
    p.on('close', (code) => resolve({ code, err }));
    p.stdin.write(JSON.stringify({ tool_name: 'Bash', tool_input: { command } }));
    p.stdin.end();
  });
}

const dataDirOf = (root) => path.join(root, 'docs', 'agent-team-board');

/* ---------- C 组：core ---------- */

t('C1 core：accept 一步直达 accepted——status / history 两条 / 文档模板 / refine 未完善', () => {
  const root = tmp();
  core.initData(root);
  const dataDir = dataDirOf(root);

  const st = core.createItem(dataDir, { type: 'requirement', title: '一步接受', description: '描述', by: 'tester', accept: true });
  assert.equal(st.status, 'accepted', '返回状态应为 accepted');
  const dir = core.resolveItemDir(dataDir, st.id).dir;
  const disk = JSON.parse(fs.readFileSync(path.join(dir, 'status.json'), 'utf8'));
  assert.equal(disk.status, 'accepted');
  assert.equal(disk.history.length, 2, 'history 应两条（创建 + 接受）');
  assert.equal(disk.history[0].from, null);
  assert.equal(disk.history[0].to, 'submitted');
  assert.equal(disk.history[1].from, 'submitted');
  assert.equal(disk.history[1].to, 'accepted');
  assert.match(disk.history[1].note, /创建并接受/, '接受条目应可追溯「创建并接受」来源');
  for (const f of ['README.md', 'design.md', 'test-cases.md']) {
    assert.ok(fs.existsSync(path.join(dir, f)), `需求条目应含 ${f}`);
  }
  assert.equal(refineStateOf(dataDir, st.id), 'unrefined', '应进入批量完善候选（未完善）');
  assert.equal(readRefineStates(dataDir)[st.id].reaccepted, undefined, '首次接受不带 reaccepted 标记');

  const bug = core.createItem(dataDir, { type: 'bug', title: '一步接受的 Bug', by: 'tester', accept: true });
  assert.equal(bug.status, 'accepted');
  const bugDir = core.resolveItemDir(dataDir, bug.id).dir;
  for (const f of ['README.md', 'design.md']) {
    assert.ok(fs.existsSync(path.join(bugDir, f)), `Bug 条目应含 ${f}`);
  }
  assert.equal(refineStateOf(dataDir, bug.id), 'unrefined');
});

t('C2 core：与分步接受等价；缺省行为不变（仍 submitted）', () => {
  const root = tmp();
  core.initData(root);
  const dataDir = dataDirOf(root);

  const oneShot = core.createItem(dataDir, { type: 'requirement', title: '一步', by: 'tester', accept: true });
  const stepwise = core.createItem(dataDir, { type: 'requirement', title: '两步', by: 'tester' });
  core.setStatus(dataDir, stepwise.id, 'accepted', { by: 'tester' });

  const a = JSON.parse(fs.readFileSync(path.join(core.resolveItemDir(dataDir, oneShot.id).dir, 'status.json'), 'utf8'));
  const b = JSON.parse(fs.readFileSync(path.join(core.resolveItemDir(dataDir, stepwise.id).dir, 'status.json'), 'utf8'));
  assert.equal(a.status, b.status, '状态一致');
  assert.equal(a.history.length, b.history.length, 'history 条数一致（两条）');
  assert.deepEqual(
    a.history.map((h) => [h.from, h.to]),
    b.history.map((h) => [h.from, h.to]),
    '流转路径一致：null→submitted→accepted'
  );
  assert.equal(refineStateOf(dataDir, oneShot.id), refineStateOf(dataDir, stepwise.id), 'refine 索引一致（未完善）');

  // 缺省（不带 accept）：与现状完全一致
  const plain = core.createItem(dataDir, { type: 'requirement', title: '旧口径', by: 'tester' });
  assert.equal(plain.status, 'submitted');
  const plainDisk = JSON.parse(fs.readFileSync(path.join(core.resolveItemDir(dataDir, plain.id).dir, 'status.json'), 'utf8'));
  assert.equal(plainDisk.history.length, 1, '不带 accept 仍只有一条 history');
  assert.equal(refineStateOf(dataDir, plain.id), null, '不带 accept 不进 refine 索引');
});

t('C3 core：原子性——接受环节写状态失败时回滚删除条目目录，不留半成品', () => {
  const root = tmp();
  core.initData(root);
  const dataDir = dataDirOf(root);
  const reqRoot = path.join(dataDir, 'requirements');
  const before = fs.readdirSync(reqRoot).length;

  const orig = fs.writeFileSync;
  fs.writeFileSync = function (f, d, ...rest) {
    // 第二次 status.json 写入（accepted）注入失败
    if (String(f).startsWith(dataDir) && String(d).includes('"status": "accepted"')) {
      throw new Error('injected accept failure');
    }
    return orig.call(fs, f, d, ...rest);
  };
  try {
    assert.throws(
      () => core.createItem(dataDir, { type: 'requirement', title: '失败回滚', by: 'tester', accept: true }),
      /injected accept failure/
    );
  } finally {
    fs.writeFileSync = orig;
  }
  assert.equal(fs.readdirSync(reqRoot).length, before, '失败不得留下条目目录（回滚删除）');
});

/* ---------- L 组：CLI ---------- */

t('L1 CLI：atb new req|bug --accept 一步创建并接受', async () => {
  const root = tmp();
  assert.equal((await runAtb(['init', '--dir', root], root)).code, 0);
  const dataDir = dataDirOf(root);

  const r1 = await runAtb(['new', 'req', '一步直达的需求', '--accept', '--dir', root], root);
  assert.equal(r1.code, 0, `应成功（err=${r1.err}）`);
  assert.match(r1.out, /已接受/, '输出应明确提示已接受');
  assert.doesNotMatch(r1.out, /等待人工接受/, '不应再提示等待人工接受');
  const reqIds = fs.readdirSync(path.join(dataDir, 'requirements'));
  assert.equal(reqIds.length, 1, '应只创建一个需求条目');
  const st1 = JSON.parse(fs.readFileSync(path.join(dataDir, 'requirements', reqIds[0], 'status.json'), 'utf8'));
  assert.equal(st1.status, 'accepted');
  assert.equal(refineStateOf(dataDir, reqIds[0]), 'unrefined');

  const r2 = await runAtb(['new', 'bug', '一步直达的Bug', '--desc', '现象', '--accept', '--dir', root], root);
  assert.equal(r2.code, 0);
  assert.match(r2.out, /已接受/);
  const bugIds = fs.readdirSync(path.join(dataDir, 'bugs'));
  assert.equal(bugIds.length, 1, '应只创建一个 Bug 条目');
  const st2 = JSON.parse(fs.readFileSync(path.join(dataDir, 'bugs', bugIds[0], 'status.json'), 'utf8'));
  assert.equal(st2.status, 'accepted');
});

t('L2 CLI：不带 --accept 输出与现状一致；USAGE 帮助含 --accept', async () => {
  const root = tmp();
  assert.equal((await runAtb(['init', '--dir', root], root)).code, 0);
  const dataDir = dataDirOf(root);

  const r = await runAtb(['new', 'req', '普通创建', '--dir', root], root);
  assert.equal(r.code, 0);
  assert.match(r.out, /状态 submitted/, '不带开关仍提示 submitted');
  assert.match(r.out, /等待人工接受/, '不带开关仍提示等待人工接受');
  const reqIds = fs.readdirSync(path.join(dataDir, 'requirements'));
  const st = JSON.parse(fs.readFileSync(path.join(dataDir, 'requirements', reqIds[0], 'status.json'), 'utf8'));
  assert.equal(st.status, 'submitted');

  const h = await runAtb([], tmp());
  assert.equal(h.code, 0);
  assert.match(h.out, /--accept/, 'USAGE 应说明 --accept 开关');
});

/* ---------- S 组：server ---------- */

t('S1 server：/api/new accept:true 一步 accepted（含附件照常落盘 + README 引用）', async () => {
  const root = tmp();
  assert.equal((await runAtb(['init', '--dir', root], root)).code, 0);
  const port = 31000 + Math.floor(Math.random() * 20000);
  const server = spawn(process.execPath, [path.join(pluginRoot, 'scripts', 'server.mjs')], {
    cwd: root,
    env: { ...process.env, ATB_PORT: String(port), ATB_REGISTRY: path.join(root, '..', 'reg.json') },
    stdio: ['ignore', 'ignore', 'ignore'],
  });
  const P = `?project=${encodeURIComponent(root)}`;
  try {
    let up = false;
    for (let i = 0; i < 40; i++) {
      await sleep(150);
      try { await req(port, 'GET', '/api/health'); up = true; break; } catch {}
    }
    assert.ok(up, '服务应启动');

    let r = await req(port, 'POST', `/api/new${P}`, {
      type: 'req', title: '创建并接受的需求', description: '见截图', accept: true,
      attachments: [{ name: 'a.png', dataBase64: Buffer.from('png').toString('base64') }],
    });
    assert.equal(r.status, 201, `创建应成功（得到 ${r.status} ${JSON.stringify(r.json)}`);
    assert.equal(r.json.status, 'accepted', '返回状态应为 accepted');
    const dataDir = dataDirOf(root);
    const id = r.json.id;
    const dir = path.join(dataDir, 'requirements', id);
    const disk = JSON.parse(fs.readFileSync(path.join(dir, 'status.json'), 'utf8'));
    assert.equal(disk.status, 'accepted');
    assert.equal(disk.history.length, 2, 'history 可追溯两步');
    assert.match(disk.history[1].note, /创建并接受/);
    assert.ok(fs.existsSync(path.join(dir, 'attachments', 'a.png')), '附件应照常落盘');
    assert.match(fs.readFileSync(path.join(dir, 'README.md'), 'utf8'), /!\[截图\]\(attachments\/a\.png\)/, 'README 应有引用行');
    assert.equal(refineStateOf(dataDir, id), 'unrefined', 'refine 索引未完善');
  } finally {
    server.kill('SIGTERM');
  }
});

t('S2 server：缺省 / accept:false / accept:"true"（非严格布尔）均落 submitted；非法附件 + accept 整单拒绝', async () => {
  const root = tmp();
  assert.equal((await runAtb(['init', '--dir', root], root)).code, 0);
  const port = 31000 + Math.floor(Math.random() * 20000);
  const server = spawn(process.execPath, [path.join(pluginRoot, 'scripts', 'server.mjs')], {
    cwd: root,
    env: { ...process.env, ATB_PORT: String(port), ATB_REGISTRY: path.join(root, '..', 'reg.json') },
    stdio: ['ignore', 'ignore', 'ignore'],
  });
  const P = `?project=${encodeURIComponent(root)}`;
  try {
    let up = false;
    for (let i = 0; i < 40; i++) {
      await sleep(150);
      try { await req(port, 'GET', '/api/health'); up = true; break; } catch {}
    }
    assert.ok(up, '服务应启动');
    const dataDir = dataDirOf(root);

    let r = await req(port, 'POST', `/api/new${P}`, { type: 'req', title: '旧客户端无字段' });
    assert.equal(r.status, 201);
    assert.equal(r.json.status, 'submitted', '缺省仍 submitted');

    r = await req(port, 'POST', `/api/new${P}`, { type: 'req', title: '显式false', accept: false });
    assert.equal(r.status, 201);
    assert.equal(r.json.status, 'submitted', 'accept:false 仍 submitted');

    r = await req(port, 'POST', `/api/new${P}`, { type: 'req', title: '字符串true', accept: 'true' });
    assert.equal(r.status, 201);
    assert.equal(r.json.status, 'submitted', '非严格布尔 true 不生效（旧客户端零影响）');

    const reqRoot = path.join(dataDir, 'requirements');
    const before = fs.readdirSync(reqRoot).length;
    r = await req(port, 'POST', `/api/new${P}`, {
      type: 'bug', title: '非法附件整单拒绝', accept: true,
      attachments: [{ name: 'x.sh', dataBase64: 'eA==' }],
    });
    assert.equal(r.status, 400, '非法附件应 400');
    assert.equal(fs.readdirSync(reqRoot).length, before, '被拒不得留下条目目录');
  } finally {
    server.kill('SIGTERM');
  }
});

/* ---------- G 组：state-guard ---------- */

t('G1 守卫：atb new … --accept（含拆词与 =true 形态）被拦；无开关放行', async () => {
  const denies = [
    'atb new req 标题 --accept',
    `node ${atbCli} new bug 标题 --accept`,
    'atb new req 标题 --ac""cept',
    'atb new req 标题 --accept=true',
    `node ${atbCli} --dir /tmp/x new req 标题 --accept`,
  ];
  for (const command of denies) {
    const r = await runGuard(command);
    assert.equal(r.code, 2, `应拦截（${command}）`);
    assert.match(r.err, /人工|accepted/, '提示应含人工专属指引');
  }
  const allows = [
    'atb new req 标题',
    `node ${atbCli} new bug 标题 --desc 描述`,
    'atb new req 标题 --accept=false', // 无效开关（CLI 不生效），不构成越权
  ];
  for (const command of allows) {
    const r = await runGuard(command);
    assert.equal(r.code, 0, `应放行（${command}）：${r.err}`);
  }
});

t('G2 守卫：curl 调 /api/new 携带 accept:true / accept=true 被拦；不带或 false 放行', async () => {
  const denies = [
    `curl -s -X POST http://127.0.0.1:7736/api/new -H 'Content-Type: application/json' -d '{"type":"req","title":"x","accept":true}'`,
    `curl -s -X POST http://127.0.0.1:8888/api/new -d '{"type":"req","accept": true}'`,
    `curl -s -X POST http://127.0.0.1:7736/api/new -d accept=true`,
  ];
  for (const command of denies) {
    const r = await runGuard(command);
    assert.equal(r.code, 2, `应拦截（${command}）`);
    assert.match(r.err, /人工|accepted/, '提示应含人工专属指引');
  }
  const allows = [
    `curl -s -X POST http://127.0.0.1:7736/api/new -H 'Content-Type: application/json' -d '{"type":"req","title":"x"}'`,
    `curl -s -X POST http://127.0.0.1:7736/api/new -d '{"type":"req","accept":false}'`,
  ];
  for (const command of allows) {
    const r = await runGuard(command);
    assert.equal(r.code, 0, `应放行（${command}）：${r.err}`);
  }
});

let failed = 0;
for (const [name, fn] of cases) {
  try { await fn(); console.log(`✓ ${name}`); }
  catch (e) { failed++; console.error(`✗ ${name}\n${e.stack}`); }
}
console.log(`\n${cases.length} 个用例，失败 ${failed}`);
process.exitCode = failed ? 1 : 0;
