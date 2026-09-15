// REQ-20260915-002 产品发布流水线（product-release-pipeline）—— server.mjs / 测试使用。
// 六阶段：sync-source（切 main + main/dev --atomic 推送 + 远端核验）→ webapp-build（冻结源码
// 隔离 worktree 构建）→ webapp-verify（本机部署 + 可用性/版本回验）→ site-materials（中英文
// 材料核验）→ site-deploy（官网本机部署）→ site-verify（中英文页面/链接/语言入口回验）。
// 语义边界：
//   - 预检全只读（dry-run 不推送、不上传、不部署、不构建）；
//   - 启动前预检必须新鲜（冻结输入变化 → 重新预检并展示新计划；main 前进可重新冻结）；
//   - 构建只使用冻结 main 源码（隔离 worktree），不从 dev 构建；执行后源码工作目录保持在 main；
//   - 部署为本机 127.0.0.1 静态服务（自动分配端口），部署命令成功不等于上线，以本机入口
//     与版本回验结果为准；缺少执行支持明确阻塞，不伪报成功；
//   - 部分成功保留各目标真实状态；重试只补未完成阶段（sync-source 重试先查询远端）；
//   - 取消只停后续阶段，已上线目标保留（不宣称撤回）。

import fs from 'node:fs';
import os from 'node:os';
import http from 'node:http';
import path from 'node:path';
import { AtbError } from './core.mjs';
import * as releaseStore from './release-store.mjs';
import * as store from './product-release-store.mjs';
import * as prelGit from './product-release-git.mjs';
import * as profileMod from './webapp-profile.mjs';
import * as materialsMod from './site-materials.mjs';

export class ProductStageError extends AtbError {
  constructor(message, kind = 'error', result = null) {
    super(message);
    this.kind = kind;
    this.stageResult = result;
  }
}

/* ---------- 本机部署注册表（服务进程内持有；重启后由 recoverInterrupted 标记可重试） ---------- */

const deployRegistry = new Map(); // runId → { webapp?: serve, site?: serve }

export function stopProductDeploy(runId) {
  const entry = deployRegistry.get(runId);
  if (!entry) return;
  deployRegistry.delete(runId);
  for (const serve of Object.values(entry)) {
    try { serve.close(); } catch { /* best-effort */ }
  }
}

