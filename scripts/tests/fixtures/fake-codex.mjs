#!/usr/bin/env node
// 假 Codex CLI（REQ-20260906-003 测试夹具）：以 codex exec 的参数形态被拉起，
// 用 FAKE_MODE 控制行为矩阵（正常/故障/挂死/逃逸工具等），把收到的 argv/cwd/stdin
// 记录到 FAKE_RECORD，供测试断言参数数组与注入安全（不经过任何 shell）。
//
//   FAKE_MODE=ok               正常：thread.started + item.completed + turn.completed，写 -o 最终回复
//   ok-resume                  同 ok；thread.started 回显 argv 里的 resume 会话 ID
//   no-report                  一轮结束但未认领未上报（最终回复只有一句话）
//   no-thread                  不发 thread.started，正常退出
//   garbage                    非 JSON 行、跨 chunk 拆分的 JSON、未知事件、超长行、无换行尾行
//   hang-ignore-term           发 thread.started 后挂死，忽略 SIGINT/SIGTERM（验证强杀）
//   late-child-same-group      正常结束后同进程组孙子进程继续写 marker（应被组回收）
//   late-child-escaped         正常结束后 detached 孙子进程（逃逸进程组）继续写 marker（cleanup_pending 探针）
//   auth-error / quota-error / net-error   对应 stderr 故障后非零退出
//   model-missing / model-denied / effort-unsupported  模型配置类失败（REQ-20260906-024 M09）
//   timeout-sleep              长时间静默（验证超时）
//   exit-127                   立即 127 退出（启动失败形态）
// `codex debug models`：返回只读模型目录 JSON（REQ-20260906-024；两个模型、不同档位集）
// FAKE_RUNTIME_MODEL：thread.started 事件附带 model 字段（M17 运行时确认值/不一致探针）

import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';

const argv = process.argv.slice(2);

// 版本探测（预检用）
if (argv[0] === '--version' || argv[0] === '-V') {
  process.stdout.write('fake-codex 1.0.0\n');
  process.exit(0);
}

// 只读模型目录（REQ-20260906-024）：codex debug models，不发模型请求
if (argv[0] === 'debug' && argv[1] === 'models') {
  if (process.env.FAKE_CATALOG_ERROR) {
    process.stderr.write(`fake-codex: ${process.env.FAKE_CATALOG_ERROR}\n`);
    process.exit(3);
  }
  process.stdout.write(JSON.stringify({
    models: [
      { slug: 'fake-astra', display_name: 'Fake Astra', default_reasoning_level: 'low',
        supported_reasoning_levels: [{ effort: 'low' }, { effort: 'medium' }, { effort: 'high' }] },
      { slug: 'fake-mini', display_name: 'Fake Mini', default_reasoning_level: 'medium',
        supported_reasoning_levels: [{ effort: 'medium' }] },
    ],
  }) + '\n');
  process.exit(0);
}

// 预检只读帮助；模拟真实 resume 不接受 -C，避免宽松夹具掩盖参数错误。
if (argv.includes('--help')) {
  if (argv.includes('resume') && argv.includes('-C')) {
    process.stderr.write("error: unexpected argument '-C' found\n");
    process.exit(2);
  }
  process.stdout.write('Usage: codex exec [OPTIONS]\n--json --output-last-message --skip-git-repo-check\n');
  process.exit(0);
}

// 模式来源：FAKE_MODE 环境变量 > 同目录 fake-mode.txt（供无状态包装器形态使用）
function resolveMode() {
  if (process.env.FAKE_MODE) return process.env.FAKE_MODE;
  try {
    return fs.readFileSync(path.join(path.dirname(process.argv[1]), 'fake-mode.txt'), 'utf8').trim() || 'ok';
  } catch {
    return 'ok';
  }
}
const mode = resolveMode();
const recordPath = process.env.FAKE_RECORD || null;
const markerDir = process.env.FAKE_MARKER_DIR || null;

const writeOut = (s) => new Promise((res) => process.stdout.write(s, () => res()));
const writeErr = (s) => new Promise((res) => process.stderr.write(s, () => res()));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 恢复形态：exec resume <THREAD_ID> …；新会话随机
function threadIdFor() {
  if (mode === 'ok-resume') {
    const i = argv.indexOf('resume');
    return argv[i + 1] || 'fake-resumed';
  }
  return `fake-thread-${process.pid}`;
}

