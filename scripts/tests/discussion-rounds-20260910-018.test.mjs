#!/usr/bin/env node
// REQ-20260910-018 讨论逐轮持久化、文档资产展示与跨会话续聊 —— 数据层 / 服务 / CLI / 前端测试
// 覆盖 test-cases.md 的 R1~R8、H1、C1~C2、U1~U6（宽窄屏双形态与深浅色为人工浏览器实测）。
// 用法：node scripts/tests/discussion-rounds-20260910-018.test.mjs

import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import * as core from '../lib/core.mjs';
import * as oncall from '../lib/oncall-store.mjs';

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const webRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'web');
const oncallJs = fs.readFileSync(path.join(webRoot, 'oncall.js'), 'utf8');

const cases = [];
const t = (name, fn) => cases.push([name, fn]);

function mkProject() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'atb-disc-rounds-')));
  core.initData(root);
  const dataDir = core.dataDirFrom(root);
  return { root, dataDir };
}

const roundsDirOf = (dataDir, id) => path.join(oncall.ticketDir(dataDir, id), 'rounds');

/* ================= 数据层（R1~R8） ================= */

t('R1 统一入口追加轮次：r0001 起逐轮递增、字段齐全、追加不覆盖旧轮', () => {
  const { dataDir } = mkProject();
  const d = oncall.createDiscussion(dataDir, { title: '逐轮记录', background: '背景', by: 'board' });
  const r1 = oncall.appendDiscussionRound(dataDir, d.id, {
    user: '第一个问题', summary: '观点A；理由B；取舍C；未决D', session: 's-1', key: 'k1',
  });
  assert.equal(r1.no, 1);
  assert.equal(r1.roundId, 'R0001');
  assert.ok(r1.at, '轮次应带时间');
  assert.equal(r1.duplicate, false, '首次追加不是重复');
  const file1 = path.join(roundsDirOf(dataDir, d.id), 'r0001.json');
  assert.ok(fs.existsSync(file1), '应落盘 rounds/r0001.json');
  const raw1 = JSON.parse(fs.readFileSync(file1, 'utf8'));
  assert.equal(raw1.discussionId, d.id, '轮文件带讨论归属');
  assert.equal(raw1.user, '第一个问题', '用户原文保存');
  assert.equal(raw1.summary, '观点A；理由B；取舍C；未决D', '回复总结保存');
  assert.equal(raw1.session, 's-1', '来源会话保存');
  assert.equal(raw1.key, 'k1', '幂等键保存');

  const r2 = oncall.appendDiscussionRound(dataDir, d.id, { user: '补充', summary: '总结二', session: 's-2' });
  assert.equal(r2.no, 2);
  assert.equal(r2.roundId, 'R0002');
  assert.ok(fs.existsSync(path.join(roundsDirOf(dataDir, d.id), 'r0002.json')));
  assert.equal(JSON.parse(fs.readFileSync(file1, 'utf8')).user, '第一个问题', '旧轮不被覆盖');
});

t('R2 归属与字段校验：讨论不存在/编号非法/字段缺失均明确拒绝', () => {
  const { dataDir } = mkProject();
  assert.throws(() => oncall.appendDiscussionRound(dataDir, 'ASK-20990101-999', { user: 'u', summary: 's' }), /找不到|不存在|未找到|非法/, '讨论不存在应拒绝');
  assert.throws(() => oncall.appendDiscussionRound(dataDir, 'bad-id', { user: 'u', summary: 's' }), /非法/, '非法编号应拒绝');
  const d = oncall.createDiscussion(dataDir, { title: 't', by: 'board' });
  assert.throws(() => oncall.appendDiscussionRound(dataDir, d.id, { user: '  ', summary: 's' }), /用户原文|user/, '缺用户原文应拒绝');
  assert.throws(() => oncall.appendDiscussionRound(dataDir, d.id, { user: 'u', summary: '' }), /总结|summary/, '缺回复总结应拒绝');
  assert.equal(fs.existsSync(roundsDirOf(dataDir, d.id)) ? fs.readdirSync(roundsDirOf(dataDir, d.id)).length : 0, 0, '失败不产生轮次文件');
});

