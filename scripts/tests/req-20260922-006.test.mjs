#!/usr/bin/env node
// REQ-20260922-006 版本号 x.y.z 格式 + 发布时间（以成功推送远端 main 的时间为准）
// 覆盖（test-cases.md）：D1–D3 数据层 / S1–S2 服务层 / U1–U2 前端与 i18n 契约。
// 用法：node scripts/tests/req-20260922-006.test.mjs

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as core from '../lib/core.mjs';
import * as buildStore from '../lib/build-store.mjs';

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const cases = [];
const t = (name, fn) => cases.push([name, fn]);

const H1 = 'a'.repeat(40);
const H2 = 'b'.repeat(40);
const H3 = 'c'.repeat(40);

function mkData() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'atb-ver-xyz-'));
  core.initData(tmp);
  return tmp;
}

const itemOf = (id, commit, title = `标题 ${id}`) => ({ itemId: id, commit, title });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- D1 数据层：缺省自动分配 ----------

t('D1 缺省自动分配：无历史 0.1.0；之后取既有最大 x.y.z 的 patch+1', () => {
  const dataDir = core.dataDirFrom(mkData());
  const v1 = buildStore.createVersion(dataDir, { items: [itemOf('REQ-20260922-010', H1)] });
  assert.equal(v1.version, '0.1.0', '首个缺省版本号应为 0.1.0');
  const v2 = buildStore.createVersion(dataDir, { items: [itemOf('REQ-20260922-011', H1)] });
  assert.equal(v2.version, '0.1.1', '第二个缺省版本号应为 0.1.1');
  const v3 = buildStore.createVersion(dataDir, { items: [itemOf('REQ-20260922-012', H1)], version: '0.2.3' });
  assert.equal(v3.version, '0.2.3');
  const v4 = buildStore.createVersion(dataDir, { items: [itemOf('REQ-20260922-013', H1)] });
  assert.equal(v4.version, '0.2.4', '手填更高版本后，缺省取整体最大者的 patch+1（0.2.3 → 0.2.4）');
});

// ---------- D2 数据层：手填校验 / 重复 / 复用 ----------

t('D2 手填校验：合法生效；非法格式拒绝；与既有计划重复拒绝（含冲突计划号）；删除后可复用；空串视同缺省', () => {
  const dataDir = core.dataDirFrom(mkData());
  const v1 = buildStore.createVersion(dataDir, { items: [itemOf('REQ-20260922-020', H1)], version: '1.2.3' });
  assert.equal(v1.version, '1.2.3');
  for (const bad of ['20260921-001', '1.2', 'v1.0.0', '1.2.3.4', '1.2.x']) {
    assert.throws(
      () => buildStore.createVersion(dataDir, { items: [itemOf(`REQ-20260922-02${bad.length}`, H2)], version: bad }),
      /版本号/,
      `非法格式应拒绝：${bad}`,
    );
  }
  assert.throws(
    () => buildStore.createVersion(dataDir, { items: [itemOf('REQ-20260922-029', H2)], version: '1.2.3' }),
    new RegExp(v1.id),
    '重复版本号应拒绝且报错含冲突计划号',
  );
  const vEmpty = buildStore.createVersion(dataDir, { items: [itemOf('REQ-20260922-030', H2)], version: '' });
  assert.equal(vEmpty.version, '1.2.4', '空串视同缺省（自动分配，最大者 1.2.3 → 1.2.4）');
  buildStore.deleteVersion(dataDir, v1.id);
  const vReuse = buildStore.createVersion(dataDir, { items: [itemOf('REQ-20260922-031', H2)], version: '1.2.3' });
  assert.equal(vReuse.version, '1.2.3', '删除计划后版本号可复用');
});

// ---------- D3 数据层：recordPushSuccess 同步 releasedAt ----------

