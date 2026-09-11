#!/usr/bin/env node
// REQ-20260901-003 钩子硬约束插件源码改动 —— 子进程实测 state-guard 两种模式
// 用法：node scripts/tests/code-guard.test.mjs
// 覆盖 design G1–G6；锁放行用临时项目看板（ATB_GUARD_TEST_* 环境变量注入 cwd 与锁目录）。

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const guard = path.join(pluginRoot, 'scripts', 'state-guard.mjs');

// 临时项目（含看板），用于锁存在性测试
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'atb-codeguard-'));
fs.mkdirSync(path.join(tmp, 'proj'), { recursive: true });
const project = fs.realpathSync(path.join(tmp, 'proj'));
const board = path.join(project, 'docs', 'agent-team-board');
fs.mkdirSync(path.join(board, '.locks'), { recursive: true });
const SRC = path.join(pluginRoot, 'scripts', 'web', 'app.js'); // 受保护源码样本

function run(mode, toolInput, cwd, env = {}) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [guard, mode], {
      cwd: cwd || pluginRoot,
      env: { ...process.env, ...env },
      stdio: ['pipe', 'ignore', 'pipe'],
    });
    let err = '';
    p.stderr.on('data', (c) => { err += c; });
    p.on('close', (code) => resolve({ code, err }));
    p.stdin.write(JSON.stringify({ tool_name: mode === 'file' ? 'Write' : 'Bash', cwd: cwd || pluginRoot, tool_input: toolInput }));
    p.stdin.end();
  });
}

const cases = [];
const t = (name, fn) => cases.push([name, fn]);

// 无锁 cwd：临时目录（无看板即无锁）——模拟在其他项目/无认领时改插件源码
const tmpNoLock = fs.mkdtempSync(path.join(os.tmpdir(), 'atb-nolock-'));

// G1 无锁：Write/Edit 指向插件源码 → 2
t('G1 无锁：Edit 插件源码被拦并含流程指引', async () => {
  const r = await run('file', { file_path: SRC }, tmpNoLock);
  assert.equal(r.code, 2, `期望 2，得到 ${r.code}：${r.err}`);
  assert.match(r.err, /认领|claim|看板/, '提示应含流程指引');
});

// G2 无锁：Bash 改写源码 → 2；只读放行
t('G2 无锁：Bash sed/重定向改源码被拦，只读放行', async () => {
  const sed = await run('bash', { command: `sed -i '' 's/a/b/' ${SRC}` }, tmpNoLock);
  assert.equal(sed.code, 2);
  const redir = await run('bash', { command: `echo x > ${pluginRoot}/commands/dev.md` }, tmpNoLock);
  assert.equal(redir.code, 2);
  const ro = await run('bash', { command: `node ${pluginRoot}/scripts/tests/layout.test.mjs` }, tmpNoLock);
  assert.equal(ro.code, 0, '运行测试应放行');
});

// BUG-20260905-001：sed 与输出重定向需按实际语义区分读写意图。
t('B1 无锁：只读 sed 与普通输出变换放行', async () => {
  const commands = [
    `sed -n '1,20p' ${SRC}`,
    `sed -e '1,20p' ${SRC}`,
    `sed 's/a/b/' ${SRC}`,
    `sed 's/>/x/' ${SRC}`,
  ];
  for (const command of commands) {
    const r = await run('bash', { command }, tmpNoLock);
    assert.equal(r.code, 0, `只读 sed 应放行（${command}）：${r.err}`);
  }
});

t('B2 无锁：sed 原地写入选项保持拦截', async () => {
  const commands = [
    `sed -i 's/a/b/' ${SRC}`,
    `sed -i '' 's/a/b/' ${SRC}`,
    `sed -i.bak 's/a/b/' ${SRC}`,
    `sed -ni 's/a/b/p' ${SRC}`,
    `sed --in-place 's/a/b/' ${SRC}`,
    `sed --in-place=.bak 's/a/b/' ${SRC}`,
  ];
  for (const command of commands) {
    const r = await run('bash', { command }, tmpNoLock);
    assert.equal(r.code, 2, `sed 原地写入应拦截（${command}）`);
  }
});

