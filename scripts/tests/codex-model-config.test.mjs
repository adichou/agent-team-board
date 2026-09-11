#!/usr/bin/env node
// REQ-20260906-024 Codex 派发模型配置 —— 纯规则单元测试
// 覆盖 test-cases M01/M02/M03/M06/M16 的规则层：
//   选择归一化与注入校验、TOML 子集提取、多层继承解析、单项优先、目录能力校验、快照构造、指纹。
// 用法：node scripts/tests/codex-model-config.test.mjs

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  validateModelId, validateReasoningEffort, normalizeModelSelection,
  extractTomlKeys, readModelConfigLayers, resolveInheritedModel, effectiveSelection,
  catalogInfoFor, buildModelSnapshot, fingerprintLayers, MODEL_FAILURE_KINDS,
} from '../lib/codex-model-config.mjs';
import { classifyFailure, buildExecArgs } from '../lib/codex-adapter.mjs';

const cases = [];
const t = (name, fn) => cases.push([name, fn]);

// ---------- M06 形态校验与注入防护 ----------

t('M06a 模型 ID：合法 slug 通过；控制字符/选项形态/超长/前后空白拒绝', () => {
  assert.deepEqual(validateModelId('gpt-6-astra'), { ok: true, error: null });
  assert.deepEqual(validateModelId('o4-mini.1:preview_x'), { ok: true, error: null });
  for (const bad of ['-m', '--model', 'x -C /etc', 'a"b', "a'b", 'a\nb', 'a\tb', 'a b', '', ' ', 'x'.repeat(201)]) {
    const r = validateModelId(bad);
    assert.equal(r.ok, false, `应拒绝：${JSON.stringify(bad)}`);
    assert.ok(r.error, '拒绝时必须给原因');
  }
});

t('M06b 推理强度：合法档位通过；引号/控制字符/选项形态拒绝', () => {
  for (const okv of ['minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra']) {
    assert.equal(validateReasoningEffort(okv).ok, true, `应接受：${okv}`);
  }
  for (const bad of ['high"', "-c", 'MOCK=1', 'a b', 'a\nb', '', 'x'.repeat(41)]) {
    assert.equal(validateReasoningEffort(bad).ok, false, `应拒绝：${JSON.stringify(bad)}`);
  }
});

t('M06c buildExecArgs：有类型模型参数生成 --model 与 -c model_reasoning_effort="…"；新会话与 resume 均携带', () => {
  const args = buildExecArgs({
    projectRoot: '/tmp/p', finalMessageFile: '/tmp/o.md',
    model: 'gpt-6-astra', reasoningEffort: 'xhigh',
  });
  const i = args.indexOf('--model');
  assert.equal(args[i + 1], 'gpt-6-astra');
  const c = args.indexOf('-c');
  assert.equal(args[c + 1], 'model_reasoning_effort="xhigh"');
  const rArgs = buildExecArgs({
    projectRoot: '/tmp/p', resumeThreadId: 'abc-123',
    model: 'gpt-6-astra', reasoningEffort: 'low',
  });
  assert.ok(rArgs.includes('resume'));
  assert.equal(rArgs[rArgs.indexOf('--model') + 1], 'gpt-6-astra');
  assert.equal(rArgs[rArgs.indexOf('-c') + 1], 'model_reasoning_effort="low"');
  // 只传模型不传强度（或反之）是编程错误：必须抛错，不得静默生成半个覆盖
  assert.throws(() => buildExecArgs({ projectRoot: '/tmp/p', model: 'm1' }), /同时提供|成对/);
  assert.throws(() => buildExecArgs({ projectRoot: '/tmp/p', reasoningEffort: 'low' }), /同时提供|成对/);
});

t('M06d 非法模型/强度在 buildExecArgs 抛错，不进入参数数组', () => {
  assert.throws(() => buildExecArgs({ projectRoot: '/tmp/p', model: '--flag', reasoningEffort: 'low' }), /模型/);
  assert.throws(() => buildExecArgs({ projectRoot: '/tmp/p', model: 'm', reasoningEffort: 'a"b' }), /强度|推理/);
});

// ---------- M01 TOML 子集提取与多层继承 ----------

