#!/usr/bin/env node
// REQ-20260910-022 project-growth 工作流 —— 数据层测试（G1~G16）
// 覆盖：五类入口任务创建与输入引用版本、提示词契约（项目归属 / 资料路径 / 保存协议 / 兜底）、
// 回执写入与幂等、过期输入拒绝与重建、跨项目写入拒绝、草稿校验（数据不足不带候选）、
// 候选编辑 / 显式采纳（定价不自动生效、定位入假设证据、渠道 / 实验 / 行动 / 复盘落地）、
// 保留草稿与完成态、接续任务引用、空项目兜底、读态与损坏占位。
// 用法：node scripts/tests/marketing-growth-store.test.mjs

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as core from '../lib/core.mjs';
import * as mkt from '../lib/marketing-store.mjs';
import * as growth from '../lib/growth-store.mjs';

const ATB = '/plug/scripts/atb.mjs';

const cases = [];
const t = (name, fn) => cases.push([name, fn]);

function mkProject(withProfile = true) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'atb-growth-store-')));
  core.initData(root);
  fs.writeFileSync(path.join(root, 'README.md'), '# Demo\n\n增长工作流测试项目。\n');
  const dataDir = core.dataDirFrom(root);
  if (withProfile) mkt.initProfile(dataDir, { projectRoot: root, by: 'board' });
  return { root, dataDir };
}

function seedPricing(dataDir) {
  return mkt.savePricing(dataDir, {
    data: {
      model: 'subscription', currency: 'CNY', cycle: 'monthly',
      packages: [{ name: '标准', benefits: '全功能', price: 29 }],
      costBasis: '', competitorBasis: '', validationMethod: '',
    },
    by: 'board',
  }).version;
}
function seedChannel(dataDir, platform = 'X') {
  return mkt.createChannel(dataDir, {
    data: {
      platform, link: '', audience: '', languages: '', formats: '',
      priority: 'medium', reason: '', weeklyEffort: null, dataAccess: '', capabilities: '',
    },
    by: 'board',
  }).channel;
}
function seedExperiment(dataDir, channelId = null) {
  return mkt.createExperiment(dataDir, {
    data: {
      channelId, hypothesis: '社区帖带来订阅', primaryMetric: '订阅新增',
      observationStart: '', observationEnd: '', successCriteria: '订阅新增 ≥ 3',
      currency: '', budgetPlanned: null, budgetActual: null, hoursPlanned: null, hoursActual: null,
      pricingVersion: null, decision: null, decisionBasis: '',
    },
    by: 'board',
  }).experiment;
}
function seedObservation(dataDir, over = {}) {
  return mkt.recordObservation(dataDir, {
    data: {
      metricKey: 'activations', dateStart: '2026-09-01', dateEnd: '2026-09-07',
      value: 12, channelId: null, experimentId: null, source: '手工记录', timezone: 'UTC+8', unit: '', ...over,
    },
    by: 'board',
  }).observation;
}

const draftBase = (over = {}) => ({
  facts: ['激活 12 人（metrics 观察）'],
  assumptions: ['首屏转化是主要瓶颈'],
  toConfirm: ['目标价位接受度'],
  evidence: ['metrics/observations（09-01~09-07）', 'profile.json'],
  missing: ['访客分母未录入'],
  advice: [],
  insufficient: false,
  candidates: [],
  ...over,
});

