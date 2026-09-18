#!/usr/bin/env node
// REQ-20260916-007 插件打包口径测试（P1）
// 用法：node scripts/tests/plugin-pack-20260916-007.test.mjs
// 覆盖：排除 agent-team-board/、AGENTS.md、node_modules/、electron/、output/（及 .git/dist）；
// skills/ 完整随包；产物自校验；非空输出目录拒绝。

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { packPlugin, verifyPack, PACK_EXCLUDES } from '../lib/plugin-pack.mjs';

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const cases = [];
const t = (name, fn) => cases.push([name, fn]);

t('P1a 造最小插件树打包：排除路径不进包，skills 完整，自校验通过', () => {
  const src = fs.mkdtempSync(path.join(os.tmpdir(), 'atb-pack-src-'));
  const mk = (rel, content = 'x') => {
    const p = path.join(src, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, content);
  };
  mk('scripts/atb.mjs');
  mk('skills/agent-team-board/SKILL.md', 'skill');
  mk('skills/agent-team-board/dev-closeout.md');
  mk('commands/board.md');
  mk('hooks/hooks.json', '{}');
  mk('.zcode-plugin/plugin.json', '{}');
  mk('.codex-plugin/plugin.json', '{}');
  mk('package.json', '{"name":"agent-team-board"}');
  mk('README.md', '# readme');
  // 应排除
  mk('agent-team-board/data/requirements/REQ-1/README.md');
  mk('agent-team-board/runtime/config.json');
  mk('AGENTS.md', '# agents');
  mk('node_modules/electron/index.js');
  mk('electron/main.mjs');
  mk('output/app.dmg');
  mk('debug.log');

  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'atb-pack-out-'));
  const r = packPlugin(src, out);
  assert.ok(fs.existsSync(path.join(out, 'skills', 'agent-team-board', 'SKILL.md')), 'skills 应完整随包');
  assert.ok(fs.existsSync(path.join(out, '.zcode-plugin', 'plugin.json')), 'ZCode manifest 应随包');
  assert.ok(fs.existsSync(path.join(out, '.codex-plugin', 'plugin.json')), 'Codex manifest 应随包');
  for (const bad of ['agent-team-board', 'AGENTS.md', 'node_modules', 'electron', 'output', 'debug.log']) {
    assert.ok(!fs.existsSync(path.join(out, bad)), `${bad} 不应进包`);
  }
  assert.equal(r.skillsComplete, true);
  assert.ok(r.files > 0 && r.bytes > 0);
});

t('P1b 非空输出目录拒绝 / 输出目录在插件根内拒绝', () => {
  const src = fs.mkdtempSync(path.join(os.tmpdir(), 'atb-pack-src2-'));
  fs.writeFileSync(path.join(src, 'package.json'), '{}');
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'atb-pack-out2-'));
  fs.writeFileSync(path.join(out, 'existing.txt'), 'x');
  assert.throws(() => packPlugin(src, out), /非空/);
  assert.throws(() => packPlugin(src, path.join(src, 'pack-dist')), /插件根内部/);
});

t('P1c 真实插件根打包口径：PACK_EXCLUDES 覆盖验收清单', () => {
  assert.deepEqual(
    PACK_EXCLUDES.slice(0, 5).sort(),
    ['AGENTS.md', 'agent-team-board', 'electron', 'node_modules', 'output'],
    '排除清单应覆盖验收点名的五个路径'
  );
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'atb-pack-out3-'));
  const r = packPlugin(pluginRoot, out);
  assert.equal(r.skillsComplete, true, '真实仓库 skills/agent-team-board/SKILL.md 应随包');
  assert.ok(!fs.existsSync(path.join(out, 'agent-team-board')), '仓库看板数据不进包');
  assert.ok(!fs.existsSync(path.join(out, 'AGENTS.md')), '根 AGENTS.md 不进包');
  assert.ok(!fs.existsSync(path.join(out, 'node_modules')), 'node_modules 不进包（纯源码量级）');
  const v = verifyPack(out);
  assert.equal(v.ok, true, `自校验应通过：${v.violations.join('、')}`);
});

let failed = 0;
for (const [name, fn] of cases) {
  try {
    await fn();
    console.log(`✓ ${name}`);
  } catch (e) {
    failed++;
    console.error(`✗ ${name}\n  ${e && e.stack ? e.stack.split('\n').slice(0, 6).join('\n  ') : e}`);
  }
}
console.log(failed ? `\n${failed} 个用例失败` : '\n全部通过');
process.exit(failed ? 1 : 0);