t('R3 同轮重试幂等：同 key 返回既有轮不新增文件；无 key 不去重', () => {
  const { dataDir } = mkProject();
  const d = oncall.createDiscussion(dataDir, { title: 't', by: 'board' });
  const a = oncall.appendDiscussionRound(dataDir, d.id, { user: 'u1', summary: 's1', session: 's', key: 'retry-key' });
  const b = oncall.appendDiscussionRound(dataDir, d.id, { user: 'u1', summary: 's1', session: 's', key: 'retry-key' });
  assert.equal(b.duplicate, true, '同 key 重试应标记 duplicate');
  assert.equal(b.no, a.no, '同 key 重试返回既有轮次');
  assert.equal(b.roundId, a.roundId);
  assert.equal(fs.readdirSync(roundsDirOf(dataDir, d.id)).filter((f) => f.endsWith('.json')).length, 1, '不新增轮次文件');
  // 无 key：两次追加就是两轮（不去重，由调用方保证幂等键）
  oncall.appendDiscussionRound(dataDir, d.id, { user: 'u2', summary: 's2' });
  oncall.appendDiscussionRound(dataDir, d.id, { user: 'u2', summary: 's2' });
  assert.equal(oncall.listDiscussionRounds(dataDir, d.id).length, 3);
});

t('R4 并发追加不覆盖与读侧容错：撞号自动递增；非法/异讨论文件跳过', () => {
  const { dataDir } = mkProject();
  const d = oncall.createDiscussion(dataDir, { title: 't', by: 'board' });
  const dir = roundsDirOf(dataDir, d.id);
  fs.mkdirSync(dir, { recursive: true });
  // 预置空洞：最大 no=3，下一轮应取 4（撞号场景由 wx 独占写保护，这里验证取号接续）
  fs.writeFileSync(path.join(dir, 'r0001.json'), JSON.stringify({ discussionId: d.id, no: 1, roundId: 'R0001', at: '2026-09-10T01:00:00.000Z', user: 'u1', summary: 's1' }));
  fs.writeFileSync(path.join(dir, 'r0003.json'), JSON.stringify({ discussionId: d.id, no: 3, roundId: 'R0003', at: '2026-09-10T03:00:00.000Z', user: 'u3', summary: 's3' }));
  const r = oncall.appendDiscussionRound(dataDir, d.id, { user: 'u4', summary: 's4' });
  assert.equal(r.no, 4, '编号接续最大值 +1');
  // 非法 JSON 与异讨论文件：读侧跳过（不串讨论、不展示半成品）
  fs.writeFileSync(path.join(dir, 'r0005.json'), 'not-json');
  fs.writeFileSync(path.join(dir, 'r0006.json'), JSON.stringify({ discussionId: 'ASK-20990101-999', no: 6, roundId: 'R0006', at: 'x', user: '串', summary: '串' }));
  const rounds = oncall.listDiscussionRounds(dataDir, d.id);
  assert.deepEqual(rounds.map((x) => x.no), [1, 3, 4], '非法与异讨论文件不进入列表');
  assert.ok(rounds.every((x) => x.discussionId === d.id));
});

t('R5 纪要版本校验：成功递增版本；baseVersion 过期冲突；旧纪要按版本 0；缺 baseVersion 拒绝', () => {
  const { dataDir } = mkProject();
  const d = oncall.createDiscussion(dataDir, { title: 't', by: 'board' });
  const dir = oncall.ticketDir(dataDir, d.id);
  // 旧发布协议写的纪要（无 meta）→ 版本 0，首次整理可覆盖
  fs.writeFileSync(path.join(dir, 'minutes.md'), '# 旧纪要');
  const m0 = oncall.readDiscussionMinutes(dataDir, d.id);
  assert.equal(m0.version, 0, '无 meta 按版本 0');
  assert.equal(m0.content, '# 旧纪要', '纪要内容可读');

  assert.throws(() => oncall.saveDiscussionMinutes(dataDir, d.id, { minutes: 'x' }), /baseVersion|版本/, '缺 baseVersion 应拒绝');

  const s1 = oncall.saveDiscussionMinutes(dataDir, d.id, { minutes: '# 新纪要 v1', baseVersion: 0 });
  assert.equal(s1.version, 1);
  assert.equal(fs.readFileSync(path.join(dir, 'minutes.md'), 'utf8'), '# 新纪要 v1', '纪要原子更新');
  // 过期 baseVersion（他人已更新）→ 冲突，提示重读
  assert.throws(() => oncall.saveDiscussionMinutes(dataDir, d.id, { minutes: '# 并发写', baseVersion: 0 }), /冲突|重新读取/, '版本冲突应明确报错');
  assert.equal(fs.readFileSync(path.join(dir, 'minutes.md'), 'utf8'), '# 新纪要 v1', '冲突写不生效');
  const s2 = oncall.saveDiscussionMinutes(dataDir, d.id, { minutes: '# 新纪要 v2', baseVersion: 1 });
  assert.equal(s2.version, 2);
  assert.equal(oncall.readDiscussionMinutes(dataDir, d.id).version, 2);
  // 归属校验
  assert.throws(() => oncall.saveDiscussionMinutes(dataDir, 'ASK-20990101-999', { minutes: 'x', baseVersion: 0 }), /找不到|不存在|未找到|非法/);
});