t('G1 五类入口创建任务：输入引用及版本来自当前档案；状态 waiting；提示词留档', () => {
  const { root, dataDir } = mkProject();
  seedPricing(dataDir); // v1
  const ch = seedChannel(dataDir);
  const exp = seedExperiment(dataDir, ch.id);
  seedObservation(dataDir);

  const mk = (type, extra = {}) => growth.createAgentRun(dataDir, {
    projectRoot: root, atbPath: ATB, type, ...extra, by: 'board',
  });

  const pos = mk('positioning');
  assert.match(pos.run.id, /^ar-/, '任务 ID 前缀');
  assert.equal(pos.run.type, 'positioning');
  assert.equal(pos.run.status, 'waiting', '复制提示词后等待回执');
  const refs = (r) => r.run.inputs.map((i) => `${i.ref}${i.revision == null ? '' : `@r${i.revision}`}`);
  assert.deepEqual(refs(pos).sort(), ['README.md', 'profile.json@r1'].sort(), '定位输入=档案+README');
  assert.ok(pos.run.prompt.includes('project-growth'), '提示词留档');

  const pr = mk('pricing');
  assert.deepEqual(refs(pr).sort(), ['pricing/v1.json', 'profile.json@r1'].sort(), '定价输入=档案+不可变版本（无版本要求）');

  const chR = mk('channels');
  assert.ok(refs(chR).includes('profile.json@r1') && refs(chR).includes(`channels/${ch.id}.json@r1`) && refs(chR).includes(`experiments/${exp.id}.json@r1`), '渠道计划输入含实体及版本');

  const ct = mk('content');
  assert.ok(refs(ct).includes(`experiments/${exp.id}.json@r1`), '内容输入含实验');

  const rv = mk('review', { observation: { from: '2026-09-01', to: '2026-09-07' } });
  const obs = mkt.readEffect(dataDir, {}).observations[0];
  assert.ok(refs(rv).includes(`metrics/observations/${obs.id}.json@r1`), '复盘输入含观察期内的观察及修订号');
  assert.equal(rv.run.observation.from, '2026-09-01');

  // 位置：agent-runs/<id>/run.json 落盘
  assert.ok(fs.existsSync(path.join(dataDir, 'marketing', 'agent-runs', pos.run.id, 'run.json')), '任务记录落盘');
});

t('G2 提示词契约：项目归属 / 资料路径 / 输入版本 / 目标 / 输出要求 / 保存协议 / 技能缺失兜底', () => {
  const { root, dataDir } = mkProject();
  const { run, prompt } = growth.createAgentRun(dataDir, {
    projectRoot: root, atbPath: ATB, type: 'pricing', by: 'board',
  });
  assert.ok(prompt.includes(root), '包含项目路径（限定该项目）');
  assert.ok(prompt.includes(path.join('docs', 'agent-team-board', 'marketing')), '包含营销资料目录');
  assert.ok(prompt.includes('profile.json'), '包含输入引用');
  assert.ok(prompt.includes('保存协议'), '包含保存协议');
  assert.ok(prompt.includes(`${ATB} growth receipt ${run.id}`), '包含统一 CLI 写回命令');
  assert.ok(prompt.includes('--dir'), 'CLI 命令绑定项目根');
  assert.ok(prompt.includes('事实 / 假设 / 待确认') || prompt.includes('事实/假设/待确认'), '输出要求区分事实与假设');
  assert.ok(prompt.includes('不得写成已生效') || prompt.includes('不自动'), '候选不自动生效约束');
  assert.ok(prompt.includes('未经外部 skill'), '技能缺失兜底声明（不假称已运行外部 skill）');
  assert.ok(!prompt.includes('skill 调用：可按需调用'), '不得出现「已安装可调用」式表述（未安装即兜底）');

  const rv = growth.createAgentRun(dataDir, {
    projectRoot: root, atbPath: ATB, type: 'review',
    observation: { from: '2026-09-01', to: '2026-09-07' }, by: 'board',
  });
  assert.ok(rv.prompt.includes('2026-09-01') && rv.prompt.includes('2026-09-07'), '复盘提示词含观察期');
  assert.ok(rv.prompt.includes('数据不足') && rv.prompt.includes('不生成虚构'), '无数据须输出数据不足与补采建议');
});

