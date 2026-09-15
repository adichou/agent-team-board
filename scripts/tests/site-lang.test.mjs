#!/usr/bin/env node
// REQ-20260915-002 官网语言选择（site-lang）测试 D1~D3
// 用法：node scripts/tests/site-lang.test.mjs

import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { pickSiteLanguage, matchBrowserLanguage } from '../lib/site-lang.mjs';

const cases = [];
const t = (name, fn) => cases.push([name, fn]);

t('D1 zh 变体 → zh；en 变体 → en；无匹配/空 → 回退 en', () => {
  for (const lang of ['zh', 'zh-CN', 'zh-TW', 'zh-SG', 'zh-Hans-CN']) {
    assert.equal(pickSiteLanguage({ browserLanguages: [lang] }), 'zh', lang);
  }
  for (const lang of ['en', 'en-US', 'en-GB']) {
    assert.equal(pickSiteLanguage({ browserLanguages: [lang] }), 'en', lang);
  }
  assert.equal(pickSiteLanguage({ browserLanguages: ['ja-JP'] }), 'en', '无匹配回退英文');
  assert.equal(pickSiteLanguage({ browserLanguages: [] }), 'en', '空列表回退英文');
  assert.equal(pickSiteLanguage({ browserLanguages: null }), 'en', '无法读取回退英文');
});

t('D2 多语言优先级按序取第一个命中', () => {
  assert.equal(pickSiteLanguage({ browserLanguages: ['ja', 'zh-CN', 'en'] }), 'zh');
  assert.equal(pickSiteLanguage({ browserLanguages: ['fr-FR', 'ja', 'en-US'] }), 'en');
  assert.equal(matchBrowserLanguage(['ja', 'zh-TW', 'en']), 'zh');
  assert.equal(matchBrowserLanguage(['ja']), null);
});

t('D3 手动偏好优先；auto 跟随浏览器', () => {
  assert.equal(pickSiteLanguage({ browserLanguages: ['en-US'], stored: 'zh' }), 'zh');
  assert.equal(pickSiteLanguage({ browserLanguages: ['zh-CN'], stored: 'en' }), 'en');
  assert.equal(pickSiteLanguage({ browserLanguages: ['zh-CN'], stored: 'auto' }), 'zh');
  assert.equal(pickSiteLanguage({ browserLanguages: ['de'], stored: 'auto' }), 'en');
});

/* ---------- 执行 ---------- */

let failed = 0;
for (const [name, fn] of cases) {
  try {
    await fn();
    console.log(`✓ ${name}`);
  } catch (e) {
    failed++;
    console.error(`✗ ${name}\n${e && e.stack ? e.stack : e}`);
  }
}
console.log(`site-lang：${cases.length - failed}/${cases.length} 通过`);
process.exit(failed ? 1 : 0);
