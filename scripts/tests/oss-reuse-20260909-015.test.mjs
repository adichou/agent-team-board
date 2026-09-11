#!/usr/bin/env node
// REQ-20260909-015 —— 开源库复用牵引（A 线）+ licenses.md「开源许可」页签（B 线）
// 用法：node scripts/tests/oss-reuse-20260909-015.test.mjs
// 覆盖 test-cases.md 的 A1–A4、B1–B6、B8；B7（006 契约测试扩展）在
// drawer-tabs-20260909-006.test.mjs 内同步扩展。浏览器目检为人工实测。

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import * as core from '../lib/core.mjs';
import { buildWorkerPrompt } from '../lib/scheduler.mjs';

const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const APP_JS = fs.readFileSync(path.join(PLUGIN_ROOT, 'scripts', 'web', 'app.js'), 'utf8');
const STYLE_CSS = fs.readFileSync(path.join(PLUGIN_ROOT, 'scripts', 'web', 'style.css'), 'utf8');
const DEV_MD = fs.readFileSync(path.join(PLUGIN_ROOT, 'commands', 'dev.md'), 'utf8');
const SKILL_MD = fs.readFileSync(path.join(PLUGIN_ROOT, 'skills', 'agent-team-board', 'SKILL.md'), 'utf8');

const cases = [];
const t = (name, fn) => cases.push([name, fn]);

function fnSrc(name) {
  const m = APP_JS.match(new RegExp(`^(?:async )?function ${name}\\([\\s\\S]*?^\\}`, 'm'));
  assert.ok(m, `应存在 ${name} 函数`);
  return m[0];
}

function tempProject(tag) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `atb-oss-15-${tag}-`));
  core.initData(root);
  return { root, dataDir: core.dataDirFrom(root) };
}

// 指引关键词口径（A 线共用）：优先复用 / 依赖引入 / 禁止复制源码 / 白名单 / 强传染禁止 / licenses.md
// 多词断言用 [\s\S] 容忍指引文本的自然换行。
function assertOssGuidance(text, where) {
  assert.match(text, /开源/, `${where} 应述及开源库`);
  assert.match(text, /优先复用/, `${where} 应牵引优先复用开源库`);
  assert.match(text, /以依赖方式引入/, `${where} 应要求以依赖方式引用`);
  assert.match(text, /禁止[\s\S]*复制[\s\S]*源码|复制[\s\S]*源码[\s\S]*仓库/, `${where} 应禁止把开源库源码复制进项目仓库`);
  assert.match(text, /MIT/, `${where} 应给出白名单许可（MIT 等）`);
  assert.match(text, /Apache-2\.0/, `${where} 应给出 Apache-2.0`);
  assert.match(text, /GPL/, `${where} 应禁止 GPL 等强传染许可`);
  assert.match(text, /AGPL|LGPL|SSPL/, `${where} 应点名 AGPL/LGPL/SSPL`);
  assert.match(text, /licenses\.md/, `${where} 应指向 licenses.md 维护开源信息`);
}

// ---------- A 线：选型牵引 ----------

t('A1 core：新建需求生成的 design.md「方案」节自带开源选型指引（三选一理由 + licenses.md）', () => {
  const { dataDir } = tempProject('a1');
  const req = core.createItem(dataDir, { type: 'requirement', title: '牵引', by: 't' });
  const design = fs.readFileSync(path.join(dataDir, 'requirements', req.id, 'design.md'), 'utf8');
  assertOssGuidance(design, '需求 design.md');
  assert.match(design, /三选一/, '应写明自研理由三选一口径');
  assert.match(design, /无合适库|引入成本/, '应覆盖「无合适库 / 引入成本高于自研」理由项');
  assert.ok(design.indexOf('## 方案') < design.indexOf('开源选型'), '指引应落在「方案」节内');
});

t('A2 core：新建 Bug 生成的 design.md 同样自带指引；「引入来源（源单）」节不回归', () => {
  const { dataDir } = tempProject('a2');
  const bug = core.createItem(dataDir, { type: 'bug', title: '独立缺陷', by: 't' });
  const design = fs.readFileSync(path.join(dataDir, 'bugs', bug.id, 'design.md'), 'utf8');
  assertOssGuidance(design, 'Bug design.md');
  assert.match(design, /引入来源（源单）/, '引入来源（源单）节应保留');
  assert.match(design, /未定位（排查过程/, '「未定位」写法指引应保留');
});

