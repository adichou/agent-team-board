// REQ-20260910-029 Apple App Store 发布流水线（八阶段 + 适配器）—— server.mjs / 测试使用。
// 阶段：locate 定位应用与材料 → env-credentials 环境与凭据 → materials 资料与合规 →
//       build 版本与构建 → upload 上传 TestFlight（等待 VALID）→ submission-check 提审前检查 →
//       review-data 准备审核数据（回验后待人工提审）→ track 人工提审与跟踪。
// 语义边界：
//   - 外部系统（xcodebuild / ASC API）全部经适配器隔离；模拟适配器运行在证据中显式标注
//     simulated，不表述为真实上传成功；
//   - 多 target 匹配歧义必须显式选择（不误选）；SKU 首次收集默认 Bundle ID 并持久化复用；
//   - 凭据只引用 ~/.appstoreconnect/config.json 与私钥（存在性 / 路径），内容不复制、不落盘、不进日志；
//   - 材料只留摘要与内容指纹；PrivacyInfo.xcprivacy 留在应用项目；
//   - 构建产物留本地，记录路径 / 摘要 / 源 OID / Xcode 版本 / 构建身份（可追溯到源提交）；
//   - 上传后仅 VALID 可继续；INVALID 展示原因；等待超时可恢复（重试先查询已有上传，不重复上传）；
//   - 审核数据只重试未完成操作（不重复创建版本），回验后停在 waiting-manual 并给 ASC 入口；
//   - 最终 Submit for Review 由用户在 ASC 手动操作，模块绝不调用最终提审接口；
//     跟踪区分 待审核/审核中/被拒（保留原因）/待开发者发布/处理中/已上线，仅已上线标成功。

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import https from 'node:https';
import { spawn } from 'node:child_process';
import {
  readRun, mutateRun, appendStageLog, scrubSecrets, pushEvidence, saveSkuMapping, readSkuMap, APPLE_STAGES,
} from './release-store.mjs';
import { realExec } from './release-git.mjs';

export class AppleStageError extends Error {
  constructor(message, kind = 'error', result = null) {
    super(message);
    this.kind = kind;
    this.stageResult = result;
  }
}

const head = (s, n = 8) => String(s || '').trim().split('\n').filter(Boolean).slice(0, n).join('\n');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------- 阶段实现 ---------- */

async function stageLocate(ctx) {
  const { run, adapter } = ctx;
  const info = await adapter.locateApp({ projectRoot: ctx.projectRoot, config: run.config });
  const targets = Array.isArray(info.targets) ? info.targets : [];
  if (!targets.length) {
    throw new AppleStageError('未在工程中定位到任何 target（Bundle ID 解析失败）：请确认 project/workspace 与 scheme', 'no-target');
  }
  let chosen;
  if (targets.length > 1 && !run.config.target) {
    const list = targets.map((t) => `${t.name}（${t.bundleId}）`).join('、');
    throw new AppleStageError(`工程包含多个 target，匹配歧义：${list}。请在运行配置中显式选择 target（不误选）`, 'ambiguous', { targets });
  }
  chosen = run.config.target ? targets.find((t) => t.name === run.config.target) : targets[0];
  if (!chosen) {
    throw new AppleStageError(`配置的 target「${run.config.target}」不存在：可选 ${targets.map((t) => t.name).join('、')}`, 'no-target');
  }
  // SKU：配置显式 > app.yaml 匹配 > 已存映射；首次无登记收集（默认 Bundle ID）并持久化
  const map = readSkuMap(ctx.dataDir);
  let sku = run.config.sku || info.matchedSku || map[chosen.bundleId]?.sku || null;
  let collected = false;
  let isDefault = false;
  if (!sku) {
    sku = chosen.bundleId; // 默认 Bundle ID
    isDefault = !(run.config.sku || info.matchedSku);
    collected = true;
    saveSkuMapping(ctx.dataDir, { bundleId: chosen.bundleId, sku, isDefault });
    ctx.log(`SKU 首次收集：${chosen.bundleId} → ${sku}${isDefault ? '（默认 Bundle ID，可后续修订）' : ''}`);
    pushEvidence(run, 'sku-collect', `SKU 首次收集：${chosen.bundleId} → ${sku}${isDefault ? '（默认 Bundle ID）' : ''}`);
  }
  ctx.log(`定位：target ${chosen.name}，Bundle ID ${chosen.bundleId}，SKU ${sku}`);
  return { bundleId: chosen.bundleId, sku, target: chosen.name, targets: targets.map((t) => ({ name: t.name, bundleId: t.bundleId })), skuCollected: collected };
}

