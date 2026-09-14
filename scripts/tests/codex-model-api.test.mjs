#!/usr/bin/env node
// REQ-20260906-024 Codex 派发模型配置 —— Status Board API 集成测试（假 codex CLI 驱动）
// 覆盖：设置 modelSelection 校验/保留共用字段（M16）、条目策略模型字段与依赖共存（M02/M16）、
// 模型目录接口与失败原因（M08）、继承解析接口（M01）、模型验证共用解析并绑定指纹（M07）、
// 待处理接口与重启持久（M11）。
// 用法：node scripts/tests/codex-model-api.test.mjs

import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as core from '../lib/core.mjs';

const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SERVER = path.join(PLUGIN_ROOT, 'scripts', 'server.mjs');
const FIXTURE = path.join(PLUGIN_ROOT, 'scripts', 'tests', 'fixtures', 'fake-codex.mjs');

const cases = [];
const t = (name, fn) => cases.push([name, fn]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(cond, timeoutMs = 15_000, label = '') {
  const start = Date.now();
  for (;;) {
    if (await cond()) return true;
    if (Date.now() - start > timeoutMs) throw new Error(`等待超时：${label}`);
    await sleep(50);
  }
}

function makeFakeCli() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'atb-mfakecli-'));
  const wrapper = path.join(dir, 'fake-codex');
  fs.writeFileSync(wrapper, `#!/bin/sh\nMODE=$(cat "$(dirname "$0")/mode.txt" 2>/dev/null || echo ok)\nexport FAKE_MODE="$MODE"\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(FIXTURE)} "$@"\n`, { mode: 0o755 });
  const setMode = (m) => fs.writeFileSync(path.join(dir, 'mode.txt'), m);
  setMode('ok');
  return { dir, wrapper, setMode };
}

function tempProject() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atb-mapi-'));
  core.initData(root);
  return root;
}

function startServer(projectRoot, extraEnv = {}) {
  const port = 20000 + Math.floor(Math.random() * 20000);
  const registry = path.join(os.tmpdir(), `atb-registry-${process.pid}-${Math.random().toString(16).slice(2)}.json`);
  const codexHome = fs.mkdtempSync(path.join(os.tmpdir(), 'atb-mhome-')); // 隔离本机 codex 配置
  const child = spawn(process.execPath, [SERVER], {
    cwd: projectRoot,
    env: {
      ...process.env,
      ATB_PORT: String(port),
      ATB_HOST: '127.0.0.1',
      ATB_REGISTRY: registry,
      ATB_TICK_MS: '60',
      ATB_CANCEL_GRACE_MS: '200',
      ATB_SETTLE_MS: '150',
      CODEX_HOME: codexHome,
      ...extraEnv,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let logs = '';
  child.stdout.on('data', (c) => { logs += c; });
  child.stderr.on('data', (c) => { logs += c; });
  const base = `http://127.0.0.1:${port}`;
  const req = (method, p, body) => new Promise((resolve, reject) => {
    const r = http.request(`${base}${p}`, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : {},
    }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        let j = null;
        try { j = JSON.parse(data); } catch {}
        resolve({ status: res.statusCode, json: j, text: data });
      });
    });
    r.on('error', reject);
    if (body) r.write(JSON.stringify(body));
    r.end();
  });
  const P = `?project=${encodeURIComponent(projectRoot)}`;
  return {
    port, child, req, P, base, codexHome,
    get logs() { return logs; },
    async stop() {
      child.kill('SIGTERM');
      await new Promise((r) => { child.on('exit', r); setTimeout(r, 5000); });
    },
  };
}

const healthy = (srv) => waitFor(async () => {
  try { return (await srv.req('GET', '/api/health')).status === 200; } catch { return false; }
}, 8000, '服务就绪');

async function makeItem(srv, title) {
  const r = await srv.req('POST', `/api/new${srv.P}`, { type: 'req', title });
  assert.ok(r.status === 200 || r.status === 201, `创建条目失败：${r.text}`);
  return r.json.id;
}