t('A3 scheduler：buildWorkerPrompt 含开源选型牵引表述', () => {
  const p = buildWorkerPrompt({ itemId: 'REQ-X', title: 'T', projectRoot: '/p', atbCliPath: '/atb.mjs', runId: 'run-1' });
  assertOssGuidance(p, 'worker 提示词');
});

t('A4 指引落点：commands/dev.md 与 SKILL.md TDD 流程含同口径牵引表述', () => {
  assertOssGuidance(DEV_MD, 'commands/dev.md');
  assertOssGuidance(SKILL_MD, 'SKILL.md');
});

// ---------- B 线：开源许可页签 ----------

t('B1 DOC_LABEL：licenses.md 页签文案为「开源许可」', () => {
  assert.match(APP_JS, /'licenses\.md':\s*'开源许可'/, 'DOC_LABEL 应含 licenses.md → 开源许可');
});

function runDrawerDocTabs(docs) {
  const consts = APP_JS.match(/const DRAWER_TAB_LABEL = \{[\s\S]*?\};\s*\nconst DRAWER_FIXED_DOC_TABS = \[[^\]]*\];/);
  assert.ok(consts, '应存在页签常量定义');
  const src = `${consts[0]}\n${fnSrc('drawerDocTabs')}\n${fnSrc('drawerTabValid')}\n__out = drawerDocTabs({ docs: ${JSON.stringify(docs)} });`;
  const sandbox = { __out: null };
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox);
  return [...sandbox.__out]; // vm 跨 realm 数组转本域数组，deepStrictEqual 原型才可比
}

t('B2 drawerDocTabs：licenses.md 存在时插在 design.md 之后、test-cases.md 之前；不存在时无该页签', () => {
  const full = runDrawerDocTabs(['README.md', 'design.md', 'licenses.md', 'test-cases.md', 'test-report.md']);
  assert.deepEqual(full, ['README.md', 'design.md', 'licenses.md', 'test-cases.md', 'test-report.md'],
    '页签顺序应为 说明 → 设计 → 开源许可 → 测试用例 → 测试报告');
  const onlyLic = runDrawerDocTabs(['README.md', 'design.md', 'licenses.md', 'test-cases.md']);
  assert.deepEqual(onlyLic, ['README.md', 'design.md', 'licenses.md', 'test-cases.md'], '无测试报告时不应追加该页签');
  const none = runDrawerDocTabs(['README.md', 'design.md', 'test-cases.md']);
  assert.deepEqual(none, ['README.md', 'design.md', 'test-cases.md'], 'licenses.md 不存在时页签列表不应包含它');
  const fixed = APP_JS.match(/const DRAWER_FIXED_DOC_TABS = \[[^\]]*\]/)[0];
  assert.ok(!fixed.includes('licenses.md'), 'licenses.md 不得进固定页签常量（条件插入）');
});

t('B3 drawerTabValid：licenses.md 存在时页签有效；被删后失效（回落基本信息口径不回归）', () => {
  const consts = APP_JS.match(/const DRAWER_TAB_LABEL = \{[\s\S]*?\};\s*\nconst DRAWER_FIXED_DOC_TABS = \[[^\]]*\];/);
  const src = `${consts[0]}\n${fnSrc('drawerDocTabs')}\n${fnSrc('drawerTabValid')}`;
  const ctx = (docs, tab) => {
    const sandbox = { __ok: null };
    vm.createContext(sandbox);
    vm.runInContext(`${src}\n__ok = drawerTabValid(${JSON.stringify(tab)}, { docs: ${JSON.stringify(docs)} });`, sandbox);
    return sandbox.__ok;
  };
  assert.equal(ctx(['README.md', 'design.md', 'licenses.md'], 'licenses.md'), true, '存在时应为有效页签');
  assert.equal(ctx(['README.md', 'design.md'], 'licenses.md'), false, '文件被删后应失效（renderDrawer 回落 info）');
});

