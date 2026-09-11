#!/usr/bin/env node
// REQ-20260906-003 Codex 自动派发 UI —— 静态契约测试（沿用 dispatch.test.mjs 源码断言模式）
// 用法：node scripts/tests/codex-ui.test.mjs

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const js = fs.readFileSync(path.join(pluginRoot, 'scripts', 'web', 'app.js'), 'utf8');
const css = fs.readFileSync(path.join(pluginRoot, 'scripts', 'web', 'style.css'), 'utf8');
const html = fs.readFileSync(path.join(pluginRoot, 'scripts', 'web', 'index.html'), 'utf8');

const cases = [];
const t = (name, fn) => cases.push([name, fn]);

t('U1 共用入口：已计划列多选进入（REQ-20260906-018；REQ-20260908-010）；Codex 后台页签已隐藏（REQ-20260908-020）', () => {
  assert.ok(!html.includes('id="btnBatch"'), '顶栏不应再有批量开发入口');
  const hits = js.match(/批量开发/g) || [];
  assert.ok(hits.length >= 1);
  // REQ-20260908-020：任务模块收敛为「批量完善 / 批量开发」，Codex 后台自动派发不再提供页签入口；
  // 面板渲染代码保留（存量执行记录深链可达），但 tabs 内不得出现 codex 按钮。
  assert.doesNotMatch(js, /data-bmode="codex"/, '任务模块不应再有 Codex 自动派发页签入口');
  assert.match(js, /data-bmode="refine"/, '应有批量完善子面板');
  assert.match(js, /data-bmode="develop"/, '应有批量开发子面板');
  assert.match(js, /openBatchDrawer/, '共用抽屉打开路径应保留');
});

t('U2 开关与配置：默认关、时限 5-240、重试 0-3、重启续跑；不含密钥收集', () => {
  assert.match(js, /id="cxToggle"/, '应有自动派发开关');
  assert.match(js, /id="cxTimeout".*min="5".*max="240"/s, '时限输入应限 5～240');
  assert.match(js, /id="cxRetries".*min="0".*max="3"/s, '重试输入应限 0～3');
  assert.match(js, /id="cxResumeRestart"/, '应有重启后自动继续开关');
  assert.match(js, /不在此收集任何密钥/, '应明示不收集密钥');
});

t('U3 预检分层：静态检查与模型验证分开，模型验证由按钮显式触发并标注', () => {
  const srv = fs.readFileSync(path.join(pluginRoot, 'scripts', 'server.mjs'), 'utf8');
  assert.match(js, /检查运行环境（静态）/);
  assert.match(js, /验证模型可达/);
  assert.match(srv, /不向模型发送请求/, '服务端静态预检应标注不发送模型请求');
  assert.match(js, /pre\.note/, '前端应渲染服务端预检说明');
  assert.match(js, /真实发起一次最小 codex exec/, '模型验证应标注为真实执行');
});

t('U4 当前执行：会话 ID 未获得时显示等待，不显示假 ID；停止先「停止中」', () => {
  assert.match(js, /等待会话创建/, '无 threadId 时显示等待会话创建');
  assert.match(js, /停止中/, '停止请求后显示停止中');
  assert.match(js, /确认回收后显示「已中断」|确认回收后才释放占用/, '文案应说明确认后才中断/放锁');
});

t('U5 执行记录与日志：分页加载、字节偏移增量读取、大日志不整载', () => {
  assert.match(js, /id="cxMoreRuns"/, '执行记录应有加载更多（分页）');
  assert.match(js, /offset=\$\{d\.logOffset\}/, '日志应按 offset 增量读取');
  assert.match(js, /增量读取，不整载全量/, '应标注增量读取');
  assert.match(js, /尚无最终回复/, '日志无结果时明确显示尚无最终回复');
});

t('U6 恢复与桌面入口：恢复本项需确切会话 ID；桌面入口如实显示未接通', () => {
  assert.match(js, /id="cxResumeItem"/, '应有恢复本项按钮');
  assert.match(js, /桌面入口未接通，请查看看板日志/, '桌面入口应如实显示未接通');
  assert.ok(!/在 Codex 桌面打开/.test(js) || /disabled/.test(js), '不得提供可用桌面跳转假入口');
});

