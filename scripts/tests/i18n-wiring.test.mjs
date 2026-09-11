#!/usr/bin/env node
// REQ-20260911-005 W1/W2：接线——index.html 在 app.js 之前引入 i18n.js、顶栏存在语言
// 切换按钮 #btnLang；app.js 零改动（不引用 i18n 机制，保持解耦）。
// 用法：node scripts/tests/i18n-wiring.test.mjs

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const webRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'web');
const html = fs.readFileSync(path.join(webRoot, 'index.html'), 'utf8');
const appJs = fs.readFileSync(path.join(webRoot, 'app.js'), 'utf8');

const cases = [];
const t = (name, fn) => cases.push([name, fn]);

t('W1a index.html 引入 /i18n.js 且位于 /app.js 之前', () => {
  const i18nIdx = html.indexOf('<script src="/i18n.js"></script>');
  const appIdx = html.indexOf('<script src="/app.js"></script>');
  assert.ok(i18nIdx > 0, '缺少 <script src="/i18n.js"></script>');
  assert.ok(appIdx > 0, '缺少 app.js 引入');
  assert.ok(i18nIdx < appIdx, 'i18n.js 必须在 app.js 之前加载');
});

t('W1b 顶栏存在语言切换按钮 #btnLang（位于快捷键按钮之前）', () => {
  const btnIdx = html.indexOf('id="btnLang"');
  const keysIdx = html.indexOf('id="btnShortcuts"');
  assert.ok(btnIdx > 0, '顶栏缺少 #btnLang 语言按钮');
  assert.ok(keysIdx > 0);
  assert.ok(btnIdx < keysIdx, '语言按钮应位于「快捷键 ?」左侧');
});

t('W1c app.js 零改动：不引用 i18n 机制（运行时翻译层完全外置）', () => {
  assert.doesNotMatch(appJs, /ATBI18N/i, 'app.js 不应引用 ATBI18N');
  assert.doesNotMatch(appJs, /i18n/i, 'app.js 不应包含 i18n 标识');
});

t('W2 i18n.js 存在且挂载 window.ATBI18N', () => {
  const src = fs.readFileSync(path.join(webRoot, 'i18n.js'), 'utf8');
  assert.match(src, /ATBI18N/, 'i18n.js 应定义 ATBI18N');
  assert.match(src, /localStorage/, '应持久化语言选择');
  assert.match(src, /navigator\.languages/, '应按系统语言检测');
});

for (const [name, fn] of cases) {
  fn();
  console.log(`✓ ${name}`);
}
console.log(`\n共 ${cases.length} 例，全部通过`);
