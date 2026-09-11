#!/usr/bin/env node
// REQ-20260911-005 C1/C2：覆盖卡点——扫描器实时扫描 app.js + index.html 的全部中文片段
// （文本 + 属性位置），每条必须命中 EN / EN_DYNAMIC / ALLOWLIST 之一；ALLOWLIST 条目
// 不得与词典冗余。新增中文文案不同步词典（或豁免）时本测试变红。
// 用法：node scripts/tests/i18n-coverage.test.mjs

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeScanner, scanHtml, extractFragments } from './lib/js-string-scanner.mjs';
import '../web/i18n.js';

const webRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'web');
const I = globalThis.ATBI18N;
assert.ok(I, 'i18n.js 应在 globalThis.ATBI18N 暴露接口');
const { EN, EN_DYNAMIC, ALLOWLIST } = I._dict;

const appJs = fs.readFileSync(path.join(webRoot, 'app.js'), 'utf8');
const indexHtml = fs.readFileSync(path.join(webRoot, 'index.html'), 'utf8');
const records = [
  ...makeScanner().run(appJs).map((r) => ({ ...r, file: 'app.js' })),
  ...scanHtml(indexHtml).map((r) => ({ ...r, file: 'index.html' })),
];
const { texts, attrs } = extractFragments(records);
const all = [...new Set([...texts, ...attrs])].sort();

const cases = [];
const t = (name, fn) => cases.push([name, fn]);

t(`C1 全部中文片段（文本+属性，共 ${all.length} 条）均被词典或豁免覆盖`, () => {
  const missing = all.filter((s) => {
    if (s in EN || s in EN_DYNAMIC || s in ALLOWLIST) return false;
    // 非动态片段进了动态词典也算覆盖失败（键形态不匹配），交由 missing 报告
    return true;
  });
  assert.deepEqual(
    missing,
    [],
    `以下片段缺少词典/豁免条目（新增文案须同步 scripts/web/i18n.js 或在 ALLOWLIST 注明原因）：\n${missing.map((s) => '  - ' + s).join('\n')}`
  );
});

t('C1b 含 ◇ 的片段必须走 EN_DYNAMIC（不能挂静态词典）', () => {
  const bad = all.filter((s) => s.includes('◇') && s in EN);
  assert.deepEqual(bad, [], `动态片段误入静态词典：${bad.slice(0, 10)}`);
});

t('C2 ALLOWLIST 无冗余（已入词典的条目不得再豁免）', () => {
  const redundant = Object.keys(ALLOWLIST).filter((k) => k in EN || k in EN_DYNAMIC);
  assert.deepEqual(redundant, [], `豁免条目已存在词典：${redundant.slice(0, 10)}`);
});

for (const [name, fn] of cases) {
  fn();
  console.log(`✓ ${name}`);
}
console.log(`\n共 ${cases.length} 例，全部通过`);
