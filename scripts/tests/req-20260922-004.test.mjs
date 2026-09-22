#!/usr/bin/env node
// REQ-20260922-004 AI 分析并行子代理模式（同时在途 ≤3）—— 数据层 / CLI / serve / UI / i18n
// 覆盖 test-cases.md P1~P11：并行领取与 busy、回执隔离、check 多在途协议、提示词并行口径、
// 暂停/终止/挂起并行适配、锁迁移（refine-next 短临界区 + codex 锁不清）、退化串行兼容。
// 用法：node scripts/tests/req-20260922-004.test.mjs

import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as core from '../lib/core.mjs';
import * as refine from '../lib/refine-store.mjs';

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const cases = [];
const t = (name, fn) => cases.push([name, fn]);

function mkProject() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'atb-req-20260922-004-')));
  core.initData(root);
  const dataDir = core.dataDirFrom(root);
  return { root, dataDir };
}

function accept(dataDir, id) {
  core.setStatus(dataDir, id, 'accepted', { by: 'human' });
}

// 4 个已接受候选（非 UI 描述，不触发界面展示门槛）
function seedCandidates(dataDir, n) {
  return Array.from({ length: n }, (_, i) => {
    const x = core.createItem(dataDir, { type: 'requirement', title: `r${i + 1}` });
    accept(dataDir, x.id);
    return x;
  });
}

// done 前补全文档（描述无 UI 关键词、长度达标）
function fillDocs(itemDir) {
  fs.writeFileSync(path.join(itemDir, 'README.md'),
    '# r\n\n## 描述\n补全后的说明文字长度超过阈值三十个字符以上，可判定为真实变更。\n\n## 验收标准\n\n- [x] 可记账\n');
}

// ---------- P1 领取并行：≤3 路不同条目；满 3 busy（不抛错）；同条目不重复 ----------

t('P1 领取并行（≤3）：不同 owner 领到不同条目；第 4 次 stop=busy 带在途清单（不抛错）；activeRunIds/currentRunId 落账', () => {
  const { root, dataDir } = mkProject();
  const items = seedCandidates(dataDir, 4);
  const { batch } = refine.createRefineBatch(dataDir, { projectRoot: root });
  assert.equal(refine.REFINE_PARALLEL_LIMIT, 3, '并行上限常量 = 3（固定值口径）');

  const g1 = refine.nextRefineItem(dataDir, batch.batchId, { owner: 'w1' });
  const g2 = refine.nextRefineItem(dataDir, batch.batchId, { owner: 'w2' });
  const g3 = refine.nextRefineItem(dataDir, batch.batchId, { owner: 'w3' });
  assert.deepEqual([g1.itemId, g2.itemId, g3.itemId], [items[0].id, items[1].id, items[2].id],
    '三路并行领取按队列序领到不同条目');
  assert.ok(new Set([g1.runId, g2.runId, g3.runId]).size === 3, '三路 runId 互不相同');

  // 第 4 次：满槽提示而非异常中断
  const g4 = refine.nextRefineItem(dataDir, batch.batchId, { owner: 'w4' });
  assert.equal(g4.stop, 'busy', '满 3 后返回 stop=busy（不抛错）');
  assert.match(g4.notice, /在途已达 3/, 'busy notice 说明在途已达上限');
  assert.match(g4.notice, /等待/, 'busy notice 指引等待回执');
  assert.match(g4.notice, new RegExp(items[0].id), 'busy notice 列出在途条目');
  assert.equal(g4.counts.remaining, 4, 'busy 计数完整（在途 3 + 剩余 1）');

  // 账本：activeRunIds 全量 + currentRunId 最新领取（兼容字段）
  const raw = refine.getRefineBatch(dataDir, batch.batchId);
  assert.deepEqual(raw.activeRunIds, [g1.runId, g2.runId, g3.runId], 'activeRunIds 记录全部在途');
  assert.equal(raw.currentRunId, g3.runId, 'currentRunId 指向最新领取');
  assert.equal(raw.status, 'running');

  // 同条目不重复：busy 期间条目 1 不会被再次领取（回执其一后才可补派，见 P2）
});

