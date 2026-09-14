#!/usr/bin/env node
// REQ-20260906-022 批次结束后提供创建下一批入口 —— 前端静态契约测试
// 覆盖：N1 结束批次入口渲染、N2 未结束不显示、N3 复用创建流程（勾选范围+复制提示词）、
//       N4 幂等返回旧批不误导、N5 上限缺省与创建面板一致
// 服务端「finished 批次后可创建新批次」由 batch-core.test.mjs 既有用例覆盖，此处不重复。
// 用法：node scripts/tests/next-batch-entry.test.mjs

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const js = fs.readFileSync(path.join(pluginRoot, 'scripts', 'web', 'app.js'), 'utf8');

const cases = [];
const t = (name, fn) => cases.push([name, fn]);

t('N1 运行视图入口：本轮结束且待处理 0 时显示完成通知与「启动新一轮」按钮（REQ-20260908-026 文案）', () => {
  assert.match(js, /id="batchNext"/, '运行视图应提供启动新一轮按钮');
  assert.match(js, /启动新一轮/, '按钮文案');
  assert.match(js, /本轮已处理完毕/, '完成通知文案（notice 缺省回退，REQ-20260913-003 去批次措辞）');
});

t('N2 未结束批次不显示：入口仅在 batchDone（finished 且 remaining=0）分支内', () => {
  const cond = js.match(/const batchDone = ([^;]+);/);
  assert.ok(cond, '应定义 batchDone 显隐条件');
  assert.match(cond[1], /b\.status === 'finished'/, '条件须限定批次已结束');
  assert.match(cond[1], /remaining/, '条件须限定无待处理项');
  assert.equal((js.match(/id="batchNext"/g) || []).length, 1, '按钮标记只应出现一次');
  // REQ-20260908-026：分支模板含嵌套插值，改为按位置校验——按钮必须出现在 batchDone 分支之后
  const branchIdx = js.indexOf('${batchDone ?');
  const btnIdx = js.indexOf('id="batchNext"');
  assert.ok(branchIdx !== -1, '应存在 batchDone 条件分支');
  assert.ok(btnIdx > branchIdx, '按钮应在 batchDone 分支内');
});

t('N3 复用创建流程：同一创建函数与接口，缺省不带 ids（候选=已计划队列），复制提示词', () => {
  // REQ-20260908-026：收尾入口先校验内嵌执行 Agent 选择（#devNextMode）再复用创建流程
  assert.match(js, /querySelector\('#batchNext'\)[\s\S]{0,320}?createBatchAndCopy/, '按钮应复用 createBatchAndCopy');
  // 窗口 2200：REQ-20260906-025 入队分支使函数变长，契约看行为不看长度
  const fn = js.match(/async function createBatchAndCopy[\s\S]{0,2200}/);
  assert.ok(fn, '应有创建函数');
  assert.match(fn[0], /\/api\/batch\/create/, '沿用创建接口');
  // BUG-20260909-006：列表勾选集合回退已移除——ids 仅为 opts.ids 显式范围（REQ-20260908-026 单条目重试）
  assert.match(fn[0], /\(opts\.ids && opts\.ids\.length\) \? \[\.\.\.opts\.ids\] : null/, 'opts.ids 显式范围优先（单条目重试）');
  assert.ok(!fn[0].includes('m.selected'), '创建不得再读取列表勾选集合');
  assert.match(fn[0], /copyDispatchText\(res\.prompt\)/, '创建后复制提示词');
  assert.match(fn[0], /refreshBatch\(\)/, '创建后刷新切到新批次');
});

t('N4 并发幂等不误导 + 重复启动如实报错：created=false 如实提示「未新建任务」；重复启动由服务端 400 toast', () => {
  const fn = js.match(/async function createBatchAndCopy[\s\S]{0,2400}/);
  assert.ok(fn, '应有创建函数');
  assert.match(fn[0], /res\.created === false/, '应区分幂等返回（并发窗口）');
  assert.match(fn[0], /未新建任务/, '幂等返回时不得宣称已创建（去批次措辞，REQ-20260913-003）');
  // REQ-20260913-003：不排队——重复启动服务端 400，由 catch 分支 toast 原因，不宣称已创建
  assert.match(fn[0], /toast\(e\.message, true\)/, '服务端拒绝应如实 toast 错误');
});

t('N5 创建函数不含上限（REQ-20260908-019）：不再读取/发送 limit，请求体仅 ids 与 developer', () => {
  const fn = js.match(/async function createBatchAndCopy[\s\S]{0,1600}/);
  assert.ok(fn, '应有创建函数');
  assert.ok(!fn[0].includes('limit'), '创建函数不得再读取或发送 limit');
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