t('D3 releasedAt 语义：推送成功写入顶层并与 release.pushedAt 同刻；同基准不重置；基准变化随 pushedAt 更新', async () => {
  const dataDir = core.dataDirFrom(mkData());
  const v = buildStore.createVersion(dataDir, { items: [itemOf('REQ-20260922-040', H1)] });
  const p1 = buildStore.recordPushSuccess(dataDir, v.id, { remote: 'origin', sha: H1 });
  assert.ok(p1.releasedAt, '推送成功应写入顶层 releasedAt');
  assert.equal(p1.releasedAt, p1.release.pushedAt, 'releasedAt 与 release.pushedAt 同刻');
  await sleep(10);
  const p2 = buildStore.recordPushSuccess(dataDir, v.id, { remote: 'origin', sha: H1 });
  assert.equal(p2.releasedAt, p1.releasedAt, '同基准（同 sha）重复推送不重置 releasedAt');
  await sleep(10);
  const p3 = buildStore.recordPushSuccess(dataDir, v.id, { remote: 'origin', sha: H2 });
  assert.notEqual(p3.releasedAt, p1.releasedAt, '基准变化（新 sha）重新推送应更新 releasedAt');
  assert.equal(p3.releasedAt, p3.release.pushedAt, '更新后 releasedAt 仍与 pushedAt 同刻');
});

// ---------- S1/S2 服务层（真实 server 进程） ----------

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

t('S1/S2 服务层：/version 带版本号创建、非法与重复 400、缺省自动分配；/state 透出 version 与 releasedAt（含存量回退）；publish-plan 版本号取 x.y.z（存量回退派生）', async () => {
  const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'atb-ver-xyz-srv-')));
  const proj = path.join(tmp, 'proj');
  fs.mkdirSync(proj);
  git(proj, ['init', '-b', 'main']);
  fs.writeFileSync(path.join(proj, 'a.txt'), 'a\n');
  git(proj, ['add', '-A']);
  git(proj, ['commit', '-m', 'init']);
  git(proj, ['switch', '-c', 'dev']);
  core.initData(proj);
  const dataDir = core.dataDirFrom(proj);
  const it1 = core.createItem(dataDir, { type: 'requirement', title: '演示一', by: 'test' });
  const it2 = core.createItem(dataDir, { type: 'requirement', title: '演示二', by: 'test' });
  const it3 = core.createItem(dataDir, { type: 'requirement', title: '演示三', by: 'test' });
  for (const it of [it1, it2, it3]) {
    for (const s of ['accepted', 'in-progress', 'done']) core.setStatus(dataDir, it.id, s, { by: 'test' });
  }
  fs.writeFileSync(path.join(proj, 'f1.txt'), `feat ${it1.id}\n`);
  git(proj, ['add', '-A']);
  git(proj, ['commit', '-m', `feat: 演示一 ${it1.id}`]);
  const c1 = git(proj, ['rev-parse', 'HEAD']);

  const reg = path.join(tmp, 'reg.json');
  const spawnOnPort = async (port) => {
    const child = spawn(process.execPath, [path.join(pluginRoot, 'scripts', 'server.mjs')], {
      cwd: proj,
      env: { ...process.env, ATB_PORT: String(port), ATB_REGISTRY: reg },
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
    port = 31000 + Math.floor(Math.random() * 20000);
    server = await spawnOnPort(port);
  }
  assert.ok(server, `服务应启动（最后端口 ${port}）`);
  const P = `?project=${encodeURIComponent(proj)}`;
  try {
    // S1a 手填创建
    const r1 = await reqJson(port, 'POST', `/api/build/version${P}`, {
      name: '手填版本', version: '0.5.1',
      items: [{ itemId: it1.id, commit: c1 }],
    });
    assert.equal(r1.status, 201, `手填创建应 201：${r1.text}`);
    assert.equal(r1.json.version.version, '0.5.1');
    const planId = r1.json.version.id;
    // S1b 非法格式
    const r2 = await reqJson(port, 'POST', `/api/build/version${P}`, {
      version: '1.2', items: [{ itemId: it2.id, commit: c1 }],
    });
    assert.equal(r2.status, 400, '非法版本号格式应 400');
    // S1c 重复
    const r3 = await reqJson(port, 'POST', `/api/build/version${P}`, {
      version: '0.5.1', items: [{ itemId: it2.id, commit: c1 }],
    });
    assert.equal(r3.status, 400, '重复版本号应 400');
    assert.ok(r3.text.includes(planId), '重复报错应含冲突计划号');
    // S1d 缺省自动分配（既有最大 0.5.1 → 0.5.2）
    const r4 = await reqJson(port, 'POST', `/api/build/version${P}`, {
      items: [{ itemId: it2.id, commit: c1 }],
    });
    assert.equal(r4.status, 201, `缺省创建应 201：${r4.text}`);
    assert.equal(r4.json.version.version, '0.5.2');
    const planId2 = r4.json.version.id;

    // S2a /state 透出 version 与 releasedAt（未推送为 null）
    const s1 = await reqJson(port, 'GET', `/api/build/state${P}`);
    assert.equal(s1.status, 200);
    const vs = Object.fromEntries(s1.json.versions.map((x) => [x.id, x]));
    assert.equal(vs[planId].version, '0.5.1');
    assert.equal(vs[planId].releasedAt, null, '未推送计划 releasedAt 应为 null');

    // S2b 存量回退：模拟旧数据（无顶层 releasedAt，仅 release.pushedAt）→ /state 仍透出 releasedAt
    buildStore.recordPushSuccess(dataDir, planId, { remote: 'origin', sha: H1 });
    const vf = path.join(dataDir, 'runtime', 'builds', 'versions', planId, 'version.json');
    const raw = JSON.parse(fs.readFileSync(vf, 'utf8'));
    const pushedAt = raw.release.pushedAt;
    delete raw.releasedAt; // 模拟旧版本写入的存量形态
    fs.writeFileSync(vf, JSON.stringify(raw, null, 2));
    const s2 = await reqJson(port, 'GET', `/api/build/state${P}`);
    const vs2 = Object.fromEntries(s2.json.versions.map((x) => [x.id, x]));
    assert.equal(vs2[planId].releasedAt, pushedAt, '存量（仅 release.pushedAt）应在 /state 回退透出 releasedAt');
    assert.equal(vs2[planId].pushed, true);

    // S2c publish-plan：新计划取 x.y.z；存量（无 version 字段）回退 YYYYMMDD-NNN 派生
    const pp1 = await reqJson(port, 'GET', `/api/build/publish-plan${P}&id=${planId}`);
    assert.equal(pp1.status, 200, `publish-plan 应 200：${pp1.text}`);
    assert.equal(pp1.json.versionNumber, '0.5.1', '新计划 versionNumber 应取 x.y.z');
    const vf2 = path.join(dataDir, 'runtime', 'builds', 'versions', planId2, 'version.json');
    const raw2 = JSON.parse(fs.readFileSync(vf2, 'utf8'));
    delete raw2.version; // 模拟存量计划
    fs.writeFileSync(vf2, JSON.stringify(raw2, null, 2));
    const derived = planId2.replace(/^BLD-/, '');
    const pp2 = await reqJson(port, 'GET', `/api/build/publish-plan${P}&id=${planId2}`);
    assert.equal(pp2.json.versionNumber, derived, '存量计划 versionNumber 应回退 YYYYMMDD-NNN 派生');
  } finally {
    server.kill('SIGTERM');
  }
});