t('B3 无锁：sed 的 w/W/r/e 脚本命令保持拦截', async () => {
  const commands = [
    `sed -n 'w /tmp/out' ${SRC}`,
    `sed -n '1W /tmp/out' ${SRC}`,
    `sed -n '/x/r /tmp/input' ${SRC}`,
    `sed -n -e '1,2e echo x' ${SRC}`,
    `sed -n '1p;w /tmp/out' ${SRC}`,
  ];
  for (const command of commands) {
    const r = await run('bash', { command }, tmpNoLock);
    assert.equal(r.code, 2, `sed 危险脚本命令应拦截（${command}）`);
  }
});

t('B4 无锁：重定向到 /dev/null 放行', async () => {
  const commands = [
    `node ${SRC} > /dev/null`,
    `node ${SRC} 2>/dev/null`,
    `node ${SRC} &>/dev/null`,
    `node ${SRC} > "/dev/null"`,
  ];
  for (const command of commands) {
    const r = await run('bash', { command }, tmpNoLock);
    assert.equal(r.code, 0, `丢弃型重定向应放行（${command}）：${r.err}`);
  }
});

// BUG-20260907-013 判例演进：`node <插件源码> > /tmp/out` 原按「重定向意图 + 段内
// 插件路径」判拦（B5 旧用例），实为执行插件脚本并写外部文件——与启动 server.mjs
// 重定向日志同构，改为放行（见 C1）。重定向目标落在插件内、或缺失目标的残缺命令仍拦。
t('B5 无锁：重定向目标在插件内保持拦截，缺失目标保守拦截', async () => {
  const commands = [
    `node ${SRC} > ${pluginRoot}/scripts/out.tmp`,
    `node ${SRC} >> ${pluginRoot}/commands/out.tmp`,
    `node ${SRC} >`,
  ];
  for (const command of commands) {
    const r = await run('bash', { command }, tmpNoLock);
    assert.equal(r.code, 2, `重定向目标在插件内应拦截（${command}）`);
  }
});

t('B6 无锁：既有独立改写命令保持拦截', async () => {
  const commands = [
    `cp /tmp/out ${SRC}`,
    `mv /tmp/out ${SRC}`,
    `rm ${SRC}`,
    `chmod 600 ${SRC}`,
    `tee ${SRC}`,
  ];
  for (const command of commands) {
    const r = await run('bash', { command }, tmpNoLock);
    assert.equal(r.code, 2, `既有改写命令应拦截（${command}）`);
  }
});

// BUG-20260907-006：引号拆词绕过——shell 中成对引号是「词内连接」，st""atus / ac""cepted
// 实际就是 status / accepted；守卫 token 化与路径子串匹配须先做引号内拼接归一。
t('Q1 子命令拆词：atb st""atus 接人工专属状态应拦截', async () => {
  const commands = [
    `atb st""atus REQ-20260907-001 accepted`,
    `atb 'st'atus REQ-20260907-001 accepted`,
    `atb st"at"us REQ-20260907-001 done`,
    `atb ""status REQ-20260907-001 done`,
  ];
  for (const command of commands) {
    const r = await run('bash', { command }, tmpNoLock);
    assert.equal(r.code, 2, `拆词子命令应拦截（${command}）`);
  }
});

t('Q2 目标状态拆词：ac""cepted / don""e / --to=do""ne 应拦截', async () => {
  const commands = [
    `atb status REQ-20260907-001 ac""cepted`,
    `atb status REQ-20260907-001 don""e`,
    `node /x/atb.mjs status REQ-20260907-001 ac''cepted`,
    `atb status REQ-20260907-001 --to=do""ne`,
  ];
  for (const command of commands) {
    const r = await run('bash', { command }, tmpNoLock);
    assert.equal(r.code, 2, `拆词目标状态应拦截（${command}）`);
  }
});