t('B4 loadDoc：licenses.md 渲染后、写缓存前调用 decorateLicensesDoc；其他文档不调用', () => {
  const ld = fnSrc('loadDoc');
  assert.match(ld, /name === 'licenses\.md'/, 'loadDoc 应识别 licenses.md');
  assert.match(ld, /decorateLicensesDoc\(view\)/, '应调用 decorateLicensesDoc 补警示');
  const posDeco = ld.indexOf('decorateLicensesDoc(view)');
  const posCache = ld.indexOf('state.drawer.docCache[name] = html');
  assert.ok(posDeco > 0 && posCache > posDeco, '警示应在写 docCache 前完成（缓存内容自带警示）');
  assert.match(ld, /if \(name === 'licenses\.md'\)/, '仅 licenses.md 走装饰分支');
});

// ---------- B5 decorateLicensesDoc 行为（vm + 桩 DOM） ----------

t('B5 decorateLicensesDoc：禁用许可红标「禁止引入，请替换」；白名单无警示；未知许可「待确认」', () => {
  const mkCell = (text) => ({
    textContent: text, children: [],
    appendChild(f) { this.children.push(f); },
  });
  const head = {
    head: true, cells: [mkCell('库名'), mkCell('License'), mkCell('仓库地址')],
    querySelectorAll(sel) { return sel === 'th' ? this.cells : []; },
  };
  const data = [
    { cells: [mkCell('marked'), mkCell('MIT'), mkCell('github.com/marked')] },
    { cells: [mkCell('bad'), mkCell('GPL-3.0'), mkCell('gpl.example')] },
    { cells: [mkCell('worse'), mkCell('AGPL-3.0-only'), mkCell('agpl.example')] },
    { cells: [mkCell('weak'), mkCell('LGPL-2.1'), mkCell('lgpl.example')] },
    { cells: [mkCell('srv'), mkCell('SSPL-1.0'), mkCell('sspl.example')] },
    { cells: [mkCell('apache'), mkCell('Apache-2.0'), mkCell('apache.example')] },
    { cells: [mkCell('bsd'), mkCell('BSD-3-Clause'), mkCell('bsd.example')] },
    { cells: [mkCell('isc'), mkCell('ISC'), mkCell('isc.example')] },
    { cells: [mkCell('zero'), mkCell('0BSD'), mkCell('0bsd.example')] },
    { cells: [mkCell('unlic'), mkCell('Unlicense'), mkCell('unlic.example')] },
    { cells: [mkCell('mpl'), mkCell('MPL-2.0'), mkCell('mpl.example')] },
    { cells: [mkCell('自造'), mkCell('MIT-with-my-terms'), mkCell('x.example')] },
    { cells: [mkCell('空'), mkCell(''), mkCell('y.example')] },
  ].map((r) => ({ ...r, querySelectorAll(sel) { return sel === 'td' ? this.cells : []; } }));
  const all = [head, ...data];
  const consts = APP_JS.match(/const OSS_LICENSE_WHITELIST = \[[^\]]*\];\s*\nconst OSS_LICENSE_BANNED_RE = [^;]+;/);
  assert.ok(consts, '应存在开源许可白名单 / 禁用名单常量');
  const src = `${consts[0]}\n${fnSrc('decorateLicensesDoc')}\ndecorateLicensesDoc(__view);`;
  const table = { querySelectorAll: (sel) => (sel === 'tr' ? all : []) };
  const view = { querySelectorAll: (sel) => (sel === 'table' ? [table] : []) };
  const sandbox = { __view: view, document: { createElement: () => ({ className: '', textContent: '' }) } };
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox);
  const flags = (rowIdx) => data[rowIdx].cells[2].children.filter((c) => typeof c.className === 'string' && c.className.includes('lic-flag'));
  assert.equal(flags(0).length, 0, 'MIT 白名单行不应有警示');
  const gpl = flags(1);
  assert.equal(gpl.length, 1, 'GPL-3.0 行应有一个警示');
  assert.match(gpl[0].className, /lic-banned/, 'GPL 应为禁用红标');
  assert.match(gpl[0].textContent, /禁止引入，请替换/, '红标文案应为「禁止引入，请替换」');
  for (const idx of [2, 3, 4]) {
    assert.match(flags(idx)[0].className, /lic-banned/, `AGPL/LGPL/SSPL 应同为禁用红标（第 ${idx} 行）`);
  }
  for (const idx of [5, 6, 7, 8, 9]) assert.equal(flags(idx).length, 0, `白名单许可不应有警示（第 ${idx} 行）`);
  const mpl = flags(10);
  assert.equal(mpl.length, 1, 'MPL-2.0（弱传染待裁定）应有待确认标');
  assert.match(mpl[0].className, /lic-unknown/, '应为 lic-unknown');
  assert.match(mpl[0].textContent, /待确认/, '文案应为「待确认」');
  assert.equal(flags(11).length, 1, '白名单外的组合写法应视为未知许可');
  assert.match(flags(11)[0].className, /lic-unknown/, '自造组合许可应打待确认标');
  assert.equal(flags(12).length, 0, '空 License 单元格应跳过');
  const bannedInHead = head.cells.flatMap((c) => c.children).length;
  assert.equal(bannedInHead, 0, '表头行不应被标注');
});

