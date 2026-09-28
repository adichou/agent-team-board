#!/usr/bin/env node
// BUG-20260928-006 官网资料更新的 AI 提示词的版本号不对 —— TDD 分层测试。
// 引入来源：REQ-20260922-006（版本号改独立 x.y.z 字段，验收口径「发布文档 AI 总结 / 翻译 /
// 官网提示词中的版本号同源」；实现只改了显示与 publish-plan versionNumber，server 调用
// buildSiteWritingPrompt 未传计划 version，提示词仍内嵌 planId 派生的 YYYYMMDD-NNN）。
// 覆盖：
//   L1 纯逻辑（publish-flow.buildSiteWritingPrompt）：
//      传入 version（x.y.z）→ 提示词两处版本号均取 x.y.z，不再出现派生 YYYYMMDD-NNN；
//      未传 version（存量计划口径）→ 沿用计划编号派生（YYYYMMDD-NNN，不迁移数据）。
//   L2 服务层（真实 server + 官网配置 ATB_BUILD_PUBLISH_CONFIG）：
//      GET /api/build/publish-plan —— 新计划（version 1.2.3）sitePrompt 含「版本号 1.2.3」
//      且不含派生编号；存量计划（version.json 删除 version 字段）sitePrompt 回退派生编号。
//   L3 源码契约：server.mjs 调用 buildSiteWritingPrompt 时传入计划的 version 字段。
// 用法：node scripts/tests/bug-20260928-006.test.mjs

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as core from '../lib/core.mjs';
import * as buildStore from '../lib/build-store.mjs';
import * as flow from '../lib/publish-flow.mjs';

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const cases = [];
const t = (name, fn) => cases.push([name, fn]);

const H1 = 'a'.repeat(40);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------- L1 纯逻辑 ---------- */

t('L1-1 版本号同源：传入 version（x.y.z）时提示词版本号取 x.y.z，两处（首行 + 运行参数）不再用计划编号派生', () => {
  const p = flow.buildSiteWritingPrompt({
    projectRoot: '/tmp/projX',
    siteRoot: '/tmp/siteX',
    planId: 'BLD-20260927-001',
    baseline: H1,
    version: '1.0.0',
  });
  const hits = p.split('版本号 1.0.0').length - 1;
  assert.ok(hits >= 2, `提示词首行与运行参数两处均应含「版本号 1.0.0」（实际 ${hits} 处）`);
  assert.ok(!p.includes('版本号 20260927-001'), '不应再出现派生口径「版本号 20260927-001」');
  assert.ok(p.includes('BLD-20260927-001'), '完整计划号仍保留（提交消息匹配依据）');
  assert.ok(p.includes(H1.slice(0, 7)), '已发布基准仍随提示词给出');
});

t('L1-2 存量回退：未传 version 时沿用计划编号派生口径（YYYYMMDD-NNN，REQ-20260922-006 旧数据不迁移）', () => {
  const p = flow.buildSiteWritingPrompt({
    projectRoot: '/tmp/projX',
    siteRoot: '/tmp/siteX',
    planId: 'BLD-20260927-001',
  });
  assert.ok(p.includes('版本号 20260927-001'), '存量口径应回退派生 YYYYMMDD-NNN');
  assert.ok(!p.includes('1.0.0'), '未传 version 时不应出现 x.y.z 猜测值');
});

/* ---------- L2 服务层（真实 server） ---------- */

function git(cwd, args) {
  return String(execFileSync('git', ['-c', 'user.email=t@e.co', '-c', 'user.name=T', ...args], {
    cwd, encoding: 'utf8',
    env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', HOME: cwd },
  })).trim();
}

function reqJson(port, method, pathname, body) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const r = http.request({
      hostname: '127.0.0.1', port, path: pathname, method,
      headers: payload ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) } : {},
      timeout: 8000,
    }, (rs) => {
      let out = '';
      rs.on('data', (c) => { out += c; });
      rs.on('end', () => {
        try { resolve({ status: rs.statusCode, json: JSON.parse(out || '{}'), text: out }); }
        catch { resolve({ status: rs.statusCode, json: null, text: out }); }
      });
    });
    r.on('error', reject);
    r.on('timeout', () => { r.destroy(); reject(new Error('timeout')); });
    if (payload) r.write(payload);
    r.end();
  });
}