t('Q3 curl 人工 API：参数值与路径拆词应拦截', async () => {
  const commands = [
    `curl -s -X POST http://127.0.0.1:8888/api/item/REQ-1/status -d "to=ac""cepted"`,
    `curl -s -X POST http://127.0.0.1:8888/api/it""em/REQ-1/status -d to=done`,
  ];
  for (const command of commands) {
    const r = await run('bash', { command }, tmpNoLock);
    assert.equal(r.code, 2, `拆词 curl 人工状态接口应拦截（${command}）`);
  }
});

t('Q4 status.json 路径拆词改写应拦截', async () => {
  const commands = [
    `echo '{"x":1}' > ${board}/requirements/R1/st""atus.json`,
    `echo x | tee ${board}/requirements/R1/st''atus.json`,
  ];
  for (const command of commands) {
    const r = await run('bash', { command }, tmpNoLock);
    assert.equal(r.code, 2, `拆词 status.json 改写应拦截（${command}）`);
  }
});

t('Q5 误报回归：引号内普通字样与拆词只读不新增误拦', async () => {
  const commands = [
    `node ${pluginRoot}/scripts/atb.mjs report REQ-20260907-006 --coverage 90 --summary "修复 st\\"\\atus 拆词绕过与 ac cepted 字样提及"`,
    `node ${pluginRoot}/scripts/atb.mjs report REQ-20260907-006 --summary "提及 st\\\"\\\"atus 与 done 字样的说明文本"`,
    `echo "文本提及 st atus 与 ac cepted 字样"`,
    `cat ${board}/requirements/R1/st""atus.json`,
    `atb st""atus REQ-20260907-001 in-pro""gress`,
  ];
  for (const command of commands) {
    const r = await run('bash', { command }, tmpNoLock);
    assert.equal(r.code, 0, `合法命令应放行（${command}）：${r.err}`);
  }
});

// BUG-20260907-007：改写意图检测缺口——解释器内联代码（node -e/--eval/-p、ruby/perl -e、
// python -c 等）与 find 写动作（-delete/-fprint 族）可改删 status.json / 插件源码，此前均放行。
t('N1 解释器内联代码改写 status.json 应拦截', async () => {
  const sj = `${board}/requirements/R1/status.json`;
  const commands = [
    `node -e "require('fs').writeFileSync('${sj}','{}')"`,
    `node --eval "require('fs').writeFileSync('${sj}','{}')"`,
    `node -p "require('fs').writeFileSync('${sj}','{}');''"`,
    `ruby -e "File.write('${sj}','{}')"`,
    `perl -e "unlink('${sj}')"`,
    `python3 -c "open('${sj}','w')"`,
  ];
  for (const command of commands) {
    const r = await run('bash', { command }, tmpNoLock);
    assert.equal(r.code, 2, `解释器内联改写 status.json 应拦截（${command}）`);
  }
});

t('N2 find 写动作删改 status.json 应拦截', async () => {
  const commands = [
    `find ${board} -name status.json -delete`,
    `find ${board} -name status.json -fprint /tmp/atb-out`,
    `find ${board} -name status.json -fprint0 /tmp/atb-out`,
    `find ${board} -name status.json -fprintf /tmp/atb-out '%p\\n'`,
    `find ${board} -name status.json -fls /tmp/atb-out`,
  ];
  for (const command of commands) {
    const r = await run('bash', { command }, tmpNoLock);
    assert.equal(r.code, 2, `find 写动作触碰 status.json 应拦截（${command}）`);
  }
});

t('N3 解释器内联代码与 find 写动作触碰插件源码应拦截', async () => {
  const commands = [
    `node -e "require('fs').rmSync('${SRC}')"`,
    `node --eval="require('fs').rmSync('${SRC}')"`,
    `ruby -e "File.delete('${SRC}')"`,
    `find ${pluginRoot}/scripts -name '*.mjs' -delete`,
    // BUG-20260907-013 判例演进：-fprint 写目标须落在插件内才拦（写 /tmp 的旧用例移至 C3）
    `find /tmp -name 'atb.mjs' -fprint ${pluginRoot}/scripts/list.tmp`,
  ];
  for (const command of commands) {
    const r = await run('bash', { command }, tmpNoLock);
    assert.equal(r.code, 2, `无锁改写插件源码应拦截（${command}）`);
  }
});

