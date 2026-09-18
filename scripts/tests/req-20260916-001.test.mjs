#!/usr/bin/env node
// REQ-20260916-001 AI 开发任务概括展示阻塞并集成人工确认与文档自动提交 —— 演示与文档契约测试。
// 本单实施边界（README「关联与交付边界」）：文档 + 条目目录 ui-demo.html 离线交互演示；
// 真实概括聚合 / blocker 安全读取 / Git 隔离提交为待开发功能，不在本单实施，也不在测试中伪装通过。
// 覆盖 test-cases.md 中可在演示层验证的用例：
//   T01 概括显示阻塞数与各轮次、按条目去重；T02 无阻塞/加载/读取失败独立反馈；
//   T04 blocker 正常/缺失/读取失败/无权访问 + 路径越界拒绝 + 重试；
//   T05 草稿保存恢复、未答完整不能确认、取消不改文档；T15 窄屏/键盘/空态。
// 断言对象：条目目录 README.md（界面展示节链接与文字说明）与 ui-demo.html（单文件离线演示）。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const itemDir = path.join(root, 'agent-team-board', 'data', 'requirements', 'REQ-20260916-001');
const readmeSrc = fs.readFileSync(path.join(itemDir, 'README.md'), 'utf8');
const demoSrc = fs.readFileSync(path.join(itemDir, 'ui-demo.html'), 'utf8');

const cases = [];
const t = (name, fn) => cases.push([name, fn]);

/** 提取 demo 内指定函数体（保守匹配到首个行首收尾大括号），供模板渲染断言 */
function fnBody(src, name) {
  const m = src.match(new RegExp(`function ${name}\\([\\s\\S]*?\\n\\}`));
  assert.ok(m, `演示应定义函数 ${name}`);
  return m[0];
}

/* ---------- README 界面展示节契约 ---------- */

