#!/usr/bin/env node
// REQ-20260916-003 契约测试 —— 按 REQ-20260915-001 四仓库规范整理源码仓库入口文档
// 覆盖（test-cases.md A 组）：
//   A1 根 README.md 存在，且其声明的每一个仓库内路径在仓库中真实存在（清单内置于本文件）
//   A2 README 记录的命令与 package.json / server.mjs 源码事实一致
//   A3 「官网 / 用户文档 / 支持」节为待发布登记，不出现 http(s) 链接
//   A4 根 AGENTS.md 存在且包含必需内容（看板流程 / 守卫 / 收口 / 质量基线 / 拦截速查）
//   A5 双入口边界：SKILL.md 路径真实、划界表述、不复制 worker 细则
//   A6 两文件无私有运营信息（本机绝对路径 / 私有运营仓库 / 全局条款字样 / 密钥形态）
// 用法：node scripts/tests/req-doc-entry-20260916-003.test.mjs

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const readmePath = path.join(pluginRoot, 'README.md');
const agentsPath = path.join(pluginRoot, 'AGENTS.md');
const readme = fs.existsSync(readmePath) ? fs.readFileSync(readmePath, 'utf8') : '';
const agents = fs.existsSync(agentsPath) ? fs.readFileSync(agentsPath, 'utf8') : '';

const cases = [];
const t = (name, fn) => cases.push([name, fn]);

// ---------- A1：README 声明的路径清单（必须逐一真实存在） ----------

const declaredPaths = [
  '.zcode-plugin/plugin.json',
  '.codex-plugin/plugin.json',
  'README.md',
  'AGENTS.md',
  'skills/agent-team-board/SKILL.md',
  'commands/req.md',
  'commands/bug.md',
  'commands/dev.md',
  'commands/board.md',
  'hooks/hooks.json',
  'hooks/codex.json',
  'bin/atb',
  'electron/main.mjs',
  'electron/service.mjs',
  'electron/shell-css.mjs',
  'scripts/atb.mjs',
  'scripts/server.mjs',
  'scripts/state-guard.mjs',
  // scripts/lib 全部模块（40 个）
  ...[
    'batch', 'build-git', 'build-publish', 'build-publish-api', 'build-publish-store', 'build-store',
    'codex-adapter', 'codex-model-config', 'codex-preflight', 'commit-store', 'confirm-states', 'confirm-store',
    'core', 'dispatch', 'dispatch-store', 'execution-verifier', 'git-flow', 'growth-store', 'hold-states',
    'hold-store', 'legacy-recovery', 'manual-closeout', 'marketing-store', 'mgt-commit', 'oncall-store',
    'product-release-git', 'product-release-pipeline', 'product-release-store', 'refine-states', 'refine-store',
    'release-apple', 'release-electron', 'release-git', 'release-store', 'req-disc-store', 'scheduler',
    'site-lang', 'site-materials', 'task-settings', 'webapp-profile',
  ].map((m) => `scripts/lib/${m}.mjs`),
  // scripts/web 界面
  'scripts/web/index.html',
  'scripts/web/app.js',
  'scripts/web/build.js',
  'scripts/web/release.js',
  'scripts/web/marketing.js',
  'scripts/web/oncall.js',
  'scripts/web/req-disc.js',
  'scripts/web/i18n.js',
  'scripts/web/banner.js',
  'scripts/web/splitter.js',
  'scripts/web/marked.min.js',
  'scripts/web/highlight.min.js',
  'scripts/web/wunderbaum.umd.min.js',
  'scripts/tests/run-all.mjs',
  'docs/agent-team-board/README.md',
  'docs/agent-team-board/batch-execution.md',
  'docs/agent-team-board/dispatch/worker-spec.md',
  'output',
];

t('A1 README 声明的仓库内路径全部真实存在（REQ-20260916-003）', () => {
  assert.ok(readme.length > 0, '根 README.md 存在且非空');
  const missing = declaredPaths.filter((rel) => !fs.existsSync(path.join(pluginRoot, rel)));
  assert.deepEqual(missing, [], `README 声明的路径缺失：${missing.join(', ')}`);
});

t('A1 README 章节结构与人机分工新机制齐备（REQ-20260916-003）', () => {
  for (const s of [
    '三栏协作体系', '状态机与人机分工', '目录与模块职责', 'scripts/lib 模块分组', 'scripts/web 界面',
    '环境与运行方式', '关键机制索引', '官网 / 用户文档 / 支持', '按任务类型导航',
    'planned', '待人工决策', '待测试', 'git 克隆',
    'commands/{req,bug,dev,board}.md', 'AGENTS.md', 'skills/agent-team-board/SKILL.md',
    'docs/agent-team-board', 'output/',
  ]) {
    assert.ok(readme.includes(s), `README 缺少表述：${s}`);
  }
  for (const m of ['core.mjs', 'batch.mjs', 'build-publish.mjs', 'release-git.mjs', 'product-release-pipeline.mjs', 'i18n.js', 'run-all.mjs']) {
    assert.ok(readme.includes(m), `README 未提及模块：${m}`);
  }
});