t('G3 回执写入：状态 received、记录会话 / 时间 / 摘要，草稿落盘（run.json + draft.md），结果入日志', () => {
  const { root, dataDir } = mkProject();
  const { run } = growth.createAgentRun(dataDir, { projectRoot: root, atbPath: ATB, type: 'pricing', by: 'board' });
  const r = growth.saveAgentRunReceipt(dataDir, {
    id: run.id,
    draft: draftBase({
      candidates: [{
        id: 'c1', kind: 'pricing', title: '候选定价 v2：订阅 ¥19/月',
        reason: '贴近访谈心理价位', verify: '半流量 A/B 观察付费转化', adoptTo: 'pricing/v2.json',
        data: {
          model: 'subscription', currency: 'CNY', cycle: 'monthly',
          packages: [{ name: '标准', benefits: '全功能', price: 19 }], costBasis: '', competitorBasis: '', validationMethod: 'A/B',
        },
      }],
    }),
    session: 'ext-session-a', by: 'board',
  });
  assert.equal(r.duplicate, false);
  const got = r.run;
  assert.equal(got.status, 'received', '草稿待处理');
  assert.equal(got.session, 'ext-session-a', '来源会话');
  assert.ok(got.receiptAt, '回执时间');
  assert.match(got.summary, /1 条事实.*候选 1 项/, '输出摘要');
  assert.equal(got.draftRef, `agent-runs/${run.id}/draft.md`, '草稿引用');
  assert.ok(fs.existsSync(path.join(dataDir, 'marketing', 'agent-runs', run.id, 'draft.md')), 'draft.md 落盘');
  assert.equal(got.receipts.at(-1).result, 'success', '执行结果入回执日志');
  const md = fs.readFileSync(path.join(dataDir, 'marketing', 'agent-runs', run.id, 'draft.md'), 'utf8');
  assert.ok(md.includes('事实') && md.includes('假设') && md.includes('候选行动'), 'draft.md 分区渲染');
  assert.ok(md.includes('候选定价 v2'), 'draft.md 含候选');
});

t('G4 幂等：相同任务重复回执跳过，不重复保存、时间戳不变；内容不同仅标记不覆盖', () => {
  const { root, dataDir } = mkProject();
  const { run } = growth.createAgentRun(dataDir, { projectRoot: root, atbPath: ATB, type: 'positioning', by: 'board' });
  const r1 = growth.saveAgentRunReceipt(dataDir, { id: run.id, draft: draftBase(), session: 's1', by: 'board' });
  const before = fs.readFileSync(path.join(dataDir, 'marketing', 'agent-runs', run.id, 'run.json'), 'utf8');
  const r2 = growth.saveAgentRunReceipt(dataDir, {
    id: run.id, draft: draftBase({ facts: ['完全不同的内容'] }), session: 's2', by: 'board',
  });
  assert.equal(r2.duplicate, true, '幂等跳过');
  assert.equal(r2.contentChanged, true, '内容不同仅标记');
  assert.equal(r2.run.session, 's1', '不覆盖首次会话');
  const after = fs.readFileSync(path.join(dataDir, 'marketing', 'agent-runs', run.id, 'run.json'), 'utf8');
  assert.equal(after, before, '记录文件未被重复保存改写');
});

t('G5 过期输入：档案并发更新后回执拒绝（不写草稿不覆盖）；重建任务输入更新', () => {
  const { root, dataDir } = mkProject();
  const { run } = growth.createAgentRun(dataDir, { projectRoot: root, atbPath: ATB, type: 'positioning', by: 'board' });
  // 并发修改：档案 revision 1 → 2
  const st = mkt.readState(dataDir);
  mkt.saveProfile(dataDir, {
    revision: st.profile.revision, positioning: st.profile.positioning, evidence: st.profile.evidence, by: 'board',
  });
  assert.throws(() => growth.saveAgentRunReceipt(dataDir, { id: run.id, draft: draftBase(), session: 's', by: 'board' }),
    /过期|stale/, '回执被拒绝');
  assert.ok(!fs.existsSync(path.join(dataDir, 'marketing', 'agent-runs', run.id, 'draft.md')), '未写入草稿');
  const fresh = growth.readAgentRun(dataDir, run.id);
  assert.equal(fresh.status, 'waiting', '任务保持等待，可按当前版本重建');
  assert.equal(fresh.receipts.at(-1).result, 'rejected:stale', '拒绝原因入日志');
  assert.match(fresh.receipts.at(-1).reason, /profile\.json/);

  const rb = growth.createAgentRun(dataDir, { projectRoot: root, atbPath: ATB, type: 'positioning', by: 'board' });
  assert.ok(rb.run.inputs.find((i) => i.ref === 'profile.json').revision === 2, '重建任务输入引用已更新');

  // 观察修订同样触发过期（review 输入含观察修订号）
  const { root: r2, dataDir: d2 } = mkProject();
  seedObservation(d2);
  const rv = growth.createAgentRun(d2, {
    projectRoot: r2, atbPath: ATB, type: 'review', observation: { from: '2026-09-01', to: '2026-09-07' }, by: 'board',
  });
  seedObservation(d2, { value: 13, reason: '重新统计' });
  assert.throws(() => growth.saveAgentRunReceipt(d2, { id: rv.run.id, draft: draftBase(), session: 's', by: 'board' }),
    /过期/, '观察修订后回执拒绝');
});