function httpGet(url, timeoutMs = 10000) {
  return new Promise((resolve) => {
    const req = http.get(url, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', (e) => resolve({ status: 0, body: '', error: e.message }));
    req.on('timeout', () => { req.destroy(); resolve({ status: 0, body: '', error: 'timeout' }); });
    req.setTimeout(timeoutMs);
  });
}

/* ---------- 冻结输入收集（预检 / 启动新鲜度共用） ---------- */

export async function collectCurrentInputs({ dataDir, projectRoot, run, exec }) {
  const mainSha = await prelGit.branchHead(projectRoot, exec, 'main');
  const devSha = await prelGit.branchHead(projectRoot, exec, 'dev');
  let remote = null;
  try {
    remote = (await prelGit.resolveSourceRemote(projectRoot, exec)).remote;
  } catch { remote = null; }
  const cfg = releaseStore.readModuleConfig(dataDir);
  const repoRoot = cfg.homepageRepoRoot || '';
  let homepage = { repoRoot, branch: 'main', contentDir: null };
  if (repoRoot) {
    try {
      homepage = { repoRoot, branch: 'main', contentDir: materialsMod.safeContentDir(repoRoot, run.productId) };
    } catch { /* 项目名不安全：保持 contentDir null，预检给诊断 */ }
  }
  const materialsFingerprint = homepage.contentDir ? materialsMod.materialsFingerprint(homepage.contentDir) : null;
  return { version: run.frozen.version, mainSha, devSha, remote, homepage, materialsFingerprint };
}

/* ---------- 预检（全只读） ---------- */

// 从冻结源码识别 Web App 构建方式（git show 读文件，不建工作树）
async function detectFrozenWebApp(projectRoot, exec, mainSha) {
  const pkgText = await prelGit.readFrozenFile(projectRoot, exec, mainSha, 'package.json');
  let packageJson = null;
  if (pkgText != null) {
    try { packageJson = JSON.parse(pkgText); } catch { /* 损坏的 package.json → 按缺诊断 */ }
  }
  const indexHtml = await prelGit.readFrozenFile(projectRoot, exec, mainSha, 'index.html');
  return profileMod.detectWebAppProfileFrom({ packageJson, hasIndexHtml: indexHtml != null });
}

function homepageRepoValid(repoRoot) {
  if (!repoRoot) return { ok: false, detail: '官网仓库根目录未设置（首次使用请先在设置中配置，保存后返回继续）' };
  if (!fs.existsSync(repoRoot)) return { ok: false, detail: `官网仓库目录不存在：${repoRoot}` };
  const gitDir = path.join(repoRoot, '.git');
  if (!fs.existsSync(gitDir)) return { ok: false, detail: `配置的目录不是 git 仓库：${repoRoot}` };
  return { ok: true, detail: repoRoot };
}

export async function runProductPrecheck({ dataDir, projectRoot, runId, exec }) {
  const run = store.readProductRun(dataDir, runId);
  const checks = [];
  const push = (key, label, ok, detail) => checks.push({ key, label, ok: !!ok, detail: String(detail) });
  store.mutateProductRun(dataDir, runId, (r) => { r.status = 'prechecking'; }, { action: 'precheck:start' });
  try {
    // 产品映射与安全子目录
    try {
      const dir = materialsMod.safeContentDir(releaseStore.readModuleConfig(dataDir).homepageRepoRoot || '/', run.productId);
      push('product-mapping', '产品映射与子目录', true, `产品内容子目录 ${dir}`);
    } catch (e) {
      push('product-mapping', '产品映射与子目录', false, e.message);
    }
    // 源码远端解析
    let remoteInfo = null;
    try {
      remoteInfo = await prelGit.resolveSourceRemote(projectRoot, exec);
      push('source-remote', '源码远端解析', true, `${remoteInfo.remote} → ${remoteInfo.sanitizedUrl}`);
    } catch (e) {
      push('source-remote', '源码远端解析', false, e.message);
    }
    // 本地双分支
    let mainSha = null;
    let devSha = null;
    try {
      mainSha = await prelGit.branchHead(projectRoot, exec, 'main');
      devSha = await prelGit.branchHead(projectRoot, exec, 'dev');
      const missing = [mainSha ? null : 'main', devSha ? null : 'dev'].filter(Boolean);
      if (missing.length) throw new AtbError(`本地分支缺失：${missing.join('、')}（main/dev 双分支推送前置，缺一不可）`);
      push('branches', '本地双分支', true, `main ${mainSha.slice(0, 8)} · dev ${devSha.slice(0, 8)}`);
    } catch (e) {
      push('branches', '本地双分支', false, e.message);
    }
    // 工作区干净
    try {
      const dirty = await prelGit.worktreeDirtyFiles(projectRoot, exec);
      if (dirty.length) throw new AtbError(`工作区有未提交修改（${dirty.slice(0, 5).join('、')}${dirty.length > 5 ? ' 等' : ''}）：不自动提交/暂存，请先完成提交`);
      push('worktree-clean', '工作区干净', true, '无未提交修改（看板数据目录除外）');
    } catch (e) {
      push('worktree-clean', '工作区干净', false, e.message);
    }
    // 远端可达 + 原子推送预演（dry-run 不推送）+ 冻结一致
    if (remoteInfo) {
      try {
        if (mainSha !== run.frozen.mainSha || devSha !== run.frozen.devSha) {
          throw new AtbError(`分支头与冻结不一致：main ${mainSha ? mainSha.slice(0, 8) : '—'}/${run.frozen.mainSha.slice(0, 8)} · dev ${devSha ? devSha.slice(0, 8) : '—'}/${run.frozen.devSha.slice(0, 8)}（main 前进可重新冻结）`);
        }
        await prelGit.precheckAtomicPushDryRun(projectRoot, exec, { remote: remoteInfo.remote });
        push('remote-push', '远端可达与原子推送预演', true, `${remoteInfo.remote} main+dev dry-run 通过（不推送）`);
      } catch (e) {
        push('remote-push', '远端可达与原子推送预演', false, e.message);
      }
    }
    // 条目包含性（发布范围确实包含计划条目）
    try {
      const v = await prelGit.verifyItemsOnMain(projectRoot, exec, run.frozen.items, run.frozen.mainSha);
      if (!v.ok) throw new AtbError(`计划条目不在 main 历史内：${v.missing.join('、')}`);
      push('items-contained', '计划条目包含性', true, `${run.frozen.items.length} 个条目均在冻结 main 历史内`);
    } catch (e) {
      push('items-contained', '计划条目包含性', false, e.message);
    }
    // 官网配置与双语材料
    const cfg = releaseStore.readModuleConfig(dataDir);
    const hp = homepageRepoValid(cfg.homepageRepoRoot || '');
    push('homepage-config', '官网仓库配置', hp.ok, hp.detail);
    if (hp.ok) {
      let contentDir = null;
      try {
        contentDir = materialsMod.safeContentDir(cfg.homepageRepoRoot, run.productId);
      } catch (e) {
        push('site-materials', '官网双语材料', false, e.message);
      }
      if (contentDir) {
        const m = materialsMod.checkSiteMaterials(contentDir);
        push('site-materials', '官网双语材料', m.ok, m.ok
          ? `中英文 ${m.files.length} 页齐备（指纹 ${String(m.fingerprint).slice(0, 8)}…）`
          : `缺少必备页面：${m.missing.map((x) => `${x.lang}/${x.page}.html（${x.label}）`).join('、')}`);
      }
    }
    // Web App 自动识别（冻结源码）
    try {
      const p = await detectFrozenWebApp(projectRoot, exec, run.frozen.mainSha);
      if (!p.detected) throw new AtbError(`${p.reason}；诊断：${p.diagnostics.join('；')}`);
      push('webapp-profile', 'Web App 自动识别', true, p.kind === 'static' ? '静态站点：无构建步骤，直接本机服务' : `${p.framework}：${p.buildCommand} → ${p.outputDir}`);
    } catch (e) {
      push('webapp-profile', 'Web App 自动识别', false, e.message);
    }
    // 版本冲突（同产品同版本不得重复发版；创建时已挡，这里兜底）
    const dup = store.listProductRuns(dataDir).find((r) => r.id !== runId && r.productId === run.productId && r.version === run.frozen.version && r.status === 'succeeded');
    push('version-conflict', '版本冲突', !dup, dup ? `已存在成功发布 ${dup.id}` : `版本 ${run.frozen.version} 无冲突`);

    const ok = checks.every((c) => c.ok);
    const inputs = await collectCurrentInputs({ dataDir, projectRoot, run, exec });
    return store.savePrecheck(dataDir, runId, { ok, checks, inputs });
  } finally {
    store.mutateProductRun(dataDir, runId, (r) => {
      if (r.status === 'prechecking') r.status = 'draft';
    }, { action: 'precheck:done' });
  }
}

/* ---------- 重新冻结（main 前进后：用当前 main 重新走冻结，不冒充旧 SHA） ---------- */

export async function refreezeProductRun({ dataDir, projectRoot, runId, exec }) {
  const run = store.readProductRun(dataDir, runId);
  if (!['draft', 'failed'].includes(run.status)) {
    throw new AtbError(`当前状态（${store.PREL_STATUS_LABEL[run.status] || run.status}）不可重新冻结`);
  }
  const remoteInfo = await prelGit.resolveSourceRemote(projectRoot, exec);
  const mainSha = await prelGit.branchHead(projectRoot, exec, 'main');
  const devSha = await prelGit.branchHead(projectRoot, exec, 'dev');
  if (!mainSha || !devSha) throw new AtbError('main/dev 分支缺失，无法重新冻结');
  const v = await prelGit.verifyItemsOnMain(projectRoot, exec, run.frozen.items, mainSha);
  if (!v.ok) throw new AtbError(`重新冻结失败：计划条目 ${v.missing.join('、')} 不在当前 main 历史内`);
  const extras = await prelGit.collectExtraCommits(projectRoot, exec, {
    mainSha, itemCommits: run.frozen.items.map((x) => x.commit), bldId: run.bldId,
  });
  return store.mutateProductRun(dataDir, runId, (r) => {
    r.frozen.mainSha = mainSha;
    r.frozen.devSha = devSha;
    r.frozen.remote = remoteInfo.remote;
    r.frozen.remoteUrl = remoteInfo.sanitizedUrl;
    r.frozen.extraCommits = extras;
    r.precheck = null; // 旧预检失效：重新冻结后必须重新预检
  }, { action: 'refreeze', note: `重新冻结为当前 main ${mainSha.slice(0, 8)} / dev ${devSha.slice(0, 8)}（额外提交 ${extras.length}）` });
}

/* ---------- Web App 构建（冻结源码隔离 worktree） ---------- */

const copyTree = (from, to) => fs.cpSync(from, to, { recursive: true, filter: (src) => !src.includes(`${path.sep}.git`) });

function dirDigest(dir) {
  let files = 0;
  let bytes = 0;
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.name === '.git') continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else { files++; bytes += fs.statSync(p).size; }
    }
  };
  try { walk(dir); } catch { /* 目录缺失 → 0 */ }
  return { files, bytes };
}