t('A2 README 记录的命令与 package.json / server.mjs 事实一致', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(pluginRoot, 'package.json'), 'utf8'));
  assert.equal(pkg.scripts.test, 'node scripts/tests/run-all.mjs', 'package.json scripts.test');
  assert.equal(pkg.scripts.app, 'electron .', 'package.json scripts.app');
  assert.equal(pkg.scripts.dist, 'electron-builder', 'package.json scripts.dist');
  const serverSrc = fs.readFileSync(path.join(pluginRoot, 'scripts', 'server.mjs'), 'utf8');
  assert.ok(serverSrc.includes('const DEFAULT_PORT = 8888;'), 'server.mjs 默认端口常量 8888');
  assert.ok(serverSrc.includes('process.env.ATB_PORT'), 'server.mjs 支持 ATB_PORT 覆盖');
  for (const s of ['npm test', 'node scripts/tests/run-all.mjs', 'node scripts/server.mjs', 'ATB_PORT', 'npm run app', 'npm run dist', 'node scripts/atb.mjs', 'cli install']) {
    assert.ok(readme.includes(s), `README 缺少命令记录：${s}`);
  }
});

t('A3 官网/用户文档/支持节为待发布登记且无 http(s) 链接', () => {
  const start = readme.indexOf('## 官网 / 用户文档 / 支持');
  assert.ok(start !== -1, '存在「官网 / 用户文档 / 支持」节');
  const rest = readme.slice(start);
  const next = rest.indexOf('\n## ', 1);
  const section = next === -1 ? rest : rest.slice(0, next);
  assert.ok(/尚未部署|待发布/.test(section), '该节含「尚未部署/待发布」表述');
  assert.ok(!/https?:\/\//.test(section), '待发布登记节不出现 http(s) 链接');
});

t('A4 根 AGENTS.md 存在且包含必需内容', () => {
  assert.ok(agents.length > 0, '根 AGENTS.md 存在且非空');
  for (const s of [
    '登记', '接受', 'claim', // 看板流程：登记 → 人工接受 → claim
    'REQ-20260901-003', 'state-guard.mjs', // 源码守卫
    'atb report', '收口', // report 自动收口
    '不要手工 git commit', '不要自动 push', 'done',
    'BUG-20260912-001', '中英文', // 中英文资源同步
    'REQ-20260909-015', '开源选型', // 开源选型
    'npm test',
    '拦截', // 常见拦截速查
    'SKILL.md',
  ]) {
    assert.ok(agents.includes(s), `AGENTS.md 缺少内容：${s}`);
  }
});

t('A5 双入口边界：SKILL 路径真实、划界表述、不复制 worker 细则', () => {
  assert.ok(fs.existsSync(path.join(pluginRoot, 'skills/agent-team-board/SKILL.md')), 'SKILL.md 真实存在');
  assert.ok(agents.includes('skills/agent-team-board/SKILL.md'), 'AGENTS.md 引用 SKILL.md 路径');
  assert.ok(agents.includes('开发本产品'), '含「开发本产品」划界表述');
  assert.ok(agents.includes('使用本产品管理'), '含「使用本产品管理任务」划界表述');
  for (const s of ['batch next', 'run receipt', 'refine next', 'worker-spec']) {
    assert.ok(!agents.includes(s), `AGENTS.md 不应复制 worker 细则：${s}`);
  }
});

t('A6 两文件无私有运营信息（本机路径 / 私有仓库 / 全局条款 / 密钥形态）', () => {
  for (const [name, text] of [['README.md', readme], ['AGENTS.md', agents]]) {
    assert.ok(!text.includes('/Users/'), `${name} 不含本机绝对路径`);
    assert.ok(!text.includes('app-info-repo'), `${name} 不含私有运营仓库内部路径`);
    for (const s of ['模拟器', '人机界面指南', 'swizzle']) {
      assert.ok(!text.includes(s), `${name} 不应复制全局 ~/.zcode/AGENTS.md 条款字样：${s}`);
    }
    assert.ok(
      !/(^|[^A-Za-z0-9])sk-[A-Za-z0-9]{8,}|ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[0-9A-Z]{16}|BEGIN (RSA|EC|OPENSSH) PRIVATE KEY/.test(text),
      `${name} 无密钥形态字符串`,
    );
  }
});

// ---------- 执行 ----------

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