t('G6 跨项目写入：任务 ID 在本项目不存在 → 拒绝', () => {
  const { root, dataDir } = mkProject();
  const { run } = growth.createAgentRun(dataDir, { projectRoot: root, atbPath: ATB, type: 'pricing', by: 'board' });
  const other = mkProject();
  assert.throws(() => growth.saveAgentRunReceipt(other.dataDir, { id: run.id, draft: draftBase(), session: 's', by: 'board' }),
    /不存在|项目/, '跨项目写入被拒绝');
  assert.ok(!fs.existsSync(path.join(other.dataDir, 'marketing', 'agent-runs', run.id)), '未在另一项目落盘');
});

t('G7 草稿校验：数据不足不得带候选且须给补采建议；结构非法定位字段不写盘', () => {
  const { root, dataDir } = mkProject();
  const { run } = growth.createAgentRun(dataDir, { projectRoot: root, atbPath: ATB, type: 'review', observation: { from: '2026-09-01', to: '2026-09-07' }, by: 'board' });
  assert.throws(() => growth.saveAgentRunReceipt(dataDir, {
    id: run.id, draft: draftBase({ insufficient: true, candidates: [{ id: 'c1', kind: 'review', title: 'x' }] }), session: 's', by: 'board',
  }), (e) => !!(e.fields && e.fields.insufficient), '数据不足带候选定位字段');
  assert.throws(() => growth.saveAgentRunReceipt(dataDir, {
    id: run.id, draft: draftBase({ insufficient: true, advice: [] }), session: 's', by: 'board',
  }), (e) => !!(e.fields && e.fields.advice), '数据不足须给补采建议');
  assert.throws(() => growth.saveAgentRunReceipt(dataDir, {
    id: run.id, draft: draftBase({ facts: '不是数组' }), session: 's', by: 'board',
  }), (e) => !!(e.fields && e.fields.facts), 'facts 类型定位字段');
  assert.throws(() => growth.saveAgentRunReceipt(dataDir, {
    id: run.id, draft: draftBase({ candidates: [{ id: 'c1', title: '缺 kind' }] }), session: 's', by: 'board',
  }), (e) => !!(e.fields && e.fields['candidates.0.kind']), '候选 kind 定位字段');
  assert.ok(!fs.existsSync(path.join(dataDir, 'marketing', 'agent-runs', run.id, 'draft.md')), '校验失败不写盘');

  const ok = growth.saveAgentRunReceipt(dataDir, {
    id: run.id, draft: draftBase({ insufficient: true, advice: ['先补采访客分母'] }), session: 's', by: 'board',
  });
  assert.equal(ok.run.draft.insufficient, true);
  assert.match(ok.run.summary, /数据不足/, '摘要注明数据不足');
});

t('G8 候选编辑：仅 pending 可编辑，保存回草稿不改状态', () => {
  const { root, dataDir } = mkProject();
  const { run } = growth.createAgentRun(dataDir, { projectRoot: root, atbPath: ATB, type: 'positioning', by: 'board' });
  growth.saveAgentRunReceipt(dataDir, {
    id: run.id,
    draft: draftBase({ candidates: [{ id: 'c1', kind: 'positioning', title: '差异点补充', data: { content: '差异点补充' } }] }),
    session: 's', by: 'board',
  });
  const e = growth.editAgentRunCandidate(dataDir, {
    id: run.id, candidateId: 'c1', data: { title: '差异点补充（修订）', verify: '访谈 5 名用户' }, by: 'board',
  });
  const cand = e.run.draft.candidates.find((c) => c.id === 'c1');
  assert.equal(cand.title, '差异点补充（修订）');
  assert.equal(cand.verify, '访谈 5 名用户');
  assert.equal(cand.state, 'pending', '编辑不改变候选状态');
  assert.equal(e.run.status, 'received', '运行状态不变');
});

