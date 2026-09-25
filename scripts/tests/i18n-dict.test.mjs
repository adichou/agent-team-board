#!/usr/bin/env node
// REQ-20260911-005 D1/D2：词典完整性——值无中文、无重复键、动态键可编译、
// 模板捕获组引用不越界；EN 键含中文且值非空。
// 用法：node scripts/tests/i18n-dict.test.mjs

import assert from 'node:assert/strict';
import '../web/i18n.js';

const I = globalThis.ATBI18N;
assert.ok(I, 'i18n.js 应在 globalThis.ATBI18N 暴露接口');
const { EN, EN_DYNAMIC, ALLOWLIST } = I._dict;

const cases = [];
const t = (name, fn) => cases.push([name, fn]);

t('D1a EN：键含中文、值非空且不含中文', () => {
  const bad = [];
  for (const [k, v] of Object.entries(EN)) {
    if (!/[\u4e00-\u9fff]/.test(k)) bad.push(`键无中文：${k}`);
    if (!v || !String(v).trim()) bad.push(`值为空：${k}`);
    if (/[\u4e00-\u9fff]/.test(v)) bad.push(`值含中文：${k} → ${v}`);
  }
  assert.deepEqual(bad, [], `词典质量问题：\n${bad.slice(0, 20).join('\n')}`);
});

t('D1b EN_DYNAMIC：键含 ◇ 与中文、值不含中文、捕获组引用不越界', () => {
  const bad = [];
  for (const [k, v] of Object.entries(EN_DYNAMIC)) {
    const marks = (k.match(/◇/g) || []).length;
    if (marks < 1) bad.push(`动态键缺 ◇：${k}`);
    if (!/[\u4e00-\u9fff]/.test(k)) bad.push(`动态键无中文：${k}`);
    if (/[\u4e00-\u9fff]/.test(v)) bad.push(`动态值含中文：${k} → ${v}`);
    const refs = [...String(v).matchAll(/\$(\d+)/g)].map((m) => Number(m[1]));
    if (refs.some((r) => r < 1 || r > marks)) bad.push(`捕获组越界（◇=${marks}）：${k} → ${v}`);
  }
  assert.deepEqual(bad, [], `动态词典质量问题：\n${bad.slice(0, 20).join('\n')}`);
});

t('D1c 键唯一性：EN 与 EN_DYNAMIC 无交叠', () => {
  const overlap = Object.keys(EN).filter((k) => k in EN_DYNAMIC);
  assert.deepEqual(overlap, [], `同键两处定义：${overlap.slice(0, 10)}`);
});

t('D1d ALLOWLIST：每条都有原因（值为非空说明）', () => {
  const bad = Object.entries(ALLOWLIST).filter(([, reason]) => !reason || !String(reason).trim());
  assert.deepEqual(bad.map(([k]) => k), [], 'ALLOWLIST 必须逐条注明豁免原因');
});

t('D1e EN 值唯一：反向映射（切回中文）无歧义', () => {
  const seen = new Map();
  const dup = [];
  for (const [k, v] of Object.entries(EN)) {
    if (seen.has(v)) dup.push(`${v} ← ${seen.get(v)} | ${k}`);
    else seen.set(v, k);
  }
  assert.deepEqual(dup, [], `英文值重复会让切回中文时无法还原：\n${dup.join('\n')}`);
});

// BUG-20260925-003：测试口径与运行时口径合一——_dict.EN（EN ∪ EN_CLI）每键必须经
// 运行时 t() 可查且可往返。此前测试只查 _dict.EN 合并副本、运行时 t() 只查主 EN，
// EN_CLI 词条分叉漏译未被本套件拦截。
t('D1f 运行时查表合一：_dict.EN 每键经 t() 可查、en 译值可回 zh（BUG-20260925-003）', () => {
  const before = I.getLang();
  const notTranslated = [];
  const notReversible = [];
  I.setLang('en');
  for (const [k, v] of Object.entries(EN)) {
    if (I.t(k) !== v) notTranslated.push(`${k} → ${I.t(k)}（期望 ${v}）`);
  }
  I.setLang('zh');
  for (const [k, v] of Object.entries(EN)) {
    if (I.t(v) !== k) notReversible.push(`${v} → ${I.t(v)}（期望 ${k}）`);
  }
  I.setLang(before);
  assert.deepEqual(notTranslated, [], `键在 _dict.EN 而 t() 查不到（运行时/测试口径分叉）：\n${notTranslated.slice(0, 15).map((s) => '  - ' + s).join('\n')}`);
  assert.deepEqual(notReversible, [], `en 译值切回 zh 无法还原（ZH_EXACT 缺口）：\n${notReversible.slice(0, 15).map((s) => '  - ' + s).join('\n')}`);
});

for (const [name, fn] of cases) {
  fn();
  console.log(`✓ ${name}`);
}
console.log(`\nEN ${Object.keys(EN).length} 条 · EN_DYNAMIC ${Object.keys(EN_DYNAMIC).length} 条 · ALLOWLIST ${Object.keys(ALLOWLIST).length} 条，全部通过`);
