#!/usr/bin/env node
// BUG-20260927-002 二次编辑弹窗底部「关闭」按钮无响应 —— 分层测试。
// 根因：bindCommon 用 q('[data-edit-close]')（querySelector 只命中 DOM 顺序第一个，
// 即头部「✕ 关闭」）单绑定，底部「关闭」从未挂上监听，点击无任何反应。
// 修复：改为与审查对话框 data-review-close 同口径的 view.querySelectorAll 循环绑定，
// 底部按钮复用同一 requestEditClose（busy 守卫 / 未保存挂起保护 / 只摘弹窗元素口径不变）。
// 引入来源：REQ-20260924-006（经 atb list 核验存在、状态 done）。
// L4 渲染：renderSecondaryEditModal 头部 + 底部两个关闭按钮；busy 底部禁用、头部不禁用。
// L4 行为：以真实绑定源码 + 假 view 验证头部与底部按钮均触发 requestEditClose（缺一即红）。
// L1 契约：querySelectorAll 循环绑定固化、q 单绑定移除；遮罩点击与审查对话框范式不回归。
// 用法：node scripts/tests/bug-20260927-002.test.mjs

import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import '../web/i18n.js';

const cases = [];
const t = (name, fn) => cases.push([name, fn]);

const SOURCE = () => fs.readFileSync(new URL('../web/build.js', import.meta.url), 'utf8');

function extractFn(source, name) {
  const m = source.match(new RegExp(`  (?:async )?function ${name}\\(([^)]*)\\) \\{[\\s\\S]*?\\n  \\}`));
  assert.ok(m, `build.js 中应存在 ${name} 函数`);
  return m[0];
}

const ESC = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const FLOW_STUB = {
  DEFAULT_DOC_LANGS: ['cn', 'en'],
  langNameOf: (l) => String(l),
  docFilesOf: (langs) => (Array.isArray(langs) ? langs : []).flatMap((l) => ['README', 'CHANGELOG', 'FEATURES', 'AGENTS'].map((k) => ({ file: `${k}_${l}.md`, state: 'summarized' }))),
};

// 从 build.js 提取 data-edit-close 的真实绑定语句（兼容缺陷态 q 单绑定与修复态循环两种形态）
function extractEditCloseBinding(source) {
  const loop = source.match(
    /for \(const el of view\.querySelectorAll\('\[data-edit-close\]'\)\) \{\s*\n\s*el\.addEventListener\('click', requestEditClose\);\s*\n\s*\}/,
  );
  if (loop) return loop[0];
  const single = source.match(/q\('\[data-edit-close\]'\)\?\.addEventListener\('click', requestEditClose\);/);
  assert.ok(single, 'bindCommon 中应存在 data-edit-close 绑定语句（循环或单绑定）');
  return single[0];
}

/* ---------- L4 渲染：弹窗内两个关闭按钮的 DOM 结构 ---------- */

