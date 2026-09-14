#!/usr/bin/env node
// REQ-20260909-003 需求文档引用讨论、纪要归档与说明同步 —— 前端静态契约测试（U1）
// 覆盖：index.html 引入 req-disc.js；app.js 挂载区块并随主轮询刷新；
// req-disc.js 含操作条/提示词复制兜底/阅读模式源行映射与复制引用/纪要等待·失败·重试/
// 独立归档/逐项应用/幂等展示；style.css 有 rd-* 样式
// 用法：node scripts/tests/req-disc-ui.test.mjs

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const pluginRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const read = (p) => fs.readFileSync(path.join(pluginRoot, 'scripts', 'web', p), 'utf8');

const cases = [];
const t = (name, fn) => cases.push([name, fn]);

t('U1 UI 静态契约：脚本引入 / 挂载与轮询 / 关键交互与状态文案 / 样式', () => {
  const html = read('index.html');
  const app = read('app.js');
  const js = read('req-disc.js');
  const css = read('style.css');

  // 脚本引入顺序：req-disc.js 需在 app.js 之前（app.js 挂载时模块已就绪）
  const posReq = html.indexOf('/req-disc.js');
  const posApp = html.indexOf('/app.js');
  assert.ok(posReq >= 0, 'index.html 应引入 req-disc.js');
  assert.ok(posApp > posReq, 'req-disc.js 应先于 app.js 加载');

  // app.js 挂载与刷新（随主轮询自动检测发布）
  assert.match(app, /reqDocDisc/, 'app.js 应渲染 reqDocDisc 区块容器');
  assert.match(app, /ATBReqDisc\??\.mount/, 'renderDrawer 应挂载讨论区块');
  assert.match(app, /ATBReqDisc\??\.refresh/, 'poll 应随主轮询刷新讨论区块（自动检测发布）');

  // 操作条与阶段反馈
  for (const word of ['开始讨论', '启动提示词', '讨论完毕', '再次查看收尾提示词', '等待纪要与草稿', '正在读取', '读取失败', '重试']) {
    assert.ok(js.includes(word), `req-disc.js 应含「${word}」`);
  }
  assert.match(js, /不感知|不代表.*已连接|请在 Agent 会话执行/, '应提示复制不代表已连接/需在 Agent 会话执行');
  assert.match(js, /手工复制/, '复制失败应保留文本并说明手工复制');

  // 提示词 API
  assert.match(js, /\/api\/req-disc/, '应调用 /api/req-disc 接口');
  assert.match(js, /startPrompt/, '应展示启动提示词');
  assert.match(js, /finishPrompt/, '应展示收尾提示词');

  // 阅读模式：源行映射 + 复制引用 + 快照
  assert.match(js, /pre-line/, '段落应保留源换行（pre-line）以便选文映射源行');
  assert.match(js, /复制引用/, '应提供复制引用');
  assert.match(js, /我的问题/, '引用文本应带追问尾巴');
  assert.match(js, /引用快照|已保存的引用/, '应展示已保存引用快照');
  assert.match(js, /请点击.*行号|整段/, '不可精确映射时应引导点击行号引用整段');

  // 纪要：归档/继续讨论/逐项应用
  for (const word of ['确认归档', '继续讨论', '确认应用', '未选择修改', '本次无说明修改', '已归档', '已应用']) {
    assert.ok(js.includes(word), `req-disc.js 应含「${word}」`);
  }
  assert.match(js, /alreadyApplied/, '重复应用应按幂等展示不重复写入');
  assert.match(js, /beforeVersion|afterVersion|保留/, '应用结果应展示前后版本与旧版保留');
  assert.match(js, /checkbox|勾选/, '草稿修改项应可逐项勾选');
  assert.match(js, /说明已变化/, '基线不符错误应向用户展示（服务端 400 透传）');

  // 样式
  assert.match(css, /\.rd-/, 'style.css 应有 rd-* 讨论区块样式');
  assert.match(css, /rd-ln|rd-block/, '应有行号/块样式');
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