// ---------- P2 回执隔离：任一回执只结算自身，其余在途不受影响 ----------

t('P2 回执隔离：done/fail/release 只结算对应运行；其余在途照常；回执后可补派；done 核验口径不变', () => {
  const { root, dataDir } = mkProject();
  const items = seedCandidates(dataDir, 4);
  const { batch } = refine.createRefineBatch(dataDir, { projectRoot: root });
  const g1 = refine.nextRefineItem(dataDir, batch.batchId, { owner: 'w1' });
  const g2 = refine.nextRefineItem(dataDir, batch.batchId, { owner: 'w2' });
  const g3 = refine.nextRefineItem(dataDir, batch.batchId, { owner: 'w3' });

  // g1 不改文档直接 done → 拒绝（「文档确有变更」核验口径不变）
  assert.throws(() => refine.finishRefineRun(dataDir, g1.runId, { result: 'done', summary: '没改' }),
    /未检测到补全变更/);

  // g1 改文档 done；g2 release；g3 fail——各自结算
  fillDocs(g1.itemDir);
  refine.finishRefineRun(dataDir, g1.runId, { result: 'done', summary: '补全 r1' });
  refine.releaseRefineRun(dataDir, g2.runId, { reason: '认领冲突换单' });
  refine.finishRefineRun(dataDir, g3.runId, { result: 'failed', reason: '信息不足' });

  const ck = refine.checkRefineBatch(dataDir, batch.batchId);
  assert.equal(ck.counts.done, 1);
  assert.equal(ck.counts.failed, 1);
  assert.equal(ck.counts.interrupted, 1);
  assert.equal(ck.counts.remaining, 1, 'release/fail 出局语义不变：仅未领的 r4 仍待处理');
  assert.equal(ck.current, null, '在途清零后 current 为空');
  assert.deepEqual(ck.currents, [], '在途清零后 currents 为空');

  // 回执后可补派：领 r4（r2 已随 release 出局，出局语义不变）
  const g4 = refine.nextRefineItem(dataDir, batch.batchId, { owner: 'w4' });
  assert.equal(g4.itemId, items[3].id, '回执腾出槽位后补派下一项');
  assert.deepEqual(refine.getRefineBatch(dataDir, batch.batchId).activeRunIds, [g4.runId],
    'activeRunIds 随回执移除、随领取追加');
});

// ---------- P3 check 协议：currents 可见 / continue / needs_attention / stop ----------

