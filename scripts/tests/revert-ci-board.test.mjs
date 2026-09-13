#!/usr/bin/env node
// REQ-20260908-004 回退 CI 看板 —— 静态契约验证：CI 模块（REQ-20260902-002）整体移除
// 用法：node scripts/tests/revert-ci-board.test.mjs

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (...rel) => fs.readFileSync(path.join(pluginRoot, ...rel), 'utf8');
const exists = (...rel) => fs.existsSync(path.join(pluginRoot, ...rel));

const cases = [];
const t = (name, fn) => cases.push([name, fn]);

t('T1 CI 专属文件已删除', () => {
  assert.ok(!exists('scripts', 'lib', 'ci-store.mjs'), 'lib/ci-store.mjs 应删除');
  assert.ok(!exists('scripts', 'web', 'ci.js'), 'web/ci.js 应删除');
  assert.ok(!exists('scripts', 'tests', 'ci-board.test.mjs'), 'tests/ci-board.test.mjs 应删除');
});

t('T2 index.html 无 CI 页签与视图容器', () => {
  const html = read('scripts', 'web', 'index.html');
  assert.doesNotMatch(html, /data-view="ci"/, '不应保留 CI 页签');
  assert.doesNotMatch(html, /id="ciView"/, '不应保留 #ciView 容器');
  assert.doesNotMatch(html, /src="\/ci\.js"/, '不应再引入 ci.js');
  // 模块导航（BUG-20260910-004 起全局入口移至顶栏；
  // REQ-20260909-013 起讨论 / 文件、REQ-20260911-002 起营销 / 发布入口暂态隐藏，
  // 导航收敛为 需求/任务 + 末位设置）
  const nav = html.match(/<nav class="module-nav"[\s\S]*?<\/nav>/);
  assert.ok(nav, '缺少模块导航');
  const order = [...nav[0].matchAll(/data-view="([a-z]+)"/g)].map((m) => m[1]);
  assert.deepEqual(order, ['status', 'build', 'runs', 'settings'], '导航应为 需求/构建/任务 + 末位设置（讨论 / 文件 / 营销 / 发布暂隐藏；全局移至顶栏；REQ-20260913-001 新增构建）');
});

t('T3 app.js 无 ci 视图注册与 ATBCi 引用', () => {
  const js = read('scripts', 'web', 'app.js');
  assert.doesNotMatch(js, /ATBCi/, '不应引用 window.ATBCi');
  assert.doesNotMatch(js, /ciView/, '不应引用 #ciView');
  assert.doesNotMatch(js, /['"]ci['"]/, 'VIEWS/MODULE_SUB 不应含 ci');
});

t('T4 server.mjs 无 CI 路由/数据层/自重启/端口持久化', () => {
  const src = read('scripts', 'server.mjs');
  assert.doesNotMatch(src, /ci-store/, '不应 import ci-store');
  assert.doesNotMatch(src, /\/api\/ci\//, '不应保留 /api/ci/ 路由');
  assert.doesNotMatch(src, /handleCiApi|selfRestart|validatePortInput/, 'CI 处理函数应移除');
  assert.doesNotMatch(src, /ATB_SERVER_CONFIG|writeServerConfig|readServerConfig|resolveServerPort/, '端口持久化应移除');
  assert.doesNotMatch(src, /ATB_BIND_RETRY|bindRetriesLeft|BIND_RETRY_MAX/, 'EADDRINUSE 绑定重试应移除');
  // 端口解析回退：ATB_PORT 环境变量 > 默认 8888
  assert.match(src, /const DEFAULT_PORT = 8888;/, '默认端口常量应保留 8888');
  assert.match(src, /const PORT = Number\(process\.env\.ATB_PORT\) \|\| DEFAULT_PORT;/, '端口解析应为 ATB_PORT || DEFAULT_PORT');
});

t('T5 style.css 无 CI 样式残留', () => {
  const css = read('scripts', 'web', 'style.css');
  assert.doesNotMatch(css, /\.ci-/, '不应残留 .ci-* 样式');
  assert.doesNotMatch(css, /CI 模块/, '不应残留 CI 模块注释');
});

let failed = 0;
for (const [name, fn] of cases) {
  try {
    await fn();
    console.log(`✓ ${name}`);
  } catch (e) {
    failed++;
    console.error(`✗ ${name}\n  ${e.message}`);
  }
}
console.log(`\n${cases.length} 用例，失败 ${failed}`);
process.exit(failed ? 1 : 0);
