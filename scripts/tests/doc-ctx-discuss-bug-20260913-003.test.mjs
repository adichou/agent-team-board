#!/usr/bin/env node
// BUG-20260913-003 Bug 单详情抽屉文档页签右键「讨论」 —— 静态契约 + vm 纯函数测试
// 用法：node scripts/tests/doc-ctx-discuss-bug-20260913-003.test.mjs
// 菜单浮层 / 复制链路 / 收起通道全部复用 REQ-20260909-014 既有实现（既有测试已覆盖），
// 本文件聚焦两处缺口：1) onDocCtxMenu 类型门槛放开 Bug 单；2) docRefPath 按独立 /
// 归属需求 Bug 拼装真实磁盘路径（口径同 scripts/lib/core.mjs resolveItemDir）。

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const js = fs.readFileSync(path.join(pluginRoot, 'scripts', 'web', 'app.js'), 'utf8');

const cases = [];
const t = (name, fn) => cases.push([name, fn]);

function fnSrc(name) {
  const m = js.match(new RegExp(`^(?:async )?function ${name}\\([\\s\\S]*?^\\}`, 'm'));
  assert.ok(m, `应存在 ${name} 函数`);
  return m[0];
}

// 在 vm 沙箱里提取源码中的纯函数（无 DOM 依赖，桩对象注入）
function loadFns(names) {
  const sandbox = {};
  vm.createContext(sandbox);
  vm.runInContext(names.map(fnSrc).join('\n'), sandbox);
  return sandbox;
}

// ---------- T1 docRefPath：按条目类型 / 归属拼装真实磁盘路径 ----------

t('T1 docRefPath：需求单回归口径不变（<项目根>/docs/agent-team-board/requirements/<单号>/<文档名>）', () => {
  const sb = loadFns(['docRefPath']);
  assert.equal(
    sb.docRefPath('/Users/x/proj', 'REQ-20260909-014', 'design.md'),
    '/Users/x/proj/docs/agent-team-board/requirements/REQ-20260909-014/design.md',
  );
});

t('T1 docRefPath：独立 Bug（parent 为空）→ docs/agent-team-board/bugs/<编号>/<文档名>', () => {
  const sb = loadFns(['docRefPath']);
  assert.equal(
    sb.docRefPath('/Users/x/proj', 'BUG-20260913-003', 'README.md', null),
    '/Users/x/proj/docs/agent-team-board/bugs/BUG-20260913-003/README.md',
  );
});

t('T1 docRefPath：归属需求的 Bug（parent=REQ 编号）→ requirements/<REQ>/bugs/<编号>/<文档名>', () => {
  const sb = loadFns(['docRefPath']);
  assert.equal(
    sb.docRefPath('/Users/x/proj', 'BUG-20260913-003', 'test-cases.md', 'REQ-20260909-014'),
    '/Users/x/proj/docs/agent-team-board/requirements/REQ-20260909-014/bugs/BUG-20260913-003/test-cases.md',
  );
});

t('T1 docRefPath：无项目根时返回相对路径（口径同既有实现）', () => {
  const sb = loadFns(['docRefPath']);
  assert.equal(
    sb.docRefPath('', 'BUG-20260913-003', 'design.md', null),
    'docs/agent-team-board/bugs/BUG-20260913-003/design.md',
  );
});

// ---------- T2 onDocCtxMenu：类型门槛放开 Bug 单，路径拼装传 parent ----------

t('T2 onDocCtxMenu：类型门槛为 requirement|bug 白名单（放行 Bug 单，其余类型仍排除）', () => {
  const h = fnSrc('onDocCtxMenu');
  assert.match(h, /dtype !== 'requirement' && dtype !== 'bug'\) return/, '应白名单放行需求与 Bug 详情抽屉');
  assert.doesNotMatch(h, /state\.drawer\.item\?\.type !== 'requirement'/, '不得残留旧口径（显式排除 Bug 单）');
});

t('T2 onDocCtxMenu：docRefPath 调用传入归属 parent（独立 / 归属 Bug 路径区分）', () => {
  const h = fnSrc('onDocCtxMenu');
  assert.match(
    h,
    /docRefPath\(state\.project, state\.drawer\.id, name,\s*state\.drawer\.item\?\.parent/,
    '应把 state.drawer.item.parent 传给 docRefPath',
  );
});

t('T2 onDocCtxMenu：其余边界零回归——#docView 内 / 链接图片放行 / 非就绪态不弹 / preventDefault 在校验后', () => {
  const h = fnSrc('onDocCtxMenu');
  assert.match(h, /view\.contains\(e\.target\)/, '应校验落点在 #docView 内');
  assert.match(h, /closest\('a, img'\)/, '链接/图片右键应放行原生菜单');
  assert.match(h, /state\.drawer\.tab !== name/, '加载中/未创建/失败态（doc 与页签不一致）不弹菜单');
  const posType = h.indexOf("dtype !== 'requirement'");
  const posGuard = h.indexOf('e.preventDefault()');
  assert.ok(posType >= 0 && posType < posGuard, '类型校验应在 preventDefault 之前');
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