// 冻结 main 源码构建 / 静态复制到本机部署目录（产物与冻结 SHA 一致；不从 dev 构建）
export async function buildWebAppFromFrozen({ projectRoot, runId, mainSha, exec }) {
  const workDir = path.join(os.tmpdir(), `atb-prel-wt-${runId}-${Date.now()}`);
  const addOut = await exec('git', ['worktree', 'add', '--detach', workDir, String(mainSha)], { cwd: projectRoot, timeoutMs: 60000 });
  if (addOut.code !== 0) {
    throw new ProductStageError(`创建冻结源码工作树失败：${String(addOut.stderr || addOut.stdout).split('\n').filter(Boolean).slice(0, 3).join('；')}`, 'worktree');
  }
  const deployDir = path.join(os.tmpdir(), `atb-prel-${runId}-webapp`);
  try {
    const p = profileMod.detectWebAppProfile(workDir);
    if (!p.detected) {
      throw new ProductStageError(`Web App 自动识别失败：${p.reason}；诊断：${p.diagnostics.join('；')}（不猜执行，请修正冻结源码后重试）`, 'webapp-undetected', { profile: p });
    }
    if (p.kind === 'package') {
      const hasLock = fs.existsSync(path.join(workDir, 'package-lock.json'));
      const install = await exec(hasLock ? 'npm' : 'npm', hasLock ? ['ci'] : ['install'], { cwd: workDir, timeoutMs: 600000 });
      if (install.code !== 0) {
        throw new ProductStageError(`依赖安装失败（exit ${install.code}）：${String(install.stderr || install.stdout).split('\n').filter(Boolean).slice(0, 4).join('；')}`, 'install-failed');
      }
      const build = await exec('npm', ['run', 'build'], { cwd: workDir, timeoutMs: 900000 });
      if (build.code !== 0) {
        throw new ProductStageError(`构建失败（exit ${build.code}）：${String(build.stderr || build.stdout).split('\n').filter(Boolean).slice(0, 5).join('；')}`, 'build-failed', { log: String(build.stdout + build.stderr).slice(0, 4000) });
      }
      const outDir = path.join(workDir, p.outputDir);
      if (!fs.existsSync(outDir)) {
        throw new ProductStageError(`构建完成但产物目录缺失：${p.outputDir}（框架产物目录与识别不符，阻塞不伪报）`, 'output-missing');
      }
      fs.rmSync(deployDir, { recursive: true, force: true });
      fs.cpSync(outDir, deployDir, { recursive: true });
    } else {
      // 静态项目：无构建步骤，整目录（除 .git）直接作为部署产物
      fs.rmSync(deployDir, { recursive: true, force: true });
      copyTree(workDir, deployDir);
    }
    return { sourceSha: String(mainSha).toLowerCase(), deployDir, profile: p, artifact: dirDigest(deployDir) };
  } finally {
    const rm = await exec('git', ['worktree', 'remove', '--force', workDir], { cwd: projectRoot, timeoutMs: 60000 });
    if (rm.code !== 0) await exec('git', ['worktree', 'prune'], { cwd: projectRoot });
  }
}