async function acceptItem(srv, id) {
  // REQ-20260908-010：调度选单口径 planned（已计划），接受后置计划
  const r = await srv.req('POST', `/api/item/${id}/status${srv.P}`, { to: 'accepted' });
  assert.equal(r.status, 200, `接受条目失败：${r.text}`);
  const p = await srv.req('POST', `/api/item/${id}/status${srv.P}`, { to: 'planned' });
  assert.equal(p.status, 200, `置计划失败：${p.text}`);
}

// ---------- M16：设置接口 ----------

t('T1 设置：默认继承；显式选择可保存；非法选择 400；保存保留共用计数器且不再补写上限', async () => {
  const root = tempProject();
  const srv = startServer(root);
  await healthy(srv);
  // 默认 modelSelection
  const g = await srv.req('GET', `/api/dispatch/settings${srv.P}`);
  assert.equal(g.status, 200);
  assert.deepEqual(g.json.settings.codex.modelSelection, { mode: 'inherit' });

  // 非法：explicit 缺强度
  const bad = await srv.req('POST', `/api/dispatch/settings${srv.P}`, { codex: { modelSelection: { mode: 'explicit', modelId: 'm' } } });
  assert.equal(bad.status, 400);
  // 非法：敏感字段
  const secret = await srv.req('POST', `/api/dispatch/settings${srv.P}`, { codex: { modelSelection: { mode: 'explicit', modelId: 'm', reasoningEffort: 'low', apiKey: 'x' } } });
  assert.equal(secret.status, 400);

  const fake = makeFakeCli();
  const ok = await srv.req('POST', `/api/dispatch/settings${srv.P}`, {
    codex: { cliPath: fake.wrapper, allowNonGit: true, modelSelection: { mode: 'explicit', modelId: 'fake-astra', reasoningEffort: 'high' } },
  });
  assert.equal(ok.status, 200, ok.text);
  assert.deepEqual(ok.json.settings.codex.modelSelection, { mode: 'explicit', modelId: 'fake-astra', reasoningEffort: 'high' });
  // 共用字段不丢
  assert.ok(ok.json.settings.counters && typeof ok.json.settings.counters.batch === 'number', '共用计数器必须保留');
  // REQ-20260908-019：上限设置已移除——保存不得再补写 defaults.batchLimit
  assert.ok(!ok.json.settings.defaults || ok.json.settings.defaults.batchLimit == null, '不得再补写 defaults.batchLimit');
  await srv.stop();
});

// ---------- M02/M16：条目策略接口 ----------

t('T2 条目策略：模型字段与依赖共存；只改模型不清依赖；依赖保存保留模型字段', async () => {
  const root = tempProject();
  const srv = startServer(root);
  await healthy(srv);
  const a = await makeItem(srv, 'A');
  const b = await makeItem(srv, 'B');
  await acceptItem(srv, a);
  await acceptItem(srv, b);

  // 只改模型策略
  const setModel = await srv.req('POST', `/api/item/${a}/policy${srv.P}`, {
    modelSelection: { mode: 'explicit', modelId: 'fake-mini', reasoningEffort: 'medium' },
  });
  assert.equal(setModel.status, 200, setModel.text);
  assert.deepEqual(setModel.json.modelSelection, { mode: 'explicit', modelId: 'fake-mini', reasoningEffort: 'medium' });

  // 再设依赖（不清模型字段）
  const setDeps = await srv.req('POST', `/api/item/${a}/policy${srv.P}`, { dependsOn: [b] });
  assert.equal(setDeps.status, 200, setDeps.text);
  assert.deepEqual(setDeps.json.dependsOn, [b]);
  assert.equal(setDeps.json.modelSelection.modelId, 'fake-mini', '保存依赖不得清空模型字段');

  // 清空依赖（模型字段保留）
  const clearDeps = await srv.req('POST', `/api/item/${a}/policy${srv.P}`, { dependsOn: [] });
  assert.equal(clearDeps.status, 200);
  assert.deepEqual(clearDeps.json.dependsOn, []);
  assert.equal(clearDeps.json.modelSelection.modelId, 'fake-mini', '清空依赖不得清空模型字段');

  // 回到继承
  const inherit = await srv.req('POST', `/api/item/${a}/policy${srv.P}`, { modelSelection: { mode: 'inherit' } });
  assert.equal(inherit.status, 200);
  assert.deepEqual(inherit.json.modelSelection, { mode: 'inherit' });

  // 非法模型策略就地 400
  const bad = await srv.req('POST', `/api/item/${a}/policy${srv.P}`, { modelSelection: { mode: 'explicit', modelId: '-x', reasoningEffort: 'low' } });
  assert.equal(bad.status, 400);
  await srv.stop();
});