t('G9 采纳定价：创建候选版本且不自动成为当前；重复采纳幂等不重复创建', () => {
  const { root, dataDir } = mkProject();
  seedPricing(dataDir); // v1 当前无指针
  const { run } = growth.createAgentRun(dataDir, { projectRoot: root, atbPath: ATB, type: 'pricing', by: 'board' });
  const cand = {
    id: 'c1', kind: 'pricing', title: '候选定价 v2：订阅 ¥19/月', reason: 'r', verify: 'v',
    data: {
      model: 'subscription', currency: 'CNY', cycle: 'monthly',
      packages: [{ name: '标准', benefits: '全功能', price: 19 }], costBasis: '', competitorBasis: '', validationMethod: 'A/B',
    },
  };
  growth.saveAgentRunReceipt(dataDir, { id: run.id, draft: draftBase({ candidates: [cand] }), session: 's', by: 'board' });
  const a1 = growth.adoptAgentRunCandidate(dataDir, { id: run.id, candidateId: 'c1', by: 'board' });
  assert.equal(a1.already, false);
  assert.equal(a1.result.version, 'v2', '写入候选版本 v2');
  assert.equal(a1.run.draft.candidates.find((c) => c.id === 'c1').state, 'adopted');
  assert.equal(a1.run.draft.candidates.find((c) => c.id === 'c1').resultRef, 'pricing/v2.json');
  assert.equal(mkt.readState(dataDir).current, null, '候选不自动成为当前方案');
  const a2 = growth.adoptAgentRunCandidate(dataDir, { id: run.id, candidateId: 'c1', by: 'board' });
  assert.equal(a2.already, true, '重复采纳幂等');
  assert.deepEqual(fs.readdirSync(path.join(dataDir, 'marketing', 'pricing')).sort(), ['v1.json', 'v2.json'], '不重复创建版本');
});

t('G10 采纳定位：内容作为「假设」证据追加进档案（revision 递增、来源指向 agent-runs）', () => {
  const { root, dataDir } = mkProject();
  const { run } = growth.createAgentRun(dataDir, { projectRoot: root, atbPath: ATB, type: 'positioning', by: 'board' });
  growth.saveAgentRunReceipt(dataDir, {
    id: run.id,
    draft: draftBase({ candidates: [{ id: 'c1', kind: 'positioning', title: '受众假设：小团队负责人', data: { content: '受众假设：小团队负责人', type: 'hypothesis' } }] }),
    session: 's', by: 'board',
  });
  const a = growth.adoptAgentRunCandidate(dataDir, { id: run.id, candidateId: 'c1', by: 'board' });
  const st = mkt.readState(dataDir);
  assert.equal(st.profile.revision, 2, '档案 revision 递增');
  const ev = st.profile.evidence.find((e) => e.content.includes('小团队负责人'));
  assert.ok(ev, '证据追加');
  assert.equal(ev.type, 'hypothesis', '显式标记为假设（不冒充已验证事实）');
  assert.ok(ev.source.includes(`agent-runs/${run.id}`), '来源指向运行记录（可追溯）');
  assert.equal(a.run.status, 'done', '全部候选处理完 → done');
});