/* ---------- 阶段实现 ---------- */

async function stageSyncSource(ctx) {
  const { dataDir, projectRoot, run, exec, log } = ctx;
  const frozen = run.frozen;
  const dirty = await prelGit.worktreeDirtyFiles(projectRoot, exec);
  if (dirty.length) {
    throw new ProductStageError(`工作区有未提交修改（${dirty.slice(0, 5).join('、')}${dirty.length > 5 ? ' 等' : ''}）：请先完成提交（不自动 add/commit/stash）`, 'dirty', { files: dirty.slice(0, 20) });
  }
  const mainSha = await prelGit.branchHead(projectRoot, exec, 'main');
  const devSha = await prelGit.branchHead(projectRoot, exec, 'dev');
  if (!mainSha || !devSha) {
    throw new ProductStageError(`本地分支缺失：${[mainSha ? null : 'main', devSha ? null : 'dev'].filter(Boolean).join('、')}`, 'branch-missing');
  }
  if (mainSha !== frozen.mainSha || devSha !== frozen.devSha) {
    throw new ProductStageError(
      `分支头与冻结不一致（main ${mainSha.slice(0, 8)}/${frozen.mainSha.slice(0, 8)} · dev ${devSha.slice(0, 8)}/${frozen.devSha.slice(0, 8)}）：执行前输入已变化，请重新预检（main 前进可重新冻结）`,
      'plan-stale',
      { mainSha, devSha },
    );
  }
  const contain = await prelGit.verifyItemsOnMain(projectRoot, exec, frozen.items, frozen.mainSha);
  if (!contain.ok) throw new ProductStageError(`计划条目不在冻结 main 历史内：${contain.missing.join('、')}`, 'items-missing');
  const sw = await prelGit.switchMainVerifyHead(projectRoot, exec, { expectedMainSha: frozen.mainSha });
  log(`已切换 main（原分支 ${sw.previousBranch || 'main'}），HEAD === 冻结 ${frozen.mainSha.slice(0, 8)}`);
  // 幂等 / 重试语义：先查询远端，双分支已到达目标则不重复推送
  let already = false;
  try {
    await prelGit.verifyRemoteBranches(projectRoot, exec, { remote: frozen.remote, mainSha: frozen.mainSha, devSha: frozen.devSha });
    already = true;
    log('远端 main/dev 已与冻结一致（查询确认）：不重复推送');
  } catch {
    already = false;
  }
  if (!already) {
    log(`执行原子推送：git push --atomic ${frozen.remote} main dev`);
    try {
      await prelGit.atomicPushBranches(projectRoot, exec, { remote: frozen.remote });
    } catch (e) {
      if (e && e.code === 'ETIMEDOUT') {
        log('推送响应超时（网络响应丢失）：先查询远端实际 ref 再判定，不盲目重推');
        try {
          await prelGit.verifyRemoteBranches(projectRoot, exec, { remote: frozen.remote, mainSha: frozen.mainSha, devSha: frozen.devSha });
          log('超时后查询确认：远端双分支已到达目标，不重复推送');
        } catch (e2) {
          throw new ProductStageError(`推送超时且远端未到达目标：${e2.message}`, 'push-timeout');
        }
      } else {
        throw e;
      }
    }
  }
  const verify = await prelGit.verifyRemoteBranches(projectRoot, exec, { remote: frozen.remote, mainSha: frozen.mainSha, devSha: frozen.devSha });
  log(`远端核验通过：main ${frozen.mainSha.slice(0, 8)} · dev ${frozen.devSha.slice(0, 8)}`);
  store.pushProductEvidence(run, 'sync-source', `main/dev 原子推送并核验一致（远端 ${frozen.remote}）`, { mainSha: frozen.mainSha, devSha: frozen.devSha });
  return { remote: frozen.remote, mainSha: frozen.mainSha, devSha: frozen.devSha, skippedPush: already };
}