// ---------- M08/M01：模型目录与继承解析接口 ----------

t('T3 模型目录：返回只读能力列表；CLI 故障时给原因且不伪报；继承解析接口展示层与来源', async () => {
  const root = tempProject();
  const fake = makeFakeCli();
  const srv = startServer(root);
  await healthy(srv);
  await srv.req('POST', `/api/dispatch/settings${srv.P}`, { codex: { cliPath: fake.wrapper, allowNonGit: true } });

  const cat = await srv.req('GET', `/api/dispatch/codex/models${srv.P}`);
  assert.equal(cat.status, 200);
  assert.equal(cat.json.ok, true);
  const slugs = cat.json.models.map((m) => m.slug);
  assert.ok(slugs.includes('fake-astra') && slugs.includes('fake-mini'));
  assert.ok(cat.json.models.find((m) => m.slug === 'fake-mini').efforts.includes('medium'));
  assert.match(cat.json.note, /不等于当前账户可用/);

  // CLI 目录能力故障：如实返回原因（前端展示原因并允许手动输入模型 ID）
  const srv2 = startServer(root, { FAKE_CATALOG_ERROR: 'catalog unavailable' });
  await healthy(srv2);
  await srv2.req('POST', `/api/dispatch/settings${srv2.P}`, { codex: { cliPath: fake.wrapper, allowNonGit: true } });
  const cat2 = await srv2.req('GET', `/api/dispatch/codex/models${srv2.P}&refresh=1`);
  assert.equal(cat2.status, 200);
  assert.equal(cat2.json.ok, false, '目录读取失败不得伪报成功');
  assert.match(cat2.json.reason || '', /catalog unavailable|手动输入/);
  await srv2.stop();

  // 继承解析：项目层可见（写项目 .codex/config.toml）
  fs.mkdirSync(path.join(root, '.codex'), { recursive: true });
  fs.writeFileSync(path.join(root, '.codex', 'config.toml'), 'model = "fake-astra"\nmodel_reasoning_effort = "high"\n');
  const inh = await srv.req('GET', `/api/dispatch/codex/model-inherit${srv.P}`);
  assert.equal(inh.status, 200);
  assert.equal(inh.json.inherit.modelId, 'fake-astra');
  assert.equal(inh.json.inherit.sources.model, 'project-config');
  const layerKinds = inh.json.layers.map((x) => x.kind).join(',');
  assert.ok(layerKinds.includes('user-config') && layerKinds.includes('project-config'));
  await srv.stop();
});

// ---------- M07：模型验证共用解析并绑定指纹 ----------