t('N4 误报回归：无内联代码的解释器调用与只读 find 放行', async () => {
  const commands = [
    `node ${pluginRoot}/scripts/atb.mjs show REQ-20260901-003`,
    `node --version`,
    `python3 -m json.tool ${board}/requirements/R1/status.json`,
    `find ${board} -name status.json`,
    `find ${pluginRoot}/scripts -name '*.mjs' | head -3`,
    `node ${pluginRoot}/scripts/atb.mjs report BUG-20260907-007 --coverage 90 --summary "提及 node -e 与 find -delete 字样的说明文本"`,
    `echo "文本提及 node --eval 与 find -delete 字样"`,
  ];
  for (const command of commands) {
    const r = await run('bash', { command }, tmpNoLock);
    assert.equal(r.code, 0, `合法命令应放行（${command}）：${r.err}`);
  }
});

t('N5 perl 形态回归：-pi 原地改写与 -e 内联均拦截', async () => {
  const commands = [
    `perl -pi -e 's/a/b/' ${SRC}`,
    `perl -pi.bak 's/a/b/' ${SRC}`,
    `perl -e "unlink(glob('${board}/requirements/*/status.json'))"`,
  ];
  for (const command of commands) {
    const r = await run('bash', { command }, tmpNoLock);
    assert.equal(r.code, 2, `perl 改写形态应拦截（${command}）`);
  }
});

// BUG-20260907-013：改写意图与插件源码须按「写目标」语义关联——插件路径仅作为
// 读取/执行/遍历来源出现（node <插件>/scripts/server.mjs > /tmp/x.log）不再误拦；
// 仅当改写动作的落盘目标解析为插件源码路径时拦截。
t('C1 无锁：执行/读取插件源码并写插件外目标放行（本 Bug 原始场景）', async () => {
  const commands = [
    `ATB_PORT=8123 node ${pluginRoot}/scripts/server.mjs > /tmp/agent-team-board.log 2>&1`,
    `node ${SRC} > /tmp/out`,
    `node ${SRC} >> /tmp/out`,
    `cat ${SRC} | tee /tmp/out`,
    `node ${pluginRoot}/scripts/tests/layout.test.mjs > /tmp/atb-test.log`,
  ];
  for (const command of commands) {
    const r = await run('bash', { command }, tmpNoLock);
    assert.equal(r.code, 0, `读/执行插件源码 + 写插件外目标应放行（${command}）：${r.err}`);
  }
});

t('C2 无锁：写目标落在插件内（含写新文件）保持拦截', async () => {
  const commands = [
    `echo x > ${pluginRoot}/scripts/new-file.tmp`,
    `node x 2> ${pluginRoot}/scripts/err.tmp`,
    `cp /tmp/atb-a ${pluginRoot}/scripts/b.tmp`,
    `cp -t ${pluginRoot}/scripts /tmp/atb-a`,
    `mv ${SRC} /tmp/atb-out`, // mv 源被移出插件根：源操作数同样计为写目标
    `sed -i 's/a/b/' ${pluginRoot}/scripts/atb.mjs`,
    `perl -pi -e 's/a/b/' ${SRC}`,
    `find /tmp -name x -fprint ${pluginRoot}/scripts/list.tmp`,
  ];
  for (const command of commands) {
    const r = await run('bash', { command }, tmpNoLock);
    assert.equal(r.code, 2, `写目标在插件内应拦截（${command}）`);
  }
});

t('C3 无锁：插件路径仅作读取/遍历来源、写目标在插件外放行（判例演进）', async () => {
  const commands = [
    `cp ${SRC} /tmp/atb-out`, // cp 源仅被读取（写目标=末操作数），与 cat <SRC> >/tmp 同口径
    `find ${pluginRoot}/scripts -name 'atb.mjs' -fprint /tmp/atb-out`, // 遍历仅读取，清单写 /tmp
    `tee /tmp/atb-out < ${SRC}`, // 输入重定向的插件路径是读取来源
  ];
  for (const command of commands) {
    const r = await run('bash', { command }, tmpNoLock);
    assert.equal(r.code, 0, `合法命令应放行（${command}）：${r.err}`);
  }
});

