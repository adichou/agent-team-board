#!/usr/bin/env node
// REQ-20260917-002 state-guard 流程外 git commit 拦截口径调整 ——
// 放行「仅含条目目录用户数据 + 主题带单号」的提交，消除参数文本误拦。
// 用法：node scripts/tests/state-guard-20260917-002.test.mjs
// 覆盖 test-cases.md P1–P9 / B1–B15 / N1–N5 / E1（D10 回归在 dev-flow-20260911-009.test.mjs）。

import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const GUARD = path.join(pluginRoot, 'scripts', 'state-guard.mjs');

// ---------- 测试看板项目 ----------
const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'atb-commitguard-')));
const proj = path.join(tmp, 'proj');
fs.mkdirSync(proj, { recursive: true });
const board = path.join(proj, 'agent-team-board');
const REQ = 'REQ-20260917-101';
const NBUG = 'BUG-20260917-102'; // 归属嵌套 bug
const TBUG = 'BUG-20260917-103'; // data/bugs/ 顶层 bug
fs.mkdirSync(path.join(board, 'runtime', '.locks'), { recursive: true });
fs.mkdirSync(path.join(board, 'runtime', 'status'), { recursive: true });
fs.mkdirSync(path.join(board, 'runtime', 'commits', 'batches', 'CMT-1'), { recursive: true });
fs.mkdirSync(path.join(board, 'data', 'requirements', REQ), { recursive: true });
fs.mkdirSync(path.join(board, 'data', 'requirements', REQ, 'bugs', NBUG), { recursive: true });
fs.mkdirSync(path.join(board, 'data', 'requirements', REQ, 'attachments'), { recursive: true });
fs.mkdirSync(path.join(board, 'data', 'bugs', TBUG), { recursive: true });

const ITEM = `agent-team-board/data/requirements/${REQ}`;
const NESTED = `agent-team-board/data/requirements/${REQ}/bugs/${NBUG}`;
const TOPBUG = `agent-team-board/data/bugs/${TBUG}`;

function runGuard(command, cwd = proj) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [GUARD, 'bash'], { cwd, stdio: ['pipe', 'ignore', 'pipe'] });
    let err = '';
    p.stderr.on('data', (c) => { err += c; });
    p.on('close', (code) => resolve({ code, err }));
    p.stdin.write(JSON.stringify({ tool_name: 'Bash', cwd, tool_input: { command } }));
    p.stdin.end();
  });
}

const cases = [];
const t = (name, fn) => cases.push([name, fn]);

const ok = async (command, name) => {
  const r = await runGuard(command);
  assert.equal(r.code, 0, `${name} 应放行：${command} → ${r.err.trim()}`);
};
const blocked = async (command, name) => {
  const r = await runGuard(command);
  assert.equal(r.code, 2, `${name} 应拦截：${command}`);
  assert.match(r.err, /git commit|提交|流程外/, `拦截提示应说明提交口径：${r.err}`);
};

// ---------- P 系列：放行（仅条目目录用户数据 + 主题带单号） ----------

t('P1 带显式 pathspec 提交条目 markdown 放行', async () => {
  await ok(`git commit -m "doc: 讨论轮更新 ${REQ}" ${ITEM}/README.md`, '条目文档提交');
  await ok(`git commit -m "doc: 讨论轮更新 ${REQ}" ${ITEM}/design.md ${ITEM}/test-cases.md`, '多文件');
});

t('P2 目录整体作 pathspec 放行', async () => {
  await ok(`git commit -m "doc: 条目目录整体 ${REQ}" ${ITEM}`, '条目目录');
  await ok(`git commit -m "doc: 顶层 bug 目录 ${TBUG}" ${TOPBUG}`, 'bug 目录');
});

t('P3 嵌套归属 bug 路径放行', async () => {
  await ok(`git commit -m "fix: 归属 bug 文档 ${NBUG}" ${NESTED}/README.md`, '嵌套 bug 文档');
  await ok(`git commit -m "fix: 归属 bug 目录 ${NBUG}" ${NESTED}`, '嵌套 bug 目录整体');
});