t('U7 条目设置：批量执行设置区显示最近 Codex 执行结果入口', () => {
  assert.match(js, /最近 Codex 执行/, '条目详情应显示最近 Codex 执行');
  assert.match(js, /lastCodexRun/, '应消费服务端 lastCodexRun 字段');
});

t('U8 空队列与等待文案：等待已计划条目（REQ-20260908-010）/项目占用/全局串行', () => {
  assert.match(js, /等待已计划条目/);
  assert.match(js, /项目被占用/);
  assert.match(js, /全局执行中/);
});

t('U9 样式：cx 面板样式存在且沿用抽屉主题变量', () => {
  assert.match(css, /\.cx-config/, '应有配置区样式');
  assert.match(css, /\.cx-checks/, '应有检查列表样式');
  assert.match(css, /var\(--border\)/, '沿用主题变量');
});

t('U10 安全：面板内容全部经 esc() 转义（标题/路径/日志不直插 HTML）', () => {
  const panel = js.slice(js.indexOf('renderCodexPanel'), js.indexOf('renderCxCurrent'));
  const rawInterp = panel.match(/\$\{(?!\s*esc\(|fmtTime|renderCx|JSON\.stringify|cxDetaiBodyHtml)[^}]*\}/g) || [];
  const allow = /\$\{(cur\.attempts|cur\.model|cur\.reasoningEffort|cur\.modelSource|cfg\.timeoutMin|!cur && st\.waiting \? `<div class="notice">\$\{cxWaitingText|cfg\.retries|cfg\.cliPath \|\| ''|st\.enabled \? 'checked' : ''|cfg\.resumeAfterRestart \? 'checked' : ''|cfg\.allowNonGit \? 'checked' : ''|c\.probing \? 'disabled' : ''|pre \?|c\.modelProbe \?|cur \?)/;
  // REQ-20260906-024 模型区块：以下插值均为字面量/数字/布尔/经 esc 的子模板调用，无用户数据直插
  const allow24 = /\$\{(listId|explicit \? '' : 'selected'|explicit \? 'selected' : ''|cxModelInfo\([^}]*\) \? '' :|lv\.error \? '' : ''|!stale && lv\.ok \? 'ok' : 'warn'|stale \? '⏳ ' : ''|label|info \? '' :|modelsOk \?|items\.length|models\.length|l\.exists \? '' :|cxModelDatalistHtml\('cxModelList'\)|cxVerificationHtml\([^)]*\)|cxInheritInfoHtml\(\)|cxModelBlockHtml\(cfg\)|renderCxPendingSection\(\))/;
  const bad = rawInterp.filter((x) => !allow.test(x) && !allow24.test(x) && !x.includes('esc('));
  assert.deepEqual(bad, [], `renderCodexPanel 存在未转义插值：${bad.join(' ; ')}`);
});

/* ---------- REQ-20260906-024 Codex 派发模型配置 UI ---------- */

t('U13 项目设置：模型与推理强度区块在超时/重试之前；配置方式/继承展示/刷新/验证齐备', () => {
  const configIdx = js.indexOf('id="cxCliPath"');
  const modelIdx = js.indexOf('cx-model-block');
  const timeoutIdx = js.indexOf('id="cxTimeout"');
  assert.ok(modelIdx !== -1 && configIdx !== -1, '应有模型区块与运行配置');
  assert.ok(modelIdx < timeoutIdx, '模型区块应位于超时设置之前');
  assert.match(js, /id="cxModelMode"/, '应有配置方式选择（沿用本机/指定）');
  assert.match(js, /沿用本机配置/);
  assert.match(js, /id="cxModelRefresh"[^>]*title="[^"]*不发模型请求/, '刷新配置应标注不发模型请求');
  assert.match(js, /id="cxModelId"/, '模型输入（可搜索 datalist + 手动输入）');
  assert.match(js, /id="cxEffortId"/, '推理强度输入');
  assert.match(js, /尚未验证/, '目录外模型标注尚未验证');
  assert.match(js, /需要重新验证/, '配置变化后旧验证结果标注过期');
});

t('U14 强度兼容：切换模型后原强度不支持时清空并提示重新选择，不静默替换', () => {
  assert.match(js, /cxModelEffortHint/, '应有强度兼容提示位');
  assert.match(js, /不被 .* 支持，请重新选择|不兼容.*重新选择/, '应提示重新选择而非静默替换');
  assert.match(js, /支持：/, '应列出该模型支持的档位');
});

t('U15 单项设置：条目执行设置内有「Codex 模型」折叠区，默认继承，保存提示影响范围', () => {
  assert.match(js, /Codex 模型（默认继承项目设置）/, '应有 Codex 模型折叠区');
  assert.match(js, /id="cxItemModelMode"/, '本项配置方式选择');
  assert.match(js, /继承项目设置/);
  assert.match(js, /id="cxItemModelSave"/, '保存本项模型设置');
  assert.match(js, /将用于后续新执行；当前执行与续跑保持原设置/, '保存提示影响范围');
});

t('U16 待处理入口：顶栏计数徽标 + 条目卡片标记 + 面板待处理区；点击打开 Codex 页', () => {
  assert.match(html, /id="cxPendingBadge"/, '顶栏应有待处理徽标');
  assert.match(js, /cxPendingBadge/, 'app 应绑定徽标');
  assert.match(js, /模型配置待处理/, '卡片/详情应有待处理标记');
  assert.match(js, /renderCxPendingSection/, 'Codex 面板应有待处理区');
  assert.match(js, /\/api\/dispatch\/pending/, '应消费待处理接口');
});

t('U17 执行记录模型信息：当前执行与详情展示模型/强度/来源；历史缺快照如实展示', () => {
  assert.match(js, /历史记录未记录/, '缺快照不得伪造历史模型');
  assert.match(js, /按记录配置请求，实际模型未返回/, 'M17：缺运行时确认值如实展示');
  assert.match(js, /modelConfirmed/, '应消费运行时确认值');
  assert.match(js, /CX_SOURCE_LABEL/, '来源应映射可读标签');
});

t('U18 新配置重试：执行详情有表单与按钮，旁列目标/参数；重复点击禁用', () => {
  assert.match(js, /以新配置重试本项/, '应有以新配置重试入口');
  assert.match(js, /id="cxRetryItem"/, '重试按钮');
  assert.match(js, /cxRetryTarget/, '按钮旁展示目标与参数');
  assert.match(js, /btn\.disabled = true; \/\/ 双击期间禁用/, '双击期间禁用按钮');
  assert.match(js, /codex\/retry-item/, '应调用重试接口');
  assert.match(js, /原执行（.*）与记录保留|原执行.*与记录保留/, '应说明原记录保留');
});

t('U19 恢复本项沿用原配置：按钮文案与提示强调原配置快照', () => {
  assert.match(js, /按原配置恢复本项/, '恢复按钮应强调原配置');
  assert.match(js, /原配置快照|确切会话 ID 与原配置/, '提示应说明使用原快照');
});

t('U11 依赖阻塞文案：与队列已空明确区分并指出前置条目（BUG-20260906-005）', () => {
  assert.match(js, /'deps-blocked'/, 'cxWaitingText 应处理 deps-blocked 等待类型');
  assert.match(js, /依赖阻塞：/, '应显示依赖阻塞原因');
  assert.match(js, /前置未完成/, '应指出需完成的前置条目');
  assert.match(js, /这与队列已空不同/, '必须与空队列文案明确区分');
  const emptyLabel = js.match(/empty: '[^']+'/) || [];
  assert.ok(!/依赖/.test(emptyLabel[0] || ''), '空队列文案不得混入依赖语义');
});

t('U12 恢复本项请求必须绑定当前详情 runId（BUG-20260906-008）', () => {
  assert.match(js, /id="cxResumeItem"/, '应有恢复本项按钮');
  assert.match(
    js,
    /codex\/resume-item'[\s\S]{0,400}?body: JSON\.stringify\(\{ runId: state\.codex\.detail\.runId \}\)/,
    '恢复请求体必须携带当前查看的 runId',
  );
  const empty = js.match(/codex\/resume-item'[\s\S]{0,300}?body: '\{\}'/);
  assert.equal(empty, null, '不得再发送空请求体（服务端会拒绝，旧行为会恢复成别的执行）');
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