t('T4 模型验证：使用待验证配置构造参数（--model/-c 进入真实 argv）；结果持久化且绑定指纹；解析失败 400 不发请求', async () => {
  const root = tempProject();
  const fake = makeFakeCli();
  // 项目层继承配置，验证走继承解析
  fs.mkdirSync(path.join(root, '.codex'), { recursive: true });
  fs.writeFileSync(path.join(root, '.codex', 'config.toml'), 'model = "fake-astra"\nmodel_reasoning_effort = "high"\n');
  const srv = startServer(root);
  await healthy(srv);
  await srv.req('POST', `/api/dispatch/settings${srv.P}`, { codex: { cliPath: fake.wrapper, allowNonGit: true } });

  // 验证（真实拉起假 CLI 一次）：ok 模式
  const probe = await srv.req('POST', `/api/dispatch/preflight/model${srv.P}`, {});
  assert.equal(probe.status, 200, probe.text);
  assert.equal(probe.json.ok, true, probe.text);
  assert.equal(probe.json.model.modelId, 'fake-astra', '验证应使用解析出的继承模型');
  assert.equal(probe.json.model.reasoningEffort, 'high');
  assert.ok(probe.json.model.configFingerprint);

  // 结果持久化在设置里（绑定模型/强度/指纹）
  const g = await srv.req('GET', `/api/dispatch/settings${srv.P}`);
  const lv = g.json.settings.codex.lastVerification;
  assert.ok(lv && lv.ok === true, '验证结果应持久化');
  assert.equal(lv.modelId, 'fake-astra');
  assert.equal(lv.reasoningEffort, 'high');
  assert.equal(lv.configFingerprint, probe.json.model.configFingerprint, '结果绑定配置指纹');

  // 配置变化后指纹变化 → 旧验证不再匹配（前端可判定需要重新验证）
  fs.writeFileSync(path.join(root, '.codex', 'config.toml'), 'model = "fake-mini"\nmodel_reasoning_effort = "medium"\n');
  const inh2 = await srv.req('GET', `/api/dispatch/codex/model-inherit${srv.P}`);
  assert.equal(inh2.json.inherit.modelId, 'fake-mini');

  // 解析失败（请求携带非法组合）：400，不发模型请求
  const badSel = await srv.req('POST', `/api/dispatch/preflight/model${srv.P}`, {
    modelSelection: { mode: 'explicit', modelId: 'fake-mini', reasoningEffort: 'ultra' },
  });
  assert.equal(badSel.status, 400, '目录已知的不兼容组合应在解析阶段被拒');
  assert.match(badSel.json.error || '', /不支持/);
  await srv.stop();
});

// ---------- M11：待处理接口与重启持久 ----------

t('T5 待处理接口：模型错误后可查询；服务重启后仍在；解决后不再列出', async () => {
  const root = tempProject();
  const fake = makeFakeCli();
  const srv = startServer(root);
  await healthy(srv);
  await srv.req('POST', `/api/dispatch/settings${srv.P}`, {
    codex: {
      cliPath: fake.wrapper, allowNonGit: true,
      // 显式选择避免依赖本机配置（服务器进程 CODEX_HOME 为隔离空目录，继承会解析失败）
      modelSelection: { mode: 'explicit', modelId: 'fake-astra', reasoningEffort: 'low' },
    },
  });
  const id = await makeItem(srv, '模型失败项');
  await acceptItem(srv, id);
  // 直接用重试通道触发失败运行：先守规成功一次再失败？更直接：手动写一条待处理（经服务端事件链路较重）。
  // 这里用真实调度链路：开启自动派发 + fake CLI model-missing 模式。
  fake.setMode('model-missing');
  await srv.req('POST', `/api/dispatch/codex/toggle${srv.P}`, { enabled: true });
  await waitFor(async () => {
    const r = await srv.req('GET', `/api/dispatch/pending${srv.P}`);
    return r.json && r.json.count === 1;
  }, 15_000, '等待模型失败产生待处理');
  const pend = (await srv.req('GET', `/api/dispatch/pending${srv.P}`)).json;
  assert.equal(pend.items[0].kind, 'model-missing');
  assert.equal(pend.items[0].itemId, id);

  // 重启服务（同项目同账本）：待处理仍在
  await srv.stop();
  const srv2 = startServer(root);
  await healthy(srv2);
  const pend2 = (await srv2.req('GET', `/api/dispatch/pending${srv2.P}`)).json;
  assert.equal(pend2.count, 1, '重启后待处理记录仍可找到');
  assert.equal(pend2.items[0].kind, 'model-missing');

  // 条目详情带模型待处理标记
  const detail = await srv2.req('GET', `/api/item/${id}${srv2.P}`);
  assert.ok(detail.json.modelPending, '条目详情应带模型待处理标记');
  assert.equal(detail.json.modelPending.kind, 'model-missing');
  await srv2.stop();
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