// G3 有效锁：放行
t('G3 有效认领锁：同类命令放行', async () => {
  fs.writeFileSync(path.join(board, '.locks', 'REQ-TEST-001.lock'), JSON.stringify({ owner: 't', at: new Date().toISOString() }));
  const w = await run('file', { file_path: SRC }, project);
  assert.equal(w.code, 0, `有效锁应放行 Write：${w.err}`);
  const b = await run('bash', { command: `echo x > ${pluginRoot}/commands/dev.md` }, project);
  assert.equal(b.code, 0, '有效锁应放行 Bash 改写');
  fs.rmSync(path.join(board, '.locks', 'REQ-TEST-001.lock'));
});

// G4 豁免：看板 markdown 直改 0；status.json 直写仍 2（原规则不破坏）
t('G4 豁免与原规则：看板 markdown 放行、status.json 直写仍拦', async () => {
  const md = path.join(board, 'README.md');
  fs.writeFileSync(md, '# t');
  const w = await run('file', { file_path: md }, project);
  assert.equal(w.code, 0, '看板 markdown 应放行');
  const sj = await run('file', { file_path: path.join(board, 'requirements', 'X', 'status.json') }, project);
  assert.equal(sj.code, 2, 'status.json 直写仍应拦截');
});

// G5 只读不误报（BUG-20260901-002 修复面）：cat status.json、提及看板目录的只读命令 → 0
t('G5 只读不误报：cat status.json / 只读提及看板目录放行', async () => {
  const c1 = await run('bash', { command: `cat ${board}/requirements/R1/status.json` }, project);
  assert.equal(c1.code, 0, `cat status.json 应放行：${c1.err}`);
  const c2 = await run('bash', { command: `ls docs/agent-team-board && grep -r 认领 docs/agent-team-board/requirements` }, project);
  assert.equal(c2.code, 0, `只读提及看板目录应放行：${c2.err}`);
});

// BUG-20260901-002 回归面：合法命令文本提及看板目录与 status.json 不误拦；真实改写仍拦
t('F1 误报回归：atb 合法子命令文本提及目录与状态文件名放行', async () => {
  const commands = [
    `node ${pluginRoot}/scripts/atb.mjs new req "守卫误报" --desc "命令文本提及 docs/agent-team-board 与 /status.json 即被拦"`,
    `node ${pluginRoot}/scripts/atb.mjs report REQ-20260901-003 --coverage 90 --summary "修复 docs/agent-team-board/…/status.json 误报"`,
  ];
  for (const command of commands) {
    const r = await run('bash', { command }, tmpNoLock);
    assert.equal(r.code, 0, `atb 合法子命令应放行（${command}）：${r.err}`);
  }
});

t('F2 误报回归：只读命令按路径形态提及 status.json 放行', async () => {
  const commands = [
    `cat ${board}/requirements/R1/status.json | head -5`,
    `ls docs/agent-team-board/requirements/R1/status.json`,
    `grep -c status.json ${board}/README.md`,
  ];
  for (const command of commands) {
    const r = await run('bash', { command }, tmpNoLock);
    assert.equal(r.code, 0, `只读命令应放行（${command}）：${r.err}`);
  }
});

t('F3 回归：status.json 真实改写命令仍拦截', async () => {
  const sj = `${board}/requirements/R1/status.json`;
  const commands = [
    `echo '{"status":"done"}' > ${sj}`,
    `sed -i '' 's/submitted/accepted/' ${sj}`,
    `echo x | tee ${sj}`,
    `rm ${sj}`,
  ];
  for (const command of commands) {
    const r = await run('bash', { command }, tmpNoLock);
    assert.equal(r.code, 2, `status.json 改写应拦截（${command}）`);
  }
});

