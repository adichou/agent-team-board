#!/usr/bin/env node
// REQ-20260920-002 设置界面的初始化 dev 分支改为切换至 dev 分支 —— 静态契约 + i18n 词典测试。
// 验收口径：设置页「Git 工作流」主操作由「初始化 dev 分支」改为「切换至 dev 分支」，
// 确认标题 / 确认按钮 / 执行与成功反馈全部围绕切换表达，不残留「初始化并切换」；
// 确认正文说明切换的是整个项目工作区、dev 不存在时先创建再切换、仅本地不 push；
// 取消不发请求；忙碌禁用防重复；成功刷新真实状态；失败给真实原因可重试。
// 后端 /api/git/init-dev 与 ensureDevWorkflow 按需创建 + 切换能力原样保留（本单不改 API）。
// 用法：node scripts/tests/req-20260920-002.test.mjs

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
const { EN, EN_DYNAMIC } = I._dict;

// 新切换导向文案（与实现保持全文一致）
const BTN_SWITCH = '切换至 dev 分支';
const BTN_READY = '已在 dev 分支';
const TITLE = '切换至 dev 分支？';
const MESSAGE = '将把整个项目工作区切换至 dev 分支。若 dev 不存在，将先创建再切换。仅本地操作，不 push。';
const CONFIRM_TEXT = '切换至 dev';
const BUSY = '正在切换至 dev 分支…';
const TOAST_OK = '✓ 已切换至 dev 分支';
const FAIL_DYN_KEY = '失败：◇（可重试；不会丢弃工作区修改）';
// 旧初始化导向文案（应从用户可见文案与词典中移除）
const OLD = ['初始化 dev 分支', '初始化 dev 分支？', '初始化并切换', '正在创建并切换到 dev 分支…', '✓ 已就绪：当前分支 dev（开发在 dev 分支进行，到待测试自动提交）'];

const fnSrc = (name) => {
  const i = app.indexOf(`function ${name}`);
  assert.ok(i >= 0, `app.js 应定义 ${name}`);
  return app.slice(i, app.indexOf('\nfunction ', i + 1) === -1 ? app.length : app.indexOf('\nfunction ', i + 1));
};
// 绑定区（确认 → 执行 → 反馈）：从 gwRetry 绑定到启动注释前的稳定切片
const bindRegion = app.slice(
  app.indexOf("const gwRetry = view.querySelector('#gwRetry')"),
  app.indexOf('/* ---------- 启动 ---------- */'),
);

const cases = [];
const t = (name, fn) => cases.push([name, fn]);

t('T1 主按钮：当前不在 dev 时显示「切换至 dev 分支」，不再出现「初始化 dev 分支」按钮文案', () => {
  const areaFn = fnSrc('gitWorkflowAreaHtml');
  assert.ok(areaFn.includes(BTN_SWITCH), '主按钮文案应为「切换至 dev 分支」');
  assert.doesNotMatch(areaFn, /初始化 dev 分支/, '分区模板不应残留「初始化 dev 分支」');
  assert.ok(areaFn.includes(BTN_READY), '已在 dev 就绪态文案「已在 dev 分支」保留');
});

t('T2 就绪 / 空态：已在 dev 按钮禁用；非 Git 项目禁用切换入口并保留初始化指引', () => {
  const areaFn = fnSrc('gitWorkflowAreaHtml');
  assert.match(areaFn, /id="gwInit" disabled/, '已在 dev 时按钮应为禁用态');
  assert.match(areaFn, /!d\.isRepo \|\| g\.busy/, '非 Git 项目与忙碌期间均禁用切换入口');
  assert.match(areaFn, /项目不是 git 仓库/, '非 Git 项目保留初始化指引');
  assert.match(areaFn, /当前分支：/, '状态行（当前分支 + dev 存在情况）保留');
});

t('T3 确认框：切换导向标题 / 确认按钮 / 正文；取消不发请求', () => {
  assert.ok(bindRegion.includes(`title: '${TITLE}'`), `确认标题应为「${TITLE}」`);
  assert.ok(bindRegion.includes(`confirmText: '${CONFIRM_TEXT}'`), `确认按钮应为「${CONFIRM_TEXT}」`);
  assert.ok(bindRegion.includes(`message: '${MESSAGE}'`), '确认正文应说明整体工作区切换、dev 按需创建、仅本地不 push');
  assert.match(bindRegion, /if \(!ok\) return;/, '取消确认不发送切换请求');
  assert.doesNotMatch(bindRegion, /初始化并切换/, '确认按钮不应残留「初始化并切换」');
});

