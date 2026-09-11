// REQ-20260910-030 桌面应用（Electron）发布流水线（五阶段）—— server.mjs / 测试使用。
// 阶段：freeze 配置冻结 → local-precheck 本地预检（只读）→ deps-install 依赖安装（隔离 worktree）→
//       build 桌面构建（electron-builder 逐平台，macOS dmg / Windows nsis）→ verify 产物核验。
// 语义边界：
//   - 发布是实际执行流程：预检（freeze + local-precheck）只读，不 npm、不构建；
//   - 未提交修改只引导回现有提交功能，绝不自动 add/commit/stash；
//   - 构建（依赖安装与 electron-builder）一律在冻结提交的隔离 worktree 内执行；
//     产物输出到项目根下输出目录（默认 dist/，.gitignore 已忽略），仅存本地不上传分发；
//   - 逐平台构建与核验：任一平台失败即阶段失败（不以部分产物冒充全部成功），平台结果分别记录；
//   - 计划确认后源提交变化使计划失效阻塞（build 阶段复核冻结 OID）；
//   - 重试只重跑未完成阶段：依赖安装已完成则不重装（隔离 worktree 保留复用，成功核验后清理）；
//   - 产物核验记录 路径 / 大小 / SHA-256 / 源提交 OID / electron 与 electron-builder 实际版本，
//     signed 恒为 false（首期不做签名 / 公证，不伪造签名状态）；
//   - 日志一律脱敏落盘（appendStageLog）。

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {
  AtbError,
} from './core.mjs';
import {
  readRun, mutateRun, appendStageLog, scrubSecrets, pushEvidence, ELECTRON_STAGES,
} from './release-store.mjs';
import { realExec } from './release-git.mjs';

export class ElectronStageError extends Error {
  constructor(message, kind = 'error', result = null) {
    super(message);
    this.kind = kind;
    this.stageResult = result;
  }
}

const head = (s, n = 8) => String(s || '').trim().split('\n').filter(Boolean).slice(0, n).join('\n');

/* ---------- 项目工程事实读取（只读） ---------- */

const BUILDER_CONFIG_FILES = ['electron-builder.yml', 'electron-builder.yaml', 'electron-builder.json', 'electron-builder.json5', 'electron-builder.toml'];