// G6 无看板项目：改插件源码 → 2
t('G6 项目无看板：改插件源码被拦', async () => {
  const nop = fs.mkdtempSync(path.join(os.tmpdir(), 'atb-noboard-'));
  const r = await run('file', { file_path: SRC }, nop);
  fs.rmSync(nop, { recursive: true, force: true });
  assert.equal(r.code, 2, '无看板（无锁）应拦截');
});

// BUG-20260906-015：PLUGIN_ROOT 从 scripts/ 多上跳一层 —— docs/ 豁免永不生效、
// 保护范围整体上移到插件根父目录。用「伪插件」副本隔离复现（守卫以自身位置解析插件根）。
function runGuardAt(guardPath, mode, toolInput, cwd, env = {}) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [guardPath, mode], {
      cwd: cwd || pluginRoot,
      env: { ...process.env, ...env },
      stdio: ['pipe', 'ignore', 'pipe'],
    });
    let err = '';
    p.stderr.on('data', (c) => { err += c; });
    p.on('close', (code) => resolve({ code, err }));
    p.stdin.write(JSON.stringify({ tool_name: mode === 'file' ? 'Write' : 'Bash', cwd: cwd || pluginRoot, tool_input: toolInput }));
    p.stdin.end();
  });
}

const fakeRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'atb-proot-')));
const fakePlugin = path.join(fakeRoot, 'fake-plugin');
fs.mkdirSync(path.join(fakePlugin, 'scripts'), { recursive: true });
fs.copyFileSync(guard, path.join(fakePlugin, 'scripts', 'state-guard.mjs'));
const sibling = path.join(fakeRoot, 'other-project');
fs.mkdirSync(path.join(sibling, 'src'), { recursive: true });

t('P1 无锁：插件根内 docs/agent-team-board 条目 markdown 放行（豁免生效）', async () => {
  const md = path.join(fakePlugin, 'docs', 'agent-team-board', 'bugs', 'B-1', 'README.md');
  fs.mkdirSync(path.dirname(md), { recursive: true });
  fs.writeFileSync(md, '# t');
  const r = await runGuardAt(path.join(fakePlugin, 'scripts', 'state-guard.mjs'), 'file', { file_path: md }, tmpNoLock);
  assert.equal(r.code, 0, `插件根内看板 markdown 应放行：${r.err}`);
});

t('P2 无锁：插件根同级其他项目文件不再被误当插件源码（保护范围不上移）', async () => {
  const f = path.join(sibling, 'src', 'main.swift');
  fs.writeFileSync(f, '// t');
  const r = await runGuardAt(path.join(fakePlugin, 'scripts', 'state-guard.mjs'), 'file', { file_path: f }, tmpNoLock);
  assert.equal(r.code, 0, `同级项目文件应放行：${r.err}`);
  const b = await runGuardAt(path.join(fakePlugin, 'scripts', 'state-guard.mjs'), 'bash', { command: `echo hi > ${f}` }, tmpNoLock);
  assert.equal(b.code, 0, `同级项目文件 Bash 改写应放行：${b.err}`);
});

t('P3 无锁：插件根内源码仍拦截（修复不放松保护）', async () => {
  const f = path.join(fakePlugin, 'scripts', 'atb.mjs');
  fs.writeFileSync(f, '#!/usr/bin/env node\n');
  const r = await runGuardAt(path.join(fakePlugin, 'scripts', 'state-guard.mjs'), 'file', { file_path: f }, tmpNoLock);
  assert.equal(r.code, 2, '伪插件 scripts/ 内源码应仍被拦截');
});

t('P4 无锁：真实安装形态下本仓库看板条目 markdown 放行', async () => {
  const md = path.join(pluginRoot, 'docs', 'agent-team-board', 'bugs', 'BUG-20260906-015', 'README.md');
  assert.ok(fs.existsSync(md), '回归样本 markdown 应存在');
  const r = await run('file', { file_path: md }, tmpNoLock);
  assert.equal(r.code, 0, `本仓库看板 markdown（插件根内 docs/）应放行：${r.err}`);
});