t('T4 执行与结果：忙碌提示 + 禁用防重复；成功刷新状态反馈已切换；失败给真实原因可重试', () => {
  assert.ok(bindRegion.includes(BUSY), '执行中应提示「正在切换至 dev 分支…」');
  assert.match(bindRegion, /state\.git\.busy = true;/, '忙碌标记置位（防重复提交）');
  assert.match(bindRegion, /gwInit\.disabled = true;/, '执行期间按钮禁用');
  assert.match(bindRegion, /await api\('\/api\/git\/init-dev', \{ method: 'POST' \}\);/, '确认后请求切换接口');
  assert.match(bindRegion, /await refreshGitState\(\);/, '成功后重新获取 Git 状态');
  assert.ok(bindRegion.includes(TOAST_OK), '成功反馈应为「已切换至 dev 分支」口径');
  assert.ok(bindRegion.includes(FAIL_DYN_KEY.replaceAll('◇', '${e.message}')), '失败显示真实原因与可重试提示（不谎报成功）');
  assert.match(bindRegion, /失败：\$\{e\.message\}（可重试；不会丢弃工作区修改）/, '失败模板含可重试与不丢弃工作区修改口径');
});

t('T5 能力保留：仍调用 /api/git/init-dev，按需创建 + 切换语义不重命名', () => {
  assert.match(app, /\/api\/git\/init-dev/, '切换仍走既有 init-dev 接口（本单不改 API）');
  const flow = fs.readFileSync(path.join(pluginRoot, 'scripts', 'lib', 'git-flow.mjs'), 'utf8');
  assert.match(flow, /export function ensureDevWorkflow\(/, 'ensureDevWorkflow 能力保留');
  assert.match(flow, /switch', '-q', '-c', DEV_BRANCH/, 'dev 不存在时先创建再切换能力保留');
});

t('T6 旧文案移除：误导性初始化导向文案不再出现在用户可见路径', () => {
  // 用户可见字面量（带引号）全文件移除；「已初始化并切换到…」为数据布局迁移 toast，
  // 属其他功能合法文案，不做子串误伤——只核对 Git 工作流自身的字面量与两个功能切片。
  for (const s of OLD) {
    assert.ok(!app.includes(`'${s}'`), `app.js 不应残留旧文案字面量：${s}`);
  }
  const areaFn = fnSrc('gitWorkflowAreaHtml');
  for (const s of OLD) {
    assert.ok(!areaFn.includes(s), `Git 工作流分区模板不应残留旧文案：${s}`);
    assert.ok(!bindRegion.includes(s), `Git 工作流绑定区不应残留旧文案：${s}`);
  }
});

t('T7 i18n 中英同步：新增词条 EN 译文生效、旧词条移除、失败动态键更新', () => {
  const expect = {
    [BTN_SWITCH]: 'Switch to dev branch',
    [TITLE]: 'Switch to the dev branch?',
    [MESSAGE]: 'Switches the whole project workspace to the dev branch. If dev does not exist yet, it is created first and then switched to. Local operations only, no push.',
    [CONFIRM_TEXT]: 'Switch to dev',
    [BUSY]: 'Switching to the dev branch…',
    [TOAST_OK]: '✓ Switched to the dev branch',
  };
  I.setLang('en');
  try {
    for (const [zh, en] of Object.entries(expect)) {
      assert.equal(I.t(zh), en, `英文翻译应生效：${zh}`);
    }
  } finally {
    I.setLang('zh');
  }
  for (const zh of Object.keys(expect)) {
    assert.ok(i18nSrc.includes(`'${zh}':`), `词典源应含新词条：${zh}`);
  }
  for (const zh of OLD) {
    assert.doesNotMatch(i18nSrc, new RegExp(`'${zh.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}':`), `旧词条应从词典移除：${zh}`);
  }
  assert.ok(EN_DYNAMIC[FAIL_DYN_KEY], `EN_DYNAMIC 应含失败动态键：${FAIL_DYN_KEY}`);
  assert.equal(EN_DYNAMIC[FAIL_DYN_KEY], 'Failed: $1 (retryable; workspace changes are never discarded)', '失败动态键英文口径');
  assert.ok(!('失败：◇（可重试；已存在的分支不会重复创建）' in EN_DYNAMIC), '旧失败动态键应移除');
});

t('T8 条目演示与说明：ui-demo.html 为切换导向可交互演示，README 保留布局说明与相对链接', () => {
  const itemDir = path.join(pluginRoot, 'agent-team-board', 'data', 'requirements', 'REQ-20260920-002');
  const demo = fs.readFileSync(path.join(itemDir, 'ui-demo.html'), 'utf8');
  for (const s of [TITLE, MESSAGE, CONFIRM_TEXT, BUSY]) {
    assert.ok(demo.includes(s), `ui-demo.html 应含切换导向文案：${s}`);
  }
  assert.ok(demo.includes('取消') && demo.includes('模拟切换失败'), 'ui-demo.html 保留取消与失败模拟交互');
  const readme = fs.readFileSync(path.join(itemDir, 'README.md'), 'utf8');
  assert.match(readme, /\[打开可交互界面演示\]\(\.\/ui-demo\.html\)/, 'README 保留演示相对链接');
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
