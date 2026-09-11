#!/usr/bin/env node
// REQ-20260906-004 File Board 分隔条拖拽调宽并记忆 —— 纯函数单测 + 静态契约（零依赖 node:assert），
// 单测风格参照 view-tabs-style.test.mjs（压平 CSS 正则断言），纯函数经 CommonJS 通道 require('../web/splitter.js')。
// 用法：node scripts/tests/file-splitter.test.mjs
// 对应 test-cases.md 的 S1–S4；M1 为浏览器人工核验。
// REQ-20260906-007（目录树改横幅呈现）：分隔条随树退役。splitter.js 模块与其纯函数保留
// （S1–S4 继续有效），S5–S7 原接线契约改写为退役守卫：不再被 index.html/app.js/style.css 引用。

import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const webRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'web');
const css = fs.readFileSync(path.join(webRoot, 'style.css'), 'utf8');
const html = fs.readFileSync(path.join(webRoot, 'index.html'), 'utf8');
const js = fs.readFileSync(path.join(webRoot, 'app.js'), 'utf8');
const S = createRequire(import.meta.url)(path.join(webRoot, 'splitter.js'));

// 压平：去注释、压缩空白，便于对声明做正则断言
const flat = css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s+/g, ' ');

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// 在顶层（媒体查询之前）取选择器声明块；左边界为 { } 或行首，避免子串误配
function rule(sel) {
  const m = flat.match(new RegExp(`(?:^|[{}])\\s*${escapeRe(sel)}\\s*\\{([^}]*)\\}`));
  assert.ok(m, `缺少规则 ${sel}`);
  return m[1];
}

// attach 用的最小假元素/假 body：记录监听器与 class，fire 手动派发
function fakeEl() {
  const listeners = {};
  const el = {
    listeners,
    classes: new Set(),
    attrs: {},
    captured: 0,
    released: 0,
    addEventListener(type, fn) { (listeners[type] ||= []).push(fn); },
    setAttribute(k, v) { el.attrs[k] = v; },
    setPointerCapture() { el.captured++; },
    releasePointerCapture() { el.released++; },
    classList: {
      add: (c) => el.classes.add(c),
      remove: (c) => el.classes.delete(c),
    },
    fire(type, ev = {}) {
      for (const fn of listeners[type] || []) {
        fn({ pointerId: 7, clientX: 0, button: 0, preventDefault() {}, ...ev });
      }
    },
  };
  return el;
}
const fakeBody = () => ({ classes: new Set(), classList: { add() {}, remove() {} } });

const cases = [];
const t = (name, fn) => cases.push([name, fn]);

t('S1 范围夹取：下限 180，超 50% 上限封顶，极窄窗口保 180', () => {
  assert.equal(S.TREE_MIN, 180);
  assert.equal(S.clampTreeWidth(100, 1400), 180, '低于下限取 180');
  assert.equal(S.clampTreeWidth(179.4, 1400), 180, '四舍五入后低于下限仍取 180');
  assert.equal(S.clampTreeWidth(300, 1400), 300, '默认 300 不动');
  assert.equal(S.clampTreeWidth(620, 1400), 620, '区间内原样保留');
  assert.equal(S.clampTreeWidth(900, 1400), 700, '超过视口一半取 50%');
  assert.equal(S.clampTreeWidth(500, 400), 180, '极窄窗口保 180 下限');
});

t('S2 双约束上限：正常宽度取 min(视口50%, 视口-保底预算)', () => {
  assert.equal(S.treeMaxWidth(1400), 700, '宽屏由 50% 约束生效');
  assert.equal(S.treeMaxWidth(2000), 1000, '宽屏由 50% 约束生效');
  assert.equal(S.treeMaxWidth(1024), 1024 - S.TREE_MIN - S.VIEWER_MIN - S.FILE_VIEW_GUTTER, '中窄窗口由详情保底约束生效');
  assert.equal(S.treeMaxWidth(300), 180, '极端窄窗仍不低于 180');
  assert.ok(S.VIEWER_MIN >= 240, '详情栏保底可读宽不应小于 240');
});