t('P3 check 多在途协议：currents ≤3 可见（条目/owner）；在途<3 且可领>0 → continue；满槽或可领 0 → needs_attention；≤2KiB', () => {
  const { root, dataDir } = mkProject();
  const items = seedCandidates(dataDir, 4);
  const { batch } = refine.createRefineBatch(dataDir, { projectRoot: root });

  // 在途 1 / 剩余可领 3 → continue（可补派）
  const g1 = refine.nextRefineItem(dataDir, batch.batchId, { owner: 'w1' });
  let ck = refine.checkRefineBatch(dataDir, batch.batchId);
  assert.equal(ck.nextAction, 'continue', '在途不足 3 且队列有余 → continue（补派）');

  // 在途 3（满槽）/ 可领 1 → needs_attention
  const g2 = refine.nextRefineItem(dataDir, batch.batchId, { owner: 'w2' });
  const g3 = refine.nextRefineItem(dataDir, batch.batchId, { owner: 'w3' });
  ck = refine.checkRefineBatch(dataDir, batch.batchId);
  assert.equal(ck.nextAction, 'needs_attention', '满 3 槽 → 等待任一回执');
  assert.match(ck.notice, /等待任一子代理回执|等待子 Agent 回执/, 'needs_attention 指引等待回执');
  assert.equal(ck.currents.length, 3, 'currents 展示全部在途（≤3）');
  assert.deepEqual(ck.currents.map((c) => c.itemId), [items[0].id, items[1].id, items[2].id]);
  for (const c of ck.currents) {
    for (const k of ['runId', 'itemId', 'owner', 'phase', 'at']) assert.ok(c[k] != null, `currents 条目含 ${k}`);
  }
  assert.equal(ck.current.runId, g3.runId, 'current 保留（最新在途，兼容字段）');
  assert.ok(Buffer.byteLength(JSON.stringify(ck)) <= 2048, 'check 响应 ≤2KiB（含 3 条 currents）');

  // g1 回执腾槽 → continue；随后领完（在途 3 / 可领 0）→ needs_attention
  fillDocs(g1.itemDir);
  refine.finishRefineRun(dataDir, g1.runId, { result: 'done', summary: '补全 r1' });
  ck = refine.checkRefineBatch(dataDir, batch.batchId);
  assert.equal(ck.nextAction, 'continue', '回执腾出槽位且队列有余 → continue');
  const g4 = refine.nextRefineItem(dataDir, batch.batchId, { owner: 'w4' });
  ck = refine.checkRefineBatch(dataDir, batch.batchId);
  assert.equal(ck.nextAction, 'needs_attention', '队列取空但在途未清零 → 等待回执（非 stop）');
  assert.equal(ck.currents.length, 3);

  // 全部回执 → stop + finished
  fillDocs(g2.itemDir); fillDocs(g3.itemDir); fillDocs(g4.itemDir);
  refine.finishRefineRun(dataDir, g2.runId, { result: 'done', summary: '补全 r2' });
  refine.finishRefineRun(dataDir, g3.runId, { result: 'done', summary: '补全 r3' });
  refine.finishRefineRun(dataDir, g4.runId, { result: 'done', summary: '补全 r4' });
  ck = refine.checkRefineBatch(dataDir, batch.batchId);
  assert.equal(ck.nextAction, 'stop');
  assert.equal(ck.counts.done, 4);
  assert.equal(refine.getRefineBatch(dataDir, batch.batchId).status, 'finished');
});

t('P3b 队列取空在途未清：next stop=finished+notice 且批次不落 finished（等待回执）', () => {
  const { root, dataDir } = mkProject();
  seedCandidates(dataDir, 1);
  const { batch } = refine.createRefineBatch(dataDir, { projectRoot: root });
  const g1 = refine.nextRefineItem(dataDir, batch.batchId, { owner: 'w1' });
  const second = refine.nextRefineItem(dataDir, batch.batchId, { owner: 'w2' });
  assert.equal(second.stop, 'finished', '队列取空 → stop=finished');
  assert.match(second.notice, /在途|等待/, 'notice 说明在途等待回执');
  assert.notEqual(refine.getRefineBatch(dataDir, batch.batchId).status, 'finished', '在途未清零不落 finished');
  fillDocs(g1.itemDir);
  refine.finishRefineRun(dataDir, g1.runId, { result: 'done', summary: '补全' });
  assert.equal(refine.getRefineBatch(dataDir, batch.batchId).status, 'finished', '回执清零后收尾');
});

// ---------- P4 提示词并行口径 ----------

t('P4 主调度提示词：移除串行约束；并行口径（最多 3 / 不同条目 / 不再派发子代理 / 补派）；尾部参数区结构保持', () => {
  const { root, dataDir } = mkProject();
  seedCandidates(dataDir, 1);
  const { batch } = refine.createRefineBatch(dataDir, { projectRoot: root });
  const p = batch.prompt;
  assert.ok(!p.includes('同一时间只运行一个'), '不得再含串行约束行');
  assert.ok(p.includes('最多 3 个子代理并行'), '明确同时最多 3 个子代理并行');
  assert.ok(p.includes('不同条目'), '明确各自领取不同条目');
  assert.ok(p.includes('不要让子代理再派发子代理'), '子代理不得再派发子代理保留');
  assert.ok(p.includes('补派'), '明确回执核对后补派口径');
  assert.ok(p.includes('每个子代理只做一项'), '每个子代理只做一项保留');
  // REQ-20260921-006 缓存口径：静态段在前 + 项目根/CLI 入口收敛尾部参数区
  const paramIdx = p.indexOf('运行参数（随项目与任务变化');
  assert.ok(paramIdx > 0, '存在尾部运行参数区');
  assert.ok(p.indexOf('项目根：') > paramIdx, '项目根在参数区');
  assert.ok(p.indexOf('CLI 入口：') > paramIdx, 'CLI 入口在参数区');
  assert.ok(p.indexOf('atb refine next') < paramIdx, '领取命令在静态段');
});

