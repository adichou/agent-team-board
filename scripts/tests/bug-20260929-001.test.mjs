// 已发布版本的状态、写入边界与交互锁回归。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import crypto from 'node:crypto';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import '../web/i18n.js';
import * as core from '../lib/core.mjs';
import * as build from '../lib/build-store.mjs';
import * as publish from '../lib/build-publish-store.mjs';
import { buildPublishApi } from '../lib/build-publish-api.mjs';
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atb-published-'));
try {
  core.initData(root);
  const dataDir = core.dataDirFrom(root);
  const v = build.createVersion(dataDir, { name: '已发布版本', items: [{ itemId: 'REQ-20260929-001', commit: 'a'.repeat(40) }] });
  for (const [status, date] of [['succeeded', '2026-09-28'], ['failed', '2026-09-29']]) {
    const id = `BPUB-${crypto.randomUUID()}`;
    const dir = publish.runDir(dataDir, id);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'run.json'), JSON.stringify({ id, bldId: v.id, version: '1.0.0', status, createdAt: date }));
  }
  const before = JSON.stringify(build.readVersion(dataDir, v.id));
  assert.throws(() => build.saveInfo(dataDir, v.id, { name: '不应保存' }), /已发布.*仅可查看/);
  assert.throws(() => build.deleteVersion(dataDir, v.id), /已发布.*仅可查看/);
  assert.throws(() => build.removeItems(dataDir, v.id, ['REQ-20260929-001']), /已发布.*仅可查看/);
  assert.equal(JSON.stringify(build.readVersion(dataDir, v.id)), before);
  await assert.rejects(buildPublishApi({ method: 'POST', pathname: '/api/build-publish/from-build', body: { bldId: v.id, version: '2.0.0' }, root, dataDir }), /已发布.*仅可查看/);
  const failedRun = publish.listRuns(dataDir, v.id).find(run => run.status === 'failed');
  for (const action of ['precheck', 'refreeze', 'start', 'retry', 'cancel']) {
    await assert.rejects(buildPublishApi({ method: 'POST', pathname: `/api/build-publish/run/${failedRun.id}/${action}`, root, dataDir }), /已发布.*仅可查看/);
  }
  const other = build.createVersion(dataDir, { name: '另一个版本', items: [{ itemId: 'REQ-20260929-002', commit: 'b'.repeat(40) }] });
  assert.equal(build.saveInfo(dataDir, other.id, { name: '允许修改' }).name, '允许修改');
  const sandbox = { console, URLSearchParams, document: { addEventListener() {}, querySelector() { return null; } }, localStorage: { getItem() {} }, setTimeout() {}, clearTimeout() {} };
  sandbox.window = sandbox;
  vm.runInNewContext(fs.readFileSync(new URL('../web/build.js', import.meta.url), 'utf8').replace('    enter, refresh,', '    state, lockPublishedControls, enter, refresh,'), sandbox);
  assert.match(sandbox.ATBBuild.statusChipFor({ ...v, release: { published: true } }), /已发布/);
  assert.doesNotMatch(sandbox.ATBBuild.statusChipFor({ ...v, release: { published: false } }), /已发布/);
  const ui = sandbox.ATBBuild;
  ui.state.data = { versions: [{ ...v, release: { published: true } }] };
  ui.state.selVerId = v.id;
  const attrs = {};
  const edit = { disabled: false, closest() { return null; }, setAttribute(k, val) { attrs[k] = val; } };
  const handlers = {};
  ui.lockPublishedControls({ querySelectorAll(selector) { assert.match(selector, /data-review-approve/); assert.doesNotMatch(selector, /data-items-pg|bldNewBtn/); return [edit]; }, addEventListener(k, fn) { handlers[k] = fn; } });
  assert.equal(edit.disabled, true);
  assert.equal(attrs['aria-disabled'], 'true');
  assert.match(attrs.title, /已发布/);
  assert.ok(globalThis.ATBI18N._dict.EN[attrs.title], '只读提示必须有英文翻译');
  let prevented = false;
  handlers.keydown({ target: { closest() { return edit; } }, preventDefault() { prevented = true; }, stopImmediatePropagation() {} });
  assert.equal(prevented, true);
  ui.openPlanEdit();
  assert.equal(ui.state.planEdit, null, '程序调用编辑入口也应锁定');

  // 实际 HTTP 写入边界：请求无需通过各接口参数校验就应因已发布被拒绝。
  const port = 35000 + Math.floor(Math.random() * 20000);
  const request = (method, route, body) => new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path: route + '?project=' + encodeURIComponent(root), headers: { 'Content-Type': 'application/json' } }, res => {
      let text = ''; res.on('data', chunk => { text += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, text }));
    });
    req.on('error', reject); req.end(body ? JSON.stringify(body) : undefined);
  });
  const server = spawn(process.execPath, [new URL('../server.mjs', import.meta.url).pathname], { cwd: root, env: { ...process.env, ATB_PORT: String(port), ATB_REGISTRY: path.join(root, 'registry.json') }, stdio: 'ignore' });
  try {
    let ready = false;
    for (let i = 0; i < 60; i++) {
      try { await request('GET', '/api/health'); ready = true; break; } catch {}
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.ok(ready, '隔离测试服务应启动');
    const routes = ['version/save', 'version/items', 'version/merge', 'version/delete', 'docs/langs', 'docs/custom', 'docs-summary/start', 'docs-translate/start', 'docs/review', 'docs/save', 'docs/commit', 'docs/merge', 'docs-proofread/start', 'docs-check/decision', 'docs/open-ide', 'release/push', 'release/site-scan'];
    for (const route of routes) {
      const response = await request('POST', '/api/build/' + route, { id: v.id, name: '拒绝修改', content: '拒绝修改' });
      assert.ok(response.status >= 400, route + ' 必须拒绝');
      assert.match(response.text, /已发布.*仅可查看/, route + ' 必须走已发布统一门禁');
    }
    const response = await request('GET', '/api/build/state');
    assert.equal(response.status, 200, '已发布仍可查看');
    assert.equal(JSON.stringify(build.readVersion(dataDir, v.id)), before, '所有请求之后版本数据保持原状');
  } finally {
    const exited = once(server, 'exit'); server.kill('SIGTERM'); await exited;
  }
  console.log('PASS BUG-20260929-001（存储、交互及 17 条 HTTP 写入边界）');
} finally { fs.rmSync(root, { recursive: true, force: true }); }