t('B5 decorateLicensesDoc：表头无 License 列时整表跳过，不误标', () => {
  const mkCell = (text) => ({ textContent: text, children: [], appendChild(c) { this.children.push(c); } });
  const head = {
    head: true,
    cells: [mkCell('库名'), mkCell('版本'), mkCell('备注')],
    querySelectorAll(sel) { return sel === 'th' ? this.cells : []; },
  };
  const row = {
    cells: [mkCell('gpl-lib'), mkCell('1.0'), mkCell('GPL-3.0 双许可但列名不叫 License')],
    querySelectorAll(sel) { return sel === 'td' ? this.cells : []; },
  };
  const table = { querySelectorAll: (sel) => (sel === 'tr' ? [head, row] : []) };
  const view = { querySelectorAll: (sel) => (sel === 'table' ? [table] : []) };
  const consts = APP_JS.match(/const OSS_LICENSE_WHITELIST = \[[^\]]*\];\s*\nconst OSS_LICENSE_BANNED_RE = [^;]+;/);
  const src = `${consts[0]}\n${fnSrc('decorateLicensesDoc')}\ndecorateLicensesDoc(__view);`;
  const sandbox = { __view: view, document: { createElement: () => ({ className: '', textContent: '' }) } };
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox);
  assert.equal(row.cells.flatMap((c) => c.children).length, 0, '无 License 列时不应标注任何行');
});

t('B6 style.css：lic-flag 标识样式存在；红用 --warn、待确认用既有 amber 变量，不新引入配色', () => {
  const base = STYLE_CSS.match(/\.lic-flag\s*\{[^}]*\}/);
  assert.ok(base, '应存在 .lic-flag 基础样式');
  const banned = STYLE_CSS.match(/\.lic-flag\.lic-banned\s*\{[^}]*\}/) || STYLE_CSS.match(/\.lic-banned\s*\{[^}]*\}/);
  assert.ok(banned, '应存在禁用红标样式');
  assert.match(banned[0], /var\(--warn\)/, '红标应使用主题警示色变量');
  const unknown = STYLE_CSS.match(/\.lic-flag\.lic-unknown\s*\{[^}]*\}/) || STYLE_CSS.match(/\.lic-unknown\s*\{[^}]*\}/);
  assert.ok(unknown, '应存在待确认黄标样式');
  assert.match(unknown[0], /var\(--inprogress\)|var\(--warn\)|var\(--confirming\)/, '黄标应复用主题既有语义色变量');
  assert.doesNotMatch(banned[0] + unknown[0], /#[0-9a-fA-F]{3,8}/, '不得写死色值（深浅色随系统）');
});

// ---------- B8 服务端零改动（行为验证） ----------

t('B8 服务端零改动：licenses.md 经既有白名单可读取并进 it.docs，无需服务端改动', () => {
  const { dataDir } = tempProject('b8');
  const req = core.createItem(dataDir, { type: 'requirement', title: '文档', by: 't' });
  const dir = path.join(dataDir, 'requirements', req.id);
  fs.writeFileSync(path.join(dir, 'licenses.md'), '# 开源信息\n\n| 库名 | 版本 | 引入方式 | License | 仓库地址 |\n| -- | -- | -- | -- | -- |\n| x | 1.0 | npm | MIT | https://example/x |\n');
  const detail = core.getItemDetail(dataDir, req.id);
  assert.ok(detail.docs.includes('licenses.md'), 'orderedDocs 应把 licenses.md 带进 it.docs');
  assert.equal(core.readDoc(dataDir, req.id, 'licenses.md').includes('| x | 1.0 | npm | MIT'), true, 'readDoc 应可按既有白名单读取 licenses.md');
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