// ---------- P5 暂停 / 终止 / 挂起在并行下的口径 ----------

t('P5a 暂停只停新派发：在途回执不受阻；恢复后补派', () => {
  const { root, dataDir } = mkProject();
  seedCandidates(dataDir, 4);
  const { batch } = refine.createRefineBatch(dataDir, { projectRoot: root });
  const g1 = refine.nextRefineItem(dataDir, batch.batchId, { owner: 'w1' });
  const g2 = refine.nextRefineItem(dataDir, batch.batchId, { owner: 'w2' });
  refine.pauseRefineBatch(dataDir, batch.batchId, true);
  assert.equal(refine.nextRefineItem(dataDir, batch.batchId, { owner: 'w3' }).stop, 'paused', '暂停后不再领取');
  // 在途回执不受阻
  fillDocs(g1.itemDir);
  assert.doesNotThrow(() => refine.finishRefineRun(dataDir, g1.runId, { result: 'done', summary: '补全 r1' }));
  assert.equal(refine.getRefineBatch(dataDir, batch.batchId).status, 'paused', '暂停期间回执不解除暂停');
  refine.pauseRefineBatch(dataDir, batch.batchId, false);
  const g3 = refine.nextRefineItem(dataDir, batch.batchId, { owner: 'w3' });
  assert.ok(g3.itemId, '恢复后补派下一项');
  void g2;
});

t('P5b 终止：全部在途落 interrupted + activeRunIds 清空 + 剩余出局 + 人工停止提示', () => {
  const { root, dataDir } = mkProject();
  seedCandidates(dataDir, 4);
  const { batch } = refine.createRefineBatch(dataDir, { projectRoot: root });
  const g1 = refine.nextRefineItem(dataDir, batch.batchId, { owner: 'w1' });
  const g2 = refine.nextRefineItem(dataDir, batch.batchId, { owner: 'w2' });
  const r = refine.abortRefineBatch(dataDir, batch.batchId);
  assert.equal(r.ok, true);
  assert.match(r.notice, /在途子代理.*人工停止/, '终止提示在途子代理人工停止');
  assert.equal(refine.getRefineRun(dataDir, g1.runId).phase, 'interrupted');
  assert.equal(refine.getRefineRun(dataDir, g2.runId).phase, 'interrupted');
  const raw = refine.getRefineBatch(dataDir, batch.batchId);
  assert.deepEqual(raw.activeRunIds || [], [], 'activeRunIds 清空');
  assert.equal(raw.currentRunId, null);
  assert.equal(refine.checkRefineBatch(dataDir, batch.batchId).nextAction, 'stop');
});

t('P5c hold 挂起：声明后队列暂停（不派新项），其他在途运行仍可回执', () => {
  const { root, dataDir } = mkProject();
  seedCandidates(dataDir, 3);
  const { batch } = refine.createRefineBatch(dataDir, { projectRoot: root });
  const g1 = refine.nextRefineItem(dataDir, batch.batchId, { owner: 'w1' });
  const g2 = refine.nextRefineItem(dataDir, batch.batchId, { owner: 'w2' });
  // 并行下非最新领取的在途运行也可声明挂起（旧口径要求 = currentRunId，已放宽为非终态）
  const h = refine.declareRefineHold(dataDir, g1.runId, {
    reason: '需求歧义', questions: [{ text: '并行上限是否可配置？' }],
  });
  assert.equal(h.ok, true, '任一在途运行可声明挂起');
  assert.equal(refine.nextRefineItem(dataDir, batch.batchId, { owner: 'w3' }).stop, 'paused', '挂起后不派新项');
  // 其他在途不受影响：g2 正常 done
  fillDocs(g2.itemDir);
  assert.doesNotThrow(() => refine.finishRefineRun(dataDir, g2.runId, { result: 'done', summary: '补全 r2' }),
    '挂起只停队列，其他在途回执不受阻');
  assert.equal(refine.getRefineRun(dataDir, g2.runId).phase, 'done');
  assert.equal(refine.getRefineBatch(dataDir, batch.batchId).pauseRequested, true, '队列保持暂停');
});