t('P4 多 pathspec 全部在条目目录内（含 attachments/、ui-demo.html）放行', async () => {
  await ok(
    `git commit -m "doc: 附件与演示 ${REQ}" ${ITEM}/attachments/a.png ${ITEM}/ui-demo.html`,
    '附件 + 演示页',
  );
});

t('P5 -- 分隔后的 pathspec 放行', async () => {
  await ok(`git commit -m "doc: 双横线分隔 ${REQ}" -- ${ITEM}/README.md`, '-- 分隔');
});

t('P6 git -C <dir>：pathspec 按 -C 目录为基准解析后放行', async () => {
  await ok(
    `git -C ${proj} commit -m "doc: 指定仓库目录 ${REQ}" agent-team-board/data/requirements/${REQ}/README.md`,
    '-C 基准',
  );
});

t('P7 相对路径与绝对路径 pathspec 均放行', async () => {
  const abs = path.join(board, 'data', 'requirements', REQ, 'README.md');
  await ok(`git commit -m "doc: 绝对路径 ${REQ}" ${abs}`, '绝对路径');
  fs.mkdirSync(path.join(board, 'data', 'requirements', REQ), { recursive: true });
  const r = await (async () => {
    // cwd=板根（agent-team-board/）下相对路径 data/requirements/…
    const p2 = board;
    const rr = await new Promise((resolve) => {
      const p = spawn(process.execPath, [GUARD, 'bash'], { cwd: p2, stdio: ['pipe', 'ignore', 'pipe'] });
      let err = '';
      p.stderr.on('data', (c) => { err += c; });
      p.on('close', (code) => resolve({ code, err }));
      p.stdin.write(JSON.stringify({ tool_name: 'Bash', cwd: p2, tool_input: { command: `git commit -m "doc: 板根相对路径 ${REQ}" data/requirements/${REQ}/README.md` } }));
      p.stdin.end();
    });
    return rr;
  })();
  assert.equal(r.code, 0, `板根 cwd 相对 pathspec 应放行：${r.err.trim()}`);
});

t('P8 多段 -m 拼接含单号放行；--message= 等价形态放行', async () => {
  await ok(`git commit -m "doc: 多段消息" -m "讨论单 ${REQ}" ${ITEM}/README.md`, '多段 -m');
  await ok(`git commit --message="doc: 长选项 ${REQ}" ${ITEM}/README.md`, '--message=');
});

t('P9 环境变量赋值前缀识别为命令位，满足细则则放行', async () => {
  await ok(`LC_ALL=C git commit -m "doc: env 前缀 ${REQ}" ${ITEM}/README.md`, 'env 前缀');
});

// ---------- B 系列：保护不回退 ----------

t('B1 裸提交（无 pathspec，主题含单号也不放）拦', async () => {
  await blocked(`git commit -m "doc: 裸提交 ${REQ}"`, '裸提交');
});

t('B2 git commit -a（暂存区整体形态）拦', async () => {
  await blocked(`git commit -a -m "doc: 全量暂存 ${REQ}"`, '-a 形态');
  await blocked(`git commit --all -m "doc: 全量暂存 ${REQ}"`, '--all 形态');
});

t('B3 pathspec 含源码路径（含混合条目路径）拦', async () => {
  await blocked(`git commit -m "feat: 源码 ${REQ}" scripts/lib/core.mjs`, '纯源码');
  await blocked(`git commit -m "doc: 混合 ${REQ}" ${ITEM}/README.md scripts/state-guard.mjs`, '混合');
});

t('B4 pathspec 含 runtime/status/<ID>.json 拦', async () => {
  await blocked(
    `git commit -m "chore: 状态文件 ${REQ}" agent-team-board/runtime/status/${REQ}.json`,
    'status.json',
  );
});