function modalNodes(pfEdit) {
  const fns = [
    extractFn(SOURCE(), 'sanitizeHtml'),
    extractFn(SOURCE(), 'renderMd'),
    extractFn(SOURCE(), 'normalizeFlowEval'),
    extractFn(SOURCE(), 'renderSecondaryEditModal'),
  ].join('\n');
  const ctx = vm.createContext({
    pfOf: (v) => v.pf,
    esc: ESC,
    short: (h) => String(h || '').slice(0, 8),
    fmtTime: () => 't',
    ...FLOW_STUB,
    window: { marked: null },
  });
  const pf = {
    phase: 'ready',
    plan: {
      langs: ['cn', 'en'], customDocs: [],
      docsFlow: { files: [{ file: 'README.md', state: 'summarized' }, { file: 'CHANGELOG.md', state: 'summarized' }] },
    },
    ...pfEdit,
  };
  vm.runInContext(fns, ctx);
  const html = vm.runInContext(
    `renderSecondaryEditModal({ id: 'V', pf: ${JSON.stringify(pf)} })`,
    ctx,
  );
  // 逐开标签扫描（本弹窗属性值不含 >），收集含独立 data-edit-close 属性的按钮（DOM 顺序）
  const nodes = [];
  const tagRe = /<([a-zA-Z][a-zA-Z0-9]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g;
  let m;
  while ((m = tagRe.exec(html))) {
    const attrs = m[2];
    if (!/(?:^|\s)data-edit-close(?=$|\s|=)/.test(attrs)) continue;
    nodes.push({
      attrs,
      disabled: /(?:^|\s)disabled(?=$|\s|=)/.test(attrs),
      listeners: {},
      addEventListener(ev, fn) { (this.listeners[ev] ||= []).push(fn); },
      click() { if (!this.disabled) for (const fn of this.listeners.click || []) fn(); },
    });
  }
  return { html, nodes };
}

const EDIT_CLEAN = { edit: { open: true, file: 'README.md', mode: 'edit', content: '# Hi', disk: '# Hi', busy: false, loadErr: null, pending: null, savedNote: null } };
const EDIT_BUSY = { edit: { ...EDIT_CLEAN.edit, busy: true } };

t('L4-1 渲染：弹窗恰有两个 data-edit-close 关闭按钮（头部 ✕ aria-label + 底部「关闭」，DOM 顺序）；头部恒不禁用；底部仅 busy 禁用（busy 点击不响应属预期）', () => {
  const { html, nodes } = modalNodes(EDIT_CLEAN);
  assert.equal(nodes.length, 2, `弹窗应有头部 + 底部两个关闭按钮，实际 ${nodes.length}`);
  assert.match(nodes[0].attrs, /aria-label="关闭对话框"/, '头部按钮（DOM 顺序第一）带 aria-label');
  assert.ok(!nodes[0].attrs.includes('✕') && nodes[0].attrs.includes('quiet'), '头部为静音样式按钮');
  assert.doesNotMatch(nodes[1].attrs, /aria-label/, '底部按钮（DOM 顺序第二）');
  assert.ok(!nodes[0].disabled && !nodes[1].disabled, '非 busy：两个按钮均可用');
  assert.ok(html.includes('>✕ 关闭</button>') && html.includes('>关闭</button>'), '头部 ✕ 与底部「关闭」文案齐备');
  // busy：底部按钮渲染禁用，头部 ✕ 不禁用（Esc / 头部关闭仍可用）
  const busy = modalNodes(EDIT_BUSY);
  assert.equal(busy.nodes.length, 2, 'busy 态仍渲染两个关闭按钮');
  assert.ok(!busy.nodes[0].disabled, 'busy 态头部 ✕ 不禁用');
  assert.ok(busy.nodes[1].disabled, 'busy 态底部「关闭」禁用');
});

/* ---------- L4 行为：真实绑定源码 + 假 view，两个按钮均可关闭 ---------- */

t('L4-2 绑定行为：以 bindCommon 中 data-edit-close 的真实绑定语句，在「querySelector 只回首个 / querySelectorAll 回全部」的假 view 上执行——头部与底部按钮点击均须触发 requestEditClose（缺陷态只绑头部，本例必红）', () => {
  const source = SOURCE();
  const bind = extractEditCloseBinding(source);
  const { nodes } = modalNodes(EDIT_CLEAN);
  assert.equal(nodes.length, 2, '前置：弹窗两个关闭按钮');
  const view = {
    querySelector: () => nodes[0] ?? null, // q 的缺陷口径：只命中 DOM 顺序第一个
    querySelectorAll: () => nodes, // 修复口径：全部命中
  };
  let closeCalls = 0;
  const requestEditClose = () => { closeCalls += 1; };
  const ctx = vm.createContext({ view, q: (s) => view.querySelector(s), requestEditClose });
  vm.runInContext(bind, ctx);
  nodes[0].click();
  nodes[1].click();
  assert.equal(closeCalls, 2, `头部与底部各触发一次 requestEditClose，实际 ${closeCalls} 次（底部按钮必须绑定监听）`);
});

t('L4-3 requestEditClose 语义不回归：busy 直接 return；未保存进挂起态（kind=close）不直接关；干净内容直接关闭（底部按钮复用同一入口即得同语义）', async () => {
  const fns = [
    extractFn(SOURCE(), 'requestEditClose'),
    extractFn(SOURCE(), 'closeEditDialog'),
    extractFn(SOURCE(), 'editUnsaved'),
  ].join('\n');
  const run = (edit, extra = {}) => {
    let closed = 0;
    const ctx = vm.createContext({
      state: { pf: { edit } },
      render: () => {},
      $: () => null,
      syncDocsPlanSilently: async () => {},
      closeEditDialogRef: () => { closed += 1; },
      ...extra,
    });
    vm.runInContext(fns.replace('closeEditDialog();', 'closeEditDialogRef();'), ctx);
    vm.runInContext('requestEditClose()', ctx);
    return { edit, closed };
  };
  // busy：直接 return，不进挂起、不关闭
  const busy = run({ open: true, busy: true, content: 'x', disk: 'x' });
  assert.equal(busy.edit.pending ?? null, null, 'busy 不进挂起态');
  assert.equal(busy.closed, 0, 'busy 不关闭');
  // 未保存：进挂起态
  const dirty = run({ open: true, busy: false, content: '草稿', disk: '盘上' });
  assert.equal(dirty.edit.pending?.kind, 'close', '未保存进关闭挂起态');
  assert.equal(dirty.closed, 0, '未保存不直接关闭');
  // 干净：直接关闭
  const clean = run({ open: true, busy: false, content: '同', disk: '同' });
  assert.equal(clean.closed, 1, '干净内容直接关闭弹窗');
});

/* ---------- L1 契约：绑定范式固化与不回归 ---------- */

t('L1-1 绑定契约：data-edit-close 用 view.querySelectorAll 循环绑定（与 data-review-close 审查对话框同口径），q 单绑定移除；遮罩点击关闭（busy 守卫）与 Esc 挂起撤条分支不回归', () => {
  const src = SOURCE();
  assert.match(
    src,
    /for \(const el of view\.querySelectorAll\('\[data-edit-close\]'\)\) \{\s*\n\s*el\.addEventListener\('click', requestEditClose\);\s*\n\s*\}/,
    'data-edit-close 循环绑定两处关闭按钮',
  );
  assert.doesNotMatch(src, /q\('\[data-edit-close\]'\)/, '不再用 querySelector 单绑定（只命中首个）');
  // 参照范式不回退：审查对话框双关闭按钮循环绑定保留
  assert.match(src, /for \(const el of view\.querySelectorAll\('\[data-review-close\]'\)\)/, '审查对话框循环绑定范式保留');
  // 遮罩点击关闭（busy 时不关）保留
  assert.match(
    src,
    /editWrap\?\.addEventListener\('click', \(e\) => \{\s*\n\s*if \(e\.target\?\.id === 'bldEditWrap' && !state\.pf\?\.edit\?\.busy\) requestEditClose\(\);\s*\n\s*\}\);/,
    '遮罩点击关闭与 busy 守卫保留',
  );
  // Esc：挂起态先撤提示，未保存走关闭保护（BUG-20260924-006 口径）
  assert.match(
    src,
    /if \(state\.pf\?\.edit\?\.open\) \{[^\n]*\n\s*if \(state\.pf\.edit\.pending\) \{ state\.pf\.edit\.pending = null; render\(\); \}\s*\n\s*else requestEditClose\(\);\s*\n\s*return;\s*\n\s*\}/,
    'Esc 关闭分支（先撤挂起条）保留',
  );
});

/* ---------- 执行 ---------- */

let failed = 0;
for (const [name, fn] of cases) {
  try {
    await fn();
    console.log(`✓ ${name}`);
  } catch (e) {
    failed += 1;
    console.error(`✕ ${name}\n${e && e.stack ? e.stack : e}`);
  }
}
if (failed) {
  console.error(`\n${failed} 例失败`);
  process.exit(1);
}
console.log(`\n共 ${cases.length} 例，全部通过`);