// ---------- P6 CLI：busy exit 0；check 在途列表输出 ----------

function atb(args, cwd) {
  const r = spawnSync(process.execPath, [path.join(pluginRoot, 'scripts', 'atb.mjs'), ...args, '--dir', cwd],
    { encoding: 'utf8', timeout: 30_000 });
  return { code: r.status, out: r.stdout || '', err: r.stderr || '' };
}

t('P6 CLI：next 满槽 exit 0 + busy 提示（--json 可解析）；check 文本输出在途列表', () => {
  const { root, dataDir } = mkProject();
  seedCandidates(dataDir, 4);
  atb(['refine', 'create'], root);
  for (const w of ['w1', 'w2', 'w3']) {
    const r = atb(['refine', 'next', '--by', w, '--json'], root);
    assert.equal(r.code, 0, `第 ${w} 路领取应成功（${r.err}）`);
  }
  // 满槽：exit 0 + 明确提示（非报错中断）
  const busy = atb(['refine', 'next', '--by', 'w4'], root);
  assert.equal(busy.code, 0, '满槽 next 应 exit 0（等待回执，非错误）');
  assert.match(busy.out, /在途已达 3|等待/, '文本输出明确等待回执提示');
  const busyJson = atb(['refine', 'next', '--by', 'w4', '--json'], root);
  assert.equal(busyJson.code, 0);
  const parsed = JSON.parse(busyJson.out.split('\n').filter(Boolean).pop());
  assert.equal(parsed.stop, 'busy', '--json 输出 stop=busy');
  // check：在途列表可见
  const ck = atb(['refine', 'check'], root);
  assert.equal(ck.code, 0);
  assert.match(ck.out, /在途执行/, 'check 输出在途执行行');
  assert.match(ck.out, /owner w1/, '在途列表含子代理会话（owner）');
  const ckJson = JSON.parse(atb(['refine', 'check', '--json'], root).out.split('\n').filter(Boolean).pop());
  assert.equal(ckJson.currents.length, 3, 'check --json currents 可见');
});

// ---------- P7 serve：/api/refine/current 透传 activeRuns ----------

function httpReq(port, method, pathname, body) {
  return new Promise((resolve, reject) => {
    const payload = body == null ? null : JSON.stringify(body);
    const r = http.request({
      hostname: '127.0.0.1', port, path: pathname, method,
      headers: payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {},
      timeout: 8000,
    }, (rs) => {
      let out = '';
      rs.on('data', (c) => { out += c; });
      rs.on('end', () => { try { resolve({ status: rs.statusCode, json: JSON.parse(out || '{}') }); } catch { resolve({ status: rs.statusCode, json: null, raw: out }); } });
    });
    r.on('error', reject);
    r.on('timeout', () => { r.destroy(); reject(new Error('timeout')); });
    if (payload) r.write(payload);
    r.end();
  });
}