t('M01a extractTomlKeys：字符串/字面量/布尔键提取；注释、表头、数组不干扰', () => {
  const toml = [
    '# 注释',
    'model = "gpt-6-astra"',
    "model_reasoning_effort = 'xhigh'",
    'model_provider = "openai"',
    'enabled = true',
    'count = 3',
    'enabled-reasoning-efforts = ["low", "medium", "high"]',
    '[profiles.plan]',
    'model = "gpt-6-astra-max"',
    'model_reasoning_effort = "max"',
    '[tui.nested]',
    'x = 1',
  ].join('\n');
  const r = extractTomlKeys(toml, ['model', 'model_reasoning_effort', 'model_provider', 'profile']);
  assert.equal(r.values.model.value, 'gpt-6-astra');
  assert.equal(r.values.model.table, '');
  assert.equal(r.values.model_reasoning_effort.value, 'xhigh');
  assert.equal(r.values.model_provider.value, 'openai');
  assert.equal(r.tables['profiles.plan'].model, 'gpt-6-astra-max');
  assert.equal(r.tables['profiles.plan'].model_reasoning_effort, 'max');
  assert.equal(r.tables[''].model, 'gpt-6-astra', '顶层键在空表名下');
});

t('M01b 继承解析：项目层覆盖 profile 层、profile 层覆盖用户层；来源如实标注', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'atb-mcfg-'));
  const proj = fs.mkdtempSync(path.join(os.tmpdir(), 'atb-mproj-'));
  fs.writeFileSync(path.join(home, 'config.toml'), [
    'model = "m-user"',
    'model_reasoning_effort = "low"',
    'profile = "plan"',
    '[profiles.plan]',
    'model = "m-profile"',
    'model_reasoning_effort = "medium"',
    '',
  ].join('\n'));
  fs.mkdirSync(path.join(proj, '.codex'), { recursive: true });
  fs.writeFileSync(path.join(proj, '.codex', 'config.toml'), 'model = "m-proj"\n');
  const layers = readModelConfigLayers({ projectRoot: proj, codexHome: home });
  const r = resolveInheritedModel(layers);
  assert.equal(r.modelId, 'm-proj', '项目层最高');
  assert.equal(r.sources.model, 'project-config');
  assert.equal(r.reasoningEffort, 'medium', '项目层只覆盖模型时强度仍来自 profile');
  assert.equal(r.sources.reasoningEffort, 'profile-table');
  // 去掉项目层：profile 覆盖用户层
  const r2 = resolveInheritedModel(layers.filter((x) => x.kind !== 'project-config'));
  assert.equal(r2.modelId, 'm-profile');
  assert.equal(r2.sources.model, 'profile-table');
  // 去掉 profile 选择且项目无覆盖：回到用户层
  fs.writeFileSync(path.join(home, 'config.toml'), 'model = "m-user"\nmodel_reasoning_effort = "low"\n');
  const plain = fs.mkdtempSync(path.join(os.tmpdir(), 'atb-mplain-'));
  const r3 = resolveInheritedModel(readModelConfigLayers({ projectRoot: plain, codexHome: home }));
  assert.equal(r3.modelId, 'm-user');
  assert.equal(r3.provider, null, '未配置提供方不猜默认');
});

t('M01c 无法解析继承值：不猜默认模型，返回明确缺失项', () => {
  const r = resolveInheritedModel([{ kind: 'user-config', path: '/u/.codex/config.toml', exists: false, raw: '' }], { keys: extractTomlKeys });
  assert.equal(r.modelId, null);
  assert.ok(r.unresolved.includes('model'), '缺模型必须列为未解析项');
  const onlyEffort = resolveInheritedModel([{ kind: 'user-config', path: '/u', exists: true, raw: 'model_reasoning_effort = "low"\n' }], { keys: extractTomlKeys });
  assert.ok(onlyEffort.unresolved.includes('model'), '只有强度时模型仍缺失');
});

t('M01d readModelConfigLayers：CODEX_HOME 与项目 .codex 层按实际文件读取', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'atb-cxhome-'));
  const proj = fs.mkdtempSync(path.join(os.tmpdir(), 'atb-cxproj-'));
  fs.writeFileSync(path.join(home, 'config.toml'), 'model = "m-home"\n');
  fs.mkdirSync(path.join(proj, '.codex'), { recursive: true });
  fs.writeFileSync(path.join(proj, '.codex', 'config.toml'), 'model = "m-proj"\nmodel_reasoning_effort = "high"\n');
  const layers = readModelConfigLayers({ projectRoot: proj, codexHome: home });
  const kinds = layers.map((x) => x.kind).join(',');
  assert.ok(kinds.includes('user-config') && kinds.includes('project-config'));
  const r = resolveInheritedModel(layers);
  assert.equal(r.modelId, 'm-proj');
  assert.equal(r.reasoningEffort, 'high');
  assert.equal(r.sources.model, 'project-config');
  // CODEX_HOME 环境变量优先于 ~/.codex
  const home2 = fs.mkdtempSync(path.join(os.tmpdir(), 'atb-cxhome2-'));
  fs.writeFileSync(path.join(home2, 'config.toml'), 'model = "m-home2"\n');
  const l2 = readModelConfigLayers({ projectRoot: proj, codexHome: home2, env: { CODEX_HOME: home2 } });
  assert.equal(resolveInheritedModel(l2).modelId, 'm-proj');
  assert.ok(l2.find((x) => x.kind === 'user-config').raw.includes('m-home2'), '应读取 CODEX_HOME 指定目录');
});