t('L2 服务层：publish-plan sitePrompt 新计划取 x.y.z、存量计划回退派生（真实 server + 官网配置）', async () => {
  const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'atb-bug-060028006-')));
  // 项目仓库（dev 分支一条提交供计划范围引用）
  const proj = path.join(tmp, 'proj');
  fs.mkdirSync(proj);
  git(proj, ['init', '-b', 'main']);
  fs.writeFileSync(path.join(proj, 'a.txt'), 'a\n');
  git(proj, ['add', '-A']);
  git(proj, ['commit', '-m', 'init']);
  git(proj, ['switch', '-c', 'dev']);
  core.initData(proj);
  const dataDir = core.dataDirFrom(proj);
  const it = core.createItem(dataDir, { type: 'requirement', title: '演示一', by: 'test' });
  const it2 = core.createItem(dataDir, { type: 'requirement', title: '演示二', by: 'test' });
  for (const x of [it, it2]) {
    for (const s of ['accepted', 'in-progress']) core.setStatus(dataDir, x.id, s, { by: 'test' });
  }
  fs.writeFileSync(path.join(proj, 'f1.txt'), `feat ${it.id}\n`);
  git(proj, ['add', '-A']);
  git(proj, ['commit', '-m', `feat: 演示 ${it.id}`]);
  const c1 = git(proj, ['rev-parse', 'HEAD']);
  // 新计划（x.y.z）；跨版本占用校验（BUG-20260914-004）要求两计划各用独立条目
  const vNew = buildStore.createVersion(dataDir, { items: [{ itemId: it.id, commit: c1 }], version: '1.2.3' });
  const vOld = buildStore.createVersion(dataDir, { items: [{ itemId: it2.id, commit: c1 }], version: '1.2.4' });
  // 存量计划：删除 version 字段模拟旧数据（REQ-20260922-006 不迁移口径）
  const vfOld = path.join(dataDir, 'runtime', 'builds', 'versions', vOld.id, 'version.json');
  const rawOld = JSON.parse(fs.readFileSync(vfOld, 'utf8'));
  delete rawOld.version; // 模拟存量计划（REQ-20260922-006 旧数据回退口径）
  fs.writeFileSync(vfOld, JSON.stringify(rawOld, null, 2));

  // 官网仓库（git 仓库 + main 分支）+ 构建发布配置（ATB_BUILD_PUBLISH_CONFIG 注入）
  const site = path.join(tmp, 'site');
  fs.mkdirSync(site);
  git(site, ['init', '-b', 'main']);
  fs.writeFileSync(path.join(site, 'index.html'), '<html></html>\n');
  git(site, ['add', '-A']);
  git(site, ['commit', '-m', 'site init']);
  const cfgFile = path.join(tmp, 'build-publish.json');
  fs.writeFileSync(cfgFile, JSON.stringify({ homepageRepoRoot: site, revision: 1 }, null, 2));

  const reg = path.join(tmp, 'reg.json');
  const spawnOnPort = async (port) => {
    const child = spawn(process.execPath, [path.join(pluginRoot, 'scripts', 'server.mjs')], {
      cwd: proj,
      env: { ...process.env, ATB_PORT: String(port), ATB_REGISTRY: reg, ATB_BUILD_PUBLISH_CONFIG: cfgFile },
      stdio: ['ignore', 'ignore', 'ignore'],
    });
    for (let i = 0; i < 40; i++) {
      await sleep(150);
      try {
        const h = await reqJson(port, 'GET', '/api/health');
        if (h.json && h.json.port === port) return child;
      } catch {}
      if (child.exitCode !== null) break;
    }
    child.kill('SIGTERM');
    return null;
  };
  let server = null;
  let port = 0;
  for (let i = 0; i < 6 && !server; i++) {
    port = 32000 + Math.floor(Math.random() * 20000);
    server = await spawnOnPort(port);
  }
  assert.ok(server, `服务应启动（最后端口 ${port}）`);
  const P = `?project=${encodeURIComponent(proj)}`;
  try {
    // 新计划：sitePrompt 版本号取 x.y.z（与 versionNumber 同源）
    const r1 = await reqJson(port, 'GET', `/api/build/publish-plan${P}&id=${vNew.id}`);
    assert.equal(r1.status, 200, `publish-plan 应 200：${r1.text}`);
    assert.ok(r1.json.sitePrompt, '已配置官网仓库时 sitePrompt 应非空');
    assert.equal(r1.json.versionNumber, '1.2.3');
    assert.ok(r1.json.sitePrompt.includes('版本号 1.2.3'), `sitePrompt 应含「版本号 1.2.3」：\n${r1.json.sitePrompt}`);
    assert.ok(!r1.json.sitePrompt.includes(`版本号 ${vNew.id.replace(/^BLD-/, '')}`), 'sitePrompt 不应再含计划编号派生的版本号');
    // 存量计划：删除 version 字段后 sitePrompt 回退派生口径
    const r2 = await reqJson(port, 'GET', `/api/build/publish-plan${P}&id=${vOld.id}`);
    assert.equal(r2.status, 200, `存量计划 publish-plan 应 200：${r2.text}`);
    const derived = vOld.id.replace(/^BLD-/, '');
    assert.equal(r2.json.versionNumber, derived, '存量计划 versionNumber 回退派生');
    assert.ok(r2.json.sitePrompt.includes(`版本号 ${derived}`), `存量计划 sitePrompt 应回退派生口径：\n${r2.json.sitePrompt}`);
  } finally {
    server.kill('SIGTERM');
  }
});

/* ---------- L3 源码契约 ---------- */

t('L3 源码契约：server.mjs 调用 buildSiteWritingPrompt 传入计划 version 字段', () => {
  const src = fs.readFileSync(path.join(pluginRoot, 'scripts', 'server.mjs'), 'utf8');
  const m = src.match(/buildSiteWritingPrompt\(\{[^}]*\}\)/s);
  assert.ok(m, 'server 应存在 buildSiteWritingPrompt 调用');
  assert.match(m[0], /version:\s*v\.version/, '调用点应传入 version: v.version（x.y.z 优先，回退在构建函数内统一）');
});

/* ---------- 执行 ---------- */

let failed = 0;
for (const [name, fn] of cases) {
  try {
    await fn();
    console.log(`✓ ${name}`);
  } catch (e) {
    failed++;
    console.error(`✗ ${name}\n    ${String(e && e.message ? e.message : e).split('\n')[0]}`);
  }
}
console.log(failed ? `\n${failed} 个用例未通过` : '\n全部通过');
process.exit(failed ? 1 : 0);
