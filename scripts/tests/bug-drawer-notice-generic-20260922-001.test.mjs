#!/usr/bin/env node
// BUG-20260922-001：详情抽屉 accepted 未入计划 notice 把双宿主通用能力（/dev 命令）
// 写成 ZCode 专属（「或在 ZCode 会话运行」/ EN "run in a ZCode session"），与插件
// ZCode/Codex 双宿主分发定位不符。修复后主文案改通用口径「在您使用的 Agent 会话运行」，
// EN 词典键随中文原文更新、值同步通用化；「让 Agent 直接认领。」词条无宿主名保留。
// 本文件回归：
// B1 app.js accepted notice 文案契约（通用表述、不含「ZCode 会话」）；
// B2 i18n 词典：新键存在且值不含 "ZCode session"，旧键（或在 ZCode 会话运行）移除；
// B3 「让 Agent 直接认领。」词条保留（无宿主名，本身通用）；
// B4 全局防线：scripts/web/ 源码（app.js / build.js / i18n.js）不再出现「ZCode 会话」；
//     保留的事实性宿主描述（「去新建 Zcode 会话」双宿主并列链接、zcode:// 深链检测提示）
//     不在本测试禁止之列（口径见 BUG-20260922-001 README 排查结论）。
// 用法：node scripts/tests/bug-drawer-notice-generic-20260922-001.test.mjs

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import '../web/i18n.js';

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'web');
const appJs = fs.readFileSync(path.join(webRoot, 'app.js'), 'utf8');
const buildJs = fs.readFileSync(path.join(webRoot, 'build.js'), 'utf8');
const I = globalThis.ATBI18N;
assert.ok(I, 'i18n.js 应在 globalThis.ATBI18N 暴露接口');
const { EN } = I._dict;

const NOTICE_KEY = '未入计划。可点「移入计划」排入开发计划（开发启动后最旧优先处理），或在您使用的 Agent 会话运行';
const LEGACY_KEY = '未入计划。可点「移入计划」排入开发计划（开发启动后最旧优先处理），或在 ZCode 会话运行';

const cases = [];
const t = (name, fn) => cases.push([name, fn]);

t('B1 app.js accepted notice：通用表述「在您使用的 Agent 会话运行 /dev」，不含「ZCode 会话」', () => {
  const fn = appJs.match(/function drawerActionsNoticeHtml\(it\)[\s\S]*?\n\}/);
  assert.ok(fn, '应存在 drawerActionsNoticeHtml 函数');
  assert.match(
    fn[0],
    /未入计划。可点「移入计划」排入开发计划（开发启动后最旧优先处理），或在您使用的 Agent 会话运行 <code>\/dev \$\{esc\(it\.id\)\}<\/code> 让 Agent 直接认领。/,
    'accepted 分支应为通用宿主表述'
  );
  assert.doesNotMatch(fn[0], /ZCode 会话/, 'notice 不得再写 ZCode 专属会话指引');
});

t('B2 i18n 词典：新键存在、英文值通用化（不含 ZCode session），旧键移除', () => {
  assert.ok(NOTICE_KEY in EN, `EN 词典应含新键：${NOTICE_KEY}`);
  const v = EN[NOTICE_KEY];
  assert.match(v, /your agent session/, '英文值应为通用 agent session 表述');
  assert.doesNotMatch(v, /ZCode/i, '英文值不得再提 ZCode');
  assert.ok(!(LEGACY_KEY in EN), '旧键（或在 ZCode 会话运行）应随中文原文一并移除');
  const legacyHit = Object.entries(EN).filter(([k, val]) => /ZCode session/.test(String(val)));
  assert.deepEqual(legacyHit, [], `EN 值不得再出现 "ZCode session"：${legacyHit.map(([k]) => k).join('、')}`);
});

t('B3 「让 Agent 直接认领。」词条保留（无宿主名，本身通用）', () => {
  assert.equal(EN['让 Agent 直接认领。'], 'and let the Agent claim it directly.');
});

t('B4 全局防线：scripts/web 源码不再出现「ZCode 会话」排他文案', () => {
  for (const [name, src] of [['app.js', appJs], ['build.js', buildJs]]) {
    assert.doesNotMatch(src, /ZCode 会话/, `${name} 不得出现「ZCode 会话」`);
  }
  assert.doesNotMatch(fs.readFileSync(path.join(webRoot, 'i18n.js'), 'utf8'), /ZCode 会话/, 'i18n.js 不得出现「ZCode 会话」');
});

for (const [name, fn] of cases) {
  fn();
  console.log(`✓ ${name}`);
}
console.log(`\n共 ${cases.length} 例，全部通过`);