async function stageWebappBuild(ctx) {
  const { dataDir, projectRoot, run, exec, log } = ctx;
  const built = await buildWebAppFromFrozen({ projectRoot, runId: run.id, mainSha: run.frozen.mainSha, exec });
  const how = built.profile.kind === 'static' ? '静态直服（无构建步骤）' : `${built.profile.framework} ${built.profile.buildCommand}`;
  log(`Web App 构建完成：${how} → ${built.deployDir}（${built.artifact.files} 文件 / ${built.artifact.bytes} B，源码 ${built.sourceSha.slice(0, 8)}）`);
  ctx.run.webapp = {
    profile: built.profile,
    build: { sourceSha: built.sourceSha, deployDir: built.deployDir, artifact: built.artifact, version: built.profile.version },
  };
  return { sourceSha: built.sourceSha, deployDir: built.deployDir, artifact: built.artifact, profile: built.profile };
}

async function stageWebappVerify(ctx) {
  const { dataDir, projectRoot, run, log } = ctx;
  const buildStage = run.stages.find((s) => s.key === 'webapp-build')?.result || {};
  const deployDir = buildStage.deployDir || ctx.run.webapp?.build?.deployDir;
  if (!deployDir || !fs.existsSync(deployDir)) {
    throw new ProductStageError('部署目录缺失（构建阶段未完成或产物被清理）：请重试构建阶段', 'deploy-dir-missing');
  }
  let serve = deployRegistry.get(run.id)?.webapp;
  if (!serve) {
    const port = await profileMod.allocLocalPort();
    serve = await profileMod.startStaticServer(deployDir, port);
    deployRegistry.set(run.id, { ...(deployRegistry.get(run.id) || {}), webapp: serve });
  }
  const res = await httpGet(`${serve.url}/`);
  if (res.status !== 200 || !res.body.includes(run.frozen.version)) {
    throw new ProductStageError(
      `Web App 回验失败：本机入口 ${serve.url} 返回 ${res.status}${res.status === 200 ? '，页面未包含版本标识 ' + run.frozen.version : ''}（部署命令成功不等于上线，以回验为准）`,
      'webapp-verify-failed',
      { url: serve.url, status: res.status },
    );
  }
  log(`Web App 本机部署回验通过：${serve.url}（含版本标识 ${run.frozen.version}）`);
  store.pushProductEvidence(run, 'webapp-verify', `Web App 已发布（本机 ${serve.url}，版本 ${run.frozen.version}）`, { url: serve.url });
  ctx.run.targets.webapp = { status: 'done', localUrl: serve.url, port: serve.port, checkedAt: new Date().toISOString() };
  return { localUrl: serve.url, port: serve.port, status: res.status };
}