t('T01 README 界面展示节相对链接 ./ui-demo.html 且保留布局/交互/状态反馈文字说明', () => {
  assert.match(readmeSrc, /## 界面展示[\s\S]*\]\(\.\/ui-demo\.html\)/, '界面展示节应相对链接 ./ui-demo.html');
  for (const sec of ['### 界面布局', '### 交互行为', '### 状态反馈']) {
    assert.ok(readmeSrc.includes(sec), `README 应保留「${sec}」文字说明`);
  }
  // 界面展示节说明与验收条目对齐：五种概括状态、双侧栏、确认链路与提交失败口径
  const showcase = readmeSrc.match(/## 界面展示[\s\S]*?(?=\n## )/)[0];
  for (const kw of ['运行中', '已结束仍有阻塞', '阻塞 0 项', '加载中', '读取失败', 'blocker', '人工确认', '差异预览', '文档已落盘', '决策已确认 · 待人工复工', '虚构示例']) {
    assert.ok(showcase.includes(kw), `界面展示节应说明「${kw}」`);
  }
});

t('T02 验收标准含 ui-demo.html 离线交互覆盖条目', () => {
  const acc = readmeSrc.match(/## 验收标准[\s\S]*?(?=\n## )/)[0];
  assert.ok(acc.includes('ui-demo.html'), '验收标准应含 ui-demo.html 条目');
  for (const kw of ['阻塞计数展开', '失败态', '草稿', '差异预览', '各阶段状态反馈']) {
    assert.ok(acc.includes(kw), `验收条目应覆盖「${kw}」`);
  }
});

/* ---------- 演示离线自包含 ---------- */

t('T03 ui-demo.html 离线自包含：无外部资源、无外链脚本、声明虚构数据与不执行真实操作', () => {
  const external = demoSrc.match(/(?:src|href)\s*=\s*["']https?:\/\//gi) || [];
  assert.equal(external.length, 0, `演示不应引用外部资源：${external.join(', ')}`);
  assert.ok(!/<script[^>]+src=/.test(demoSrc), '脚本应内联，不引外部 js');
  assert.ok(!/<link[^>]+href=/.test(demoSrc), '样式应内联，不引外部 css');
  for (const kw of ['虚构', '不发真实请求', '不读写文件', '不执行 Git 操作', '不修改任何条目状态']) {
    assert.ok(demoSrc.includes(kw), `演示应声明「${kw}」`);
  }
});

/* ---------- 概括区：固定计数与五种状态（README 界面布局 / T01、T02 用例） ---------- */

t('T04 概括五种状态独立反馈：运行中有阻塞 / 已结束仍有阻塞 / 阻塞 0 项 / 加载中 / 读取失败可重试', () => {
  for (const scene of ['running', 'finished', 'none', 'loading', 'error']) {
    assert.ok(demoSrc.includes(`data-scene="${scene}"`), `控制台应提供场景 ${scene}`);
  }
  assert.ok(demoSrc.includes('已结束 · 仍有 2 项阻塞'), '结束且有阻塞时不得只显示成功或结束');
  assert.ok(demoSrc.includes('阻塞 0 项'), '无阻塞应显示「阻塞 0 项」');
  assert.ok(demoSrc.includes('概况加载中'), '加载中应有独立反馈');
  assert.ok(demoSrc.includes('概况读取失败'), '读取失败应有独立反馈');
  assert.ok(demoSrc.includes('不能当作「阻塞 0 项」展示'), '读取失败不得当作无阻塞');
  assert.ok(demoSrc.includes('id="sumRetry"'), '读取失败应提供重试入口');
  assert.ok(demoSrc.includes('批次结束不等于阻塞解除'), '结束批次须提示阻塞未解决');
});

t('T05 计数口径：阻塞按条目去重计 1，含待复工；待确认不含已确认项', () => {
  const list = fnBody(demoSrc, 'renderList');
  assert.ok(list.includes('按条目去重计 1 项'), '列表应说明同条目多轮去重计 1');
  // 阻塞计数来自去重后的条目集合（BLOCKERS 条目级），确认后仍保持（含待复工）
  const cnt = demoSrc.match(/const pendingCount[\s\S]*?const blockedCount[\s\S]*?;/);
  assert.ok(cnt, '应定义 pendingCount/blockedCount');
  assert.match(cnt[0], /S\.scene === 'none' \? 0 : BLOCKERS\.length/, '阻塞数按去重条目计，确认后不减');
  assert.match(cnt[0], /b\.confirmable && !S\.confirmed/, '待确认数不含已确认项');
});

t('T06 展开后列出各阻塞轮次（同条目多轮逐轮可见，非仅最新一轮）', () => {
  const list = fnBody(demoSrc, 'renderList');
  assert.match(list, /b\.rounds\.map/, '列表项应逐轮渲染 b.rounds');
  assert.ok(list.includes('轮次'), '轮次行应有「轮次」标签');
  assert.ok(list.includes('按条目去重计 1 项'), '轮次行应标注去重口径');
  // 演示数据含同条目两轮（第 1 轮 run-20260916-3971 / 第 2 轮 run-20260916-4012）
  assert.ok(demoSrc.includes('第 1 轮 run-20260916-3971'), '演示数据应含历史轮次');
});

/* ---------- blocker 只读侧栏（T04 用例） ---------- */

t('T07 blocker 四种读取结果 + 路径越界拒绝，均有原因与重试，错误不当作无阻塞', () => {
  for (const blk of ['ok', 'missing', 'readFail', 'noAccess', 'escape']) {
    assert.ok(demoSrc.includes(`data-blk="${blk}"`), `控制台应提供 blocker 读取态 ${blk}`);
  }
  const side = fnBody(demoSrc, 'renderBlockerSide');
  assert.ok(side.includes('blocker 不存在'), '缺失应显示不存在');
  assert.ok(side.includes('读取失败'), '读取失败应显示失败');
  assert.ok(side.includes('无权访问'), '无权访问应显示原因');
  assert.ok(side.includes('路径越界'), '越界请求应被拒绝并说明（限定项目运行目录内）');
  assert.ok(side.includes('id="blkRetry"'), '失败态应提供重试按钮');
  assert.ok(side.includes('只读'), '侧栏应为只读查看');
  assert.ok(demoSrc.includes('拒绝路径穿越'), '应声明服务端拒绝路径穿越');
});

/* ---------- 人工确认侧栏（T05 用例 + README 交互行为） ---------- */

t('T08 人工确认：原问题逐项作答、缺答案不能提交、保存草稿、取消保留答案、差异预览与确认按钮命名', () => {
  assert.ok(demoSrc.includes('data-q="${q.key}"'), '问题应逐项输入（按问题 key 渲染 textarea）');
  // 演示数据多问题：QUESTIONS 含 q1/q2 两项
  const qs = demoSrc.match(/const QUESTIONS = [\s\S]*?\n\];/);
  assert.ok(qs, '应定义问题清单');
  assert.ok(qs[0].includes("key: 'q1'") && qs[0].includes("key: 'q2'"), '演示应含多问题逐项作答');
  assert.match(demoSrc, /miss\.length \? 'disabled' : ''/, '缺答案时确认按钮必须禁用');
  assert.ok(demoSrc.includes('未答完整不能提交确认'), '缺答案应有明确提示');
  assert.ok(demoSrc.includes('保存草稿'), '应提供保存草稿');
  assert.ok(demoSrc.includes('草稿已保存'), '草稿保存应有反馈');
  assert.ok(demoSrc.includes('答案与草稿保留'), '取消后答案与草稿应保留');
  assert.ok(demoSrc.includes('差异预览'), '应提供差异预览');
  assert.ok(demoSrc.includes("dl('add'") && demoSrc.includes("dl('del'"), '差异预览应含新增/删除行样式');
  assert.ok(demoSrc.includes('确认决策并提交文档'), '确认按钮应命名「确认决策并提交文档」');
  assert.ok(demoSrc.includes('仅确认实施边界'), '旁注仅确认实施边界');
  assert.ok(demoSrc.includes('design.md 不存在时将创建') || demoSrc.includes('不存在时创建'), '应说明 design 不存在时创建');
  // 草稿恢复：重新打开侧栏答案仍在（状态不清空）+ 差异预览随草稿实时生成
  assert.ok(demoSrc.includes('diffPreviewHtml'), '差异预览按草稿实时生成');
});

/* ---------- 确认链路状态反馈（README 状态反馈节） ---------- */

t('T09 七阶段状态反馈齐全，提交失败明确文档已落盘、分阶段重试不重复', () => {
  const pm = fnBody(demoSrc, 'phaseMeta');
  for (const phase of ['待确认', '草稿', '正在保存文档', '正在提交', '已提交（', '保存失败', '提交失败']) {
    assert.ok(pm.includes(phase), `阶段徽标应含「${phase}」`);
  }
  assert.ok(pm.includes('文档已落盘'), '提交失败须明确文档已落盘，不误报完成');
  const foot = fnBody(demoSrc, 'renderCfFoot');
  assert.ok(foot.includes('重试保存并继续'), '保存失败应从保存阶段重试');
  assert.ok(foot.includes('重试提交（文档已落盘）'), '提交失败应只重试提交阶段');
  const flow = fnBody(demoSrc, 'runConfirm');
  assert.ok(flow.includes("S.busy = true"), '保存与提交期间应防重复操作');
  assert.ok(flow.includes('不重复写决策'), '重试不得重复写决策');
  assert.ok(demoSrc.includes('不自动 push'), '须声明不自动 push');
});

t('T10 确认成功后：信息缺失切换「决策已确认 · 待人工复工」，阻塞计数保持、待确认清零、依赖类仍无确认入口', () => {
  assert.ok(demoSrc.includes('决策已确认 · 待人工复工'), '确认后应显示待人工复工');
  assert.ok(demoSrc.includes('确认动作不自动重启执行'), '确认不得自动重启实施');
  assert.ok(demoSrc.includes('不自动接受 / 置计划 / 认领 / 确认完成 / 重启执行'), '确认边界声明');
  assert.ok(demoSrc.includes('依赖类阻塞无人工确认入口'), '依赖类阻塞无人工确认入口');
  assert.ok(demoSrc.includes('等待依赖完成'), '依赖类仍保持未解决');
  assert.ok(demoSrc.includes('含待复工 1'), '阻塞计数包含待复工项');
  assert.ok(demoSrc.includes('待确认清零'), '确认后待确认清零');
  // 提交文件白名单：仅已批准文档，不含源码/状态文件/账本
  assert.ok(demoSrc.includes('不含业务源码、状态文件、执行账本或其他条目'), '提交白名单声明');
});

/* ---------- 键盘与窄屏（T15 用例） ---------- */

t('T11 键盘与窄屏：Esc 关闭侧栏、aria 展开态、dialog 语义、按钮键盘焦点样式、窄屏纵向布局', () => {
  assert.ok(demoSrc.includes("e.key === 'Escape'"), 'Esc 应关闭侧栏');
  assert.ok(demoSrc.includes('aria-expanded'), '展开计数应有 aria-expanded');
  assert.ok(demoSrc.includes('role="dialog"'), '侧栏应具备 dialog 语义');
  assert.match(demoSrc, /button:focus-visible[^{]*\{[^}]*outline/, '按钮应有键盘焦点样式 :focus-visible');
  assert.ok(demoSrc.includes('@media (max-width: 720px)'), '应提供窄屏断点');
  const mq = demoSrc.match(/@media \(max-width: 720px\)[\s\S]*?\n  \}/);
  assert.match(mq[0], /grid-template-columns: 1fr/, '窄屏阻塞列表应纵向排列');
  assert.ok(mq[0].includes('width: 100vw'), '窄屏侧栏应全宽');
  // 空态说明（T15 阻塞列表为空）
  assert.ok(demoSrc.includes('阻塞列表（0 项）'), '空态应有明确说明');
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