t('R6 卡片与全量：roundCount/lastRoundAt/lastSummary/minutesStale；legacyRoundCount 分离；phase=recording；full 含 rounds 与 minutes', () => {
  const { dataDir } = mkProject();
  const d = oncall.createDiscussion(dataDir, { title: 't', by: 'board' });
  let card = oncall.listDiscussions(dataDir).find((c) => c.id === d.id);
  assert.equal(card.roundCount, 0, '新讨论零轮次');
  assert.equal(card.lastRoundAt, null);
  assert.equal(card.lastSummary, null);
  assert.equal(card.phase, 'none', '无轮次未发布 → 外部会话中');

  const at1 = '2026-09-10T01:00:00.000Z';
  const dir = roundsDirOf(dataDir, d.id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'r0001.json'), JSON.stringify({ discussionId: d.id, no: 1, roundId: 'R0001', at: at1, user: 'u1', summary: '总结一', session: 's1' }));
  fs.writeFileSync(path.join(dir, 'r0002.json'), JSON.stringify({ discussionId: d.id, no: 2, roundId: 'R0002', at: '2026-09-10T02:00:00.000Z', user: 'u2', summary: '最新总结', session: 's2' }));

  card = oncall.listDiscussions(dataDir).find((c) => c.id === d.id);
  assert.equal(card.roundCount, 2, '已保存轮数');
  assert.equal(card.lastRoundAt, '2026-09-10T02:00:00.000Z', '最近轮时间');
  assert.equal(card.lastSummary, '最新总结', '最新回复摘要');
  assert.equal(card.phase, 'recording', '已存轮次未发布 → 逐轮记录中');
  assert.equal(card.minutesStale, true, '纪要落后于最新轮');

  const full = oncall.discussionFull(dataDir, d.id);
  assert.deepEqual(full.rounds.map((r) => [r.no, r.roundId, r.user, r.summary]), [[1, 'R0001', 'u1', '总结一'], [2, 'R0002', 'u2', '最新总结']], '轮次按时间升序');
  assert.equal(full.minutes.stale, true, 'full.minutes.stale');
  assert.ok('version' in full.minutes && 'content' in full.minutes, '纪要带版本与内容');

  // 纪要追上最新轮后不再待更新
  oncall.saveDiscussionMinutes(dataDir, d.id, { minutes: '# 已整理', baseVersion: 0 });
  card = oncall.listDiscussions(dataDir).find((c) => c.id === d.id);
  assert.equal(card.minutesStale, false, '纪要更新到最新后不再提示待更新');

  // 旧问答计数迁移 legacyRoundCount（旧单 rounds 字段不冒充逐轮记录）
  const old = oncall.createTicket(dataDir, { title: '旧单', question: 'q', by: 'board' });
  oncall.dispatchTickets(dataDir, { ids: [old.id], mode: 'zcode', staff: '', by: 'board', kind: 'batch' });
  oncall.answerTicket(dataDir, old.id, { answer: '旧回答', by: 's', mode: 'zcode' });
  const oldCard = oncall.listDiscussions(dataDir).find((c) => c.id === old.id);
  assert.equal(oldCard.legacyRoundCount, 1, '旧问答计数保留');
  assert.equal(oldCard.roundCount, 0, '旧单不算逐轮记录（不伪造）');
  assert.equal(oncall.discussionFull(dataDir, old.id).rounds.length, 0);
  assert.equal(oncall.discussionFull(dataDir, old.id).legacyRounds.length, 1, '旧问答仍可展示');
});

t('R7 提示词：启动（逐轮保存）/ 继续讨论 / 整理结论 内容契约', () => {
  const { root, dataDir } = mkProject();
  const d = oncall.createDiscussion(dataDir, { title: '提示词主题', background: '背景X', by: 'board' });
  const dir = oncall.ticketDir(dataDir, d.id);
  const sp = oncall.buildStartPrompt(dataDir, d.id);
  for (const want of [
    d.id, root, '背景X',
    path.join(dir, 'rounds'),            // 文档位置：轮次目录
    path.join(dir, 'minutes.md'),        // 文档位置：纪要
    'atb.mjs" disc round',               // 统一追加入口命令
    'atb.mjs" disc minutes',             // 纪要更新入口命令
    'key',                               // 幂等重试约定
  ]) {
    assert.ok(sp.includes(want), `启动提示词应包含 ${want}`);
  }
  assert.ok(!sp.includes('只在收到收尾提示词'), '启动提示词不得再以收尾提示词为落盘前提');
  assert.ok(sp.includes('每轮') || sp.includes('逐轮'), '应说明逐轮保存规则');

  const cp = oncall.buildContinuePrompt(dataDir, d.id);
  for (const want of [d.id, root, path.join(dir, 'rounds'), '纪要', '继续', 'atb.mjs" disc round']) {
    assert.ok(cp.includes(want), `继续讨论提示词应包含 ${want}`);
  }
  assert.ok(cp.includes(d.id) && cp.includes('轮次'), '续聊应说明轮次接续同一讨论');

  const op = oncall.buildOrganizePrompt(dataDir, d.id);
  for (const want of [d.id, path.join(dir, 'minutes.md'), path.join(dir, 'candidates.json'), path.join(dir, 'PUBLISH.json'), 'atb.mjs" disc minutes', '不终止讨论']) {
    assert.ok(op.includes(want), `整理结论提示词应包含 ${want}`);
  }
});