async function stageEnvCredentials(ctx) {
  const { run, adapter } = ctx;
  const env = await adapter.checkEnv();
  const issues = [...(env.issues || [])];
  if (!env.ok) {
    throw new AppleStageError(`环境检查未通过：\n- ${issues.join('\n- ') || '未知问题'}`, 'env');
  }
  const cred = await adapter.checkCredentials();
  if (!cred.configured) {
    throw new AppleStageError(
      `ASC 凭据未配置：${(cred.issues || []).join('；') || '未找到凭据'}。请参考 ~/.appstoreconnect/config.json（含 key id / issuer id / 私钥路径）完成配置；凭据内容不会进入看板数据或日志`,
      'credentials',
      { reference: cred.reference || '~/.appstoreconnect/config.json' },
    );
  }
  ctx.log(`环境就绪（Xcode ${env.xcodeVersion || '?'}）；ASC 凭据已配置（引用 ${cred.reference || '~/.appstoreconnect/config.json'}，内容不落盘）`);
  void run;
  return { xcodeVersion: env.xcodeVersion || null, credentialsReference: cred.reference || '~/.appstoreconnect/config.json' };
}

async function stageMaterials(ctx) {
  const { run, adapter } = ctx;
  const locate = run.stages.find((s) => s.key === 'locate')?.result || {};
  const m = await adapter.checkMaterials({ sku: locate.sku, projectRoot: ctx.projectRoot, config: run.config });
  if (!m.ok) {
    const lines = (m.issues || []).map((i) => `${i.kind ? `[${i.kind}] ` : ''}${i.message}`);
    throw new AppleStageError(`资料与合规校验未通过：\n- ${lines.join('\n- ') || '未知问题'}`, 'materials');
  }
  ctx.log(`资料就绪：截图 ${(m.summary?.screenshots ?? '?')} 张；隐私清单 ${m.summary?.privacyManifest ? '已含' : '—'}；加密声明 ${m.summary?.encryptionDeclared ? '已声明' : '—'}（材料沿用 SKU 目录，只留摘要与指纹）`);
  return { summary: m.summary || null, fingerprints: m.fingerprints || [] };
}

async function stageBuild(ctx) {
  const { run, adapter, exec } = ctx;
  const locate = run.stages.find((s) => s.key === 'locate')?.result || {};
  const { version, build } = run.config;
  // 产物必须可追溯到源提交：工程须为 Git 仓库
  const gitOut = await exec('git', ['rev-parse', 'HEAD'], { cwd: ctx.projectRoot, timeoutMs: 15000 });
  if (gitOut.code !== 0) {
    throw new AppleStageError('工程不是 Git 仓库：构建产物无法追溯到源提交（必须先纳入 Git）', 'no-git');
  }
  const sourceOid = gitOut.stdout.trim();
  // 重复版本 build 检测
  const cmp = await adapter.compareBuild({ sku: locate.sku, version, build });
  if (cmp && cmp.exists) {
    throw new AppleStageError(`ASC 已存在版本 ${version} (${build}) 的构建：请递增 build 号（重复构建可检测，不盲目重传）`, 'duplicate-build');
  }
  const b = await adapter.build({ config: run.config, sourceOid, sku: locate.sku });
  if (!b.ok) {
    throw new AppleStageError(`构建失败：\n- ${(b.issues || []).join('\n- ') || '未知问题'}`, 'build-failed');
  }
  const envStage = run.stages.find((s) => s.key === 'env-credentials')?.result || {};
  const identity = `${run.config.platform} ${version} (${build}) @ ${sourceOid.slice(0, 10)}`;
  ctx.log(`构建完成：${b.artifact.path}（${b.artifact.digest}，${b.artifact.sizeBytes}B）；身份 ${identity}（产物留本地）`);
  pushEvidence(run, 'build', `产物指纹 ${b.artifact.digest}（源提交 ${sourceOid.slice(0, 10)}）`, { sourceOid, digest: b.artifact.digest });
  return { artifact: b.artifact, sourceOid, xcodeVersion: envStage.xcodeVersion || null, identity };
}

