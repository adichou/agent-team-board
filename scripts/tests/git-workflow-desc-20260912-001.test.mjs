#!/usr/bin/env node
// REQ-20260912-001 设置页「Git 工作流」描述更详细 —— 静态契约 + i18n 词典测试。
// 验收口径：分区描述覆盖三点——dev + main 双分支协作总述；分支职责（dev 承载需求
// 设计/开发/测试，main 承载版本构建与发布构建物）；每个需求或 Bug 单开发完自动提交
// 到本地（仅本地操作，不 push）。详细描述在就绪态始终展示（含非 git 仓库状态），
// 新增中文文案同步英文词典，旧单行提示随实现移除。
// 用法：node scripts/tests/git-workflow-desc-20260912-001.test.mjs

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import '../web/i18n.js';

const testsDir = path.dirname(fileURLToPath(import.meta.url));
const pluginRoot = path.resolve(testsDir, '..', '..');
const app = fs.readFileSync(path.join(pluginRoot, 'scripts', 'web', 'app.js'), 'utf8');
const i18nSrc = fs.readFileSync(path.join(pluginRoot, 'scripts', 'web', 'i18n.js'), 'utf8');

const I = globalThis.ATBI18N;
assert.ok(I, 'i18n.js 应在 globalThis.ATBI18N 暴露接口');
const { EN } = I._dict;

// 新描述文案（与实现保持全文一致）
const DESC_INTRO = '采用 dev + main 双分支协作：';
const DESC_DEV_MAIN = 'dev 分支承载需求设计、开发和测试；main 分支承载版本构建，发布构建物。';
const DESC_AUTOCOMMIT = '每个需求或 Bug 单开发完自动提交到本地（仅本地分支操作，不 push）。';
const DESC_EN = {
  [DESC_INTRO]: 'Adopt the dev + main dual-branch workflow:',
  [DESC_DEV_MAIN]: 'The dev branch carries requirement design, development, and testing; the main branch carries version builds and release artifacts.',
  [DESC_AUTOCOMMIT]: 'Each requirement or bug item is auto-committed locally once development finishes (local branch operations only, no push).',
};
const OLD_HINT = '开发在 dev 分支进行，到待测试自动提交；仅本地分支操作，不 push。';
const NOT_REPO_HINT = '项目不是 git 仓库：请先在终端完成 git 初始化（新项目可经 atb init 自动初始化）。';

const fnSrc = (name) => {
  const i = app.indexOf(`function ${name}`);
  assert.ok(i >= 0, `app.js 应定义 ${name}`);
  return app.slice(i, app.indexOf('\nfunction ', i + 1) === -1 ? app.length : app.indexOf('\nfunction ', i + 1));
};

const cases = [];
const t = (name, fn) => cases.push([name, fn]);

t('T1 描述总述：Git 工作流分区含「dev + main 双分支协作」描述块', () => {
  const descFn = fnSrc('gitWorkflowDescHtml');
  assert.match(descFn, /采用 dev \+ main 双分支协作/, '描述块应含双分支协作总述');
});

t('T2 分支职责：dev 承载需求设计/开发/测试，main 承载版本构建与发布构建物', () => {
  const descFn = fnSrc('gitWorkflowDescHtml');
  assert.match(descFn, /dev 分支承载需求设计、开发和测试/, '应说明 dev 分支职责');
  assert.match(descFn, /main 分支承载版本构建，发布构建物/, '应说明 main 分支职责');
});

t('T3 自动提交口径：每个需求或 Bug 单开发完自动提交到本地，仅本地操作不 push', () => {
  const descFn = fnSrc('gitWorkflowDescHtml');
  assert.match(descFn, /每个需求或 Bug 单开发完自动提交到本地/, '应说明自动提交口径');
  assert.match(descFn, /仅本地分支操作，不 push/, '应保留仅本地操作不 push 口径');
});

t('T4 就绪态始终展示详细描述：gitWorkflowAreaHtml 无条件渲染描述块，非 git 指引保留', () => {
  const areaFn = fnSrc('gitWorkflowAreaHtml');
  assert.match(areaFn, /gitWorkflowDescHtml\(\)/, '就绪态模板应无条件调用 gitWorkflowDescHtml()');
  assert.match(areaFn, /项目不是 git 仓库/, '非 git 仓库指引应保留');
  const descFn = fnSrc('gitWorkflowDescHtml');
  for (const s of [DESC_INTRO, DESC_DEV_MAIN, DESC_AUTOCOMMIT]) {
    assert.ok(descFn.includes(s), `描述块应含完整文案：${s}`);
  }
});

t('T5 旧单行提示移除：不再作为就绪态描述', () => {
  assert.doesNotMatch(app, new RegExp(`'${OLD_HINT}'`), '旧单行提示字符串应从 app.js 移除');
});

t('T6 i18n 词典同步：新文案有 EN 词条且译文可用，旧词条移除', () => {
  I.setLang('en');
  try {
    for (const [zh, en] of Object.entries(DESC_EN)) {
      assert.equal(I.t(zh), en, `英文翻译应生效：${zh}`);
    }
  } finally {
    I.setLang('zh');
  }
  for (const zh of Object.keys(DESC_EN)) {
    assert.ok(i18nSrc.includes(`'${zh}':`), `词典源应含新词条：${zh}`);
  }
  assert.doesNotMatch(i18nSrc, new RegExp(`'${OLD_HINT}':`), '旧提示词条应从词典移除');
});

let failed = 0;
for (const [name, fn] of cases) {
  try {
    await fn();
    console.log(`✓ ${name}`);
  } catch (e) {
    failed++;
    console.error(`✗ ${name}\n    ${String(e.message).split('\n')[0]}`);
  }
}
console.log(failed ? `\n${failed} 个用例未通过` : '\n全部通过');
process.exit(failed ? 1 : 0);