async function stageSiteMaterials(ctx) {
  const { run, log } = ctx;
  const contentDir = run.frozen.homepage?.contentDir;
  if (!contentDir) {
    throw new ProductStageError('官网内容目录未冻结（官网仓库根目录未配置）：请先在设置中配置并重新预检', 'homepage-missing');
  }
  const m = materialsMod.checkSiteMaterials(contentDir);
  if (!m.ok) {
    throw new ProductStageError(
      `官网双语材料缺失：${m.missing.map((x) => `${x.lang}/${x.page}.html（${x.label}）`).join('、')}。缺少任一必备译文时阻塞官网发布（不伪造材料）`,
      'site-materials-missing',
      { missing: m.missing },
    );
  }
  log(`官网材料核验通过：中英文 ${m.files.length} 页（指纹 ${String(m.fingerprint).slice(0, 8)}…）`);
  ctx.run.frozen.materialsFingerprint = m.fingerprint;
  return { files: m.files, fingerprint: m.fingerprint };
}

async function stageSiteDeploy(ctx) {
  const { run, log } = ctx;
  const contentDir = run.frozen.homepage?.contentDir;
  let serveDir = contentDir;
  // 官网仓库为构建型站点（根含 package.json + scripts.build）时先构建再服务产物目录；
  // 静态内容目录直接服务（独立构建不依赖私有产品源码仓库）
  const repoRoot = run.frozen.homepage?.repoRoot;
  if (repoRoot && fs.existsSync(path.join(repoRoot, 'package.json'))) {
    const p = profileMod.detectWebAppProfile(repoRoot);
    if (p.detected && p.kind === 'package') {
      const build = await ctx.exec('npm', ['run', 'build'], { cwd: repoRoot, timeoutMs: 900000 });
      if (build.code !== 0) {
        throw new ProductStageError(`官网仓库构建失败（exit ${build.code}）：${String(build.stderr || build.stdout).split('\n').filter(Boolean).slice(0, 4).join('；')}`, 'site-build-failed');
      }
      serveDir = path.join(repoRoot, p.outputDir);
    }
  }
  if (!serveDir || !fs.existsSync(serveDir)) {
    throw new ProductStageError(`官网部署目录缺失：${serveDir || '（未配置）'}（缺少执行支持时明确阻塞，不伪报成功）`, 'site-deploy-missing');
  }
  let serve = deployRegistry.get(run.id)?.site;
  if (!serve) {
    serve = await profileMod.startStaticServer(serveDir);
    deployRegistry.set(run.id, { ...(deployRegistry.get(run.id) || {}), site: serve });
  }
  log(`官网本机部署：${serve.url}（服务 ${serveDir}）`);
  return { localUrl: serve.url, port: serve.port, serveDir };
}