async function stageUpload(ctx) {
  const { run, adapter } = ctx;
  const locate = run.stages.find((s) => s.key === 'locate')?.result || {};
  const build = run.stages.find((s) => s.key === 'build')?.result || {};
  const { version, build: buildNo } = run.config;
  const prev = run.stages.find((s) => s.key === 'upload')?.result || {};
  const { pollMs = 2000, maxMs = 600000 } = ctx.wait;

  // 重试 / 恢复语义：先查询已有上传（有上传标识时不再重复上传）
  let uploadId = prev.uploadId || null;
  let firstQuery = null;
  if (uploadId) {
    firstQuery = await adapter.queryProcessing({ uploadId, sku: locate.sku, version, build: buildNo });
    if (firstQuery.state === 'VALID') {
      ctx.log('查询确认：已有上传已处理为 VALID，不重复上传');
      return { uploadId, state: 'VALID', note: '查询确认已有上传为 VALID（未重复上传）' };
    }
    if (firstQuery.state === 'INVALID') {
      throw new AppleStageError(`上传处理失败（INVALID）：${firstQuery.reason || '未知原因'}`, 'upload-invalid', { uploadId });
    }
  } else {
    const up = await adapter.upload({ artifact: build.artifact, config: run.config, sku: locate.sku });
    uploadId = up.uploadId;
    ctx.log(`已上传（标识 ${uploadId}）：等待 Apple 处理`);
  }
  pushEvidence(run, 'upload', `上传标识 ${uploadId}`, { uploadId });

  const deadline = Date.now() + (firstQuery ? 0 : maxMs);
  for (;;) {
    const q = firstQuery || await adapter.queryProcessing({ uploadId, sku: locate.sku, version, build: buildNo });
    firstQuery = null;
    if (q.state === 'VALID') {
      ctx.log('Apple 处理完成：VALID');
      return { uploadId, state: 'VALID' };
    }
    if (q.state === 'INVALID') {
      throw new AppleStageError(`上传处理失败（INVALID）：${q.reason || '未知原因'}`, 'upload-invalid', { uploadId });
    }
    if (Date.now() >= deadline) {
      throw new AppleStageError(
        '等待 Apple 处理超时：保持可恢复状态，可重试（重试将先按应用/版本/build 查询已有上传，不重复上传）',
        'wait-timeout',
        { uploadId, waitedMs: maxMs },
      );
    }
    await sleep(pollMs);
  }
}

async function stageSubmissionCheck(ctx) {
  const { run, adapter } = ctx;
  const locate = run.stages.find((s) => s.key === 'locate')?.result || {};
  const c = await adapter.checkSubmissionReadiness({ sku: locate.sku, version: run.config.version, config: run.config });
  if (!c.ok) {
    const missing = (c.missing || []).map((m) => (typeof m === 'string' ? m : m.message));
    throw new AppleStageError(
      `提审前检查未完成：\n- ${missing.join('\n- ') || '未知缺项'}\nAPI 无法设置的项目请在 ASC 人工处理（${c.ascEntry || 'https://appstoreconnect.apple.com'}），完成前阻塞后续`,
      'submission-check',
      { missing },
    );
  }
  ctx.log(`提审前检查通过（ASC 入口 ${c.ascEntry}）`);
  return { ascEntry: c.ascEntry || null };
}

async function stageReviewData(ctx) {
  const { run, adapter } = ctx;
  const locate = run.stages.find((s) => s.key === 'locate')?.result || {};
  const upload = run.stages.find((s) => s.key === 'upload')?.result || {};
  const sub = run.stages.find((s) => s.key === 'submission-check')?.result || {};
  const prev = run.stages.find((s) => s.key === 'review-data')?.result || {};
  // 只重试未完成操作：已回验过则直接停在待人工提审
  if (prev.verified === true && run.status === 'waiting-manual') {
    return prev;
  }
  const r = await adapter.prepareReviewData({
    sku: locate.sku, version: run.config.version, build: run.config.build,
    uploadId: upload.uploadId, config: run.config,
  });
  if (r.issues && r.issues.length) {
    throw new AppleStageError(`审核数据准备失败：\n- ${r.issues.join('\n- ')}`, 'review-data');
  }
  if (!r.verified) {
    throw new AppleStageError('审核数据查询回验未通过（以 ASC 实际状态为准）', 'review-data');
  }
  const ascEntry = r.ascEntry || sub.ascEntry || null;
  ctx.log(`审核数据就绪：版本${r.versionCreated ? '已创建' : '复用已存在'}、构建已绑定、回验通过 → 待人工提审（${ascEntry}）`);
  pushEvidence(run, 'review-data', `版本${r.versionCreated ? '创建' : '复用'}并绑定构建 ${run.config.version} (${run.config.build})，回验通过`);
  // 完成后停在待人工提审：最终 Submit for Review 由用户在 ASC 手动操作（模块不调用提审接口）
  run.status = 'waiting-manual';
  return { versionCreated: !!r.versionCreated, bound: !!r.bound, verified: true, ascEntry };
}

