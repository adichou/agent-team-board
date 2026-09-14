#!/usr/bin/env node
// REQ-20260907-001 Oncall 咨询看板 —— codex 后台派发端到端测试（D1~D3）
// 覆盖：fake-codex 正常路径自动回传、失败路径 failed+重派、串行执行、不占 impl.lock
// 用法：node scripts/tests/oncall-dispatch.test.mjs

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function req(port, method, pathname, body) {
  return new Promise((resolve, reject) => {
    const payload = body == null ? null : JSON.stringify(body);
    const r = http.request({
      hostname: '127.0.0.1', port, path: pathname, method,
      headers: payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {},
      timeout: 8000,
    }, (rs) => {
      let out = '';
      rs.on('data', (c) => { out += c; });
      rs.on('end', () => { try { resolve({ status: rs.statusCode, json: JSON.parse(out || '{}') }); } catch { resolve({ status: rs.statusCode, json: null, raw: out }); } });
    });
    r.on('error', reject);
    r.on('timeout', () => { r.destroy(); reject(new Error('timeout')); });
    if (payload) r.write(payload);
    r.end();
  });
}

// 无状态假 CLI 包装器（复用 fixtures/fake-codex.mjs；mode.txt 切行为）
function makeFakeCli(initialMode) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'atb-oncall-cli-'));
  const wrapper = path.join(dir, 'fake-codex');
  fs.writeFileSync(wrapper, `#!/bin/sh\nMODE=$(cat "$(dirname "$0")/mode.txt" 2>/dev/null || echo ok)\nexport FAKE_MODE="$MODE"\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(path.join(pluginRoot, 'scripts', 'tests', 'fixtures', 'fake-codex.mjs'))} "$@"\n`, { mode: 0o755 });
  const setMode = (m) => fs.writeFileSync(path.join(dir, 'mode.txt'), m);
  setMode(initialMode);
  return { cliPath: wrapper, setMode, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

async function waitStatus(port, P, id, want, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    const r = await req(port, 'GET', `/api/oncall/ticket/${id}${P}`);
    last = r.json;
    if (r.json && r.json.status === want) return r.json;
    await sleep(300);
  }
  throw new Error(`等待 ${id} 变为 ${want} 超时（当前 ${last && last.status}）`);
}

const cases = [];
const t = (name, fn) => cases.push([name, fn]);

t('D1/D2/D3 codex 派发：自动回传、失败重派、串行、不占 impl.lock', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'atb-oncall-disp-'));
  const root = path.join(tmp, 'proj');
  fs.mkdirSync(root);
  await new Promise((resolve) => {
    const p = spawn(process.execPath, [path.join(pluginRoot, 'scripts', 'atb.mjs'), 'init', '--dir', root], { stdio: 'ignore' });
    p.on('close', resolve);
  });
  // fake 项目不是 git 仓库 → codex 需要 --skip-git-repo-check（oncall 派发允许非 git，与实施派发一致由设置控制）
  const fake = makeFakeCli('ok');
  const port = 32000 + Math.floor(Math.random() * 20000);
  const server = spawn(process.execPath, [path.join(pluginRoot, 'scripts', 'server.mjs')], {
    cwd: root,
    env: { ...process.env, ATB_PORT: String(port), ATB_REGISTRY: path.join(tmp, 'reg.json') },
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

    // 配置 fake CLI + 允许非 git
    let r = await req(port, 'GET', `/api/oncall/board${P}`);
    assert.equal(typeof r.json.codexReady, 'boolean', 'codexReady 应为布尔');
    r = await req(port, 'POST', `/api/dispatch/settings${P}`, { codex: { cliPath: fake.cliPath, allowNonGit: true } });
    assert.equal(r.status, 200, '保存 CLI 配置应成功');
    r = await req(port, 'GET', `/api/oncall/board${P}`);
    assert.equal(r.json.codexReady, true, '配置后 codexReady=true');

    // D1 自动回传
    r = await req(port, 'POST', `/api/oncall/ticket${P}`, { title: '问架构', question: 'core.mjs 的职责是什么？' });
    const a = r.json.id;
    r = await req(port, 'POST', `/api/oncall/ticket${P}`, { title: '问路由', question: 'server 路由表在哪？' });
    const b = r.json.id;
    r = await req(port, 'POST', `/api/oncall/dispatch${P}`, { ids: [a, b], mode: 'codex', staff: '王五' });
    assert.equal(r.status, 200, `codex 批量派单应成功（${JSON.stringify(r.json)}`);
    assert.ok(!r.json.prompt, 'codex 模式不返回 zcode 提示词');
    assert.equal(r.json.dispatched.length, 2);

    const implLock = path.join(root, 'docs', 'agent-team-board', '.locks', 'impl.lock');
    assert.ok(!fs.existsSync(implLock), 'oncall 派单不得占用 impl.lock');

    const done1 = await waitStatus(port, P, a, 'answered');
    assert.equal(done1.rounds[0].mode, 'codex', '回答轮次标注 codex');
    assert.equal(done1.rounds[0].staff, '王五', '客服人员归属展示');
    assert.match(done1.rounds[0].by, /王五/, '来源会话含客服人员');
    const roundRes = await req(port, 'GET', `/api/oncall/ticket/${a}/round/1${P}`);
    assert.match(roundRes.json.answer, /执行完毕/, 'final-message 应自动回传为回答');
    await waitStatus(port, P, b, 'answered');
    assert.ok(!fs.existsSync(implLock), '执行结束后也不得产生 impl.lock');

    // D2 失败路径：auth-error → failed + 原因；重派后恢复
    fake.setMode('auth-error');
    r = await req(port, 'POST', `/api/oncall/ticket${P}`, { title: '会失败的', question: 'q' });
    const c = r.json.id;
    r = await req(port, 'POST', `/api/oncall/dispatch${P}`, { ids: [c], mode: 'codex', staff: '' });
    assert.equal(r.status, 200, '未填客服人员的 codex 派单应成功');
    const failed = await waitStatus(port, P, c, 'failed');
    assert.ok(failed.rounds[0].error, '失败应记录原因');
    assert.match(String(failed.rounds[0].error), /auth|认证/, `原因应含分类（得到 ${failed.rounds[0].error}）`);

    fake.setMode('ok');
    r = await req(port, 'POST', `/api/oncall/redispatch${P}`, { id: c, mode: 'codex', staff: '赵六' });
    assert.equal(r.status, 200, `重派应成功（${JSON.stringify(r.json)}`);
    const redone = await waitStatus(port, P, c, 'answered');
    assert.equal(redone.rounds[0].staff, '赵六', '重派更新客服人员');

    // D3 串行佐证：派单账本与执行记录可见
    r = await req(port, 'GET', `/api/oncall/dispatch/records${P}`);
    assert.equal(r.status, 200);
    assert.ok(r.json.records.length >= 3, '派单账本应含历次派单');
    const codexRecs = r.json.records.filter((x) => x.mode === 'codex');
    assert.equal(codexRecs.length, 3, '三次 codex 派单');
  } finally {
    server.kill();
    fake.cleanup();
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
  }
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