t('R8 兼容：发布成果照常读取；requestFinish 仍可用（UI 无入口）', () => {
  const { dataDir } = mkProject();
  const d = oncall.createDiscussion(dataDir, { title: 't', by: 'board' });
  oncall.appendDiscussionRound(dataDir, d.id, { user: 'u', summary: 's' });
  const dir = oncall.ticketDir(dataDir, d.id);
  oncall.saveDiscussionMinutes(dataDir, d.id, { minutes: '# 纪要\n\n- 共识：A', baseVersion: 0 });
  fs.writeFileSync(path.join(dir, 'candidates.json'), JSON.stringify({ discussionId: d.id, items: [{ id: 'c1', type: 'requirement', title: '候选', description: 'd' }] }));
  fs.writeFileSync(path.join(dir, 'PUBLISH.json'), JSON.stringify({ discussionId: d.id, publishedAt: '2026-09-10T00:00:00.000Z' }));
  const out = oncall.readOutcome(dataDir, d.id);
  assert.equal(out.state, 'published', '发布协议照常');
  const full = oncall.discussionFull(dataDir, d.id);
  assert.equal(full.draftCount, 1, '候选草稿照常');
  assert.equal(full.phase, 'drafts', '发布后阶段回到候选口径');
  assert.equal(full.rounds.length, 1, '逐轮记录与发布成果共存');
  // requestFinish 兼容保留
  oncall.requestFinish(dataDir, d.id, { by: 'board' });
  assert.ok(oncall.getTicket(dataDir, d.id).finishPromptAt, 'finish 兼容仍记录');
  assert.equal(oncall.getTicket(dataDir, d.id).status, 'discussing');
});

/* ================= 服务接口（H1） ================= */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function httpReq(port, method, pathname, body) {
  return new Promise((resolve, reject) => {
    const payload = body == null ? null : JSON.stringify(body);
    const r = (async () => {
      const { default: http } = await import('node:http');
      return http.request({
        hostname: '127.0.0.1', port, path: pathname, method,
        headers: payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {},
        timeout: 6000,
      }, (rs) => {
        const chunks = [];
        rs.on('data', (c) => chunks.push(c));
        rs.on('end', () => {
          let json = null;
          try { json = JSON.parse(Buffer.concat(chunks).toString() || '{}'); } catch {}
          resolve({ status: rs.statusCode, json });
        });
      });
    })();
    r.then((req) => {
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
      if (payload) req.write(payload);
      req.end();
    }, reject);
  });
}