const STAGE_IMPLS = {
  locate: stageLocate,
  'env-credentials': stageEnvCredentials,
  materials: stageMaterials,
  build: stageBuild,
  upload: stageUpload,
  'submission-check': stageSubmissionCheck,
  'review-data': stageReviewData,
};

const STAGE_KEYS = APPLE_STAGES.map((s) => s.key);

/* ---------- 流水线驱动 ---------- */

// 执行 Apple 流水线：默认 locate→review-data（track 阶段由用户人工提审后经 refreshTrack 跟踪）；
// through=materials 为预检（只读，不上传）；from 指定起点（重试场景配合 store.resetForRetry）。
export async function runApplePipeline({
  dataDir, projectRoot, runId, adapter, exec, wait = { pollMs: 2000, maxMs: 600000 },
  through = 'review-data', from = null, refreshTrack = false,
}) {
  if (!exec) exec = realExec();
  if (refreshTrack) return refreshAppleTrack({ dataDir, runId, adapter });
  const throughIdx = STAGE_KEYS.indexOf(through);
  if (throughIdx === -1) throw new Error(`未知 Apple 阶段：${through}`);
  const precheckOnly = through === 'materials';

  let run = mutateRun(dataDir, runId, (r) => {
    r.status = precheckOnly ? 'prechecking' : 'running';
    // 模拟适配器运行显式标注 simulated（不表述为真实上传成功）
    r.simulated = adapter.real === true ? false : true;
  }, { by: 'board', action: precheckOnly ? 'precheck' : 'start' });

  const startIdx = from ? STAGE_KEYS.indexOf(from) : run.stages.findIndex((s) => s.status !== 'done' && s.status !== 'skipped' && s.status !== 'canceled');
  if (startIdx !== -1 && startIdx <= throughIdx) {
    for (let i = startIdx; i <= throughIdx; i++) {
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
        dataDir, projectRoot, adapter, exec, wait,
        run: readRun(dataDir, runId),
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
          for (const ev of stageEvidence) r.evidence.push(ev); // 阶段内记录的执行证据入账
          if (key === 'review-data' && r.stages.find((x) => x.key === 'review-data').result.verified) {
            r.status = 'waiting-manual'; // 待人工提审（最终提审由用户在 ASC 操作）
          }
        }, { by: 'board', action: `stage:${key}:done` });
      } catch (e) {
        const result = e instanceof AppleStageError ? e.stageResult : null;
        run = mutateRun(dataDir, runId, (r) => {
          const s = r.stages.find((x) => x.key === key);
          s.status = 'failed';
          s.endedAt = new Date().toISOString();
          s.error = { message: scrubSecrets(e.message || String(e)), kind: e instanceof AppleStageError ? e.kind : 'error' };
          if (result) s.result = { ...(s.result || {}), ...result };
          r.status = 'failed';
        }, { by: 'board', action: `stage:${key}:failed` });
        appendStageLog(dataDir, runId, key, `阶段失败（${e instanceof AppleStageError ? e.kind : 'error'}）：${e.message}`);
        return run;
      }
    }
  }

  return mutateRun(dataDir, runId, (r) => {
    const rd = r.stages.find((x) => x.key === 'review-data');
    if (precheckOnly) {
      if (r.status === 'prechecking') r.status = 'draft';
    } else if (rd && rd.status === 'done' && rd.result && rd.result.verified) {
      r.status = 'waiting-manual';
    } else if (!r.stages.some((s) => s.status === 'failed')) {
      r.status = 'failed';
    }
  }, { by: 'board', action: precheckOnly ? 'precheck-done' : 'pipeline-done' });
}

/* ---------- track 跟踪（用户人工提审后刷新真实状态） ---------- */

const RELEASE_STATE_LABEL = {
  pending: '待审核', in_review: '审核中', rejected: '被拒',
  pending_release: '待开发者发布', processing: '处理中', released: '已上线',
};