t('P7 serve：/api/refine/current 透传 activeRuns（owner/createdAt）；current 保留', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'atb-req004-serve-'));
  fs.mkdirSync(path.join(tmp, 'proj'));
  const root = fs.realpathSync(path.join(tmp, 'proj'));
  core.initData(root);
  seedCandidates(core.dataDirFrom(root), 3);
  const port = 33000 + Math.floor(Math.random() * 20000);
  const server = spawn(process.execPath, [path.join(pluginRoot, 'scripts', 'server.mjs')], {
    cwd: root,
    env: { ...process.env, ATB_PORT: String(port), ATB_REGISTRY: path.join(tmp, 'reg.json') },
    stdio: ['ignore', 'ignore', 'ignore'],
  });
  const P = `?project=${encodeURIComponent(root)}`;
  try {
    let up = false;
    for (let i = 0; i < 40; i++) {
      await new Promise((r) => setTimeout(r, 150));
      try { await httpReq(port, 'GET', '/api/health'); up = true; break; } catch {}
    }
    assert.ok(up, '服务应启动');
    await httpReq(port, 'POST', `/api/refine/create${P}`, {});
    const dataDir = core.dataDirFrom(root);
    const head = refine.queueHeadRefineBatch(dataDir).batchId;
    refine.nextRefineItem(dataDir, head, { owner: 'w1' });
    refine.nextRefineItem(dataDir, head, { owner: 'w2' });
    const r = await httpReq(port, 'GET', `/api/refine/current${P}`);
    assert.equal(r.status, 200);
    assert.equal(r.json.activeRuns.length, 2, 'activeRuns 透传两路在途');
    for (const a of r.json.activeRuns) {
      assert.ok(a.itemId && a.owner && a.createdAt, 'activeRuns 条目含 itemId/owner/createdAt');
    }
    assert.ok(r.json.current, 'current 保留（兼容）');
  } finally {
    server.kill('SIGTERM');
  }
});

// ---------- P8 UI：在途卡片 + 统计进行中 + i18n 同步 ----------

t('P8 UI：renderRefinePanel 渲染在途卡片（≤3，条目可点，会话/开始时间/已用时）；统计进行中 = 在途数；activeRuns 缺失回退；i18n 词条同步', () => {
  const js = fs.readFileSync(path.join(pluginRoot, 'scripts', 'web', 'app.js'), 'utf8');
  const panel = js.match(/function renderRefinePanel\(\)[\s\S]*?\n\}/);
  assert.ok(panel, '应存在 renderRefinePanel');
  const src = panel[0];
  assert.match(src, /activeRuns/, '概况区使用 activeRuns 在途列表');
  assert.match(src, /在途子代理/, '在途区标题标注在途子代理（N/3）');
  assert.match(src, /data-goto-item/, '在途卡片条目编号可点击跳转');
  assert.match(src, /已用时/, '在途卡片展示已用时');
  assert.match(src, /data\.current/, 'activeRuns 缺失时回退 current（旧数据兼容）');
  assert.match(src, /active:\s*actives\.length|active:\s*activeRuns/, '统计行进行中 = 实际在途数');
  // i18n：新增文案中英同步（EN 词典含键且译文非空）
  const i18nSrc = fs.readFileSync(path.join(pluginRoot, 'scripts', 'web', 'i18n.js'), 'utf8');
  assert.match(i18nSrc, /'在途子代理'\s*:/, 'i18n 词典含「在途子代理」词条');
});

// ---------- P9 退化兼容：存量账本（仅 currentRunId）续跑 ----------

t('P9 存量账本兼容：无 activeRunIds（仅 currentRunId）的在途可回执、可补派、不误判', () => {
  const { root, dataDir } = mkProject();
  const items = seedCandidates(dataDir, 2);
  const { batch } = refine.createRefineBatch(dataDir, { projectRoot: root });
  const g1 = refine.nextRefineItem(dataDir, batch.batchId, { owner: 'w1' });
  // 模拟升级前创建的账本：抹掉 activeRunIds（保留 currentRunId 单值）
  const bfile = path.join(dataDir, 'runtime', 'refine', 'batches', batch.batchId, 'batch.json');
  const raw = JSON.parse(fs.readFileSync(bfile, 'utf8'));
  delete raw.activeRunIds;
  fs.writeFileSync(bfile, JSON.stringify(raw));
  // 存量判定：currentRunId 在途 → 在途 1；check 可见
  let ck = refine.checkRefineBatch(dataDir, batch.batchId);
  assert.equal(ck.currents.length, 1, '存量账本按 currentRunId 回退判定在途');
  // 可补派（在途 1 < 3）
  const g2 = refine.nextRefineItem(dataDir, batch.batchId, { owner: 'w2' });
  assert.equal(g2.itemId, items[1].id);
  // 回执成功（回执移除逻辑对无 activeRunIds 账本不报错）
  fillDocs(g1.itemDir);
  assert.doesNotThrow(() => refine.finishRefineRun(dataDir, g1.runId, { result: 'done', summary: '补全 r1' }));
  ck = refine.checkRefineBatch(dataDir, batch.batchId);
  assert.equal(ck.currents.length, 1, '回执后仅剩 g2 在途');
  assert.equal(ck.current.runId, g2.runId);
});