t('H1 服务接口：board 卡片与详情携带逐轮字段；创建即返回新字段', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'atb-disc-rounds-serve-'));
  const root = path.join(tmp, 'proj');
  fs.mkdirSync(root);
  await new Promise((resolve) => {
    const p = spawn(process.execPath, [path.join(pluginRoot, 'scripts', 'atb.mjs'), 'init', '--dir', root], { stdio: 'ignore' });
    p.on('close', resolve);
  });
  const dataDir = path.join(root, 'docs', 'agent-team-board');
  const port = 31000 + Math.floor(Math.random() * 20000);
  const server = spawn(process.execPath, [path.join(pluginRoot, 'scripts', 'server.mjs')], {
    cwd: root,
    env: { ...process.env, ATB_PORT: String(port), ATB_REGISTRY: path.join(tmp, 'reg.json') },
    stdio: ['ignore', 'ignore', 'ignore'],
  });
  const P = `?project=${encodeURIComponent(root)}`;
  try {
    let up = false;
    for (let i = 0; i < 40; i++) {
      await sleep(150);
      try { await httpReq(port, 'GET', '/api/health'); up = true; break; } catch {}
    }
    assert.ok(up, '服务应启动');

    let r = await httpReq(port, 'POST', `/api/discussion${P}`, { title: '逐轮讨论', background: 'b' });
    assert.equal(r.status, 200);
    const id = r.json.discussion.id;
    assert.equal(r.json.discussion.roundCount, 0, '创建即带轮数字段');
    assert.ok(Array.isArray(r.json.discussion.rounds));
    assert.ok(r.json.discussion.continuePrompt.includes(id), '创建即带继续讨论提示词');
    assert.ok(r.json.discussion.organizePrompt.includes(id), '创建即带整理结论提示词');

    // 经统一入口（store 直调等价 CLI）落两轮 + 更新纪要
    oncall.appendDiscussionRound(dataDir, id, { user: '问一', summary: '总结一', session: 's1', key: 'k1' });
    oncall.appendDiscussionRound(dataDir, id, { user: '问二', summary: '总结二', session: 's2' });
    oncall.saveDiscussionMinutes(dataDir, id, { minutes: '# 纪要v1', baseVersion: 0 });

    r = await httpReq(port, 'GET', `/api/discussion/board${P}`);
    const card = r.json.discussions.find((c) => c.id === id);
    assert.equal(card.roundCount, 2, '卡片轮数');
    assert.equal(card.lastSummary, '总结二', '卡片最新摘要');
    assert.equal(card.phase, 'recording', '逐轮记录中');

    r = await httpReq(port, 'GET', `/api/discussion/${id}${P}`);
    const d = r.json.discussion;
    assert.equal(d.rounds.length, 2);
    assert.equal(d.rounds[0].user, '问一');
    assert.equal(d.rounds[1].roundId, 'R0002');
    assert.equal(d.minutes.content, '# 纪要v1', '详情纪要内容');
    assert.equal(d.minutes.version, 1, '详情纪要版本');
    assert.equal(d.minutes.stale, false, '纪要已更新到最新轮');
  } finally {
    server.kill('SIGKILL');
  }
});

/* ================= CLI（C1~C2） ================= */

function runCli(args, { input = null } = {}) {
  const r = spawnSync(process.execPath, [path.join(pluginRoot, 'scripts', 'atb.mjs'), ...args], {
    input,
    encoding: 'utf8',
    timeout: 30000,
  });
  return { status: r.status, out: `${r.stdout || ''}${r.stderr || ''}` };
}

t('C1 atb disc round：文件写入成功、--json 输出、同 key 重试不重复、失败原因明确', () => {
  const { root, dataDir } = mkProject();
  const d = oncall.createDiscussion(dataDir, { title: 'CLI', by: 'board' });
  const roundFile = path.join(root, 'round-a.json');
  fs.writeFileSync(roundFile, JSON.stringify({ user: '用户原文\n多行', summary: '回复总结', session: 'cli-sess', key: 'cli-key-1' }));

  let r = runCli(['disc', 'round', d.id, '--file', roundFile, '--dir', root, '--json']);
  assert.equal(r.status, 0, `应成功：${r.out}`);
  const parsed = JSON.parse(r.out.slice(r.out.indexOf('{')));
  assert.equal(parsed.no, 1);
  assert.equal(parsed.roundId, 'R0001');
  assert.ok(fs.existsSync(path.join(roundsDirOf(dataDir, d.id), 'r0001.json')), '轮次落盘');

  // 同 key 重试（模拟回执丢失后重试）
  r = runCli(['disc', 'round', d.id, '--file', roundFile, '--dir', root, '--json']);
  assert.equal(r.status, 0);
  assert.equal(JSON.parse(r.out.slice(r.out.indexOf('{'))).duplicate, true, '同 key 重试标记 duplicate');
  assert.equal(fs.readdirSync(roundsDirOf(dataDir, d.id)).length, 1, '不产生重复轮');

  // 归属不符
  r = runCli(['disc', 'round', 'ASK-20990101-999', '--file', roundFile, '--dir', root]);
  assert.notEqual(r.status, 0, '归属不符应非零退出');
  assert.match(r.out, /找不到|不存在|未找到|非法/);

  // 字段缺失
  const badFile = path.join(root, 'round-bad.json');
  fs.writeFileSync(badFile, JSON.stringify({ summary: '缺用户原文' }));
  r = runCli(['disc', 'round', d.id, '--file', badFile, '--dir', root]);
  assert.notEqual(r.status, 0);
  assert.match(r.out, /用户原文|user/);

  // 文件不可访问
  r = runCli(['disc', 'round', d.id, '--file', path.join(root, 'nope.json'), '--dir', root]);
  assert.notEqual(r.status, 0);
  assert.match(r.out, /不存在|无法|读取/);
});