t('B5 pathspec 含应用数据路径（config.json / 运行账本）拦', async () => {
  await blocked(`git commit -m "chore: 配置 ${REQ}" agent-team-board/runtime/config.json`, 'config.json');
  await blocked(
    `git commit -m "chore: 账本 ${REQ}" agent-team-board/runtime/commits/batches/CMT-1/batch.json`,
    '运行账本',
  );
});

t('B6 pathspec 越出条目目录（data 整体 / .. 逃逸）拦', async () => {
  await blocked(`git commit -m "doc: 数据根 ${REQ}" agent-team-board/data`, 'data 整体');
  await blocked(`git commit -m "doc: 需求根 ${REQ}" agent-team-board/data/requirements`, 'requirements 整体');
  await blocked(`git commit -m "doc: 逃逸 ${REQ}" ${ITEM}/../../README.md`, '.. 逃逸');
});

t('B7 主题不含条目编号拦', async () => {
  await blocked(`git commit -m "doc: 忘记单号" ${ITEM}/README.md`, '无单号');
});

t('B8 --amend / --only / --include / --patch / --fixup 非授权形态拦', async () => {
  await blocked(`git commit --amend -m "doc: 改写 ${REQ}" ${ITEM}/README.md`, '--amend');
  await blocked(`git commit --only -m "doc: only ${REQ}" ${ITEM}/README.md`, '--only');
  await blocked(`git commit -i -m "doc: include ${REQ}" ${ITEM}/README.md`, '-i');
  await blocked(`git commit -p -m "doc: patch ${REQ}" ${ITEM}/README.md`, '-p');
  await blocked(`git commit --fixup=HEAD~1 ${ITEM}/README.md`, '--fixup');
});

t('B9 消息来源不可静态解析（-F / -t / -C 复用消息 / 无 -m）拦', async () => {
  await blocked(`git commit -F msg.txt ${ITEM}/README.md`, '-F 文件');
  await blocked(`git commit --file=msg.txt ${ITEM}/README.md`, '--file=');
  await blocked(`git commit -t tpl.txt -m "doc: 模板 ${REQ}" ${ITEM}/README.md`, '-t 模板');
  await blocked(`git commit -C HEAD~1 ${ITEM}/README.md`, '-C 复用消息');
  await blocked(`git commit ${ITEM}/README.md`, '无 -m');
});

t('B10 pathspec 含通配符 / magic 前缀拦（glob 不静态展开）', async () => {
  await blocked(`git commit -m "doc: 通配 ${REQ}" ${ITEM}/*.md`, 'glob');
  await blocked(`git commit -m "doc: 排除 ${REQ}" ${ITEM} ':(exclude)'${ITEM}/x.md`, ':magic');
  await blocked(`git commit -m "doc: 排除 ${REQ}" ${ITEM} '^'${ITEM}/x.md`, '^ 排除');
});

t('B11 --git-dir / --work-tree / GIT_* 赋值改变仓库落点拦', async () => {
  await blocked(`git --git-dir=.git commit -m "doc: 落点 ${REQ}" ${ITEM}/README.md`, '--git-dir');
  await blocked(`git --work-tree=. commit -m "doc: 落点 ${REQ}" ${ITEM}/README.md`, '--work-tree');
  await blocked(`GIT_DIR=.git git commit -m "doc: 落点 ${REQ}" ${ITEM}/README.md`, 'GIT_DIR=');
});

t('B12 ; / && 拼接的真实提交分段后仍拦', async () => {
  await blocked(`git add -A; git commit -m "doc: 分号拼接 ${REQ}"`, '分号拼接');
  await blocked(`git add -A && git commit -m "doc: 与拼接 ${REQ}"`, '&& 拼接');
});

t('B13 bash -c / eval 再解释执行形态拦', async () => {
  await blocked(`bash -c 'git commit -m "doc: 再解释 ${REQ}"'`, 'bash -c');
  await blocked(`eval "git commit -m 'doc: eval ${REQ}'"`, 'eval');
});

