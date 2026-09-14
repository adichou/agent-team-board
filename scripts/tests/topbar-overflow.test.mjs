#!/usr/bin/env node
// BUG-20260830-001 契约测试 —— 顶栏窄窗口：路径省略号、按钮组不压缩不遮挡、≤640px 换行降级。
// 用法：node scripts/tests/topbar-overflow.test.mjs

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const webRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'web');
const css = fs.readFileSync(path.join(webRoot, 'style.css'), 'utf8');
const flat = css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s+/g, ' ');

// 本测试断言的是「基础规则」契约。早期 helper 盲取首个同名规则即成立，
// REQ-20260903-002 v3 在 ≤640 断点内新增了 .view-tabs/.top-actions 覆盖规则，
// 会按文件顺序遮蔽后面的基础规则——故先剥掉所有 @media 块再查找。
function stripMediaBlocks(src) {
  let out = '';
  let i = 0;
  while (i < src.length) {
    const m = src.indexOf('@media', i);
    if (m === -1) {
      out += src.slice(i);
      break;
    }
    out += src.slice(i, m);
    let j = src.indexOf('{', m) + 1;
    let depth = 1;
    while (j < src.length && depth > 0) {
      if (src[j] === '{') depth++;
      else if (src[j] === '}') depth--;
      j++;
    }
    i = j;
  }
  return out;
}
const baseCss = stripMediaBlocks(flat);

function rule(sel) {
  const i = baseCss.indexOf(sel + ' {');
  assert.ok(i >= 0, `未找到基础规则 ${sel}`);
  const end = baseCss.indexOf('}', i);
  return baseCss.slice(i, end);
}

let failed = 0;
function t(name, fn) {
  try {
    fn();
    console.log(`✓ ${name}`);
  } catch (e) {
    failed++;
    console.error(`✗ ${name}\n    ${e.message}`);
  }
}

t('#1 .brand-text 可收缩（min-width: 0），路径省略号能生效', () => {
  assert.match(rule('.brand-text'), /min-width:\s*0/);
});
t('#2 .path 不再用 vw 硬上限，改为 100% + 省略号', () => {
  assert.ok(!/\.path \{[^}]*max-width:\s*46vw/.test(flat), '仍存在 max-width: 46vw');
  assert.match(rule('.path'), /max-width:\s*100%/);
  assert.match(rule('.path'), /text-overflow:\s*ellipsis/);
});
t('#3 模块导航行不被压缩且可横滑（REQ-20260907-004 第二行；顶栏已无视图切换）', () => {
  assert.match(rule('.module-nav'), /flex:\s*none/);
  assert.match(rule('.module-nav'), /overflow-x:\s*auto/, '导航项多时横滑不溢出');
  assert.match(rule('.module-nav .view-tab'), /white-space:\s*nowrap/, '导航项文字不换行');
});
t('#4 .top-actions 不被压缩（flex: none）', () => {
  assert.match(rule('.top-actions'), /flex:\s*none/);
});
t('#5 ≤640px 顶栏允许换行降级（聚合所有同名断点块：紧凑化规则在文件末尾独立块中）', () => {
  const re = /@media \(max-width: 640px\) \{/g;
  let all = '';
  let m;
  let found = false;
  while ((m = re.exec(flat)) !== null) {
    found = true;
    let i = m.index + m[0].length;
    let depth = 1;
    while (i < flat.length && depth > 0) {
      if (flat[i] === '{') depth++;
      else if (flat[i] === '}') depth--;
      i++;
    }
    all += flat.slice(m.index + m[0].length, i - 1) + ' ';
  }
  assert.ok(found, '缺少 640px 断点');
  assert.match(all, /\.topbar \{[^}]*flex-wrap:\s*wrap/);
});

if (failed) {
  console.error(`\n${failed} 个用例失败`);
  process.exit(1);
}
console.log('\n全部通过');