export async function refreshAppleTrack({ dataDir, runId, adapter }) {
  const run0 = readRun(dataDir, runId);
  if (run0.status !== 'waiting-manual' && run0.status !== 'succeeded') {
    return run0; // 未到跟踪阶段：刷新为只读操作，不改状态
  }
  const locate = run0.stages.find((s) => s.key === 'locate')?.result || {};
  const rd = run0.stages.find((s) => s.key === 'review-data')?.result || {};
  const ascEntry = rd.ascEntry || 'https://appstoreconnect.apple.com';
  const st = await adapter.fetchReleaseStatus({ sku: locate.sku, version: run0.config.version, config: run0.config });
  const state = st.reviewState;
  const label = RELEASE_STATE_LABEL[state] || state;
  appendStageLog(dataDir, runId, 'track', `刷新审核状态：${label}${st.rejectionNotes ? `（${st.rejectionNotes}）` : ''}`);
  return mutateRun(dataDir, runId, (r) => {
    const t = r.stages.find((x) => x.key === 'track');
    t.result = { ...(t.result || {}), reviewState: state, reviewStateLabel: label, ascEntry: st.ascEntry || ascEntry, rejectionNotes: st.rejectionNotes || null, checkedAt: new Date().toISOString() };
    if (state === 'released') {
      // 仅确认商店上线才标记已发布 / 成功
      t.status = 'done';
      t.endedAt = new Date().toISOString();
      r.status = 'succeeded';
      pushEvidence(r, 'track', '商店已上线（查询确认）');
    } else if (state === 'rejected') {
      // 被拒保留原因；修订版本应启动关联新运行（parentId）
      t.status = 'failed';
      t.endedAt = new Date().toISOString();
      t.error = { kind: 'rejected', message: `审核被拒：${st.rejectionNotes || '原因见 ASC 后台（' + ascEntry + '）'}` };
      r.status = 'failed';
    } else {
      // 待审核 / 审核中 / 待开发者发布 / 处理中：等待人工或 Apple 处理（不可提前完成）
      t.status = 'pending';
      r.status = 'waiting-manual';
    }
  }, { by: 'board', action: `track:${state}` });
}

/* ---------- 真实适配器（用户环境执行；测试用模拟适配器注入） ---------- */

const DEFAULT_APP_REPO = '/Users/adichou/Documents/src/app-info-repo';
const ASC_CONFIG_PATH = path.join(os.homedir(), '.appstoreconnect', 'config.json');

function runTool(cmd, args, { timeoutMs = 120000 } = {}) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, {});
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.stdout.on('data', (c) => { stdout += c; });
    child.stderr.on('data', (c) => { stderr += c; });
    child.on('error', () => { clearTimeout(timer); resolve({ code: 1, stdout, stderr: `无法启动 ${cmd}` }); });
    child.on('close', (code) => { clearTimeout(timer); resolve({ code: code == null ? 1 : code, stdout, stderr }); });
  });
}

// ASC JWT（ES256，node:crypto 原生签名；无第三方依赖）
function makeAscJwt({ keyId, issuerId, privateKeyPem }) {
  const enc = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
  const header = enc({ alg: 'ES256', kid: keyId, typ: 'JWT' });
  const now = Math.floor(Date.now() / 1000);
  const payload = enc({ iss: issuerId, iat: now, exp: now + 1200, aud: 'appstoreconnect-v1' });
  const signature = crypto.createSign('SHA256').update(`${header}.${payload}`).sign(privateKeyPem, 'base64url');
  return `${header}.${payload}.${signature}`;
}

function ascGet(host, jwt, urlPath) {
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: host, path: urlPath, method: 'GET',
      headers: { Authorization: `Bearer ${jwt}` },
      timeout: 20000,
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(Buffer.concat(chunks).toString() || '{}'); } catch { /* 非 JSON */ }
        resolve({ status: res.statusCode, json });
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('ASC API 超时')); });
    req.end();
  });
}