// ---------- M02 单项覆盖优先级 ----------

t('M02 effectiveSelection：本项 explicit > 项目 explicit > inherit；取消本项覆盖回到项目；同构归一化', () => {
  const proj = { mode: 'explicit', modelId: 'm-proj', reasoningEffort: 'high' };
  const item = { mode: 'explicit', modelId: 'm-item', reasoningEffort: 'low' };
  assert.equal(effectiveSelection({ itemSelection: item, projectSelection: proj }).source, 'item-explicit');
  assert.equal(effectiveSelection({ itemSelection: item, projectSelection: proj }).selection.modelId, 'm-item');
  assert.equal(effectiveSelection({ itemSelection: { mode: 'inherit' }, projectSelection: proj }).source, 'project-explicit');
  assert.equal(effectiveSelection({ itemSelection: null, projectSelection: proj }).selection.modelId, 'm-proj');
  const both = effectiveSelection({ itemSelection: { mode: 'inherit' }, projectSelection: { mode: 'inherit' } });
  assert.equal(both.source, 'inherit');
  assert.deepEqual(both.selection, { mode: 'inherit' });
});

t('M02b normalizeModelSelection：非法形态就地报错（缺字段/多余 mode/敏感键）', () => {
  assert.equal(normalizeModelSelection({ mode: 'inherit' }).ok, true);
  assert.equal(normalizeModelSelection(null).ok, true, '缺省视为继承');
  assert.equal(normalizeModelSelection({ mode: 'explicit', modelId: 'm' }).ok, false, 'explicit 必须同时给强度');
  assert.equal(normalizeModelSelection({ mode: 'explicit', modelId: 'm', reasoningEffort: 'high', apiKey: 'x' }).ok, false, '不接受敏感字段');
  assert.equal(normalizeModelSelection({ mode: 'other' }).ok, false);
  const e = normalizeModelSelection({ mode: 'explicit', modelId: '-x', reasoningEffort: 'low' });
  assert.equal(e.ok, false);
});

// ---------- M03 目录能力校验 ----------

const CATALOG = {
  ok: true,
  models: [
    { slug: 'gpt-6-astra', display_name: 'GPT-6-Astra', default_reasoning_level: 'low', supported_reasoning_levels: [{ effort: 'low' }, { effort: 'high' }] },
    { slug: 'gpt-6-mini', display_name: 'Mini', default_reasoning_level: 'medium', supported_reasoning_levels: [{ effort: 'medium' }, { effort: 'low' }] },
  ],
};

t('M03a catalogInfoFor：已知模型给出默认强度与支持档位', () => {
  const info = catalogInfoFor(CATALOG, 'gpt-6-astra');
  assert.equal(info.known, true);
  assert.deepEqual(info.efforts, ['low', 'high']);
  assert.equal(info.defaultEffort, 'low');
  assert.equal(catalogInfoFor(CATALOG, 'no-such-model').known, false);
  assert.equal(catalogInfoFor(null, 'any').known, false, '目录不可用时不得伪报已验证');
});

t('M03b 快照校验：已知模型 + 不支持强度 → 拒绝；未知模型 → 允许但标注未验证', () => {
  const bad = buildModelSnapshot({
    selection: { mode: 'explicit', modelId: 'gpt-6-astra', reasoningEffort: 'ultra' },
    source: 'item-explicit', catalog: CATALOG,
  });
  assert.equal(bad.ok, false);
  assert.match(bad.error, /不支持|不兼容/);
  const okSnap = buildModelSnapshot({
    selection: { mode: 'explicit', modelId: 'gpt-6-astra', reasoningEffort: 'high' },
    source: 'item-explicit', catalog: CATALOG,
  });
  assert.equal(okSnap.ok, true);
  assert.equal(okSnap.snapshot.catalog.known, true);
  assert.equal(okSnap.snapshot.catalog.effortSupported, true);
  const unknown = buildModelSnapshot({
    selection: { mode: 'explicit', modelId: 'custom-model-id', reasoningEffort: 'high' },
    source: 'item-explicit', catalog: CATALOG,
  });
  assert.equal(unknown.ok, true, '目录外模型允许提交（待真实验证）');
  assert.equal(unknown.snapshot.catalog.known, false);
  assert.equal(unknown.snapshot.verification, 'unverified', '未知能力不冒充已验证');
});