export function readElectronProject(root) {
  const file = path.join(root, 'package.json');
  let pkg = null;
  try {
    pkg = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch { /* 无 package.json 或损坏 */ }
  if (!pkg || typeof pkg !== 'object') {
    return { packageJson: false, appName: null, version: null, main: null, mainOk: false, depsOk: false, buildConfigOk: false };
  }
  const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
  const depsOk = !!(deps.electron && deps['electron-builder']);
  const main = typeof pkg.main === 'string' ? pkg.main : null;
  const mainOk = !!main && fs.existsSync(path.join(root, main));
  const buildConfigOk = (!!pkg.build && typeof pkg.build === 'object')
    || BUILDER_CONFIG_FILES.some((f) => fs.existsSync(path.join(root, f)));
  return {
    packageJson: true,
    appName: pkg.productName || pkg.name || null,
    version: typeof pkg.version === 'string' ? pkg.version : null,
    main,
    mainOk,
    depsOk,
    buildConfigOk,
    declared: { electron: deps.electron || null, 'electron-builder': deps['electron-builder'] || null },
  };
}

/* ---------- 单阶段实现 ---------- */

async function tryGit(ctx, args) {
  try {
    const r = await ctx.exec('git', args, { cwd: ctx.projectRoot, timeoutMs: 15000 });
    return r.code === 0 ? r.stdout.trim() : null;
  } catch {
    return null;
  }
}

// 1. freeze：解析源提交 OID 与项目工程事实，冻结生效配置（version 覆盖 > 项目 version）
async function stageFreeze(ctx) {
  const { run, projectRoot } = ctx;
  const proj = readElectronProject(projectRoot);
  if (!proj.packageJson) {
    throw new ElectronStageError(`项目根未找到可解析的 package.json：桌面构建只面向 Node 工程（当前项目即看板项目本身）`, 'not-electron-project');
  }
  const sourceOid = await tryGit(ctx, ['rev-parse', 'HEAD']);
  if (!sourceOid) {
    throw new ElectronStageError('项目不是 Git 仓库：构建产物无法追溯到源提交（必须先纳入 Git）', 'no-git');
  }
  const version = String(run.config.version || '').trim() || proj.version;
  if (!version) {
    throw new ElectronStageError('未取得版本号：配置未填且项目 package.json 无 version 字段', 'no-version');
  }
  const frozen = {
    sourceOid,
    appName: proj.appName || '桌面应用',
    projectVersion: proj.version || null,
    version,
    platforms: [...run.config.platforms],
    macArch: String(run.config.macArch || '').trim() || (process.arch === 'x64' ? 'x64' : 'arm64'),
    outDir: run.config.outDir || 'dist',
    declared: proj.declared || {},
  };
  run.frozen = frozen;
  ctx.log(`冻结输入：源提交 ${sourceOid}；应用 ${frozen.appName}；版本 ${version}${run.config.version ? '（配置覆盖）' : `（项目 package.json）`}；平台 ${frozen.platforms.join(' + ')}；架构 mac ${frozen.macArch} / win x64；输出 ${frozen.outDir}`);
  return { ...frozen };
}

// 2. local-precheck：只读——Git 干净 / Electron 工程 / electron-builder 配置 / node 与 npm 可用
async function stageLocalPrecheck(ctx) {
  const { run, projectRoot } = ctx;
  const inside = await tryGit(ctx, ['rev-parse', '--is-inside-work-tree']);
  if (inside !== 'true') throw new ElectronStageError('当前目录不是 Git 仓库', 'not-repo');
  const sourceOid = run.frozen.sourceOid;
  const still = await tryGit(ctx, ['rev-parse', '--verify', `${sourceOid}^{commit}`]);
  if (!still) throw new ElectronStageError(`冻结的源提交 ${sourceOid.slice(0, 8)} 已不存在（历史被改写？）`, 'source-gone');
  const status = await tryGit(ctx, ['status', '--porcelain']);
  if (status == null) throw new ElectronStageError('无法读取 Git 工作区状态', 'git-error');
  // 看板数据目录豁免口径与 Git 流水线一致（看板自身写入，不属发布内容）
  const BOARD_DIR = 'docs/agent-team-board/';
  const dirty = status.split('\n').filter(Boolean).filter((line) => {
    let p = line.slice(3).trim();
    if (p.startsWith('"') && p.endsWith('"')) p = p.slice(1, -1);
    if (p.includes(' -> ')) p = p.split(' -> ').pop().trim();
    return !(p.startsWith(BOARD_DIR) || BOARD_DIR.startsWith(`${p}/`) || p === 'docs' || p === 'docs/');
  });
  if (dirty.length) {
    const files = dirty.slice(0, 5).map((l) => l.slice(3).trim()).join('、');
    throw new ElectronStageError(
      `工作区有未提交修改（${files}${dirty.length > 5 ? ' 等' : ''}）：请先在看板提交功能完成提交后再构建（系统不自动 add/commit/stash）`,
      'dirty',
      { files: dirty.slice(0, 20).map((l) => l.slice(3).trim()) },
    );
  }
  const proj = readElectronProject(projectRoot);
  if (!proj.mainOk) {
    throw new ElectronStageError(
      `项目不是 Electron 工程：package.json 缺少可用的 main 入口（当前 ${proj.main ? `main=${proj.main} 文件不存在` : '未配置 main'}）。请确认 main 指向 Electron 主进程入口（本项目为 electron/main.mjs）`,
      'not-electron-project',
    );
  }
  if (!proj.depsOk) {
    throw new ElectronStageError(
      '缺少构建依赖：package.json 需同时声明 electron 与 electron-builder（devDependencies）。本项目已有；其他项目请先安装（npm i -D electron electron-builder，MIT 许可）',
      'not-electron-project',
    );
  }
  if (!proj.buildConfigOk) {
    throw new ElectronStageError(
      '缺少 electron-builder 构建配置：请在 package.json 增加 build 字段（appId / files / mac / win 目标）或添加 electron-builder.yml。参考本项目 package.json 的 build 配置',
      'no-builder-config',
    );
  }
  const nodeV = await ctx.exec('node', ['-v'], { cwd: projectRoot, timeoutMs: 15000 });
  if (nodeV.code !== 0) {
    throw new ElectronStageError(`node 不可用：${head(scrubSecrets(nodeV.stderr || nodeV.stdout), 2) || '无法执行 node -v'}。构建需要 node / npm 环境`, 'node-unavailable');
  }
  const npmV = await ctx.exec('npm', ['-v'], { cwd: projectRoot, timeoutMs: 15000 });
  if (npmV.code !== 0) {
    throw new ElectronStageError(`npm 不可用：${head(scrubSecrets(npmV.stderr || npmV.stdout), 2) || '无法执行 npm -v'}。构建需要 node / npm 环境`, 'npm-unavailable');
  }
  ctx.log(`本地预检通过：工作区干净；Electron 工程（main=${proj.main}）；electron-builder 配置就绪；node ${String(nodeV.stdout).trim()} / npm ${String(npmV.stdout).trim()}`);
  return { nodeVersion: String(nodeV.stdout).trim(), npmVersion: String(npmV.stdout).trim() };
}

// 3. deps-install：冻结提交的隔离 worktree 内安装依赖（有 lock → npm ci，否则 npm install）
async function stageDepsInstall(ctx) {
  const { run, projectRoot } = ctx;
  const sourceOid = run.frozen.sourceOid;
  const prev = run.stages.find((s) => s.key === 'deps-install')?.result || {};
  // 重试 / 恢复语义：上轮已装好（electron-builder 可执行存在）→ 直接复用，不重装
  if (prev.workDir && fs.existsSync(path.join(prev.workDir, 'node_modules', '.bin', 'electron-builder'))) {
    ctx.log(`复用隔离工作目录：${prev.workDir}（依赖已安装，不重装）`);
    return { ...prev, reused: true };
  }
  // 失败残留的半成品 worktree：先移除再重建（git worktree add 不能复用已注册路径）
  if (prev.workDir && fs.existsSync(prev.workDir)) {
    const rm = await ctx.exec('git', ['worktree', 'remove', '--force', prev.workDir], { cwd: projectRoot, timeoutMs: 60000 });
    if (rm.code !== 0) ctx.log(`清理失败残留的隔离工作目录未成功（继续新建）：${head(rm.stderr, 2)}`);
  }
  const workDir = path.join(os.tmpdir(), `atb-release-el-${run.id}-${Date.now()}`);
  const addOut = await ctx.exec('git', ['worktree', 'add', '--detach', workDir, sourceOid], { cwd: projectRoot, timeoutMs: 60000 });
  if (addOut.code !== 0) {
    throw new ElectronStageError(`创建隔离工作目录失败：${head(scrubSecrets(addOut.stderr || addOut.stdout), 3)}`, 'worktree');
  }
  const installCommand = fs.existsSync(path.join(workDir, 'package-lock.json')) ? 'npm ci' : 'npm install';
  ctx.log(`隔离工作目录：${workDir}（冻结提交 ${sourceOid.slice(0, 8)}）；执行依赖安装：${installCommand}（耗时较长，需下载 Electron 平台二进制）`);
  const out = await ctx.exec('npm', [installCommand === 'npm ci' ? 'ci' : 'install'], {
    cwd: workDir,
    timeoutMs: ctx.cfg.depsTimeoutMs || 1800000,
    env: { ...process.env, npm_config_audit: 'false', npm_config_fund: 'false' },
  });
  const log = `${out.stdout || ''}${out.stderr ? `\n${out.stderr}` : ''}`.trim();
  if (log) ctx.log(`安装输出（摘要）：\n${head(log, 12)}`);
  if (out.code !== 0) {
    throw new ElectronStageError(
      `依赖安装失败（${installCommand}，exit ${out.code}）：常见为网络 / registry 错误。失败不可继续，可重试（只重跑本阶段）\n${head(scrubSecrets(log), 8)}`,
      'deps-failed',
      { installCommand, exitCode: out.code, workDir },
    );
  }
  return { workDir, installCommand, lockUsed: installCommand === 'npm ci' };
}

// 4. build：electron-builder 逐平台构建（计划复核 → mac dmg / win nsis）
async function stageBuild(ctx) {
  const { run, projectRoot } = ctx;
  const frozen = run.frozen;
  // 计划有效性：启动后源提交变化使计划失效（draft 才能改配置，配置变化已由状态机挡住）
  const headNow = await tryGit(ctx, ['rev-parse', 'HEAD']);
  if (headNow && headNow !== frozen.sourceOid) {
    throw new ElectronStageError(
      '构建计划已失效：源提交在计划确认后指向了新提交。请重新预检并启动新计划',
      'plan-stale',
    );
  }
  const deps = run.stages.find((s) => s.key === 'deps-install')?.result || {};
  const workDir = deps.workDir;
  if (!workDir || !fs.existsSync(workDir)) {
    throw new ElectronStageError('隔离工作目录不存在（依赖安装证据缺失）：请从依赖安装阶段重跑', 'worktree');
  }
  const builderBin = path.join(workDir, 'node_modules', '.bin', 'electron-builder');
  if (!fs.existsSync(builderBin)) {
    throw new ElectronStageError(`未找到 ${path.join('node_modules', '.bin', 'electron-builder')}：依赖安装不完整，请重试依赖安装阶段`, 'no-builder');
  }
  const outAbs = path.resolve(projectRoot, frozen.outDir);
  fs.mkdirSync(outAbs, { recursive: true });
  const platforms = [];
  for (const platform of frozen.platforms) {
    const args = platform === 'mac'
      ? ['--mac', 'dmg', `--${frozen.macArch}`]
      : ['--win', 'nsis', '--x64'];
    args.push(`-c.extraMetadata.version=${frozen.version}`, `-c.directories.output=${outAbs}`);
    ctx.log(`构建 ${platform === 'mac' ? 'macOS' : 'Windows'}：electron-builder ${args.join(' ')}`);
    let out;
    try {
      out = await ctx.exec(builderBin, args, { cwd: workDir, timeoutMs: ctx.cfg.buildTimeoutMs || 1800000 });
    } catch (e) {
      if (e && e.code === 'ETIMEDOUT') {
        throw new ElectronStageError(`构建 ${platform} 超时（${(ctx.cfg.buildTimeoutMs || 1800000) / 60000} 分钟上限）：可重试本阶段`, 'build-timeout', { platforms });
      }
      throw e;
    }
    const log = `${out.stdout || ''}${out.stderr ? `\n${out.stderr}` : ''}`.trim();
    if (log) ctx.log(`构建输出（${platform}，摘要）：\n${head(log, 20)}`);
    if (out.code !== 0) {
      platforms.push({ platform, ok: false, exitCode: out.code });
      throw new ElectronStageError(
        `桌面构建失败（${platform === 'mac' ? 'macOS' : 'Windows'}）：${head(scrubSecrets(log), 6) || `electron-builder exit ${out.code}`}。交叉构建等做不到的组合以真实报错为准，不以部分产物冒充成功`,
        'build-failed',
        { platforms },
      );
    }
    platforms.push({ platform, ok: true });
    ctx.log(`平台 ${platform} 构建完成（输出目录 ${outAbs}）`);
  }
  return { platforms, outDir: outAbs };
}

// 5. verify：逐平台核验产物存在并记录指纹与工具版本；全部通过才成功，成功后清理隔离 worktree
async function stageVerify(ctx) {
  const { run, projectRoot } = ctx;
  const frozen = run.frozen;
  const build = run.stages.find((s) => s.key === 'build')?.result || {};
  const outAbs = build.outDir || path.resolve(projectRoot, frozen.outDir);
  const deps = run.stages.find((s) => s.key === 'deps-install')?.result || {};
  // 工具实际版本：优先隔离 worktree 内安装的版本（可追溯），读不到回退 package.json 声明
  const versionOf = (pkgName) => {
    if (deps.workDir) {
      try {
        const p = JSON.parse(fs.readFileSync(path.join(deps.workDir, 'node_modules', pkgName, 'package.json'), 'utf8'));
        if (p && p.version) return p.version;
      } catch { /* 回退声明版本 */ }
    }
    return frozen.declared?.[pkgName] || null;
  };
  const electronVersion = versionOf('electron');
  const builderVersion = versionOf('electron-builder');

  let files = [];
  try {
    files = fs.readdirSync(outAbs);
  } catch { /* 目录不存在 → 全平台缺产物 */ }
  const artifacts = [];
  const missing = [];
  for (const platform of frozen.platforms) {
    const ext = platform === 'mac' ? '.dmg' : '.exe';
    const arch = platform === 'mac' ? frozen.macArch : 'x64';
    const hits = files.filter((f) => f.toLowerCase().endsWith(ext) && !f.endsWith('.blockmap'));
    if (!hits.length) {
      missing.push(`${platform === 'mac' ? 'macOS' : 'Windows'}（期望 ${ext} 产物）`);
      continue;
    }
    for (const fileName of hits) {
      const p = path.join(outAbs, fileName);
      const buf = fs.readFileSync(p);
      artifacts.push({
        fileName,
        path: p,
        platform,
        arch,
        sizeBytes: buf.length,
        sha256: crypto.createHash('sha256').update(buf).digest('hex'),
        sourceOid: frozen.sourceOid,
        electronVersion,
        builderVersion,
        signed: false, // 首期不做签名 / 公证：产物与界面明确标注，不伪造签名状态
      });
    }
  }
  if (missing.length) {
    throw new ElectronStageError(
      `产物核验失败：输出目录 ${outAbs} 缺少 ${missing.join('、')} 的产物。可重试本阶段（构建阶段重跑后会重新核验）`,
      'artifact-missing',
      { missing },
    );
  }
  for (const a of artifacts) {
    ctx.log(`产物：${a.fileName}（${a.platform} ${a.arch}，${a.sizeBytes}B，sha256 ${a.sha256.slice(0, 12)}…，未签名）`);
    pushEvidence(run, 'artifact', `${a.platform} ${a.arch} 产物 ${a.fileName}（${a.sizeBytes}B，sha256:${a.sha256.slice(0, 16)}，源提交 ${a.sourceOid.slice(0, 10)}，未签名）`, {
      platform: a.platform, fileName: a.fileName, sizeBytes: a.sizeBytes, sourceOid: a.sourceOid,
    });
  }
  pushEvidence(run, 'verify', `全部产物核验通过（electron ${electronVersion || '?'} / electron-builder ${builderVersion || '?'}）`, {
    electronVersion, builderVersion, sourceOid: frozen.sourceOid,
  });
  ctx.log(`核验通过：${artifacts.length} 个产物可追溯到源提交 ${frozen.sourceOid}（产物仅存本地，不上传分发）`);
  // 成功后清理隔离 worktree（best-effort；失败 / 取消运行保留供重试续跑，交由系统 tmp 清理）
  if (deps.workDir && fs.existsSync(deps.workDir)) {
    const rm = await ctx.exec('git', ['worktree', 'remove', '--force', deps.workDir], { cwd: projectRoot, timeoutMs: 60000 });
    if (rm.code !== 0) ctx.log(`清理隔离工作目录失败（不影响判定）：${head(rm.stderr, 2)}`);
    else ctx.log(`已清理隔离工作目录：${deps.workDir}`);
  }
  return { artifacts, outDir: outAbs, electronVersion, builderVersion, signed: false };
}

const STAGE_IMPLS = {
  freeze: stageFreeze,
  'local-precheck': stageLocalPrecheck,
  'deps-install': stageDepsInstall,
  build: stageBuild,
  verify: stageVerify,
};

/* ---------- 流水线驱动 ---------- */

const STAGE_KEYS = ELECTRON_STAGES.map((s) => s.key);

// 执行 Electron 流水线：默认 freeze→verify；through=local-precheck 为预检（只读，不安装不构建）；
// from 指定起点（重试场景配合 store.resetForRetry，由首个 pending 阶段自然接续）。
export async function runElectronPipeline({ dataDir, projectRoot, runId, exec, cfg = {}, through = 'verify', from = null }) {
  if (!exec) exec = realExec();
  const throughIdx = STAGE_KEYS.indexOf(through);
  if (throughIdx === -1) throw new AtbError(`未知 Electron 阶段：${through}`);
  const precheckOnly = through === 'local-precheck';

  let run = mutateRun(dataDir, runId, (r) => {
    r.status = precheckOnly ? 'prechecking' : 'running';
  }, { by: 'board', action: precheckOnly ? 'precheck' : 'start' });

  const startIdx = from ? STAGE_KEYS.indexOf(from) : run.stages.findIndex((s) => s.status !== 'done' && s.status !== 'skipped' && s.status !== 'canceled');
  if (from && startIdx !== -1) {
    run = mutateRun(dataDir, runId, (r) => {
      const s = r.stages.find((x) => x.key === from);
      if (s && s.status !== 'pending') {
        s.status = 'pending';
        s.error = null;
      }
    }, { by: 'board', action: `refresh:${from}` });
  }
  if (startIdx === -1 || startIdx > throughIdx) {
    return mutateRun(dataDir, runId, (r) => {
      if (precheckOnly) {
        if (r.status === 'prechecking') r.status = 'draft';
      } else if (r.stages.every((s) => s.status === 'done' || s.status === 'skipped')) {
        r.status = 'succeeded';
      }
    }, { by: 'board', action: 'noop' });
  }

  for (let i = Math.max(startIdx, 0); i <= throughIdx; i++) {
    const key = STAGE_KEYS[i];
    const stageDef = run.stages.find((s) => s.key === key);
    if (!stageDef || stageDef.status === 'done' || stageDef.status === 'skipped') continue;
    // 取消后续阶段：每阶段执行前核对最新状态（外部取消请求即时生效）
    const disk = readRun(dataDir, runId);
    if (disk.status === 'canceled') return disk;
    run = mutateRun(dataDir, runId, (r) => {
      const s = r.stages.find((x) => x.key === key);
      s.status = 'running';
      s.startedAt = new Date().toISOString();
    }, { by: 'board', action: `stage:${key}:start` });
    const ctx = {
      dataDir, projectRoot, run: readRun(dataDir, runId), exec, cfg,
      log: (line) => appendStageLog(dataDir, runId, key, line),
    };
    try {
      const ctxRun = ctx.run;
      const evidenceBefore = ctxRun.evidence.length;
      const result = await STAGE_IMPLS[key](ctx);
      const stageEvidence = ctxRun.evidence.slice(evidenceBefore);
      run = mutateRun(dataDir, runId, (r) => {
        const s = r.stages.find((x) => x.key === key);
        s.status = 'done';
        s.endedAt = new Date().toISOString();
        s.result = { ...(s.result || {}), ...result };
        if (key === 'freeze') r.frozen = ctxRun.frozen; // 冻结输入入主记录
        for (const ev of stageEvidence) r.evidence.push(ev);
        pushEvidence(r, key, `阶段完成：${key}`);
      }, { by: 'board', action: `stage:${key}:done` });
    } catch (e) {
      const result = e instanceof ElectronStageError ? e.stageResult : null;
      run = mutateRun(dataDir, runId, (r) => {
        const s = r.stages.find((x) => x.key === key);
        s.status = 'failed';
        s.endedAt = new Date().toISOString();
        s.error = { message: scrubSecrets(e.message || String(e)), kind: e instanceof ElectronStageError ? e.kind : 'error' };
        if (result) s.result = { ...(s.result || {}), ...result };
        r.status = 'failed';
      }, { by: 'board', action: `stage:${key}:failed` });
      appendStageLog(dataDir, runId, key, `阶段失败（${e instanceof ElectronStageError ? e.kind : 'error'}）：${e.message}`);
      return run;
    }
  }

  return mutateRun(dataDir, runId, (r) => {
    if (precheckOnly) {
      if (r.status === 'prechecking') r.status = 'draft';
    } else if (r.stages.every((s) => s.status === 'done' || s.status === 'skipped')) {
      r.status = 'succeeded';
    }
  }, { by: 'board', action: precheckOnly ? 'precheck-done' : 'pipeline-done' });
}