t('C2 atb disc minutes / show：版本更新、冲突非零退出、show 输出纪要与轮次', () => {
  const { root, dataDir } = mkProject();
  const d = oncall.createDiscussion(dataDir, { title: 'CLI2', by: 'board' });
  const roundFile = path.join(root, 'r.json');
  fs.writeFileSync(roundFile, JSON.stringify({ user: '问', summary: '答总结' }));
  assert.equal(runCli(['disc', 'round', d.id, '--file', roundFile, '--dir', root]).status, 0);

  const mdFile = path.join(root, 'minutes.md');
  fs.writeFileSync(mdFile, '# 纪要 v1\n\n- 共识：X');
  let r = runCli(['disc', 'minutes', d.id, '--file', mdFile, '--base-version', '0', '--dir', root]);
  assert.equal(r.status, 0, `纪要更新应成功：${r.out}`);
  assert.match(r.out, /版本/, '输出新版本');

  // 过期 baseVersion → 冲突非零退出
  r = runCli(['disc', 'minutes', d.id, '--file', mdFile, '--base-version', '0', '--dir', root]);
  assert.notEqual(r.status, 0, '版本冲突应非零退出');
  assert.match(r.out, /冲突|重新读取/);

  // show：背景 + 纪要版本 + 轮次
  r = runCli(['disc', 'show', d.id, '--dir', root, '--json']);
  assert.equal(r.status, 0);
  const show = JSON.parse(r.out.slice(r.out.indexOf('{')));
  assert.equal(show.minutes.version, 1);
  assert.equal(show.rounds.length, 1);
  assert.equal(show.rounds[0].summary, '答总结');
  assert.equal(show.background, '');

  // 归属不符
  r = runCli(['disc', 'show', 'ASK-20990101-999', '--dir', root]);
  assert.notEqual(r.status, 0);
});

/* ================= 前端（U1~U6） ================= */

function fnSrc(name) {
  const m = oncallJs.match(new RegExp(`^[ \\t]*(?:async )?function ${name}\\([\\s\\S]*?^  \\}`, 'm'));
  assert.ok(m, `应存在 ${name} 函数`);
  return m[0];
}

function element() {
  const nodes = new Map();
  const classes = new Set();
  return {
    nodes, dataset: {}, innerHTML: '', textContent: '', value: '', title: '', disabled: false, checked: false, hidden: false,
    children: [], listeners: {},
    classList: { add: (v) => classes.add(v), remove: (v) => classes.delete(v), contains: (v) => classes.has(v), toggle: (v, on) => on ? classes.add(v) : classes.delete(v) },
    addEventListener(event, fn) { this.listeners[event] = fn; },
    querySelector(sel) { if (!nodes.has(sel)) nodes.set(sel, element()); return nodes.get(sel); },
    querySelectorAll() { return []; },
    appendChild(c) { this.children.push(c); },
    replaceChildren(...c) { this.children = c; },
    setAttribute() {}, removeAttribute() {}, focus() {}, select() {}, remove() {}, scrollIntoView() {},
    closest() { return null; },
    get scrollTop() { return 0; }, set scrollTop(v) {},
  };
}

