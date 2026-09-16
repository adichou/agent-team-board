#!/usr/bin/env node
// REQ-20260914-004 右键「讨论」提示词追加「讨论要求」 —— vm 纯函数 + 静态契约测试
// 用法：node scripts/tests/doc-ctx-discuss-req-20260914-004.test.mjs
// 覆盖 test-cases.md 的 T1–T8（菜单浮层/深浅色/Electron 目检不在自动化范围）；
// BUG-20260914-019 追加 T9：提示词末尾恰一个换行（粘贴后用户问题与提示词明确分行）。

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const js = fs.readFileSync(path.join(pluginRoot, 'scripts', 'web', 'app.js'), 'utf8');

const cases = [];
const t = (name, fn) => cases.push([name, fn]);

function fnSrc(name) {
  const m = js.match(new RegExp(`^(?:async )?function ${name}\\([\\s\\S]*?^\\}`, 'm'));
  assert.ok(m, `应存在 ${name} 函数`);
  return m[0];
}

// 在 vm 沙箱里提取源码中的纯函数（无 DOM 依赖，桩对象注入）
function loadFns(names) {
  const sandbox = {};
  vm.createContext(sandbox);
  vm.runInContext(names.map(fnSrc).join('\n'), sandbox);
  return sandbox;
}

// 讨论要求三条 commit 指令的关键内容（T3 复用）
function assertCommitRules(ref, id) {
  assert.match(ref, /同轮同步执行 git commit/, '指令①：须含「同轮同步执行 git commit」');
  assert.match(ref, /不留未提交改动/, '指令①：须含「不留未提交改动」');
  assert.match(ref, /commit message 须包含/, '指令②：须含「commit message 须包含」');
  assert.ok(ref.includes(id), '指令②：条目单号应动态取当前条目 id');
  assert.match(ref, /本轮用户问题摘要/, '指令②：须含「本轮用户问题摘要」');
  assert.match(ref, /本轮回答（改动）摘要/, '指令②：须含「本轮回答（改动）摘要」');
  assert.match(ref, /commit log 与 commit 号/, '指令③：须含「commit log 与 commit 号」');
  assert.match(ref, /短哈希/, '指令③：应注明 commit 号短哈希即可');
}

// ---------- T1 有选中：引用要素全保留 ----------

t('T1 buildDocRef 有选中：分区标记 + 单号/文档名/行范围/路径/原文全保留', () => {
  const sb = loadFns(['docRefPath', 'buildDocRef']);
  const p = sb.docRefPath('/Users/x/proj', 'REQ-1', 'design.md');
  const ref = sb.buildDocRef({ id: 'REQ-1', name: 'design.md', path: p, start: 3, end: 4, text: '原文片段' });
  assert.ok(ref.includes('【文档讨论引用】'), '应有引用分区标记');
  assert.ok(ref.indexOf('【文档讨论引用】') < ref.indexOf('REQ-1 / design.md'), '分区标记应在单号行之前');
  assert.ok(ref.includes('REQ-1 / design.md 第 3–4 行'), '单号 / 文档名 第 x–y 行应保留');
  assert.ok(ref.includes(`文档：${p}`), '应含绝对文档路径');
  assert.ok(ref.includes('原文：\n原文片段'), '有选中时应附原文');
});

// ---------- T2 「讨论要求」分区与空行分隔 ----------

t('T2 buildDocRef 追加「讨论要求」：空行分隔 + 标题「【讨论要求】请在本轮及后续讨论中遵守：」', () => {
  const sb = loadFns(['docRefPath', 'buildDocRef']);
  const p = sb.docRefPath('/Users/x/proj', 'REQ-1', 'design.md');
  const ref = sb.buildDocRef({ id: 'REQ-1', name: 'design.md', path: p, start: 3, end: 4, text: '原文片段' });
  assert.ok(ref.includes('原文片段\n\n【讨论要求】'), '原文节与讨论要求之间应空一行');
  assert.ok(ref.includes('【讨论要求】请在本轮及后续讨论中遵守：'), '应有讨论要求标题');
  assert.ok(ref.indexOf('【讨论要求】') > ref.indexOf(`文档：${p}`), '讨论要求应追加在引用之后');
  const refNoText = sb.buildDocRef({ id: 'REQ-1', name: 'design.md', path: p, start: 3, end: 4, text: '' });
  assert.ok(refNoText.includes('【讨论要求】'), '讨论要求不应依赖原文节存在');
});

// ---------- T3 三条 commit 指令完整覆盖 ----------

t('T3 讨论要求完整覆盖三条指令：同轮同步 commit / message 含单号+问题摘要+回答摘要 / 回显 commit log 与 commit 号', () => {
  const sb = loadFns(['docRefPath', 'buildDocRef']);
  const p = sb.docRefPath('/Users/x/proj', 'REQ-1', 'design.md');
  const ref = sb.buildDocRef({ id: 'REQ-1', name: 'design.md', path: p, start: 3, end: 4, text: '原文片段' });
  assertCommitRules(ref, 'REQ-1');
});

// ---------- T4 无选中：无原文节但同样携带讨论要求 ----------