// BUG-20260907-008：软链别名绕过——生产形态 cache 目录软链指向源码仓库，命令文本用
// 别名路径时既不含 realpath 插件根、也不符合 agent-team-board/<受控目录> 邻接正则，
// 此前可无锁改写源码。守卫须对路径形态 token 做符号链接归一化（realpath）。
const aliasRoot = path.join(fakeRoot, 'cache-alias'); // 模拟 cache 软链 → 源码仓库
fs.symlinkSync(fakePlugin, aliasRoot, 'dir');
fs.mkdirSync(path.join(fakePlugin, 'scripts', 'web'), { recursive: true });
const aliasSrc = path.join(aliasRoot, 'scripts', 'web', 'app.js');
fs.writeFileSync(aliasSrc, '// t\n');

t('S1 无锁：经软链别名路径 Bash 改写既有源码应拦截', async () => {
  const commands = [
    `echo hacked > ${aliasSrc}`,
    `sed -i '' 's/a/b/' ${aliasSrc}`,
    `echo x | tee ${aliasSrc}`,
    `rm ${aliasSrc}`,
    `cp /tmp/atb-x ${aliasSrc}`,
  ];
  for (const command of commands) {
    const r = await runGuardAt(path.join(fakePlugin, 'scripts', 'state-guard.mjs'), 'bash', { command }, tmpNoLock);
    assert.equal(r.code, 2, `软链别名改写源码应拦截（${command}）`);
  }
});

t('S2 无锁：经软链别名写不存在的新文件（父目录存在）应拦截', async () => {
  const commands = [
    `echo hacked > ${aliasRoot}/scripts/web/new-file.js`,
    `tee ${aliasRoot}/commands/new-cmd.md < /dev/null`,
  ];
  for (const command of commands) {
    const r = await runGuardAt(path.join(fakePlugin, 'scripts', 'state-guard.mjs'), 'bash', { command }, tmpNoLock);
    assert.equal(r.code, 2, `软链别名写新文件应拦截（${command}）`);
  }
});

t('S3 无锁：file 模式经别名改既有源码仍拦截（realpath 行为回归）', async () => {
  const r = await runGuardAt(path.join(fakePlugin, 'scripts', 'state-guard.mjs'), 'file', { file_path: aliasSrc }, tmpNoLock);
  assert.equal(r.code, 2, `file 模式别名路径应拦截（realpath 解析）`);
});

t('S4 无锁：~ 前缀别名路径改写应拦截', async () => {
  const r = await runGuardAt(
    path.join(fakePlugin, 'scripts', 'state-guard.mjs'),
    'bash',
    { command: `echo x > ~/cache-alias/scripts/web/app.js` },
    tmpNoLock,
    { HOME: fakeRoot },
  );
  assert.equal(r.code, 2, `~ 前缀软链别名改写应拦截：${r.err}`);
});

t('S5 误报回归：别名指向非插件目录、别名下 docs 豁免与只读命令不误拦', async () => {
  const otherAlias = path.join(fakeRoot, 'other-alias'); // 软链 → 非插件目录
  fs.symlinkSync(sibling, otherAlias, 'dir');
  const boardMd = path.join(aliasRoot, 'docs', 'agent-team-board', 'bugs', 'B-2', 'README.md');
  fs.mkdirSync(path.dirname(boardMd), { recursive: true });
  fs.writeFileSync(boardMd, '# t');
  const guardAt = path.join(fakePlugin, 'scripts', 'state-guard.mjs');
  const commands = [
    `echo hi > ${otherAlias}/src/main.swift`, // 别名指向其他项目：放行
    `echo x > ${boardMd}`, // 别名下的看板 markdown：docs/ 豁免放行
    `cat ${aliasSrc}`, // 只读：放行
    `curl -s http://127.0.0.1:8888/api/items`, // URL token 不当作路径：放行（无人工状态参数）
  ];
  for (const command of commands) {
    const r = await runGuardAt(guardAt, 'bash', { command }, tmpNoLock);
    assert.equal(r.code, 0, `合法命令应放行（${command}）：${r.err}`);
  }
});