function setup({ board, detail }) {
  const document = element();
  document.createElement = element;
  document.body = element();
  document.querySelector = (sel) => document.nodes.get(sel) ?? null;
  document.nodes.set('#oncallView', element());
  document.nodes.set('#ocList', element());
  document.nodes.set('#ocDetail', element());
  document.nodes.set('#discMask', element());
  document.nodes.set('#oncallLightbox', element());
  document.addEventListener = () => {};
  const sandbox = {
    document, console, URLSearchParams, CustomEvent: class { constructor(type, o) { this.type = type; this.detail = o && o.detail; } },
    dispatchEvent: () => {},
    setTimeout: () => 0, clearTimeout() {},
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    marked: { parse: (s) => String(s || '') },
    fetch: async (url) => {
      if (String(url).includes('/api/discussion/board')) return { ok: true, json: async () => board };
      if (detail && String(url).includes('/api/discussion/')) return { ok: true, json: async () => ({ discussion: detail }) };
      return { ok: true, json: async () => ({}) };
    },
    navigator: { clipboard: { writeText: async () => {} } },
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(oncallJs, sandbox, { filename: 'oncall.js' });
  return sandbox;
}

const discDetail = (id, over = {}) => ({
  id, title: `t-${id}`, status: 'discussing', createdAt: '2026-09-10T00:00:00.000Z', updatedAt: '2026-09-10T01:00:00.000Z',
  phase: 'recording', waiting: false, draftCount: 0, createdCount: 0,
  roundCount: 2, lastRoundAt: '2026-09-10T01:30:00.000Z', legacyRoundCount: 0,
  background: '讨论背景', startPrompt: 'SP', continuePrompt: 'CP', organizePrompt: 'OP',
  minutes: { content: '# 纪要', version: 1, updatedAt: '2026-09-10T01:00:00.000Z', stale: true },
  rounds: [
    { no: 1, roundId: 'R0001', at: '2026-09-10T01:10:00.000Z', user: '用户原文一', summary: '总结一', session: 's1' },
    { no: 2, roundId: 'R0002', at: '2026-09-10T01:30:00.000Z', user: '用户原文二', summary: '总结二', session: 's2' },
  ],
  outcome: { state: 'waiting', minutes: null }, candidates: [], created: [], legacyRounds: [], ...over,
});

const discCard = (id, over = {}) => ({
  id, title: `t-${id}`, status: 'discussing', createdAt: '2026-09-10T00:00:00.000Z', updatedAt: '2026-09-10T01:00:00.000Z',
  phase: 'recording', waiting: false, draftCount: 0, createdCount: 0,
  roundCount: 2, lastRoundAt: '2026-09-10T01:30:00.000Z', lastSummary: '最新回复摘要', legacyRoundCount: 0, ...over,
});

t('U1 页签结构：三页签 讨论纪要/交流记录/后续行动；默认讨论纪要；旧 tab 值回落默认', () => {
  const m = oncallJs.match(/const DISC_TABS = \[[^\]]*\]/);
  assert.ok(m, '应存在 DISC_TABS 常量');
  assert.match(m[0], /key: 'minutes'/);
  assert.match(m[0], /key: 'rounds'/);
  assert.match(m[0], /key: 'actions'/);
  assert.match(m[0], /讨论纪要/);
  assert.match(m[0], /交流记录/);
  assert.match(m[0], /后续行动/);
  assert.doesNotMatch(m[0], /overview|prompt|drafts/, '不再有概况/提示词/成果页签');
  assert.match(oncallJs, /DISC_DEFAULT_TAB = 'minutes'/, '默认页签为讨论纪要');
  const dto = fnSrc('discTabOf');
  assert.match(dto, /DISC_TABS\.some/, '无效页签回落默认');
});