t('T4 无选中：仍无「原文」节，但同样携带完整「讨论要求」；单行范围仍为「第 x 行」', () => {
  const sb = loadFns(['docRefPath', 'buildDocRef']);
  const p = sb.docRefPath('/Users/x/proj', 'REQ-1', 'README.md');
  const ref = sb.buildDocRef({ id: 'REQ-1', name: 'README.md', path: p, start: 42, end: 42, text: null });
  assert.ok(ref.includes('第 42 行'), '单行范围应为「第 x 行」');
  assert.ok(!ref.includes('原文'), '无选中时不应有原文节');
  assert.ok(ref.includes('【讨论要求】'), '无选中也应携带讨论要求');
  assertCommitRules(ref, 'REQ-1');
});

// ---------- T5 纯文本 + 条目单号动态 ----------

t('T5 整体为单次复制纯文本：无 Markdown 渲染符号混入；条目单号动态取当前条目 id（Bug 单同口径）', () => {
  const sb = loadFns(['docRefPath', 'buildDocRef']);
  const p = sb.docRefPath('/Users/x/proj', 'BUG-20260913-003', 'README.md', 'REQ-20260909-014');
  const ref = sb.buildDocRef({ id: 'BUG-20260913-003', name: 'README.md', path: p, start: 5, end: 6, text: null });
  assert.ok(ref.includes('BUG-20260913-003'), 'Bug 单号应出现在引用与讨论要求中');
  assert.ok(ref.includes('条目单号'), '讨论要求应提条目单号');
  assert.ok(ref.includes('条目单号（如 BUG-20260913-003）'), '单号示例应动态取当前条目 id');
  for (const line of ref.split('\n')) {
    assert.doesNotMatch(line, /^#{1,6}\s/, `不得混入 Markdown 标题符号：${line}`);
    assert.doesNotMatch(line, /\*\*/, `不得混入 Markdown 加粗符号：${line}`);
    assert.doesNotMatch(line, /`/, `不得混入 Markdown 代码符号：${line}`);
  }
});

// ---------- T6 唯一组装点：三份页签与 Bug 抽屉同口径 ----------

t('T6 buildDocRef 为唯一组装点且不按文档名分支（README/design/test-cases 与 Bug 抽屉同口径）', () => {
  assert.equal((js.match(/buildDocRef/g) || []).length, 2, 'buildDocRef 应仅有定义 + onDocCtxMenu 单点调用两处');
  assert.match(js, /text: buildDocRef\(\{ id: state\.drawer\.id, name, path/, 'onDocCtxMenu 仍单点调用 buildDocRef');
  const b = fnSrc('buildDocRef');
  assert.doesNotMatch(b, /name === ['"]/, '组装不得按文档名分支（同口径全部生效）');
});

// ---------- T7 复制链路零改动（静态契约沿用） ----------

t('T7 零回归：toast 摘要口径 / copyPlain 双回退 / uiCopyBox 手动复制承载完整新文本', () => {
  const d = fnSrc('onDocCtxDiscuss');
  assert.match(d, /await copyPlain\(/, '应走 copyPlain 双回退');
  assert.match(d, /已复制 引用：/, 'toast 摘要口径不变');
  assert.match(d, /uiCopyBox\('手动复制讨论引用', info\.text\)/, '自动复制失败应由 uiCopyBox 展示完整文本');
  const box = fnSrc('uiCopyBox');
  assert.match(box, /readOnly = true|setAttribute\('readonly'/, '手动复制文本域应只读');
  assert.match(box, /textarea/i, '应以文本域完整展开变长提示词');
});

// ---------- T8 纯前端：无后端调用 / 文件写入 ----------

t('T8 纯前端：buildDocRef 无 api()/fetch() 后端调用、无文件写入', () => {
  const b = fnSrc('buildDocRef');
  assert.doesNotMatch(b, /\bapi\(|\bfetch\(/, '不应有后端请求');
  assert.doesNotMatch(b, /writeFile|localStorage|sessionStorage/, '不应有文件 / 存储写入');
});

// ---------- T9 BUG-20260914-019 提示词末尾恰一个换行 ----------

t('T9 buildDocRef 末尾换行：有/无选中均以单个 \\n 结尾（endsWith("\\n") 且不以 "\\n\\n" 结尾），内容不因修复改变', () => {
  const sb = loadFns(['docRefPath', 'buildDocRef']);
  const p = sb.docRefPath('/Users/x/proj', 'REQ-1', 'design.md');
  const ref = sb.buildDocRef({ id: 'REQ-1', name: 'design.md', path: p, start: 3, end: 4, text: '原文片段' });
  assert.ok(ref.endsWith('\n'), '有选中：提示词应以换行符结尾，粘贴后光标落在新行');
  assert.ok(!ref.endsWith('\n\n'), '有选中：末尾只追加一个换行，不得产生多余空行');
  assert.ok(ref.endsWith('（短哈希即可）。\n'), '末行内容应保持不变，换行紧随其后');
  const ref2 = sb.buildDocRef({ id: 'BUG-2', name: 'README.md', path: p, start: 42, end: 42, text: null });
  assert.ok(ref2.endsWith('\n'), '无选中：同样以换行符结尾');
  assert.ok(!ref2.endsWith('\n\n'), '无选中：末尾同样只一个换行');
  assert.ok(!ref2.startsWith('\n'), '开头不得追加换行');
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