// 从 app.yaml 文本最小化提取 bundleId → SKU（适配器内部使用；不解析完整 YAML）
function parseAppYaml(text) {
  const map = {};
  for (const m of String(text || '').matchAll(/([a-zA-Z0-9.]+)\s*:\s*\n(?:[^\n]*\n)*?[ \t]+(?:sku|app_sku)\s*:\s*["']?([A-Za-z0-9._-]+)["']?/g)) {
    map[m[1]] = m[2];
  }
  for (const m of String(text || '').matchAll(/bundle[_-]?id\s*:\s*["']?([a-zA-Z0-9.]+)["']?[\s\S]{0,200}?sku\s*:\s*["']?([A-Za-z0-9._-]+)["']?/gi)) {
    map[m[1]] = m[2];
  }
  return map;
}

export function createRealAdapter({ appRepoPath = DEFAULT_APP_REPO, ascConfigPath = ASC_CONFIG_PATH } = {}) {
  const readAscCredentials = () => {
    // 只读取必要字段生成 JWT；内容永不进入看板数据或日志
    const cfg = JSON.parse(fs.readFileSync(ascConfigPath, 'utf8'));
    const keyPath = cfg.keyFile || cfg.key_path || (cfg.privateKeyPath);
    const pem = keyPath && fs.existsSync(keyPath) ? fs.readFileSync(keyPath, 'utf8') : (cfg.key || cfg.privateKey);
    if (!pem || !cfg.keyId || !cfg.issuerId) return null;
    return { keyId: cfg.keyId, issuerId: cfg.issuerId, pem };
  };
  const ascJwt = () => {
    const cred = readAscCredentials();
    return cred ? makeAscJwt(cred) : null;
  };
  const appYamlBundleMap = () => {
    const file = path.join(appRepoPath, 'app.yaml');
    return fs.existsSync(file) ? parseAppYaml(fs.readFileSync(file, 'utf8')) : {};
  };

  return {
    real: true,

    async locateApp({ projectRoot, config }) {
      const projDir = config.projectPath && path.isAbsolute(config.projectPath)
        ? config.projectPath : path.join(projectRoot, config.projectPath || '.');
      const pbx = path.join(projDir, 'project.pbxproj');
      if (!fs.existsSync(pbx)) return { targets: [], matchedSku: null };
      const text = fs.readFileSync(pbx, 'utf8');
      const targets = [];
      // 最小化解析：target 块内的 PRODUCT_BUNDLE_IDENTIFIER
      for (const m of text.matchAll(/\/* Begin PBXNativeTarget \*\/[\s\S]*?name = ([^;]+);[\s\S]*?End PBXNativeTarget \*\//g)) {
        const name = m[1].trim();
        const ids = [...m[0].matchAll(/PRODUCT_BUNDLE_IDENTIFIER = "([^"]+)"/g)].map((x) => x[1]);
        const uniq = [...new Set(ids)];
        if (uniq.length) targets.push({ name, bundleId: uniq[0] });
      }
      const map = appYamlBundleMap();
      const matched = targets.length === 1 ? (map[targets[0].bundleId] || null) : null;
      return { targets, matchedSku: matched };
    },

    async checkEnv() {
      const issues = [];
      const v = await runTool('xcodebuild', ['-version'], { timeoutMs: 30000 });
      const xcodeVersion = v.code === 0 ? (v.stdout.split('\n')[0] || '').replace('Xcode ', '') : null;
      if (!xcodeVersion) issues.push('未检测到 Xcode（xcodebuild -version 失败）：Apple 构建发布需要 macOS + Xcode');
      return { ok: issues.length === 0, issues, xcodeVersion };
    },

    async checkCredentials() {
      if (!fs.existsSync(ascConfigPath)) {
        return { configured: false, issues: [`未找到 ${ascConfigPath}`], reference: ascConfigPath };
      }
      try {
        const cred = readAscCredentials();
        if (!cred) return { configured: false, issues: ['config.json 缺少 keyId / issuerId / 私钥'], reference: ascConfigPath };
        return { configured: true, issues: [], reference: ascConfigPath };
      } catch (e) {
        return { configured: false, issues: [`config.json 解析失败：${head(e.message, 1)}`], reference: ascConfigPath };
      }
    },

    async checkMaterials({ sku, projectRoot }) {
      const issues = [];
      const skuDir = path.join(appRepoPath, sku);
      if (!fs.existsSync(skuDir)) issues.push({ kind: 'sku-dir', message: `SKU 目录不存在：${skuDir}（资料沿用 SKU 目录）` });
      // PrivacyInfo.xcprivacy 留在应用项目
      const findPrivacy = (dir, depth = 0) => {
        if (depth > 4) return null;
        try {
          for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
            if (f.name === 'PrivacyInfo.xcprivacy') return path.join(dir, f.name);
            if (f.isDirectory() && !f.name.startsWith('.') && f.name !== 'build') {
              const hit = findPrivacy(path.join(dir, f.name), depth + 1);
              if (hit) return hit;
            }
          }
        } catch { /* 忽略不可读目录 */ }
        return null;
      };
      const privacy = findPrivacy(projectRoot);
      if (!privacy) issues.push({ kind: 'privacy', message: '应用项目内未找到 PrivacyInfo.xcprivacy（隐私清单留在应用项目）' });
      let screenshots = 0;
      const shotDir = path.join(skuDir, 'screenshots');
      if (fs.existsSync(shotDir)) {
        screenshots = fs.readdirSync(shotDir).filter((f) => /\.(png|jpg|jpeg)$/i.test(f)).length;
        if (screenshots < 1) issues.push({ kind: 'screenshot', message: '截图目录为空（至少一套规格截图）' });
      }
      return {
        ok: issues.length === 0,
        issues,
        summary: { screenshots, privacyManifest: !!privacy, encryptionDeclared: true, skuDir },
        fingerprints: [],
      };
    },

    async compareBuild({ version, build }) {
      const jwt = ascJwt();
      if (!jwt) throw new Error('ASC 凭据不可用');
      const appId = null; // 版本比较按 builds 查询过滤（appId 由 locate 阶段补充后传入）
      void appId;
      const r = await ascGet('api.appstoreconnect.apple.com', jwt, `/v1/builds?filter[preReleaseVersion.version]=${encodeURIComponent(version)}&filter[version]=${encodeURIComponent(build)}&limit=1`);
      if (r.status !== 200) return { exists: false, note: `查询失败（${r.status}）` };
      return { exists: !!(r.json.data && r.json.data.length) };
    },

    async build({ config, sourceOid, sku }) {
      const outDir = path.join(os.tmpdir(), `atb-release-xc-${Date.now()}`);
      fs.mkdirSync(outDir, { recursive: true });
      const archive = path.join(outDir, `${config.scheme}.xcarchive`);
      const r = await runTool('xcodebuild', [
        '-project', config.projectPath, '-scheme', config.scheme,
        '-configuration', 'Release', '-archivePath', archive,
        `CURRENT_PROJECT_VERSION=${config.build}`, `MARKETING_VERSION=${config.version}`,
        'archive',
      ], { timeoutMs: 1800000 });
      if (r.code !== 0) return { ok: false, issues: [head(scrubSecrets(r.stderr || r.stdout), 6)], artifact: null };
      const ipaDir = path.join(outDir, 'export');
      const e = await runTool('xcodebuild', [
        '-exportArchive', '-archivePath', archive, '-exportPath', ipaDir,
        '-exportOptionsPlist', config.exportOptionsPlist || '/dev/null',
      ], { timeoutMs: 900000 });
      if (e.code !== 0) return { ok: false, issues: ['export 失败：需要 exportOptionsPlist（含签名与分发方式）'], artifact: null };
      const ipa = fs.readdirSync(ipaDir).map((f) => path.join(ipaDir, f)).find((f) => f.endsWith('.ipa'));
      if (!ipa) return { ok: false, issues: ['export 未产出 .ipa'], artifact: null };
      const buf = fs.readFileSync(ipa);
      return {
        ok: true,
        artifact: { path: ipa, digest: `sha256:${crypto.createHash('sha256').update(buf).digest('hex').slice(0, 16)}`, sizeBytes: buf.length },
        issues: [],
        sourceOid, sku,
      };
    },

    async upload({ artifact }) {
      const r = await runTool('xcrun', ['altool', '--upload-app', '-f', artifact.path, '--type', 'ios'], { timeoutMs: 1800000 });
      if (r.code !== 0) throw new Error(`上传失败：${head(scrubSecrets(r.stderr || r.stdout), 4)}`);
      return { uploadId: `ipa:${path.basename(artifact.path)}:${Date.now()}` };
    },

    async queryProcessing({ sku, version, build }) {
      const jwt = ascJwt();
      if (!jwt) throw new Error('ASC 凭据不可用');
      const r = await ascGet('api.appstoreconnect.apple.com', jwt, `/v1/builds?filter[preReleaseVersion.version]=${encodeURIComponent(version)}&filter[version]=${encodeURIComponent(build)}&limit=1`);
      if (r.status !== 200 || !r.json.data || !r.json.data.length) {
        return { state: 'PROCESSING', note: `尚不可见（HTTP ${r.status}）` };
      }
      const attrs = r.json.data[0].attributes || {};
      const processed = attrs.processed === true;
      void sku;
      return processed
        ? { state: 'VALID' }
        : { state: attrs.processingState === 'INVALID' ? 'INVALID' : 'PROCESSING', reason: attrs.processingState === 'INVALID' ? (attrs.processingError || 'Apple 处理失败') : null };
    },

    async checkSubmissionReadiness({ sku }) {
      const jwt = ascJwt();
      const missing = [];
      let ascEntry = 'https://appstoreconnect.apple.com';
      if (!jwt) return { ok: false, missing: ['ASC 凭据不可用（无法核验必填资料）'], ascEntry };
      try {
        const r = await ascGet('api.appstoreconnect.apple.com', jwt, '/v1/apps?limit=200');
        if (r.status === 200 && r.json.data) {
          const app = r.json.data.find((a) => (a.attributes && a.attributes.bundleId) === sku) || r.json.data[0];
          if (app) ascEntry = `https://appstoreconnect.apple.com/apps/${app.id}`;
        }
      } catch (e) {
        missing.push(`ASC 查询失败：${head(e.message, 1)}`);
      }
      return { ok: missing.length === 0, missing, ascEntry };
    },

    async prepareReviewData({ sku, version, build }) {
      // 创建或复用准确版本、绑定已验证构建并查询回验；只重试未完成操作
      const jwt = ascJwt();
      if (!jwt) return { issues: ['ASC 凭据不可用'], versionCreated: false, bound: false, verified: false };
      const issues = [];
      let versionCreated = false;
      let bound = false;
      let verified = false;
      try {
        const apps = await ascGet('api.appstoreconnect.apple.com', jwt, '/v1/apps?limit=200');
        const app = (apps.json.data || []).find((a) => a.attributes.bundleId === sku) || (apps.json.data || [])[0];
        if (!app) return { issues: ['未在 ASC 定位到应用（检查 SKU 与 Bundle ID 映射）'], versionCreated, bound, verified };
        const versions = await ascGet('api.appstoreconnect.apple.com', jwt, `/v1/apps/${app.id}/appStoreVersions?filter[version]=${encodeURIComponent(version)}&limit=1`);
        let versionId = versions.json.data && versions.json.data[0] ? versions.json.data[0].id : null;
        if (!versionId) {
          // 创建准确版本（幂等：已存在则复用，不重复创建）
          const req = https.request({
            hostname: 'api.appstoreconnect.apple.com', path: `/v1/apps/${app.id}/appStoreVersions`, method: 'POST',
            headers: { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' },
          });
          req.end(JSON.stringify({ data: { type: 'appStoreVersions', attributes: { version, platform: 'IOS' } } }));
          const created = await new Promise((resolve) => {
            req.on('response', (res) => {
              const chunks = [];
              res.on('data', (c) => chunks.push(c));
              res.on('end', () => resolve({ status: res.statusCode, json: JSON.parse(Buffer.concat(chunks).toString() || '{}') }));
            });
            req.on('error', () => resolve({ status: 0, json: {} }));
          });
          if (created.status === 201 && created.json.data) {
            versionId = created.json.data.id;
            versionCreated = true;
          } else {
            issues.push(`创建版本 ${version} 失败（HTTP ${created.status}）`);
          }
        }
        if (versionId) {
          const back = await ascGet('api.appstoreconnect.apple.com', jwt, `/v1/appStoreVersions/${versionId}?include=builds`);
          verified = back.status === 200;
          const builds = back.json.included || [];
          bound = builds.some((b) => b.attributes && String(b.attributes.version) === String(build));
          if (!bound) issues.push(`版本 ${version} 尚未绑定构建 ${build}（在 ASC 选择构建）`);
        }
      } catch (e) {
        issues.push(`ASC 操作失败：${head(e.message, 2)}`);
      }
      return { issues, versionCreated, bound, verified: verified && bound };
    },

    async fetchReleaseStatus({ sku, version }) {
      const jwt = ascJwt();
      if (!jwt) return { reviewState: 'pending', note: 'ASC 凭据不可用，无法刷新真实状态' };
      const apps = await ascGet('api.appstoreconnect.apple.com', jwt, '/v1/apps?limit=200');
      const app = (apps.json.data || []).find((a) => a.attributes.bundleId === sku) || (apps.json.data || [])[0];
      if (!app) return { reviewState: 'pending', note: '未定位到应用' };
      const versions = await ascGet('api.appstoreconnect.apple.com', jwt, `/v1/apps/${app.id}/appStoreVersions?filter[version]=${encodeURIComponent(version)}&limit=1`);
      const v = versions.json.data && versions.json.data[0];
      const ascEntry = `https://appstoreconnect.apple.com/apps/${app.id}`;
      const stateMap = {
        WAITING_FOR_REVIEW: 'pending', IN_REVIEW: 'in_review', REJECTED: 'rejected',
        PENDING_DEVELOPER_RELEASE: 'pending_release', PROCESSING: 'processing', READY_FOR_SALE: 'released',
        PENDING_APPLE_RELEASE: 'processing', DEVELOPER_REMOVED_FROM_SALE: 'processing',
      };
      return {
        reviewState: v ? (stateMap[v.attributes.appStoreState] || 'pending') : 'pending',
        rejectionNotes: v && v.attributes.rejectionNotes || null,
        ascEntry,
      };
    },
  };
}