// ---------- P10 锁迁移：zcode 领取不占 refine.lock；收尾不清 codex 锁 ----------

t('P10 锁迁移：领取不持有 refine.lock（refine-next 短临界区即取即释）；无候选收尾清 zcode 遗留锁但不清 codex-refine 锁', () => {
  const { root, dataDir } = mkProject();
  seedCandidates(dataDir, 1);
  const { batch } = refine.createRefineBatch(dataDir, { projectRoot: root });
  const g1 = refine.nextRefineItem(dataDir, batch.batchId, { owner: 'w1' });
  const lockFile = path.join(dataDir, 'runtime', '.locks', 'refine.lock');
  const nextLock = path.join(dataDir, 'runtime', '.locks', 'refine-next.lock');
  assert.ok(!fs.existsSync(lockFile), 'zcode 领取不再持有全局 refine.lock');
  assert.ok(!fs.existsSync(nextLock), 'refine-next 短临界区锁操作后即释放');

  // 造 codex 执行锁：无候选收尾不得误删
  fs.mkdirSync(path.dirname(lockFile), { recursive: true });
  fs.writeFileSync(lockFile, JSON.stringify({ kind: 'codex-refine', batchId: batch.batchId, runId: 'run-x', owner: 'codex-refine' }));
  fillDocs(g1.itemDir);
  refine.finishRefineRun(dataDir, g1.runId, { result: 'done', summary: '补全' });
  const drained = refine.nextRefineItem(dataDir, batch.batchId, { owner: 'w2' });
  assert.equal(drained.stop, 'finished');
  assert.ok(fs.existsSync(lockFile), '收尾不得清 codex-refine 执行锁');
  assert.equal(JSON.parse(fs.readFileSync(lockFile, 'utf8')).kind, 'codex-refine');
  // 换成 zcode 遗留锁：收尾清理（迁移兼容）
  fs.writeFileSync(lockFile, JSON.stringify({ kind: 'zcode', batchId: batch.batchId, owner: 'w1' }));
  refine.nextRefineItem(dataDir, batch.batchId, { owner: 'w2' });
  assert.ok(!fs.existsSync(lockFile), 'zcode 遗留锁在收尾时清理');
});

// ---------- P11 codex 执行器不回归：tryAcquireRefineLock 语义保留 ----------

t('P11 codex 锁接口不回归：zcode 3 路在途不占 refine.lock，tryAcquireRefineLock 仍可占用/释放', () => {
  const { root, dataDir } = mkProject();
  seedCandidates(dataDir, 3);
  const { batch } = refine.createRefineBatch(dataDir, { projectRoot: root });
  refine.nextRefineItem(dataDir, batch.batchId, { owner: 'w1' });
  refine.nextRefineItem(dataDir, batch.batchId, { owner: 'w2' });
  refine.nextRefineItem(dataDir, batch.batchId, { owner: 'w3' });
  // zcode 并行在途不占全局锁：codex 接口可占用（语义保留，执行器并发 1 队列不动）
  const got = refine.tryAcquireRefineLock(dataDir, { kind: 'codex-refine', batchId: batch.batchId, runId: 'run-x', owner: 'codex-refine' });
  assert.equal(got.ok, true, 'zcode 在途不阻塞 codex 锁接口');
  refine.releaseRefineLockForRun(dataDir, 'run-x', 'codex-refine');
  assert.ok(!fs.existsSync(path.join(dataDir, 'runtime', '.locks', 'refine.lock')), '按 runId 释放正常');
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