t('U2 头部操作区与提示词块：启动提示词/复制继续讨论提示词/整理结论/归档；「讨论完毕」移除；无提示词页签', () => {
  const rd = fnSrc('renderDetail');
  for (const word of ['启动提示词', '复制继续讨论提示词', '整理结论']) {
    assert.match(rd, new RegExp(word), `操作区应有「${word}」`);
  }
  assert.match(oncallJs, /归档讨论|继续讨论/, '归档/继续讨论操作保留');
  assert.ok(!rd.includes('讨论完毕'), '「讨论完毕」不再出现在详情操作区（改为整理结论）');
  assert.ok(!rd.includes('data-pane="prompt"'), '不再有提示词页签');
  assert.ok(!rd.includes('data-pane="overview"'), '不再有概况页签');
  // 提示词块在页签行之下（drawer-body 内）、通知条之前/之后均可，但必须常驻 drawer-body 顶部区域
  const bodyPos = rd.indexOf('<div class="drawer-body">');
  const promptPos = rd.indexOf('promptHtml(');
  const firstPane = rd.indexOf('data-pane="minutes"');
  assert.ok(bodyPos >= 0 && promptPos > bodyPos && promptPos < firstPane, '提示词块应在 drawer-body 内、分区之前');
  assert.match(fnSrc('promptHtml'), /ocPromptText/, '提示词块沿用只读 textarea');
  assert.match(oncallJs, /navigator\.clipboard\.writeText/, '剪贴板优先');
  assert.match(oncallJs, /execCommand\('copy'\)/, 'execCommand 回退保留');
  // 整理结论展示整理提示词（kind 区分），不终止讨论
  assert.match(oncallJs, /kind: 'organize'/, '整理结论应展示整理提示词');
  assert.match(fnSrc('promptHtml'), /整理结论|整理提示词/, '整理提示词条幅');
  // 复制继续讨论提示词：直接复制 continuePrompt 并反馈
  const cp = oncallJs.match(/#ocCopyContinue'\)\?\.addEventListener\('click'[\s\S]*?\}\);/);
  assert.ok(cp, '应有复制继续讨论提示词按钮处理');
  assert.match(cp[0], /continuePrompt/, '复制内容为继续讨论提示词');
});

t('U3 交流记录页签：升序渲染原文/总结/时间/轮次/来源会话；空态引导；旧单不补造', async () => {
  const rd = fnSrc('renderDetail');
  assert.match(rd, /data-pane="rounds"/, '应有交流记录分区');
  const rh = `${fnSrc('roundsHtml')}${fnSrc('roundHtml')}`;
  assert.match(rh, /r\.user|\.user/, '渲染用户原文');
  assert.match(rh, /r\.summary|\.summary/, '渲染回复总结');
  assert.match(rh, /roundId|r\.no/, '渲染轮次标识');
  assert.match(rh, /session/, '渲染来源会话');
  assert.match(rh, /fmtTime/, '渲染时间');
  assert.match(rh, /details/, '历史可折叠');
  // 行为：详情渲染轮次内容
  const h = setup({ board: { initialized: true, discussions: [discCard('ASK-20990910-001')] }, detail: discDetail('ASK-20990910-001') });
  await h.ATBOncall.poll('/p', true);
  h.ATBOncall.openItem('ASK-20990910-001');
  await new Promise((r) => setTimeout(r, 20));
  const html = h.document.querySelector('#ocDetail').innerHTML;
  assert.match(html, /用户原文一/, '交流记录含用户原文');
  assert.match(html, /总结二/, '交流记录含回复总结');
  assert.match(html, /R0001/, '交流记录含轮次标识');
  // 空态：无轮次
  const h2 = setup({ board: { initialized: true, discussions: [discCard('ASK-20990910-002', { roundCount: 0, phase: 'none' })] }, detail: discDetail('ASK-20990910-002', { rounds: [], roundCount: 0, phase: 'none', legacyRounds: [{ no: 1, question: '旧问', answer: '旧答' }] }) });
  await h2.ATBOncall.poll('/p', true);
  h2.ATBOncall.openItem('ASK-20990910-002');
  await new Promise((r) => setTimeout(r, 20));
  const html2 = h2.document.querySelector('#ocDetail').innerHTML;
  assert.match(html2, /尚无已保存交流|尚无逐轮/, '空态说明尚无已保存交流');
  assert.match(html2, /历史问答/, '旧单历史问答保留展示');
  assert.doesNotMatch(html2, /R0001/, '旧单不伪造逐轮记录');
});

t('U4 纪要页签：背景+最新纪要渲染；纪要待更新徽标；失败重试入口保留', async () => {
  const mh = fnSrc('minutesHtml');
  assert.match(mh, /讨论背景/, '纪要页签含背景');
  assert.match(mh, /minutes/, '渲染最新纪要');
  const h = setup({ board: { initialized: true, discussions: [discCard('ASK-20990910-001')] }, detail: discDetail('ASK-20990910-001') });
  await h.ATBOncall.poll('/p', true);
  h.ATBOncall.openItem('ASK-20990910-001');
  await new Promise((r) => setTimeout(r, 20));
  const html = h.document.querySelector('#ocDetail').innerHTML;
  assert.match(html, /纪要待更新/, '纪要落后时显示待更新徽标');
  assert.match(html, /讨论背景/, '纪要页签含背景');
  assert.match(oncallJs, /ocReread/, '读取失败重试入口保留');
});

t('U5 列表卡片：已保存轮数与最新回复摘要；阶段提示逐轮记录中', async () => {
  const rl = fnSrc('renderList');
  assert.match(rl, /roundCount/, '卡片显示已保存轮数');
  assert.match(rl, /lastSummary/, '卡片显示最新回复摘要');
  const h = setup({ board: { initialized: true, discussions: [discCard('ASK-20990910-001')] } });
  await h.ATBOncall.poll('/p', true);
  const rows = [h.document.querySelector('#ocList').innerHTML, ...(h.document.querySelector('#ocList').children || []).map((c) => c.innerHTML || '')].join('\n');
  assert.match(rows, /2 轮|轮数 2|已保存 2/, '卡片轮数展示');
  assert.match(rows, /最新回复摘要/, '卡片最新摘要展示');
  const hint = oncallJs.match(/recording: '([^']+)'/);
  assert.ok(hint && hint[1].includes('记录'), '阶段提示含逐轮记录中');
});

t('U6 后续行动页签：沿用候选草稿与已创建成果（draftsHtml 迁移），零候选正常空态', () => {
  const rd = fnSrc('renderDetail');
  assert.match(rd, /data-pane="actions"/, '应有后续行动分区');
  assert.match(rd, /id="ocPane"/, '#ocPane 保留（bindDrafts 兼容）');
  assert.match(rd, /draftsHtml\(d, createdIds\)/, '后续行动渲染 draftsHtml');
  const dh = fnSrc('draftsHtml');
  assert.match(dh, /id="ocCreate"/, '批量创建按钮保留');
  assert.match(dh, /data-retry/, '失败重试保留');
  assert.match(dh, /没有候选条目|零候选/, '零候选正常空态');
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