// BUG-20260908-001：file 模式不拦新建文件——denyIfSourceLocked 先 existsSync 再判定，
// 目标不存在（Write 新建）时跳过源码判定，无锁可在插件源码目录落新文件；Bash 侧经
// BUG-20260907-008 的最近存在祖先回溯已覆盖新建场景，file 模式须同口径（docs/ 豁免照旧）。
t('NF1 无锁：file 模式 Write 插件源码目录内不存在的新文件应拦截', async () => {
  const targets = [
    path.join(pluginRoot, 'scripts', 'brand-new-file.mjs'),
    path.join(pluginRoot, 'commands', 'new-cmd.md'),
    path.join(pluginRoot, 'zcode-new-at-root.tmp'), // 插件根直下新文件：祖先即插件根，剩余段非 docs
  ];
  for (const file_path of targets) {
    assert.ok(!fs.existsSync(file_path), `用例目标应不存在（${file_path}）`);
    const r = await run('file', { file_path }, tmpNoLock);
    assert.equal(r.code, 2, `无锁新建插件源码文件应拦截（${file_path}）：${r.err}`);
  }
});

t('NF2 无锁：file 模式经软链别名路径写新文件（含多级不存在子目录）应拦截', async () => {
  const guardAt = path.join(fakePlugin, 'scripts', 'state-guard.mjs');
  const targets = [
    path.join(aliasRoot, 'scripts', 'new-file.js'),
    path.join(aliasRoot, 'scripts', 'new-dir', 'deep', 'new.js'), // 父目录也不存在：逐级上溯
    path.join(aliasRoot, 'commands', 'new-cmd.md'),
  ];
  for (const file_path of targets) {
    assert.ok(!fs.existsSync(file_path), `用例目标应不存在（${file_path}）`);
    const r = await runGuardAt(guardAt, 'file', { file_path }, tmpNoLock);
    assert.equal(r.code, 2, `软链别名新建源码文件应拦截（${file_path}）：${r.err}`);
  }
});

t('NF3 误报回归：docs/ 豁免与插件外新文件放行', async () => {
  const guardAt = path.join(fakePlugin, 'scripts', 'state-guard.mjs');
  const realBoardNew = path.join(pluginRoot, 'docs', 'agent-team-board', 'bugs', 'B-new', 'README.md');
  const aliasBoardNew = path.join(aliasRoot, 'docs', 'agent-team-board', 'bugs', 'B-new', 'README.md');
  const outsideNew = path.join(sibling, 'src', 'brand-new.swift');
  const tmpNew = path.join(tmpNoLock, 'notes.md');
  for (const file_path of [realBoardNew, aliasBoardNew, outsideNew, tmpNew]) {
    assert.ok(!fs.existsSync(file_path), `用例目标应不存在（${file_path}）`);
    const guardPath = file_path.startsWith(aliasRoot) ? guardAt : guard;
    const r = await runGuardAt(guardPath, 'file', { file_path }, tmpNoLock);
    assert.equal(r.code, 0, `插件外/看板 docs 新建文件应放行（${file_path}）：${r.err}`);
  }
});

t('NF4 有效认领锁：file 模式新建插件源码文件放行', async () => {
  fs.writeFileSync(path.join(board, '.locks', 'REQ-TEST-002.lock'), JSON.stringify({ owner: 't', at: new Date().toISOString() }));
  const r = await run('file', { file_path: path.join(pluginRoot, 'scripts', 'locked-new.tmp') }, project);
  fs.rmSync(path.join(board, '.locks', 'REQ-TEST-002.lock'));
  assert.equal(r.code, 0, `有效锁应放行新建源码文件：${r.err}`);
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
try { fs.rmSync(tmp, { recursive: true, force: true }); fs.rmSync(tmpNoLock, { recursive: true, force: true }); fs.rmSync(fakeRoot, { recursive: true, force: true }); } catch {}
console.log(failed ? `\n${failed} 个用例未通过` : '\n全部通过');
process.exit(failed ? 1 : 0);