t('S3 记忆恢复：parseStoredWidth 合法值夹取，非法/缺失返回 null', () => {
  assert.equal(S.parseStoredWidth('300', 1400), 300);
  assert.equal(S.parseStoredWidth('440', 1400), 440);
  assert.equal(S.parseStoredWidth('5000', 1000), S.treeMaxWidth(1000), '超上限记忆值按当前视口夹取');
  assert.equal(S.parseStoredWidth('abc', 1400), null, '非数字不应用');
  assert.equal(S.parseStoredWidth('-5', 1400), null, '负数不应用');
  assert.equal(S.parseStoredWidth('0', 1400), null, '0 不应用');
  assert.equal(S.parseStoredWidth(null, 1400), null, '无记录保持默认');
  assert.equal(S.STORAGE_KEY, 'atb.fileTreeWidth');
});

t('S4 拖拽交互：down 记起点，move 实时夹取，up 提交恰一次；未按下不触发；cancel 同 up；dblclick 重置', () => {
  const splitter = fakeEl();
  const body = fakeBody();
  const changes = [];
  const commits = [];
  let resets = 0;
  S.attach({
    splitter,
    body,
    getTreeWidth: () => 300,
    getViewportWidth: () => 1400,
    onChange: (w) => changes.push(w),
    onCommit: (w) => commits.push(w),
    onReset: () => { resets++; },
  });

  splitter.fire('pointermove', { clientX: 640 });
  assert.equal(changes.length, 0, '未按下时 move 不触发');

  splitter.fire('pointerdown', { clientX: 500 });
  assert.ok(splitter.classes.has('dragging'), '按下后进入拖拽态');
  assert.equal(splitter.captured, 1, '应 setPointerCapture 防移出丢事件');

  splitter.fire('pointermove', { clientX: 640 });
  assert.equal(changes.at(-1), 440, '右移 140px → 300+140');
  splitter.fire('pointermove', { clientX: 300 });
  assert.equal(changes.at(-1), 180, '左移越过下限被夹取');

  splitter.fire('pointerup', { clientX: 300 });
  assert.equal(commits.length, 1, 'up 提交恰一次');
  assert.equal(commits[0], 180, '提交最终应用宽度');
  assert.ok(!splitter.classes.has('dragging'), 'up 后退出拖拽态');
  assert.equal(splitter.released, 1, '应 releasePointerCapture');

  splitter.fire('pointerdown', { clientX: 500 });
  splitter.fire('pointermove', { clientX: 620 });
  splitter.fire('pointercancel', {});
  assert.equal(commits.length, 2, 'pointercancel 与 up 同样收尾提交');

  splitter.fire('dblclick');
  assert.equal(resets, 1, '双击触发重置');
});

t('S5 退役守卫（REQ-20260906-007）：index.html 不再含树/分隔条结构，不再加载 splitter.js', () => {
  assert.doesNotMatch(html, /id="fileTree"/, '旧文件树容器应已移除');
  assert.doesNotMatch(html, /id="fileSplitter"/, '分隔条应已移除');
  assert.doesNotMatch(html, /\/splitter\.js/, '页面不应再加载 splitter.js（模块文件保留待人工清理）');
});

t('S6 退役守卫（REQ-20260906-007）：style.css 不再保留树/分隔条两栏样式', () => {
  const flatRetired = flat;
  assert.doesNotMatch(flatRetired, /\.file-tree\s*\{/, '.file-tree 样式应已移除');
  assert.doesNotMatch(flatRetired, /\.file-splitter\s*\{/, '.file-splitter 样式应已移除');
  assert.doesNotMatch(flatRetired, /body\.splitting\s*\{/, '拖拽期间的全局 body 样式应已移除');
  assert.match(rule('.file-view'), /flex-direction:\s*column/, '文件视图应为横幅纵向布局（REQ-20260906-007）');
});

t('S7 退役守卫（REQ-20260906-007）：app.js 不再接线分隔条与树宽记忆', () => {
  assert.doesNotMatch(js, /initFileSplitter/, '不应再初始化分隔条');
  assert.doesNotMatch(js, /ATBSplitter/, '不应再引用 ATBSplitter');
  assert.doesNotMatch(js, /atb\.fileTreeWidth/, '不应再读写树宽记忆键');
  assert.doesNotMatch(js, /reclampTreeWidth/, '不应再有树宽重夹取');
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