async function stageSiteVerify(ctx) {
  const { run, log } = ctx;
  const entry = deployRegistry.get(run.id);
  const siteUrl = entry?.site?.url || run.targets.site?.localUrl;
  if (!siteUrl) {
    throw new ProductStageError('官网本机入口缺失（部署阶段未完成）：请重试官网部署阶段', 'site-url-missing');
  }
  const webappUrl = ctx.run.targets.webapp?.localUrl || '';
  const problems = [];
  for (const lang of ['zh', 'en']) {
    const res = await httpGet(`${siteUrl}/${lang}/index.html`);
    if (res.status !== 200) {
      problems.push(`${lang}: HTTP ${res.status}`);
      continue;
    }
    if (!res.body.includes(run.frozen.version)) problems.push(`${lang}: 页面缺少版本标识 ${run.frozen.version}`);
    const hasEntry = /data-webapp-entry/.test(res.body) || (webappUrl && res.body.includes(webappUrl));
    if (!hasEntry) problems.push(`${lang}: 缺少 Web App 入口链接`);
    const hasLangSwitch = /data-lang-switch|lang-switch/.test(res.body) || (res.body.includes('中文') && res.body.includes('English'));
    if (!hasLangSwitch) problems.push(`${lang}: 缺少语言切换入口`);
  }
  if (problems.length) {
    throw new ProductStageError(`官网回验未通过（两语言均通过才算官网目标完成）：${problems.join('；')}`, 'site-verify-failed', { problems });
  }
  log(`官网中英文回验通过：${siteUrl}/zh / · ${siteUrl}/en /`);
  store.pushProductEvidence(run, 'site-verify', `官网已上线（本机 ${siteUrl}，中英文页面/链接/语言入口回验通过）`, { url: siteUrl });
  ctx.run.targets.site = { status: 'done', localUrl: siteUrl, port: entry?.site?.port ?? null, checkedAt: new Date().toISOString() };
  return { localUrl: siteUrl, langs: ['zh', 'en'] };
}

const STAGE_IMPLS = {
  'sync-source': stageSyncSource,
  'webapp-build': stageWebappBuild,
  'webapp-verify': stageWebappVerify,
  'site-materials': stageSiteMaterials,
  'site-deploy': stageSiteDeploy,
  'site-verify': stageSiteVerify,
};
const STAGE_KEYS = store.PRODUCT_STAGES.map((s) => s.key);

