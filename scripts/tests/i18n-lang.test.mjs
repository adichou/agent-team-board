#!/usr/bin/env node
// REQ-20260911-005 L1/L2：语言检测、持久化与优先级、t() 回退语义（零依赖 node:assert）。
// 用法：node scripts/tests/i18n-lang.test.mjs

import assert from 'node:assert/strict';
import '../web/i18n.js';

const I = globalThis.ATBI18N;
assert.ok(I, 'i18n.js 应在 globalThis.ATBI18N 暴露接口');

const cases = [];
const t = (name, fn) => cases.push([name, fn]);

// L3 zh 直通：中文模式下 t() 一律原样返回
t('L3a zh 模式 t() 原样返回（不查词典）', () => {
  I.setLang('zh');
  assert.equal(I.t('待接受'), '待接受');
  assert.equal(I.t('不存在的文案'), '不存在的文案');
});

// L1 检测
t('L1a languages 含 en-* → en', () => {
  assert.equal(I.detect({ languages: ['en-US', 'zh-CN'] }), 'en');
  assert.equal(I.detect({ languages: ['en-GB'] }), 'en');
  assert.equal(I.detect({ languages: [], language: 'en' }), 'en');
});
t('L1b 仅 zh / 其他语言 / 空 → zh', () => {
  assert.equal(I.detect({ languages: ['zh-CN', 'zh'] }), 'zh');
  assert.equal(I.detect({ languages: ['ja-JP'] }), 'zh');
  assert.equal(I.detect({ languages: [], language: 'zh-CN' }), 'zh');
  assert.equal(I.detect({}), 'zh');
});

// L2 持久化与优先级
t('L2a 手动选择优先于系统语言并持久化', () => {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };
  store.set('atb.lang', 'en');
  I.initLang({ languages: ['zh-CN'] });
  assert.equal(I.getLang(), 'en', '已存储 en 时系统 zh 不覆盖');
  assert.equal(I.langSource(), 'manual');
  I.setLang('zh');
  assert.equal(store.get('atb.lang'), 'zh', '切换写入存储');
  assert.equal(I.getLang(), 'zh');
  store.delete('atb.lang');
  I.initLang({ languages: ['en-US'] });
  assert.equal(I.getLang(), 'en', '无存储时按检测初始化');
  assert.equal(I.langSource(), 'auto');
  store.set('atb.lang', 'bogus');
  I.initLang({ languages: ['en-US'] });
  assert.equal(I.getLang(), 'en', '非法存储值视为未设置');
  delete globalThis.localStorage;
});

// L3 t() 语义
t('L3b en 模式：精确词典命中 / 动态回填 / 未命中降级', () => {
  I.setLang('en');
  assert.equal(I.t('待接受'), 'Pending', '精确词典命中');
  assert.match(I.t('已选 3 项'), /3/, '动态命中回填数字');
  assert.equal(I.t('完全不存在的文案xyz'), '完全不存在的文案xyz', '未命中保持原文');
  I.setLang('zh');
});

for (const [name, fn] of cases) {
  fn();
  console.log(`✓ ${name}`);
}
console.log(`\n共 ${cases.length} 例，全部通过`);
