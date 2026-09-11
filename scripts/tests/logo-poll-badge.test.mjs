#!/usr/bin/env node
// REQ-20260906-009 契约测试 —— 实时状态标志移动到左侧 logo 右上角叠加显示。
// 用法：node scripts/tests/logo-poll-badge.test.mjs
// 覆盖 test-cases.md 的 T1–T4；B1 为浏览器实测。

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const webRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'web');
const html = fs.readFileSync(path.join(webRoot, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(webRoot, 'style.css'), 'utf8');
const js = fs.readFileSync(path.join(webRoot, 'app.js'), 'utf8');

// 与 topbar-overflow.test.mjs 同法：断言「基础规则」契约，先剥注释与 @media 块，
// 避免断点内覆盖规则按文件顺序遮蔽基础规则导致误判。
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
const baseCss = stripMediaBlocks(css.replace(/\/\*[\s\S]*?\*\//g, ''));

function rule(sel) {
  const i = baseCss.indexOf(sel + ' {');
  assert.ok(i >= 0, `未找到基础规则 ${sel}`);
  const end = baseCss.indexOf('}', i);
  return baseCss.slice(i, end);
}

const cases = [];
const t = (name, fn) => cases.push([name, fn]);

t('T1 结构迁移：#pollState 渲染在 .brand 的徽标容器 .logo-badge 内（与 .logo 同容器），不再位于 .top-actions', () => {
  const brand = html.match(/<div class="brand">[\s\S]*?<\/div>\s*<\/div>|<div class="brand">[\s\S]*?<\/nav>/);
  assert.ok(brand, '应存在 .brand 区块');
  const badge = brand[0].match(/<span class="logo-badge">[\s\S]*?<\/span>\s*<\/span>|<span class="logo-badge">[\s\S]*?id="pollState"[\s\S]*?<\/span>/);
  assert.ok(badge, '.brand 内应有徽标容器 .logo-badge 包含状态点');
  assert.match(badge[0], /class="logo"/, '徽标容器应包含 .logo');
  assert.match(badge[0], /id="pollState"/, '徽标容器应包含 #pollState');
  // .logo-badge 需在 .brand 内、且状态点不再在 .top-actions 中
  const topActions = html.match(/<div class="top-actions">([\s\S]*?)<\/header>/);
  assert.ok(topActions, '应存在 .top-actions 区块');
  assert.ok(!/id="pollState"/.test(topActions[1]), '#pollState 不应再位于 .top-actions');
});

t('T2 叠加定位：.logo-badge position:relative；.poll position:absolute 负偏移叠加 logo 右上角', () => {
  assert.match(rule('.logo-badge'), /position:\s*relative/, '徽标容器应为定位基准');
  const poll = rule('.poll');
  assert.match(poll, /position:\s*absolute/, '.poll 应绝对定位');
  assert.match(poll, /top:\s*-\d+px/, '角标应向上悬出（top 负偏移）');
  assert.match(poll, /right:\s*-\d+px/, '角标应向右悬出（right 负偏移）');
  // 可辨性：压在 logo 渐变上需有底色 halo（panel 色圆环）隔离
  assert.match(poll, /box-shadow:[^;]*var\(--panel\)/, '角标应有 --panel 色 halo 与 logo 渐变隔离');
});

t('T3 配色契约不回归：在线 .poll 绿 var(--done)、离线 .poll.off 灰 var(--muted)', () => {
  assert.match(rule('.poll'), /color:\s*var\(--done\)/, '「●」应为绿色');
  assert.match(rule('.poll.off'), /color:\s*var\(--muted\)/, '「○」应为灰色');
});

t('T4 JS 行为不变：仍按 #pollState 更新 ●/○、title 与 off class，无位置相关改动', () => {
  assert.match(js, /pollState'\)\.textContent = '●'/, '在线仅保留圆点图标');
  assert.match(js, /pollState'\)\.textContent = '○'/, '离线仅保留空心圆图标');
  assert.match(js, /pollState'\)\.classList\.remove\('off'\)/, '在线应移除 off');
  assert.match(js, /pollState'\)\.classList\.add\('off'\)/, '离线应加 off');
  assert.match(js, /pollState'\)\.title = '实时连接：每 2 秒自动刷新'/, '在线 title 提示保留');
  assert.match(js, /pollState'\)\.title = '服务离线：数据停止刷新'/, '离线 title 提示保留');
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