// ---------- U1 前端契约（源码级断言） ----------

t('U1 前端契约：版本号 v.version 回退旧派生；发布于渲染；创建表单版本号输入；产品发布弹窗预填', () => {
  const src = fs.readFileSync(path.join(pluginRoot, 'scripts', 'web', 'build.js'), 'utf8');
  // 列表卡片与详情头部：优先 v.version，回退 id 派生（两处）
  const fallbacks = src.match(/v\.version \|\|[^;]*BLD-/g) || [];
  assert.ok(fallbacks.length >= 2, `列表与详情两处应使用 v.version 回退派生（实际 ${fallbacks.length} 处）`);
  assert.ok(src.includes('发布于'), '应渲染「发布于」发布时间');
  assert.ok(/发布于\s*:?[^`]*fmtTime\((?:v\.)?(?:releasedAt|relAt)/.test(src) || /releasedAt[^\n]*fmtTime|fmtTime[^\n]*releasedAt/.test(src), '发布时间应取 releasedAt 格式化');
  assert.ok(src.includes('bldNewVersion'), '创建表单应有版本号输入（bldNewVersion）');
  assert.ok(src.includes('version: v.version'), '产品发布弹窗应预填计划版本号（version: v.version）');
});

// ---------- U2 i18n 中英同步 ----------

t('U2 i18n：新增文案键中英文同步', () => {
  const src = fs.readFileSync(path.join(pluginRoot, 'scripts', 'web', 'i18n.js'), 'utf8');
  for (const key of ['发布于']) {
    assert.ok(new RegExp(`'${key}'\\s*:`).test(src), `i18n 应包含键「${key}」`);
    assert.ok(new RegExp(`'${key}'\\s*:\\s*'[^']+'`).test(src), `键「${key}」应有非空英文译文`);
  }
});

// ---------- 执行 ----------

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