t('G11 采纳渠道 / 实验 / 行动 / 复盘：创建实体且不自动验证 / 发布；底层校验失败保持 pending', () => {
  const { root, dataDir } = mkProject();
  const ch = seedChannel(dataDir);
  seedObservation(dataDir);
  const { run } = growth.createAgentRun(dataDir, { projectRoot: root, atbPath: ATB, type: 'channels', by: 'board' });
  const cands = [
    { id: 'c1', kind: 'channel', title: '新渠道候选：V2EX', data: { platform: 'V2EX', priority: 'medium', reason: '受众聚集' } },
    { id: 'c2', kind: 'experiment', title: '新实验：社区首发帖', data: { hypothesis: '社区帖带来订阅', primaryMetric: '订阅新增', successCriteria: '订阅新增 ≥ 3' } },
    { id: 'c3', kind: 'activity', title: '行动草稿：社区帖', data: { channelId: ch.id, title: '社区帖', contentDraft: '正文…' } },
    { id: 'c4', kind: 'review', title: '复盘：首期观察', data: { periodStart: '2026-09-01', periodEnd: '2026-09-07', target: '激活 ≥ 10', actual: '12 人', basis: '观察记录', conclusion: '达成', nextStep: '扩大投放' } },
    { id: 'c5', kind: 'activity', title: '缺渠道的非法行动', data: { title: '无渠道' } },
  ];
  growth.saveAgentRunReceipt(dataDir, { id: run.id, draft: draftBase({ candidates: cands }), session: 's', by: 'board' });

  const a1 = growth.adoptAgentRunCandidate(dataDir, { id: run.id, candidateId: 'c1', by: 'board' });
  assert.match(a1.result.channel.id, /^ch-/, '渠道创建');
  const a2 = growth.adoptAgentRunCandidate(dataDir, { id: run.id, candidateId: 'c2', by: 'board' });
  assert.match(a2.result.experiment.id, /^exp-/, '实验创建（草稿待人工开始）');
  const a3 = growth.adoptAgentRunCandidate(dataDir, { id: run.id, candidateId: 'c3', by: 'board' });
  assert.equal(a3.result.activity.status, 'draft', '行动保持草稿（不自动发布）');
  const a4 = growth.adoptAgentRunCandidate(dataDir, { id: run.id, candidateId: 'c4', by: 'board' });
  assert.ok(a4.result.review.snapshot.length >= 1, '复盘创建并固定观察快照');

  assert.throws(() => growth.adoptAgentRunCandidate(dataDir, { id: run.id, candidateId: 'c5', by: 'board' }),
    (e) => !!(e.fields && e.fields.channelId), '非法行动数据定位字段');
  const after = growth.readAgentRun(dataDir, run.id);
  assert.equal(after.draft.candidates.find((c) => c.id === 'c5').state, 'pending', '失败候选保持 pending 可修正');
});

t('G12 保留草稿：未写入正式档案；全部候选处理完 → done', () => {
  const { root, dataDir } = mkProject();
  const { run } = growth.createAgentRun(dataDir, { projectRoot: root, atbPath: ATB, type: 'channels', by: 'board' });
  growth.saveAgentRunReceipt(dataDir, {
    id: run.id,
    draft: draftBase({ candidates: [{ id: 'c1', kind: 'channel', title: '暂不做', data: { platform: 'Test' } }] }),
    session: 's', by: 'board',
  });
  const k = growth.keepAgentRunCandidate(dataDir, { id: run.id, candidateId: 'c1', by: 'board' });
  assert.equal(k.run.draft.candidates.find((c) => c.id === 'c1').state, 'kept');
  assert.equal(k.run.status, 'done', '全部处理完 → done');
  assert.equal(mkt.readBoard(dataDir).channels.length, 0, '未写入正式档案');
  const k2 = growth.keepAgentRunCandidate(dataDir, { id: run.id, candidateId: 'c1', by: 'board' });
  assert.equal(k2.already, true, '重复保留幂等');
});

t('G13 接续任务：continueOf 引用历史 run；提示词含历史草稿与采纳记录；可按 ID 读取（跨会话）', () => {
  const { root, dataDir } = mkProject();
  const r1 = growth.createAgentRun(dataDir, { projectRoot: root, atbPath: ATB, type: 'positioning', by: 'board' });
  growth.saveAgentRunReceipt(dataDir, {
    id: r1.run.id,
    draft: draftBase({ candidates: [{ id: 'c1', kind: 'positioning', title: '已采纳项', data: { content: '已采纳项' } }] }),
    session: 's', by: 'board',
  });
  growth.adoptAgentRunCandidate(dataDir, { id: r1.run.id, candidateId: 'c1', by: 'board' });

  const r2 = growth.createAgentRun(dataDir, {
    projectRoot: root, atbPath: ATB, type: 'positioning', continueOf: r1.run.id, by: 'board',
  });
  assert.equal(r2.run.continueOf, r1.run.id, '接续引用');
  assert.ok(r2.prompt.includes(`agent-runs/${r1.run.id}/draft.md`), '提示词含历史草稿引用');
  assert.ok(r2.prompt.includes('已采纳项'), '提示词含采纳记录');
  assert.ok(r2.prompt.includes('继续'), '继续任务提示词');
  const got = growth.readAgentRun(dataDir, r1.run.id);
  assert.equal(got.id, r1.run.id, '新会话可按任务 ID 读取');
});

