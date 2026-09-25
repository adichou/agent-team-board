#!/usr/bin/env node
// BUG-20260925-003：英文界面下 EN_CLI 词条（校对建议侧栏 / 五步条 / 二次编辑弹窗 /
// 命令注册表分组名等）运行时不翻译——t() 只查主 EN 词典，EN_CLI 仅并入 _dict.EN
//（测试口径），运行时与测试查表分叉。本文件以 t() 运行时口径断言：
// B1/B2 代表词条可查 · B3 全量遍历无「键在 _dict.EN 而 t() 查不到」残留 ·
// B4 en→zh 往返 · B5 四个历史双定义键收口 · B6 translateTree 渲染路径 ·
// B7 zh 模式回归 · B8 源级组装契约（EN_CLI 块物理独立 + Object.assign 先于 ZH_EXACT）。
// 用法：node scripts/tests/bug-20260925-003.test.mjs

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import '../web/i18n.js';

const I = globalThis.ATBI18N;
assert.ok(I, 'i18n.js 应在 globalThis.ATBI18N 暴露接口');
const { EN } = I._dict;

const webRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'web');
const i18nSrc = fs.readFileSync(path.join(webRoot, 'i18n.js'), 'utf8');

// 最小假 DOM（与 i18n-runtime 同口径）
function text(v) { return { nodeType: 3, nodeValue: v, childNodes: [] }; }
function el(tagName, { children = [] } = {}) {
  return { nodeType: 1, tagName: String(tagName).toUpperCase(), childNodes: children };
}

const cases = [];
const t = (name, fn) => cases.push([name, fn]);

// B1 README 方式 B 最小验证等价：setLang('en') 后 t() 能查到 EN_CLI 静态词条
//（REQ-20260924-006 文档编写五步 / 校对建议侧栏 / 二次编辑弹窗）
t('B1 EN_CLI 静态词条经 t() 可查（五步条 / 校对建议侧栏 / 二次编辑弹窗）', () => {
  const samples = {
    '五步：': 'Five steps:',
    '① AI 总结': '① AI summary',
    '② 二次编辑': '② Second edit',
    '③ AI 校对': '③ AI proofread',
    '④ AI 翻译': '④ AI translation',
    '⑤ 提交': '⑤ Commit',
    '校对建议': 'Proofread suggestions',
    '选择要查看校对建议的文件': 'Select a file to view its proofread suggestions',
    '重试 AI 校对': 'Retry AI proofread',
    '过期': 'Stale',
    '已拒绝': 'Rejected',
    '无行号': 'No line number',
    '查看修改前后差异': 'View before/after diff',
    '修改前（删除）': 'Before (deletion)',
    '修改后（新增）': 'After (insertion)',
    '错别字': 'Typo',
    '链接': 'Link',
    '语法': 'Grammar',
    '行文规范': 'Writing style',
    '已拒绝该条建议：原文保持不变': 'Suggestion rejected: the original text is unchanged',
    '二次编辑（默认语言）': 'Second edit (default language)',
    '保存并继续': 'Save & continue',
    '放弃修改并继续': 'Discard & continue',
    '留在本文件': 'Stay on this file',
  };
  const before = I.getLang();
  I.setLang('en');
  for (const [k, v] of Object.entries(samples)) {
    assert.equal(I.t(k), v, `t(${JSON.stringify(k)}) 应为 ${v}（实际：${I.t(k)}）`);
    assert.equal(EN[k], v, `_dict.EN[${JSON.stringify(k)}] 应为 ${v}`);
  }
  I.setLang(before);
});

// B2 命令注册表词条（REQ-20260920-004：同根因连带——commands.js 分组名以普通文本节点
// 走 translateTree → t()，修复前运行时同样查不到）
t('B2 命令注册表词条经 t() 可查（分组名 / 命令说明 / 参数标签）', () => {
  const samples = {
    '数据与分发': 'Data & distribution',
    '条目生命周期': 'Item lifecycle',
    '执行回执': 'Run receipts',
    '查询': 'Query',
    '服务': 'Service',
    '终端命令': 'Terminal commands',
    '创建需求（缺省状态 submitted）': 'Create a requirement (default status submitted)',
    '认领条目（accepted/planned → in-progress，原子锁）': 'Claim an item (accepted/planned → in-progress, atomic lock)',
    '新标题': 'New title',
    '问题号': 'Question #',
  };
  const before = I.getLang();
  I.setLang('en');
  for (const [k, v] of Object.entries(samples)) {
    assert.equal(I.t(k), v, `t(${JSON.stringify(k)}) 应为 ${v}（实际：${I.t(k)}）`);
  }
  I.setLang(before);
});