t('M03c 继承快照：配置缺强度时用目录默认并标注来源；目录不可用且缺强度 → 阻止', () => {
  const layers = [{ kind: 'user-config', path: '/u/.codex/config.toml', exists: true, raw: 'model = "gpt-6-mini"\n' }];
  const inherit = resolveInheritedModel(layers);
  const snap = buildModelSnapshot({ selection: { mode: 'inherit' }, source: 'inherit', inherit, catalog: CATALOG, layers });
  assert.equal(snap.ok, true);
  assert.equal(snap.snapshot.reasoningEffort, 'medium');
  assert.equal(snap.snapshot.sources.reasoningEffort, 'catalog-default');
  const noCatalog = buildModelSnapshot({ selection: { mode: 'inherit' }, source: 'inherit', inherit, catalog: null, layers });
  assert.equal(noCatalog.ok, false, '目录不可用又无配置强度时不得猜默认');
  assert.match(noCatalog.error, /推理强度|强度/);
});

t('M03d 快照不含密钥类字段，且包含指纹与解析时间', () => {
  const layers = [{ kind: 'user-config', path: '/u/.codex/config.toml', exists: true, raw: 'model = "gpt-6-astra"\nmodel_reasoning_effort = "high"\n' }];
  const snap = buildModelSnapshot({
    selection: { mode: 'inherit' }, source: 'inherit',
    inherit: resolveInheritedModel(layers), catalog: CATALOG, layers, cliVersion: 'codex-cli 0.153.4',
  });
  const s = JSON.stringify(snap.snapshot);
  assert.ok(!/api[-_]?key|token|secret|password|credential|bearer/i.test(s), '快照不得包含密钥类字段');
  assert.ok(snap.snapshot.configFingerprint && snap.snapshot.configFingerprint.length >= 8);
  assert.ok(snap.snapshot.resolvedAt);
  assert.equal(snap.snapshot.cliVersion, 'codex-cli 0.153.4');
});

t('M03e fingerprintLayers：配置内容变化 → 指纹变化', () => {
  const l1 = [{ kind: 'user-config', path: '/a', exists: true, raw: 'model = "m1"\n' }];
  const l2 = [{ kind: 'user-config', path: '/a', exists: true, raw: 'model = "m2"\n' }];
  assert.notEqual(fingerprintLayers(l1), fingerprintLayers(l2));
  assert.equal(fingerprintLayers(l1), fingerprintLayers([{ kind: 'user-config', path: '/a', exists: true, raw: 'model = "m1"\n' }]));
});

// ---------- M10 失败分类：模型错误明确，不把所有 HTTP 错误归为模型问题 ----------

t('M10 模型错误分类：不存在/无权限/强度不支持分别可辨；普通 404 不归为模型问题', () => {
  assert.equal(classifyFailure('ERROR: model "no-such-model" not found', 1).kind, 'model-missing');
  assert.equal(classifyFailure('error: unknown model: foo-bar', 1).kind, 'model-missing');
  assert.equal(classifyFailure('ERROR: you do not have access to model gpt-x (403)', 1).kind, 'model-denied');
  assert.equal(classifyFailure('ERROR: model gpt-x is not available on your plan', 1).kind, 'model-denied');
  assert.equal(classifyFailure('ERROR: invalid reasoning effort "ultra" for model gpt-6-mini', 1).kind, 'effort-unsupported');
  assert.equal(classifyFailure('ERROR: unsupported model_reasoning_effort value', 1).kind, 'effort-unsupported');
  assert.notEqual(classifyFailure('HTTP 404 Not Found', 1).kind.startsWith('model'), true, '泛化 404 不得归为模型问题');
  assert.equal(classifyFailure('HTTP 404 Not Found', 1).kind, 'unknown');
  // 原有分类不回归
  assert.equal(classifyFailure('ERROR: stream error: HTTP 401 Unauthorized', 1).kind, 'auth');
  assert.equal(classifyFailure('ERROR: network error: connection reset', 1).kind, 'network');
  assert.ok(MODEL_FAILURE_KINDS.includes('model-missing'));
  assert.ok(MODEL_FAILURE_KINDS.includes('model-denied'));
  assert.ok(MODEL_FAILURE_KINDS.includes('effort-unsupported'));
});

let failed = 0;
for (const [name, fn] of cases) {
  try {
    fn();
    console.log(`✓ ${name}`);
  } catch (e) {
    failed++;
    console.error(`✗ ${name}\n    ${String(e.message).split('\n')[0]}`);
  }
}
console.log(failed ? `\n${failed} 个用例未通过` : '\n全部通过');
process.exit(failed ? 1 : 0);
