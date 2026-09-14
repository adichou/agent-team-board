#!/usr/bin/env node
// REQ-20260907-001 建立的讨论看板已由 REQ-20260909-004 重构为开放式讨论模块。
// 本文件更新为新模块的骨架契约（行为细节见 discussion-ui.test.mjs）：
// 模块入口与容器、创建走 /api/discussion、提示词复制回退、列表两态与空态、
// 详情 Markdown 与旧单附件只读兼容、样式与轮询。
// 用法：node scripts/tests/oncall-ui.test.mjs

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const html = fs.readFileSync(path.join(pluginRoot, 'scripts', 'web', 'index.html'), 'utf8');
const app = fs.readFileSync(path.join(pluginRoot, 'scripts', 'web', 'app.js'), 'utf8');
const oncallJs = fs.readFileSync(path.join(pluginRoot, 'scripts', 'web', 'oncall.js'), 'utf8');
const css = fs.readFileSync(path.join(pluginRoot, 'scripts', 'web', 'style.css'), 'utf8');

const cases = [];
const t = (name, fn) => cases.push([name, fn]);

t('U1 入口与骨架（REQ-20260909-013：讨论 tab 随讨论模块暂态隐藏）；disc-view 视图容器与脚本引入保留待恢复；旧抽屉/遮罩移除', () => {
  const seg = html.match(/<nav class="module-nav"[\s\S]*?<\/nav>/);
  assert.ok(seg, '应有模块导航');
  assert.doesNotMatch(seg[0], /data-view="oncall"/, '「讨论」tab 随 REQ-20260909-013 暂态隐藏（恢复步骤见条目 design.md）');
  assert.match(html, /id="oncallView"[^>]*class="disc-view/, '讨论视图容器应为 disc-view 布局（机制保留待恢复）');
  assert.match(html, /src="\/oncall\.js"/, '应引入 oncall.js');
  assert.ok(!html.includes('id="oncallDrawer"'), '旧讨论抽屉应移除（详情为分栏右栏）');
  assert.ok(!html.includes('id="oncallMask"'), '旧讨论遮罩应移除');
  assert.match(html, /id="oncallLightbox"/, '保留旧单附件放大灯箱');
  assert.match(app, /ATBOncall/, 'app.js 应与 oncall.js 挂钩');
  assert.match(app, /'oncall'/, 'setView 应支持 oncall 视图（隐藏态经 HIDDEN_VIEWS 兜底回落需求模块）');
});

t('U2 新建与提示词：创建走 /api/discussion（标题必填 + 背景可选，无附件/关联需求）；复制含手动回退', () => {
  assert.match(app, /\/api\/discussion'/, '统一新建 ask 类型应调 /api/discussion 创建接口');
  assert.ok(!html.includes('id="fAttach"'), '新建弹窗不再有截图上传');
  assert.ok(!html.includes('id="fReq"'), '新建弹窗不再有关联需求输入');
  assert.match(app, /ATBOncall\?\.reveal/, '创建成功应 reveal 定位并展示启动提示词');
  assert.match(oncallJs, /启动提示词/, '详情应有启动提示词按钮');
  assert.match(oncallJs, /复制提示词/, '应有复制提示词按钮');
  assert.match(oncallJs, /Ctrl\+C|⌘C/, '剪贴板不可用应提示手动复制');
  assert.match(oncallJs, /execCommand/, '应有 execCommand 降级复制');
  assert.ok(!oncallJs.includes('/api/oncall/dispatch'), '新模块不再调用看板代答派单接口');
  assert.ok(!oncallJs.includes('/api/oncall/ticket/') || oncallJs.includes('attachment'), '仅旧单附件端点保留');
});

t('U3 列表：两态状态与阶段提示、空态引导', () => {
  for (const s of ['讨论中', '已归档']) assert.ok(oncallJs.includes(s), `应有「${s}」状态文案`);
  for (const s of ['等待纪要', '纪要已生成', '有待创建草稿']) assert.ok(oncallJs.includes(s), `应有「${s}」阶段提示`);
  assert.match(oncallJs, /filter-chip/, '筛选 chip 复用 filter-chip 样式');
  assert.match(oncallJs, /filter-count/, '筛选 chip 带计数');
  assert.match(oncallJs, /＋ 新建|新建/, '空态引导指向新建');
});

t('U4 详情：Markdown 渲染、旧单历史问答与附件内联只读保留、无追问/派单入口', () => {
  assert.match(oncallJs, /\/api\/discussion\/.+/, '应拉取讨论详情（/api/discussion/:id）');
  assert.match(oncallJs, /marked\.parse|renderMd/, '应渲染 Markdown');
  assert.match(oncallJs, /\/api\/oncall\/ticket\/.+\/attachment/, '旧单附件仍经 oncall 附件端点内联展示');
  assert.match(oncallJs, /lightbox|放大/, '点击图片应放大查看');
  assert.match(oncallJs, /历史问答/, '旧单历史问答只读保留');
  assert.match(oncallJs, /只读保留/, '历史问答标注只读');
  assert.ok(!oncallJs.includes('/ask'), '不再有问询追问接口');
  assert.ok(!oncallJs.includes('redispatch'), '不再有失败重派入口');
  assert.match(oncallJs, /sanitize/, '渲染前应做注入兜底净化');
});

t('U5 样式与轮询：讨论视图样式存在；随主轮询刷新', () => {
  assert.match(css, /\.disc-view\s*\{/, '应有 disc-view 容器样式');
  assert.match(css, /\.disc-draft[,.]/, '应有候选草稿卡片样式');
  assert.match(app, /ATBOncall\.poll|ATBOncall\?\.\s*poll/, '讨论视图应随主 2 秒轮询刷新');
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