function readStdin() {
  return new Promise((resolve) => {
    if (!argv.includes('-')) return resolve('');
    let s = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (c) => { s += c; });
    process.stdin.on('end', () => resolve(s));
    process.stdin.on('error', () => resolve(s));
  });
}

function record(stdin) {
  if (!recordPath) return;
  fs.mkdirSync(path.dirname(recordPath), { recursive: true });
  fs.writeFileSync(recordPath, JSON.stringify({
    mode, argv, cwd: process.cwd(), stdin, envKeys: Object.keys(process.env).sort(),
  }, null, 2));
}

function finalMessageFile() {
  const i = argv.indexOf('--output-last-message') !== -1 ? argv.indexOf('--output-last-message') : argv.indexOf('-o');
  return i !== -1 ? argv[i + 1] : null;
}

// ---- 模拟守规 worker：真实调用受控 atb CLI 完成 claim/report（调度器端到端测试用） ----
const isResume = argv.includes('resume');

// 从提示词解析 atb CLI 路径与条目单号（buildWorkerPrompt/buildResumePrompt 的稳定形态）；
// 环境变量优先（进程内测试），缺省走提示词（无状态包装器形态）
function parsePromptCmds(stdin) {
  const claim = stdin.match(/node "([^"]+)" claim ((?:REQ|BUG)-\d{8}-\d{3}) --by/);
  const report = stdin.match(/node "([^"]+)" report ((?:REQ|BUG)-\d{8}-\d{3}) --coverage/);
  return { atb: (claim || report || [])[1], itemId: (claim || report || [])[2] };
}

function atb(args) {
  const cli = process.env.FAKE_ATB_CLI || parsePromptCmds(lastStdin).atb;
  const item = process.env.FAKE_ITEM_ID || parsePromptCmds(lastStdin).itemId;
  if (!cli || !item) return { status: -1 };
  return spawnSync(process.execPath, [cli, ...args], { stdio: 'ignore', timeout: 20_000 });
}

let lastStdin = '';

function workerClaim(by) {
  const item = process.env.FAKE_ITEM_ID || parsePromptCmds(lastStdin).itemId;
  return atb(['claim', item, '--by', by || item]).status;
}

function workerReport() {
  const item = process.env.FAKE_ITEM_ID || parsePromptCmds(lastStdin).itemId;
  const runId = (lastStdin.match(/--run (run-[0-9A-Za-z-]+)/) || [])[1];
  const args = ['report', item, '--coverage', '88', '--framework', 'node:test',
    '--summary', '假 worker：按提示词完成 TDD 并上报'];
  if (runId) args.push('--run', runId);
  return atb(args).status;
}

const marker = (name) => (markerDir ? path.join(markerDir, name) : null);