t('B14 xargs / find -exec 间接执行形态拦', async () => {
  await blocked(`git add -A | xargs git commit -m "doc: xargs ${REQ}"`, 'xargs');
  await blocked(`find agent-team-board/data -name '*.md' -exec git commit -m "doc: fexec ${REQ}" \\;`, 'find -exec');
});

t('B15 echo 管道喂 stdin shell 的提交序列拦', async () => {
  await blocked(`echo "git commit -m 'doc: 管道 ${REQ}'" | bash`, 'echo | bash');
});

// ---------- N 系列：文本误拦消除 ----------

t('N1 atb new req --desc 引用拦截提示原文不再误拦', async () => {
  await ok(
    `node scripts/atb.mjs new req --title "示例" --desc "流程外 git commit 已拦截：提交通道为系统自动提交"`,
    'atb 登记引用原文',
  );
});

t('N2 grep / echo 参数文本含 git commit 字样放行', async () => {
  await ok(`grep "git commit" README.md`, 'grep');
  await ok(`echo "git commit -m x"`, 'echo');
  await ok(`sed -n '/git commit/p' docs/faq.md`, 'sed 查找');
});

t('N3 无看板上下文项目内 git commit 放行（管辖不变）', async () => {
  const outside = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'atb-noboard-')));
  const r = await runGuard('git commit -m "chore: 别的项目正常提交"', outside);
  assert.equal(r.code, 0, '非看板项目不管辖');
});

t('N4 git add / status 等非提交子命令放行', async () => {
  await ok('git add -A && git status --short', 'add+status');
  await ok(`git add ${ITEM}/README.md`, 'add 条目文件');
});

t('N5 git log / diff 等只读子命令放行', async () => {
  await ok('git log --oneline -5', 'log');
  await ok('git diff HEAD', 'diff');
});

// ---------- E1 讨论轮端到端 ----------

t('E1 讨论轮端到端：submitted 条目文档提交守卫放行且真实落库', async () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'atb-discussion-')));
  const git = (args) => spawnSync('git', ['-c', 'user.email=t@example.com', '-c', 'user.name=t', ...args], {
    cwd: root, encoding: 'utf8', timeout: 30_000,
  });
  git(['init', '-q', '-b', 'main']);
  // 看板 + submitted 条目（讨论轮常态）
  const bDir = path.join(root, 'agent-team-board');
  fs.mkdirSync(path.join(bDir, 'runtime', '.locks'), { recursive: true });
  const itemDir = path.join(bDir, 'data', 'requirements', REQ);
  fs.mkdirSync(itemDir, { recursive: true });
  fs.writeFileSync(path.join(itemDir, 'README.md'), '# 讨论单\n\n初稿\n');
  git(['add', '.']);
  git(['commit', '-q', '-m', 'chore: 基线']);
  // 讨论轮：编辑条目 markdown 后带 pathspec 提交，主题含讨论单号
  fs.appendFileSync(path.join(itemDir, 'README.md'), '\n第二轮讨论补充\n');
  const command = `git commit -m "doc: 讨论轮更新 ${REQ}" agent-team-board/data/requirements/${REQ}/README.md`;
  const g = await runGuard(command, root);
  assert.equal(g.code, 0, `讨论轮提交应放行：${g.err.trim()}`);
  const real = spawnSync('git', ['-c', 'user.email=t@example.com', '-c', 'user.name=t', 'commit',
    '-m', `doc: 讨论轮更新 ${REQ}`, `agent-team-board/data/requirements/${REQ}/README.md`], {
    cwd: root, encoding: 'utf8', timeout: 30_000,
  });
  assert.equal(real.status, 0, `真实提交应成功：${real.stderr}`);
  const subjects = git(['log', '--format=%s']).stdout.split('\n').filter(Boolean);
  assert.ok(subjects.includes(`doc: 讨论轮更新 ${REQ}`), '提交应落库且主题含单号');
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
