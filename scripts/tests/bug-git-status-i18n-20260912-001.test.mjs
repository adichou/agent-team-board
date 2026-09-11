#!/usr/bin/env node
// BUG-20260912-001 设置页「Git 工作流」状态行英文残留 —— i18n 词典 + 结构 + 运行时回归。
// 现象：状态行 `当前分支：main · dev 分支：已存在` 为单个文本节点，动态词典
// '当前分支：◇ · dev 分支：◇' 整体命中后捕获组（已存在/未创建/未知）原样回填不翻译，
// 英文界面残留中文；静态词条 '已存在'/'未创建' 因非独立文本节点永远命不中。
// 修复：app.js 状态行把分支名与 dev 状态词分别包进独立 <span>（成为独立文本节点），
// 词典补 '当前分支：'、'· dev 分支：' 静态词条，移除不可达的旧动态键。
// 用法：node scripts/tests/bug-git-status-i18n-20260912-001.test.mjs

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import '../web/i18n.js';

const testsDir = path.dirname(fileURLToPath(import.meta.url));
const pluginRoot = path.resolve(testsDir, '..', '..');
const app = fs.readFileSync(path.join(pluginRoot, 'scripts', 'web', 'app.js'), 'utf8');

const I = globalThis.ATBI18N;
assert.ok(I, 'i18n.js 应在 globalThis.ATBI18N 暴露接口');
const { EN, EN_DYNAMIC } = I._dict;

// ---- 最小假 DOM（与 i18n-runtime.test.mjs 同构） ----
function text(v) { return { nodeType: 3, nodeValue: v, childNodes: [] }; }
function el(tagName, { attrs = {}, children = [] } = {}) {
  const a = { ...attrs };
  return {
    nodeType: 1,
    tagName: String(tagName).toUpperCase(),
    childNodes: children,
    getAttribute: (k) => (k in a ? a[k] : null),
    setAttribute: (k, v) => { a[k] = v; },
    get _attrs() { return a; },
  };
}

// 按修复后渲染结构组装状态行 <p>：当前分支：<span>分支</span> · dev 分支：<span>状态词</span>
function statusLineP(branch, devExists) {
  return el('p', {
    children: [
      text('当前分支：'),
      el('span', { children: [text(branch)] }),
      text(' · dev 分支：'),
      el('span', { children: [text(devExists ? '已存在' : '未创建')] }),
    ],
  });
}

function collectTexts(root, out = []) {
  if (root.nodeType === 3) out.push(root.nodeValue);
  for (const c of root.childNodes || []) collectTexts(c, out);
  return out;
}

const fnSrc = (name) => {
  const i = app.indexOf(`function ${name}`);
  assert.ok(i >= 0, `app.js 应定义 ${name}`);
  return app.slice(i, app.indexOf('\nfunction ', i + 1) === -1 ? app.length : app.indexOf('\nfunction ', i + 1));
};

const cases = [];
const t = (name, fn) => cases.push([name, fn]);

t('T1 英文态状态行全译：dev 状态词（已存在/未创建）不再残留中文', () => {
  I.setLang('en');
  try {
    for (const devExists of [true, false]) {
      const p = statusLineP('main', devExists);
      I.translateTree(p);
      const line = collectTexts(p).join('');
      assert.equal(
        line,
        devExists ? 'Current branch: main · dev branch: exists' : 'Current branch: main · dev branch: not created',
        `整行应译出且无中文残留（实际：${line}）`
      );
      assert.doesNotMatch(line, /[\u4e00-\u9fff]/, '英文态不得残留中文字符');
    }
  } finally { I.setLang('zh'); }
});

t('T1b 分支名保持原样（用户数据不误翻）；缺省「未知」可译', () => {
  I.setLang('en');
  try {
    const p = statusLineP('feature/x', true);
    I.translateTree(p);
    assert.match(collectTexts(p).join(''), /Current branch: feature\/x/, '分支名原文保留');
    const fallback = statusLineP('未知', false);
    I.translateTree(fallback);
    assert.match(collectTexts(fallback).join(''), /Current branch: Unknown/, '「未知」兜底词应译出');
  } finally { I.setLang('zh'); }
});

t('T2 双语往返：en 译出后切回 zh 还原中文状态行', () => {
  I.setLang('en');
  const p = statusLineP('main', true);
  I.translateTree(p);
  I.setLang('zh');
  I.translateTree(p);
  assert.equal(collectTexts(p).join(''), '当前分支：main · dev 分支：已存在');
});

t('T3 词典契约：状态行分段词条齐备且 t() 生效', () => {
  assert.equal(EN['当前分支：'], 'Current branch: ', '应含「当前分支：」词条');
  assert.equal(EN['· dev 分支：'], '· dev branch: ', '应含「· dev 分支：」词条');
  assert.equal(EN['已存在'], 'exists');
  assert.equal(EN['未创建'], 'not created');
  I.setLang('en');
  try {
    assert.equal(I.t('已存在'), 'exists');
    assert.equal(I.t('未创建'), 'not created');
    assert.equal(I.t('· dev 分支：'), '· dev branch: ');
  } finally { I.setLang('zh'); }
});

t('T4 结构契约：状态行分支名与 dev 状态词各自成独立文本节点（span 包裹）', () => {
  const areaFn = fnSrc('gitWorkflowAreaHtml');
  assert.match(
    areaFn,
    /当前分支：<span>\$\{esc\(d\.branch \|\| '未知'\)\}<\/span>/,
    '分支名应包进独立 <span>'
  );
  assert.match(
    areaFn,
    /· dev 分支：<span>\$\{d\.devExists \? '已存在' : '未创建'\}<\/span>/,
    'dev 状态词（已存在/未创建）应包进独立 <span>'
  );
});

t('T5 词典卫生：不可达旧动态键移除（状态行不再整句动态回填）', () => {
  assert.ok(!('当前分支：◇ · dev 分支：◇' in EN_DYNAMIC), '旧动态键「当前分支：◇ · dev 分支：◇」应移除');
});

for (const [name, fn] of cases) {
  fn();
  console.log(`✓ ${name}`);
}
console.log(`\n共 ${cases.length} 例，全部通过`);
