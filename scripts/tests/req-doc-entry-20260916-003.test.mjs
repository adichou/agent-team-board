#!/usr/bin/env node
// 仓库结构存在性检查（原 REQ-20260916-003 / REQ-20260918-001 文档契约测试按 BUG-20260922-003
// 人工决策收窄：测试用例不校验 README / AGENTS 等文档内容——文档重写期（发布文档三阶段）
// 不应导致测试失败；仅保留「声明的仓库内路径逐一真实存在」的结构检查）。
// 覆盖：
//   A1 根 README.md 存在且非空，清单声明的每一个仓库内路径在仓库中真实存在（清单内置于本文件）
//   B3 路径清单含 migrate-layout.mjs、plugin-pack.mjs 且逐一真实存在（README.en.md 已随
//   BUG-20260928-009 删除——点号命名孤儿文件，由 <KEY>_<lang>.md 语言变体机制取代）
// 用法：node scripts/tests/req-doc-entry-20260916-003.test.mjs

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const readmePath = path.join(pluginRoot, 'README.md');
const readme = fs.existsSync(readmePath) ? fs.readFileSync(readmePath, 'utf8') : '';

const cases = [];
const t = (name, fn) => cases.push([name, fn]);

// ---------- A1：README 声明的路径清单（必须逐一真实存在） ----------

const declaredPaths = [
  '.zcode-plugin/plugin.json',
  '.codex-plugin/plugin.json',
  'README.md',
  'index.html', // 仓库根产品落地页（REQ-20260916-002）
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
  // scripts/lib 全部模块（41 个；mgt-commit.mjs 已随 BUG-20260918-002 下线删除）
  ...[
    'batch', 'build-git', 'build-publish', 'build-publish-api', 'build-publish-store', 'build-store',
    'codex-adapter', 'codex-model-config', 'codex-preflight', 'commit-store', 'confirm-states', 'confirm-store',
    'core', 'dispatch', 'dispatch-store', 'execution-verifier', 'git-flow', 'growth-store', 'hold-states',
    'hold-store', 'legacy-recovery', 'manual-closeout', 'marketing-store', 'migrate-layout', 'oncall-store',
    'plugin-pack', 'product-release-git', 'product-release-pipeline', 'product-release-store', 'refine-states',
    'refine-store', 'release-apple', 'release-electron', 'release-git', 'release-store', 'req-disc-store',
    'scheduler', 'site-lang', 'site-materials', 'task-settings', 'webapp-profile',
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
  'scripts/web/diff-view.js',
  'scripts/web/style.css',
  'scripts/web/marked.min.js',
  'scripts/web/highlight.min.js',
  'scripts/web/highlight-github.min.css',
  'scripts/web/highlight-github-dark.min.css',
  'scripts/web/wunderbaum.umd.min.js',
  'scripts/web/wunderbaum.css',
  'scripts/tests/run-all.mjs',
  'skills/agent-team-board/SKILL.md',
  'skills/agent-team-board/batch-execution.md',
  'skills/agent-team-board/worker-spec.md',
  'skills/agent-team-board/dev-closeout.md',
  'output',
];

t('A1 README 声明的仓库内路径全部真实存在（REQ-20260916-003）', () => {
  assert.ok(readme.length > 0, '根 README.md 存在且非空');
  const missing = declaredPaths.filter((rel) => !fs.existsSync(path.join(pluginRoot, rel)));
  assert.deepEqual(missing, [], `README 声明的路径缺失：${missing.join(', ')}`);
});

// ---------- B 组：REQ-20260918-001 路径清单扩展（存在性） ----------

t('B3 路径清单含 migrate-layout.mjs / plugin-pack.mjs 且逐一真实存在（README.en.md 已随 BUG-20260928-009 删除）', () => {
  assert.ok(!declaredPaths.includes('README.en.md'), '清单不再包含已删除的 README.en.md');
  for (const rel of ['scripts/lib/migrate-layout.mjs', 'scripts/lib/plugin-pack.mjs']) {
    assert.ok(declaredPaths.includes(rel), `A1 路径清单未包含：${rel}`);
    assert.ok(fs.existsSync(path.join(pluginRoot, rel)), `文件不存在：${rel}`);
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