async function main() {
  const stdin = await readStdin();
  lastStdin = stdin;
  record(stdin);
  const tid = threadIdFor();

  switch (mode) {
    case 'ok':
    case 'ok-resume': {
      const started = { type: 'thread.started', thread_id: tid };
      if (process.env.FAKE_RUNTIME_MODEL) started.model = process.env.FAKE_RUNTIME_MODEL; // M17 运行时确认值
      await writeOut(JSON.stringify(started) + '\n');
      await writeOut(JSON.stringify({ type: 'turn.started' }) + '\n');
      await sleep(40);
      await writeOut(JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: '已按 TDD 完成' } }) + '\n');
      await writeOut(JSON.stringify({ type: 'turn.completed' }) + '\n');
      const f = finalMessageFile();
      if (f) fs.writeFileSync(f, '执行完毕：已写测试报告');
      process.exit(0);
    }
    case 'no-report': {
      await writeOut(JSON.stringify({ type: 'thread.started', thread_id: tid }) + '\n');
      await writeOut(JSON.stringify({ type: 'turn.completed' }) + '\n');
      const f = finalMessageFile();
      if (f) fs.writeFileSync(f, '我做完啦');
      process.exit(0);
    }
    case 'worker-ok': {
      // 守规 worker：认领（会话名=单号）→ 上报 → 结束
      await writeOut(JSON.stringify({ type: 'thread.started', thread_id: tid }) + '\n');
      workerClaim(process.env.FAKE_ITEM_ID);
      await writeOut(JSON.stringify({ type: 'item.completed', item: { text: '已 claim，实施中' } }) + '\n');
      workerReport();
      await writeOut(JSON.stringify({ type: 'turn.completed' }) + '\n');
      const f = finalMessageFile();
      if (f) fs.writeFileSync(f, '已认领并上报');
      process.exit(0);
    }
    case 'worker-ok-slow': {
      await writeOut(JSON.stringify({ type: 'thread.started', thread_id: tid }) + '\n');
      workerClaim(process.env.FAKE_ITEM_ID);
      await sleep(900); // 留窗口给 disable/stop 观察中途状态
      workerReport();
      await writeOut(JSON.stringify({ type: 'turn.completed' }) + '\n');
      process.exit(0);
    }
    case 'worker-late-report': {
      // 首轮只认领不上报（触发调度器按确切 threadId 续跑）；续跑轮完成上报
      await writeOut(JSON.stringify({ type: 'thread.started', thread_id: tid }) + '\n');
      workerClaim(process.env.FAKE_ITEM_ID);
      if (isResume) workerReport();
      await writeOut(JSON.stringify({ type: 'turn.completed' }) + '\n');
      process.exit(0);
    }
    case 'worker-stuck': {
      // 认领后每轮都正常结束但永远不上报（验证续跑轮数上限后转 blocked）
      await writeOut(JSON.stringify({ type: 'thread.started', thread_id: tid }) + '\n');
      if (!isResume) workerClaim(process.env.FAKE_ITEM_ID);
      await writeOut(JSON.stringify({ type: 'turn.completed' }) + '\n');
      process.exit(0);
    }
    case 'worker-hang': {
      // 认领后挂死且忽略中断信号（验证停止当前 → 停止中 → 已中断链路）
      await writeOut(JSON.stringify({ type: 'thread.started', thread_id: tid }) + '\n');
      workerClaim(process.env.FAKE_ITEM_ID);
      process.on('SIGINT', () => {});
      process.on('SIGTERM', () => {});
      const m = marker('hang');
      setInterval(() => { if (m) fs.appendFileSync(m, 'x'); }, 100);
      break; // 不退出
    }
    case 'worker-claim-wrong-owner': {
      await writeOut(JSON.stringify({ type: 'thread.started', thread_id: tid }) + '\n');
      workerClaim('someone-else-session');
      await writeOut(JSON.stringify({ type: 'turn.completed' }) + '\n');
      process.exit(0);
    }
    case 'worker-net-fail-once': {
      // 首轮网络错误退出（可重试）；续跑轮守规完成
      await writeOut(JSON.stringify({ type: 'thread.started', thread_id: tid }) + '\n');
      if (!isResume) {
        await writeErr('ERROR: network error: connection reset by peer\n');
        process.exit(1);
      }
      workerClaim(process.env.FAKE_ITEM_ID);
      workerReport();
      await writeOut(JSON.stringify({ type: 'turn.completed' }) + '\n');
      process.exit(0);
    }
    case 'worker-dirty-fail': {
      // 认领 → 弄脏 git 工作区 → 非零退出（验证失败后暂停项目、不清理用户改动）
      await writeOut(JSON.stringify({ type: 'thread.started', thread_id: tid }) + '\n');
      workerClaim(process.env.FAKE_ITEM_ID);
      const dirty = path.join(process.cwd(), 'src.txt');
      fs.appendFileSync(dirty, 'worker 改动\n');
      process.exit(1);
    }
    case 'no-thread': {
      await writeOut(JSON.stringify({ type: 'turn.started' }) + '\n');
      await writeOut(JSON.stringify({ type: 'turn.completed' }) + '\n');
      process.exit(0);
    }
    case 'garbage': {
      await writeErr('some plain diagnostic line\n');
      await writeOut('this is not json\n');
      await writeOut('{"type":"thre');
      await sleep(50);
      await writeOut(`ad.started","thread_id":"g-1"}\n`);
      await writeOut(JSON.stringify({ type: 'weird.unknown.event', payload: 1 }) + '\n');
      await writeOut(JSON.stringify({ type: 'item.completed', item: { text: 'x'.repeat(200 * 1024) } }) + '\n');
      await sleep(30);
      await writeOut('trailing partial without newline');
      const f = finalMessageFile();
      if (f) fs.writeFileSync(f, '垃圾流下的最终回复');
      process.exit(0);
    }
    case 'hang-ignore-term': {
      await writeOut(JSON.stringify({ type: 'thread.started', thread_id: tid }) + '\n');
      process.on('SIGINT', () => {});
      process.on('SIGTERM', () => {});
      const m = marker('hang');
      setInterval(() => { if (m) fs.appendFileSync(m, 'x'); }, 100);
      break; // 不退出
    }
    case 'late-child-same-group':
    case 'late-child-escaped': {
      await writeOut(JSON.stringify({ type: 'thread.started', thread_id: tid }) + '\n');
      const m = marker('late');
      if (m) {
        // 孙子进程持续写文件：same-group 留在组内（可被组强杀）；escaped 用 detached 自立进程组
        const child = spawn(process.execPath, ['-e', `const fs=require('fs');setInterval(()=>fs.appendFileSync(${JSON.stringify(m)},'x'),100);`], {
          stdio: 'ignore',
          detached: mode === 'late-child-escaped',
        });
        const pidFile = process.env.FAKE_ESCAPED_PID_FILE;
        if (pidFile && mode === 'late-child-escaped') {
          fs.mkdirSync(path.dirname(pidFile), { recursive: true });
          fs.writeFileSync(pidFile, String(child.pid));
        }
      }
      await sleep(60);
      const f = finalMessageFile();
      if (f) fs.writeFileSync(f, 'CLI 已退出，工具还在跑');
      process.exit(0);
    }
    case 'refine-ok':
    case 'refine-noop': {
      // REQ-20260907-003 需求完善 worker：refine-ok 按提示词中的「条目目录」补全条目 README
      // （只改条目 markdown，模拟守规 refine worker）；refine-noop 不改文档（验证 no-doc-change 失败）
      await writeOut(JSON.stringify({ type: 'thread.started', thread_id: tid }) + '\n');
      await writeOut(JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: '已按约束补全文档' } }) + '\n');
      if (mode === 'refine-ok') {
        const m = stdin.match(/条目目录：(\S+)/);
        if (m) {
          try {
            fs.appendFileSync(path.join(m[1], 'README.md'), '\n\n## 补全（refine worker）\n按缺失原因补全的说明内容，长度超过判定阈值三十个字符。\n');
          } catch { /* 目录异常：交由服务端核验路径记失败 */ }
        }
      }
      await writeOut(JSON.stringify({ type: 'turn.completed' }) + '\n');
      const f = finalMessageFile();
      if (f) fs.writeFileSync(f, '已补全说明文档：按缺失原因补全 README（涉及 UI 需界面展示——ui-demo.html 可交互演示）');
      process.exit(0);
    }
    case 'project-error':
      await writeErr('Not inside a trusted directory and --skip-git-repo-check was not specified.\n');
      process.exit(1);
    case 'args-error':
      await writeErr("error: unexpected argument '-C' found\n");
      process.exit(2);
    case 'auth-error':
      await writeErr('ERROR: stream error: HTTP 401 Unauthorized\n');
      process.exit(1);
    case 'quota-error':
      await writeErr('ERROR: usage limit reached for plan (429)\n');
      process.exit(1);
    case 'net-error':
      await writeErr('ERROR: network error: connection reset by peer\n');
      process.exit(1);
    case 'model-missing': // REQ-20260906-024 M09：模型不存在（先按提示词认领，模拟运行中受阻）
      await writeOut(JSON.stringify({ type: 'thread.started', thread_id: tid }) + '\n');
      workerClaim(process.env.FAKE_ITEM_ID);
      await writeErr('ERROR: model "no-such-model" not found\n');
      process.exit(1);
    case 'model-denied': // 账户无权使用该模型
      await writeOut(JSON.stringify({ type: 'thread.started', thread_id: tid }) + '\n');
      workerClaim(process.env.FAKE_ITEM_ID);
      await writeErr('ERROR: you do not have access to model fake-astra (403)\n');
      process.exit(1);
    case 'effort-unsupported': // 推理强度不支持
      await writeOut(JSON.stringify({ type: 'thread.started', thread_id: tid }) + '\n');
      workerClaim(process.env.FAKE_ITEM_ID);
      await writeErr('ERROR: invalid reasoning effort "ultra" for model fake-mini\n');
      process.exit(1);
    case 'timeout-sleep':
      await writeOut(JSON.stringify({ type: 'thread.started', thread_id: tid }) + '\n');
      await sleep(60_000);
      process.exit(0);
    case 'exit-127':
    default:
      process.exit(mode === 'exit-127' ? 127 : 0);
  }
}

main().catch((e) => {
  process.stderr.write(`fake-codex error: ${e.stack}\n`);
  process.exit(70);
});