/* ---------- 流水线驱动 ---------- */

export async function runProductPipeline({ dataDir, projectRoot, runId, exec }) {
  let run = store.mutateProductRun(dataDir, runId, (r) => { r.status = 'running'; }, { action: 'start' });
  const startIdx = run.stages.findIndex((s) => s.status !== 'done' && s.status !== 'skipped');
  for (let i = Math.max(startIdx, 0); i < STAGE_KEYS.length; i++) {
    const key = STAGE_KEYS[i];
    const stageDef = run.stages.find((s) => s.key === key);
    if (!stageDef || stageDef.status === 'done' || stageDef.status === 'skipped') continue;
    // 取消后续阶段：每阶段执行前核对最新状态（外部取消即时生效）
    const disk = store.readProductRun(dataDir, runId);
    if (disk.status === 'canceled') return disk;
    run = store.mutateProductRun(dataDir, runId, (r) => {
      const s = r.stages.find((x) => x.key === key);
      s.status = 'running';
      s.startedAt = new Date().toISOString();
    }, { action: `stage:${key}:start` });
    const ctx = {
      dataDir, projectRoot, exec,
      run,
      log: (line) => store.appendProductRunLog(dataDir, runId, key, line),
    };
    try {
      const current = store.readProductRun(dataDir, runId);
      ctx.run = current;
      const evidenceBefore = current.evidence.length;
      const result = await STAGE_IMPLS[key](ctx);
      const stageEvidence = ctx.run.evidence.slice(evidenceBefore);
      run = store.mutateProductRun(dataDir, runId, (r) => {
        const s = r.stages.find((x) => x.key === key);
        s.status = 'done';
        s.endedAt = new Date().toISOString();
        s.result = { ...(s.result || {}), ...result };
        // 阶段内更新的派生字段（webapp 构建结果 / 目标卡 / 材料指纹）随阶段落盘
        if (key === 'webapp-build' && ctx.run.webapp) r.webapp = ctx.run.webapp;
        if (key === 'webapp-verify' && ctx.run.targets?.webapp) r.targets.webapp = ctx.run.targets.webapp;
        if (key === 'site-materials' && ctx.run.frozen?.materialsFingerprint) r.frozen.materialsFingerprint = ctx.run.frozen.materialsFingerprint;
        if (key === 'site-verify' && ctx.run.targets?.site) r.targets.site = ctx.run.targets.site;
        for (const ev of stageEvidence) r.evidence.push(ev);
        store.pushProductEvidence(r, key, `阶段完成：${key}`);
      }, { action: `stage:${key}:done` });
    } catch (e) {
      const result = e instanceof ProductStageError ? e.stageResult : null;
      run = store.mutateProductRun(dataDir, runId, (r) => {
        const s = r.stages.find((x) => x.key === key);
        s.status = 'failed';
        s.endedAt = new Date().toISOString();
        s.error = { message: String(e && e.message ? e.message : e), kind: e instanceof ProductStageError ? e.kind : 'error' };
        if (result) s.result = { ...(s.result || {}), ...result };
        // 失败波及目标卡：只标记本阶段所属目标为 failed，已上线目标保留
        if (key.startsWith('webapp') && r.targets?.webapp?.status !== 'done') r.targets.webapp.status = 'failed';
        if (key.startsWith('site') && r.targets?.site?.status !== 'done') r.targets.site.status = 'failed';
        r.status = 'failed';
      }, { action: `stage:${key}:failed` });
      store.appendProductRunLog(dataDir, runId, key, `阶段失败（${e instanceof ProductStageError ? e.kind : 'error'}）：${e && e.message ? e.message : e}`);
      return run;
    }
  }
  // 收敛：全部完成 → succeeded（两目标 + 前置同步全部 done）；取消 / 失败由阶段路径处理
  return store.mutateProductRun(dataDir, runId, (r) => {
    r.status = store.overallStatus(r);
  }, { action: 'pipeline-done' });
}