// B3 验收 1：遍历断言——_dict.EN（EN ∪ EN_CLI）全部键 t() 可查，
// 无「键在 _dict.EN 而 t() 查不到」的残留（测试口径与运行时口径合一）
t('B3 全量遍历：_dict.EN 每键 setLang(en) 后 t() 命中词典值', () => {
  const before = I.getLang();
  I.setLang('en');
  const missing = [];
  for (const [k, v] of Object.entries(EN)) {
    if (I.t(k) !== v) missing.push(`${k} → ${I.t(k)}（期望 ${v}）`);
  }
  I.setLang(before);
  assert.deepEqual(missing, [], `以下键在 _dict.EN 而 t() 查不到（运行时/测试口径分叉）：\n${missing.slice(0, 15).map((s) => '  - ' + s).join('\n')}`);
});

// B4 验收 3：en→zh 往返——EN_CLI 词条并入 ZH_EXACT 反向词典，切回中文无英文残段
t('B4 全量往返：setLang(zh) 后 t(EN 值) 还原中文键（含 EN_CLI 词条）', () => {
  const before = I.getLang();
  I.setLang('zh');
  const broken = [];
  for (const [k, v] of Object.entries(EN)) {
    if (I.t(v) !== k) broken.push(`${v} → ${I.t(v)}（期望 ${k}）`);
  }
  I.setLang(before);
  assert.deepEqual(broken, [], `以下英文值切回中文无法还原（ZH_EXACT 缺口）：\n${broken.slice(0, 15).map((s) => '  - ' + s).join('\n')}`);
});

// B5 验收 6：四个历史双定义键收口——源内单定义 + 命中值明确
//（待确认取 EN_CLI 'To verify'：唯一独立渲染点是校对建议状态 chip；
//  人工决策 / 挂起确认 / 重试读取保持主 EN 线上值，EN_CLI 侧重复定义删除）
t('B5 双定义键收口：源内单定义，t() 命中值明确无歧义', () => {
  const expectEn = {
    '待确认': 'To verify',
    '人工决策': 'Human decisions',
    '挂起确认': 'Suspension confirmation',
    '重试读取': 'Retry loading',
  };
  for (const [k, v] of Object.entries(expectEn)) {
    const defs = [...i18nSrc.matchAll(new RegExp(`^  '${k.replace(/[.*+?^${}()|[\]\\\\]/g, '\\$&')}': `, 'gm'))];
    assert.equal(defs.length, 1, `「${k}」应只定义一次（实际 ${defs.length} 处）`);
    assert.equal(I._dict.EN[k], v, `_dict.EN[${JSON.stringify(k)}] 应为 ${v}`);
  }
  const before = I.getLang();
  I.setLang('en');
  for (const [k, v] of Object.entries(expectEn)) assert.equal(I.t(k), v, `t(${k}) 应为 ${v}`);
  I.setLang('zh');
  assert.equal(I.t('To verify'), '待确认', '反向：To verify → 待确认');
  I.setLang(before);
});

// B6 渲染路径：translateTree 翻译 EN_CLI 词条文本节点（build.js chip / 侧栏标题同路径），zh 往返还原
t('B6 translateTree 渲染路径：EN_CLI 文本节点 en 译出、zh 译回', () => {
  I.setLang('en');
  const chip = text('待确认');
  const title = text('校对建议');
  I.translateTree(el('div', { children: [chip, title] }));
  assert.equal(chip.nodeValue, 'To verify', '校对建议状态 chip 文本节点应译为 To verify');
  assert.equal(title.nodeValue, 'Proofread suggestions', '侧栏标题文本节点应译出');
  I.setLang('zh');
  I.translateTree(el('div', { children: [chip, title] }));
  assert.equal(chip.nodeValue, '待确认', '切回中文还原 chip');
  assert.equal(title.nodeValue, '校对建议', '切回中文还原标题');
});

// B7 验收 4：中文界面回归——zh 模式原样返回
t('B7 zh 模式回归：EN_CLI 词条原样返回中文', () => {
  I.setLang('zh');
  assert.equal(I.t('校对建议'), '校对建议');
  assert.equal(I.t('待确认'), '待确认');
  assert.equal(I.t('数据与分发'), '数据与分发');
});

// B8 源级组装契约：EN_CLI 块物理独立保留（realtime-round RT-09 剔除口径依赖），
// Object.assign 组装并入且位于 ZH_EXACT 反向词典构建之前
t('B8 源级组装契约：EN_CLI 块独立 + Object.assign 先于 ZH_EXACT 构建', () => {
  assert.match(i18nSrc, /const EN_CLI = \{[\s\S]*?\n\};/, 'EN_CLI 应保留为物理独立块');
  const assignIdx = i18nSrc.indexOf('Object.assign(EN, EN_CLI)');
  assert.ok(assignIdx > 0, '应有 Object.assign(EN, EN_CLI) 组装语句');
  assert.ok(assignIdx < i18nSrc.indexOf('const ZH_EXACT'), '组装必须先于 ZH_EXACT 构建（反向词典同口径）');
  assert.ok(assignIdx > i18nSrc.indexOf('const EN_CLI'), '组装应位于 EN_CLI 块之后');
});

for (const [name, fn] of cases) {
  fn();
  console.log(`✓ ${name}`);
}
console.log(`\n共 ${cases.length} 例，全部通过`);
