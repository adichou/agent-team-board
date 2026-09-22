#!/usr/bin/env node
// REQ-20260921-007 发布模块的 AI 写作改成 AI 总结，并优化提示词显示布局 —— 第二轮（A 口径剩余增量）。
// 范围：① 正式发布步「官网 AI 写作」→「官网 AI 总结」统一更名（q3 落地，全局无旧文案残留）；
// ② 文档编写步 AI 总结 / AI 翻译提示词预览默认折叠（details 不带 open，复制按钮仍可达）；
// ③ 回归：008 已落地的更名、任务模块 AI 总结页签与全局 summary 类型不回退。
// 用法：node scripts/tests/req-20260921-007.test.mjs

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import '../web/i18n.js';

const webRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'web');
const readWeb = (f) => fs.readFileSync(path.join(webRoot, f), 'utf8');

const cases = [];
const t = (name, fn) => cases.push([name, fn]);

/* ---------- 1 正式发布步更名与全局无残留 ---------- */

t('L1-1 正式发布步第二步标题更名「官网 AI 总结」，build.js / i18n.js 无「AI 写作」键残留', () => {
  const build = readWeb('build.js');
  const i18n = readWeb('i18n.js');
  assert.ok(build.includes('第二步 · 官网 AI 总结'), '正式发布步第二步标题为「第二步 · 官网 AI 总结」');
  assert.ok(!build.includes('AI 写作'), 'build.js 无「AI 写作」残留（含注释）');
  // i18n 历史注释保留更名记录（REQ-20260921-008 注明旧称），断言精确到键字面量
  assert.ok(!/'[^'\n]*AI 写作[^'\n]*'\s*:/.test(i18n), 'i18n.js 无「AI 写作」键残留');
  const I = globalThis.ATBI18N;
  assert.ok(Object.keys(I._dict.EN).every((k) => !k.includes('AI 写作')), 'EN 词典键无「AI 写作」');
});

t('L1-2 i18n 新键中英齐备、旧键清理、值无「AI writing」', () => {
  const I = globalThis.ATBI18N;
  assert.ok(I, 'i18n.js 应在 globalThis.ATBI18N 暴露接口');
  const { EN } = I._dict;
  assert.equal(EN['官网 AI 总结'], 'Website AI summary', '「官网 AI 总结」词条');
  assert.equal(EN['第二步 · 官网 AI 总结'], 'Step 2 · Website AI summary', '「第二步 · 官网 AI 总结」词条');
  assert.ok(!('官网 AI 写作' in EN), '旧键「官网 AI 写作」已清理');
  assert.ok(!('第二步 · 官网 AI 写作' in EN), '旧键「第二步 · 官网 AI 写作」已清理');
  const stale = Object.entries(EN).filter(([, v]) => String(v).includes('AI writing'));
  assert.deepEqual(stale.map(([k]) => k), [], '词典值无「AI writing」残留');
  // 往返不变形
  I.setLang('en');
  assert.equal(I.t('第二步 · 官网 AI 总结'), 'Step 2 · Website AI summary');
  I.setLang('zh');
  assert.equal(I.t('第二步 · 官网 AI 总结'), '第二步 · 官网 AI 总结');
});

/* ---------- 2 提示词预览默认折叠 ---------- */

t('L2-1 AI 总结 / AI 翻译提示词预览默认折叠：details 无 open，复制按钮保留', () => {
  const build = readWeb('build.js');
  const pane = build.match(/  function renderDocsPane\(v\) \{[\s\S]*?\n  \}/)[0];
  const boxes = pane.match(/<details class="bld-docs-prompt-box"[^>]*>/g) || [];
  assert.ok(boxes.length >= 2, `提示词预览 details 至少两处（AI 总结 + AI 翻译），实际 ${boxes.length}`);
  for (const b of boxes) {
    assert.ok(!/\bopen\b/.test(b), `提示词预览默认折叠（不带 open）：${b}`);
  }
  assert.ok(pane.includes('data-pf-copy-prompt'), 'AI 总结「复制提示词」按钮保留');
  assert.ok(pane.includes('data-pf-copy-tprompt'), 'AI 翻译「复制提示词」按钮保留');
  assert.ok(pane.includes('bld-docs-prompt"'), '提示词 textarea 保留（展开后可查看全文）');
});

/* ---------- 3 回归（008 / 012 已落地方径不回退） ---------- */

t('L3-1 回归：文档编写步无「AI 写作」；任务模块 AI 总结页签与全局 summary 类型仍在', () => {
  const build = readWeb('build.js');
  const pane = build.match(/  function renderDocsPane\(v\) \{[\s\S]*?\n  \}/)[0];
  assert.ok(!pane.includes('AI 写作'), '文档编写步内无「AI 写作」（008 口径）');
  assert.ok(build.includes('data-pf-summary'), '「AI 总结」启动按钮仍在（008 三阶段视图）');
  const app = readWeb('app.js');
  assert.ok(app.includes('data-bmode="summary"'), '任务模块 AI 总结一级页签（008）');
  assert.match(app, /GLOBAL_KIND_LABEL\s*=\s*\{[^}]*summary:\s*'AI 总结'/, '全局类型标签 summary（008）');
  assert.match(app, /\['sum-', 'summary'\]/, 'sum- 前缀兜底（008）');
});

/* ---------- 执行 ---------- */

for (const [name, fn] of cases) {
  fn();
  console.log(`✓ ${name}`);
}
console.log(`\n共 ${cases.length} 例，全部通过`);