t('G14 空项目：无营销档案仍可创建任务（仅 README 输入），提示词声明档案缺失', () => {
  const { root, dataDir } = mkProject(false);
  const r = growth.createAgentRun(dataDir, { projectRoot: root, atbPath: ATB, type: 'positioning', by: 'board' });
  assert.deepEqual(r.run.inputs, [{ ref: 'README.md', revision: null }], '输入仅 README（无版本要求）');
  assert.ok(r.prompt.includes('档案缺失'), '兜底声明');
  assert.ok(r.prompt.includes('README'), '仅基于 README 与通用方法');
  const ok = growth.saveAgentRunReceipt(dataDir, { id: r.run.id, draft: draftBase(), session: 's', by: 'board' });
  assert.equal(ok.run.status, 'received', '空项目回执仍可写入');
});

t('G15 无指标复盘：insufficient 草稿保存（仅补采建议），无候选可采纳', () => {
  const { root, dataDir } = mkProject();
  const rv = growth.createAgentRun(dataDir, {
    projectRoot: root, atbPath: ATB, type: 'review',
    observation: { from: '2026-09-08', to: '2026-09-14' }, by: 'board', // 该期无观察
  });
  const r = growth.saveAgentRunReceipt(dataDir, {
    id: rv.run.id,
    draft: draftBase({
      insufficient: true, facts: ['该观察期无任何观察记录（未录入 ≠ 0）'],
      advice: ['补采：订阅新增、激活、访客（分母）', '录入后再生成复盘，本周期不输出结论'],
    }),
    session: 's', by: 'board',
  });
  assert.equal(r.run.draft.insufficient, true);
  assert.equal(r.run.draft.candidates.length, 0, '无候选（不生成虚构结论）');
  assert.ok(r.run.draft.advice.length >= 2, '补采建议保留');
  assert.throws(() => growth.adoptAgentRunCandidate(dataDir, { id: rv.run.id, candidateId: 'c1', by: 'board' }),
    /候选|数据不足/, '无候选可采纳');
});

t('G16 读态：两态返回；run 字段齐备（ID / 会话 / 输入及版本 / 摘要 / 草稿引用 / 时间 / 结果）；损坏只读占位', () => {
  assert.equal(growth.readGrowth(mkProject(false).dataDir).initialized, false, '未初始化营销 → initialized:false');
  const { root, dataDir } = mkProject();
  const { run } = growth.createAgentRun(dataDir, { projectRoot: root, atbPath: ATB, type: 'pricing', by: 'board' });
  growth.saveAgentRunReceipt(dataDir, { id: run.id, draft: draftBase(), session: 's', by: 'board' });
  const g = growth.readGrowth(dataDir);
  assert.equal(g.initialized, true);
  assert.equal(g.skills.installed, false, '外部 skill 未安装（列出缺口，不假称已运行）');
  assert.ok(Array.isArray(g.skills.byType.pricing), '按入口列能力缺口');
  const row = g.runs.find((x) => x.id === run.id);
  assert.ok(row.session === 's' && row.summary && row.draftRef === `agent-runs/${run.id}/draft.md`
    && row.receiptAt && row.result === 'success' && Array.isArray(row.inputs), '运行记录要素齐备');
  const waiting = growth.createAgentRun(dataDir, { projectRoot: root, atbPath: ATB, type: 'positioning', by: 'board' });
  assert.equal(growth.readGrowth(dataDir).runs.find((x) => x.id === waiting.run.id).result, 'waiting', '未回执 → waiting');

  // 损坏 run.json → 只读占位，其余照常
  fs.writeFileSync(path.join(dataDir, 'marketing', 'agent-runs', waiting.run.id, 'run.json'), '{ broken');
  const g2 = growth.readGrowth(dataDir);
  assert.equal(g2.runs.find((x) => x.id === waiting.run.id).corrupt, true, '损坏只读占位');
  assert.ok(g2.runs.find((x) => x.id === run.id), '其余照常');
  assert.throws(() => growth.saveAgentRunReceipt(dataDir, { id: waiting.run.id, draft: draftBase(), session: 's', by: 'board' }),
    /损坏/, '损坏记录拒绝写入（不自动覆盖）');
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
