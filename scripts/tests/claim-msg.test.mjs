#!/usr/bin/env node
// BUG-20260903-004 —— claim 成功提示与网页 403 文案须与实际流转一致（对齐闸门已取消）
// 用法：node scripts/tests/claim-msg.test.mjs

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as core from '../lib/core.mjs';

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const atbCli = path.join(pluginRoot, 'scripts', 'atb.mjs');

// ---------- 环境 ----------
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'atb-claimmsg-'));
fs.mkdirSync(path.join(tmp, 'proj'), { recursive: true });
const project = fs.realpathSync(path.join(tmp, 'proj'));
core.initData(project);
const dataDir = core.dataDirFrom(project);

const registryFile = path.join(tmp, 'projects.json');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const mkAccepted = (title) => {
  const it = core.createItem(dataDir, { type: 'requirement', title, by: 'test' });
  core.setStatus(dataDir, it.id, 'accepted', { by: 'human' });
  return it.id;
};

function runCli(args) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [atbCli, ...args, '--dir', project], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '', err = '';
    p.stdout.on('data', (c) => { out += c; });
    p.stderr.on('data', (c) => { err += c; });
    p.on('close', (code) => resolve({ code, out, err }));
  });
}

function request(method, url, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = http.request(
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
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}
const post = (url, body, expect = 200) => request('POST', url, body ?? {}).then((r) => {
  assert.equal(r.status, expect, `POST ${url} → ${r.status}：${JSON.stringify(r.json)}`);
  return r.json;
});

let serverProc = null;
let base = '';
async function tryStartServer(port) {
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
      if (r.status === 200) return { proc, base: `http://127.0.0.1:${port}` };
    } catch {}
    if (proc.exitCode !== null) throw new Error(`server 提前退出: ${err}`);
  }
  proc.kill();
  throw new Error(`server 启动超时: ${err}`);
}

const cases = [];
const t = (name, fn) => cases.push([name, fn]);

t('C1 claim 成功提示与实际流转一致：状态 in-progress，可直接实施', async () => {
  const id = mkAccepted('提示一致');
  const r = await runCli(['claim', id, '--by', 'test-session']);
  assert.equal(r.code, 0, `claim 应成功：${r.err}`);
  assert.match(r.out, /状态 in-progress/, '提示应含实际状态 in-progress');
  assert.match(r.out, /可直接实施/, '提示应说明可直接实施');
  assert.ok(!r.out.includes('待对齐'), '不应再出现「待对齐」措辞');
  assert.ok(!r.out.includes('对齐确认'), '不应再引导人工对齐确认');
  const st = JSON.parse(fs.readFileSync(path.join(core.resolveItemDir(dataDir, id).dir, 'status.json'), 'utf8'));
  assert.equal(st.status, 'in-progress', '实际状态应为 in-progress');
  assert.equal(st.owner, 'test-session');
  // BUG-20260906-002：claim 即占用项目实施互斥；用例结束 report 收尾，释放占用供后续用例造数
  core.report(dataDir, id, { summary: '完成', by: 'test-session' });
});

t('C2 存量 pending-alignment 续认：提示如实反映状态，不谎报可直接实施', async () => {
  const it = core.createItem(dataDir, { type: 'requirement', title: '存量续认', by: 'test' });
  const f = path.join(core.resolveItemDir(dataDir, it.id).dir, 'status.json');
  const st = JSON.parse(fs.readFileSync(f, 'utf8'));
  st.status = 'pending-alignment';
  st.owner = 'legacy-session';
  st.history.push({ at: new Date().toISOString(), from: 'accepted', to: 'pending-alignment', by: 'legacy' });
  fs.writeFileSync(f, JSON.stringify(st, null, 2) + '\n');
  const r = await runCli(['claim', it.id, '--by', 'legacy-session']);
  assert.equal(r.code, 0, `续认应成功：${r.err}`);
  assert.match(r.out, /pending-alignment/, '续认应如实提示当前状态');
  assert.ok(!r.out.includes('可直接实施'), '存量条目未人工放行，不应提示可直接实施');
  assert.ok(!r.out.includes('对齐确认'), '不应再引导人工对齐确认');
});

t('C3 server：accepted→in-progress 403 提示引导 atb claim，不再提对齐确认', async () => {
  const id = mkAccepted('网页提示');
  const r = await post(`${base}/api/item/${id}/status`, { to: 'in-progress' }, 403);
  assert.ok(!String(r.error).includes('对齐确认'), '不应再引导点「对齐确认」（按钮已取消）');
  assert.ok(!String(r.error).includes('待对齐'), '不应再出现「待对齐」措辞');
  assert.match(String(r.error), /atb claim/, '应引导 Agent 走 CLI 认领');
});

let failed = 0;
try {
  for (const port of [29541, 29741, 29941]) {
    try {
      const r = await tryStartServer(port);
      serverProc = r.proc;
      base = r.base;
      break;
    } catch (e) {
      if (port === 29941) throw e;
    }
  }
  for (const [name, fn] of cases) {
    try {
      await fn();
      console.log(`✓ ${name}`);
    } catch (e) {
      failed++;
      console.error(`✗ ${name}\n    ${String(e.message).split('\n')[0]}`);
    }
  }
} finally {
  if (serverProc) serverProc.kill();
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
}
console.log(failed ? `\n${failed} 个用例未通过` : '\n全部通过');
process.exit(failed ? 1 : 0);
