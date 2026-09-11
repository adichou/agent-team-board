#!/usr/bin/env node
// REQ-20260910-020 渠道 / 实验 / 内容行动看板 —— 数据层测试（B1~B14）
// 覆盖：渠道校验与乐观锁、实验（币种 / 零预算 / 定价版本绑定 / 观察窗口）、
// 行动状态机（推进校验 / 停止 / 更正 / 不变量）、复制为新实验、开发需求双向关联（幂等）、
// readBoard 空态 / 损坏占位 / 排序。
// 用法：node scripts/tests/marketing-board-store.test.mjs

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as core from '../lib/core.mjs';
import * as mkt from '../lib/marketing-store.mjs';

const cases = [];
const t = (name, fn) => cases.push([name, fn]);

function mkProject(readme) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'atb-mkt-board-store-')));
  core.initData(root);
  if (readme != null) fs.writeFileSync(path.join(root, 'README.md'), readme);
  const dataDir = core.dataDirFrom(root);
  mkt.initProfile(dataDir, { projectRoot: root, by: 'board' });
  return { root, dataDir };
}

const README = '# Demo App\n\n一句话介绍：本地优先的团队看板。\n';

const channel = (over = {}) => ({
  platform: 'X', link: 'https://x.com/atb', audience: '独立开发者', languages: '英文',
  formats: '短帖', priority: 'high', reason: '目标人群集中', weeklyEffort: 3,
  dataAccess: '后台分析', capabilities: '可发帖与评论', ...over,
});

const experiment = (over = {}) => ({
  channelId: null, hypothesis: '日更短帖 2 周可带来 50 次产品页访问', primaryMetric: '产品页访问数',
  observationStart: '2026-09-01', observationEnd: '2026-09-14', successCriteria: '≥50 次访问',
  currency: 'CNY', budgetPlanned: 0, budgetActual: null, hoursPlanned: 6, hoursActual: null,
  pricingVersion: null, decision: null, decisionBasis: '', ...over,
});

const activity = (over = {}) => ({
  channelId: null, experimentId: null, title: '演示视频发布', contentDraft: '一分钟演示视频文案',
  materialRefs: '素材：demo.mp4', plannedAt: '2026-09-10T10:00', timezone: 'Asia/Shanghai',
  owner: '张三', nextStep: '', publishUrl: '', publishedAt: '', publishCredential: '',
  ...over,
});

function seed(dataDir, { withChannel = true, withExperiment = true } = {}) {
  let ch = null;
  let exp = null;
  if (withChannel) ch = mkt.createChannel(dataDir, { data: channel(), by: 'board' }).channel;
  if (withExperiment) {
    exp = mkt.createExperiment(dataDir, {
      data: experiment({ channelId: ch ? ch.id : null }), by: 'board',
    }).experiment;
  }
  return { ch, exp };
}

t('B1 渠道创建：平台必填 / 优先级枚举 / 负每周投入定位字段；合法创建落盘并可读', () => {
  const { dataDir } = mkProject(README);
  assert.throws(() => mkt.createChannel(dataDir, { data: channel({ platform: '' }), by: 'board' }),
    (e) => !!(e.fields && e.fields.platform), '平台缺失应定位字段');
  assert.throws(() => mkt.createChannel(dataDir, { data: channel({ priority: 'urgent' }), by: 'board' }),
    (e) => !!(e.fields && e.fields.priority), '优先级枚举外应定位字段');
  assert.throws(() => mkt.createChannel(dataDir, { data: channel({ weeklyEffort: -1 }), by: 'board' }),
    (e) => !!(e.fields && e.fields.weeklyEffort), '负每周投入应定位字段');

  const r = mkt.createChannel(dataDir, { data: channel(), by: 'board' });
  const ch = r.channel;
  assert.match(ch.id, /^ch-/, '渠道稳定 ID 前缀');
  assert.equal(ch.revision, 1);
  assert.equal(ch.platform, 'X');
  assert.ok(fs.existsSync(path.join(dataDir, 'marketing', 'channels', `${ch.id}.json`)), '渠道落盘');
  assert.equal(r.board.channels.length, 1, '返回看板快照');
});

t('B2 渠道更新：revision 过期冲突（旧文件字节不变）；合法更新递增 revision', () => {
  const { dataDir } = mkProject(README);
  const ch = mkt.createChannel(dataDir, { data: channel(), by: 'board' }).channel;
  const file = path.join(dataDir, 'marketing', 'channels', `${ch.id}.json`);
  const before = fs.readFileSync(file, 'utf8');
  assert.throws(() => mkt.saveChannel(dataDir, {
    id: ch.id, revision: 9, data: channel({ platform: 'Reddit' }), by: 'board',
  }), (e) => e instanceof mkt.MarketingConflictError && e.currentRevision === 1, '过期 revision 应冲突');
  assert.equal(fs.readFileSync(file, 'utf8'), before, '冲突失败不改动旧文件');
  assert.throws(() => mkt.saveChannel(dataDir, {
    id: 'ch-none', revision: 1, data: channel(), by: 'board',
  }), /不存在/, '未知渠道应拒绝');

  const r = mkt.saveChannel(dataDir, { id: ch.id, revision: 1, data: channel({ platform: 'Reddit' }), by: 'board' });
  assert.equal(r.channel.revision, 2);
  assert.equal(r.channel.platform, 'Reddit');
  assert.equal(r.board.channels[0].platform, 'Reddit');
});

t('B3 实验创建与校验：假设必填、观察窗口格式与先后、定价版本存在、channelId 存在、零预算可保存', () => {
  const { dataDir } = mkProject(README);
  const { ch } = seed(dataDir, { withExperiment: false });

  assert.throws(() => mkt.createExperiment(dataDir, { data: experiment({ hypothesis: '' }), by: 'board' }),
    (e) => !!(e.fields && e.fields.hypothesis), '假设必填定位字段');
  assert.throws(() => mkt.createExperiment(dataDir, { data: experiment({ observationStart: '09-01' }), by: 'board' }),
    (e) => !!(e.fields && e.fields.observationStart), '观察开始格式错误定位字段');
  assert.throws(() => mkt.createExperiment(dataDir, {
    data: experiment({ observationStart: '2026-09-14', observationEnd: '2026-09-01' }), by: 'board',
  }), (e) => !!(e.fields && e.fields.observationEnd), '观察结束早于开始定位字段');
  assert.throws(() => mkt.createExperiment(dataDir, { data: experiment({ pricingVersion: 'v3' }), by: 'board' }),
    (e) => !!(e.fields && e.fields.pricingVersion), '定价版本不存在定位字段');
  assert.throws(() => mkt.createExperiment(dataDir, { data: experiment({ channelId: 'ch-x' }), by: 'board' }),
    (e) => !!(e.fields && e.fields.channelId), '渠道不存在定位字段');

  // 零预算 + 币种可保存；null=未知
  const r = mkt.createExperiment(dataDir, { data: experiment({ channelId: ch.id, budgetPlanned: 0 }), by: 'board' });
  assert.equal(r.experiment.budgetPlanned, 0, '0=实际零可保存');
  assert.equal(r.experiment.budgetActual, null, 'null=未知');
  assert.match(r.experiment.id, /^exp-/);

  // 定价版本绑定存在时通过
  mkt.savePricing(dataDir, { data: { model: 'subscription', currency: 'CNY', cycle: 'monthly', packages: [] }, by: 'board' });
  const r2 = mkt.createExperiment(dataDir, { data: experiment({ pricingVersion: 'v1' }), by: 'board' });
  assert.equal(r2.experiment.pricingVersion, 'v1');
});

t('B4 实验费用币种：有预算或支出缺币种 → 字段错误；无费用字段币种可空', () => {
  const { dataDir } = mkProject(README);
  assert.throws(() => mkt.createExperiment(dataDir, { data: experiment({ currency: '', budgetPlanned: 100 }), by: 'board' }),
    (e) => !!(e.fields && e.fields.currency), '有预算缺币种应定位字段');
  assert.throws(() => mkt.createExperiment(dataDir, { data: experiment({ currency: '', budgetPlanned: null, budgetActual: 12.5 }), by: 'board' }),
    (e) => !!(e.fields && e.fields.currency), '有实际支出缺币种应定位字段');
  const ok = mkt.createExperiment(dataDir, {
    data: experiment({ currency: '', budgetPlanned: null, budgetActual: null }), by: 'board',
  });
  assert.equal(ok.experiment.currency, '', '无费用字段币种可空');
});

t('B5 实验更新：冲突拒绝；绑定 v1 后新增/切换当前定价不改变实验绑定', () => {
  const { dataDir } = mkProject(README);
  mkt.savePricing(dataDir, { data: { model: 'subscription', currency: 'CNY', cycle: 'monthly', packages: [] }, by: 'board' });
  const exp = mkt.createExperiment(dataDir, { data: experiment({ pricingVersion: 'v1' }), by: 'board' }).experiment;
  const before = fs.readFileSync(path.join(dataDir, 'marketing', 'experiments', `${exp.id}.json`), 'utf8');

  assert.throws(() => mkt.saveExperiment(dataDir, {
    id: exp.id, revision: 5, data: experiment({ pricingVersion: 'v1' }), by: 'board',
  }), (e) => e instanceof mkt.MarketingConflictError, '过期 revision 应冲突');
  assert.equal(fs.readFileSync(path.join(dataDir, 'marketing', 'experiments', `${exp.id}.json`), 'utf8'), before, '冲突不改旧文件');

  // 新增 v2 并把当前指针切到 v2：实验仍绑定 v1（版本文件不可变）
  mkt.savePricing(dataDir, { data: { model: 'onetime', currency: 'USD', cycle: '', packages: [] }, by: 'board' });
  mkt.setCurrentPricing(dataDir, { version: 'v2', by: 'board' });
  const board = mkt.readBoard(dataDir);
  assert.equal(board.experiments.find((x) => x.id === exp.id).pricingVersion, 'v1', '实验绑定版本不随当前定价变化');
});

t('B6 行动创建：channelId 必填且存在；experimentId 可选但存在；初始 draft 带历史', () => {
  const { dataDir } = mkProject(README);
  const { ch } = seed(dataDir, { withExperiment: false });
  assert.throws(() => mkt.createActivity(dataDir, { data: activity(), by: 'board' }),
    (e) => !!(e.fields && e.fields.channelId), '缺渠道应定位字段');
  assert.throws(() => mkt.createActivity(dataDir, { data: activity({ channelId: 'ch-z' }), by: 'board' }),
    (e) => !!(e.fields && e.fields.channelId), '渠道不存在应定位字段');
  assert.throws(() => mkt.createActivity(dataDir, { data: activity({ channelId: ch.id, experimentId: 'exp-z' }), by: 'board' }),
    (e) => !!(e.fields && e.fields.experimentId), '实验不存在应定位字段');
  assert.throws(() => mkt.createActivity(dataDir, { data: activity({ channelId: ch.id, plannedAt: '2026-09-10T10:00', timezone: '' }), by: 'board' }),
    (e) => !!(e.fields && e.fields.timezone), '计划时间必须配套时区');

  const r = mkt.createActivity(dataDir, { data: activity({ channelId: ch.id }), by: 'board' });
  const act = r.activity;
  assert.equal(act.status, 'draft');
  assert.equal(act.statusHistory.length, 1);
  assert.equal(act.statusHistory[0].to, 'draft');
  assert.ok(fs.existsSync(path.join(dataDir, 'marketing', 'activities', `${act.id}.json`)), '行动落盘');
  assert.match(act.id, /^act-/);
});

function seededActivity(dataDir, over = {}) {
  const { ch, exp } = seed(dataDir);
  const act = mkt.createActivity(dataDir, {
    data: activity({ channelId: ch.id, experimentId: exp.id, ...over }), by: 'board',
  }).activity;
  return { ch, exp, act };
}

t('B7 状态推进：待发布需内容草稿；已发布需发布时间+链接或凭据；published→observing→reviewed 链路', () => {
  const { dataDir } = mkProject(README);
  const { act } = seededActivity(dataDir, { contentDraft: '' });

  // draft → pending 缺内容草稿
  assert.throws(() => mkt.setActivityStatus(dataDir, { id: act.id, revision: 1, to: 'pending', by: 'board' }),
    (e) => !!(e.fields && e.fields.contentDraft), '缺内容草稿应定位字段');
  assert.equal(mkt.readBoard(dataDir).activities.find((x) => x.id === act.id).status, 'draft', '状态不变');

  // 补内容 → pending
  mkt.saveActivity(dataDir, { id: act.id, revision: 1, data: activity({ channelId: act.channelId, experimentId: act.experimentId, contentDraft: '新文案' }), by: 'board' });
  let r = mkt.setActivityStatus(dataDir, { id: act.id, revision: 2, to: 'pending', by: 'board' });
  assert.equal(r.activity.status, 'pending');

  // pending → published 缺凭据
  assert.throws(() => mkt.setActivityStatus(dataDir, { id: act.id, revision: 3, to: 'published', by: 'board' }),
    (e) => !!(e.fields && (e.fields.publishedAt || e.fields.publishUrl)), '缺发布信息应定位字段');
  // 人工登记：时间 + 公开链接
  r = mkt.setActivityStatus(dataDir, {
    id: act.id, revision: 3, to: 'published',
    payload: { publishedAt: '2026-09-10T09:30', publishUrl: 'https://x.com/post/1' }, by: 'board',
  });
  assert.equal(r.activity.status, 'published');
  assert.equal(r.activity.publishUrl, 'https://x.com/post/1');

  // 凭据说明替代公开链接
  const { act: a2 } = seededActivity(dataDir);
  mkt.setActivityStatus(dataDir, { id: a2.id, revision: 1, to: 'pending', payload: { contentDraft: '有内容' }, by: 'board' });
  const r2 = mkt.setActivityStatus(dataDir, {
    id: a2.id, revision: 2, to: 'published',
    payload: { publishedAt: '2026-09-10T09:30', publishCredential: '私信截图存档' }, by: 'board',
  });
  assert.equal(r2.activity.status, 'published', '凭据说明可替代公开链接');

  // published → observing → reviewed
  r = mkt.setActivityStatus(dataDir, { id: act.id, revision: 4, to: 'observing', by: 'board' });
  assert.equal(r.activity.status, 'observing');
  r = mkt.setActivityStatus(dataDir, {
    id: act.id, revision: 5, to: 'reviewed',
    payload: { reviewBasis: '两周 62 次访问', decision: 'continue' }, by: 'board',
  });
  assert.equal(r.activity.status, 'reviewed');
  assert.equal(r.activity.decision, 'continue');
  const hist = r.activity.statusHistory.map((h) => h.to);
  assert.deepEqual(hist, ['draft', 'pending', 'published', 'observing', 'reviewed'], '历史按序入档');
});

t('B8 复盘与停止：依据与决策必填；暂不能判断独立存在；停止需原因、reviewed 不能停止', () => {
  const { dataDir } = mkProject(README);
  const { act } = seededActivity(dataDir);
  for (const [to, rev] of [['pending', 1], ['published', 2], ['observing', 3]]) {
    mkt.setActivityStatus(dataDir, {
      id: act.id, revision: rev, to,
      payload: rev === 2 ? { publishedAt: '2026-09-10T09:30', publishUrl: 'https://e/p' } : {}, by: 'board',
    });
  }
  assert.throws(() => mkt.setActivityStatus(dataDir, {
    id: act.id, revision: 4, to: 'reviewed', payload: { decision: 'continue' }, by: 'board',
  }), (e) => !!(e.fields && e.fields.reviewBasis), '缺结果依据应定位字段');
  assert.throws(() => mkt.setActivityStatus(dataDir, {
    id: act.id, revision: 4, to: 'reviewed', payload: { reviewBasis: '样本不足' }, by: 'board',
  }), (e) => !!(e.fields && e.fields.decision), '缺决策应定位字段');
  assert.throws(() => mkt.setActivityStatus(dataDir, {
    id: act.id, revision: 4, to: 'reviewed', payload: { reviewBasis: '样本不足', decision: 'maybe' }, by: 'board',
  }), (e) => !!(e.fields && e.fields.decision), '决策枚举外应定位字段');
  // 暂不能判断：数据不足也可结束
  const r = mkt.setActivityStatus(dataDir, {
    id: act.id, revision: 4, to: 'reviewed',
    payload: { reviewBasis: '只有 3 天数据', decision: 'undetermined' }, by: 'board',
  });
  assert.equal(r.activity.decision, 'undetermined', '暂不能判断不等同验证成功');

  // reviewed 不能停止
  assert.throws(() => mkt.setActivityStatus(dataDir, {
    id: act.id, revision: 5, to: 'stopped', payload: { stopReason: '算了' }, by: 'board',
  }), /已复盘|不能停止/, '已复盘不能停止（需更正或复盘决策承载）');

  // 未复盘状态停止需原因
  const { act: a2 } = seededActivity(dataDir);
  assert.throws(() => mkt.setActivityStatus(dataDir, { id: a2.id, revision: 1, to: 'stopped', by: 'board' }),
    (e) => !!(e.fields && e.fields.stopReason), '缺停止原因应定位字段');
  const r2 = mkt.setActivityStatus(dataDir, {
    id: a2.id, revision: 1, to: 'stopped', payload: { stopReason: '渠道规则变化' }, by: 'board',
  });
  assert.equal(r2.activity.status, 'stopped');
  assert.equal(r2.activity.stoppedReason, '渠道规则变化');
});

t('B9 状态推进只允许链式下一步或停止：跳步与非相邻前进拒绝', () => {
  const { dataDir } = mkProject(README);
  const { act } = seededActivity(dataDir);
  assert.throws(() => mkt.setActivityStatus(dataDir, { id: act.id, revision: 1, to: 'published', by: 'board' }),
    /逐步|不能直接到|非法/, 'draft 不能直接 published');
  assert.throws(() => mkt.setActivityStatus(dataDir, { id: act.id, revision: 1, to: 'reviewed', by: 'board' }),
    /逐步|不能直接到|非法/, 'draft 不能直接 reviewed');
  const { act: a2 } = seededActivity(dataDir);
  mkt.setActivityStatus(dataDir, {
    id: a2.id, revision: 1, to: 'pending', payload: { contentDraft: 'x' }, by: 'board',
  });
  assert.throws(() => mkt.setActivityStatus(dataDir, { id: a2.id, revision: 2, to: 'observing', by: 'board' }),
    /逐步|不能直接到|非法/, 'pending 不能跳到 observing');
  assert.throws(() => mkt.setActivityStatus(dataDir, { id: a2.id, revision: 2, to: 'draft', by: 'board' }),
    /更正|非法/, '倒退须走更正');
});

t('B10 误操作更正：回退记录原因与历史（type=correct）；前进方向更正拒绝；缺原因拒绝', () => {
  const { dataDir } = mkProject(README);
  const { act } = seededActivity(dataDir);
  mkt.setActivityStatus(dataDir, { id: act.id, revision: 1, to: 'pending', payload: { contentDraft: 'x' }, by: 'board' });
  mkt.setActivityStatus(dataDir, {
    id: act.id, revision: 2, to: 'published',
    payload: { publishedAt: '2026-09-10T09:30', publishUrl: 'https://e/p' }, by: 'board',
  });

  assert.throws(() => mkt.correctActivityStatus(dataDir, { id: act.id, revision: 3, to: 'pending', reason: '', by: 'board' }),
    (e) => !!(e.fields && e.fields.reason), '缺更正原因应定位字段');
  assert.throws(() => mkt.correctActivityStatus(dataDir, { id: act.id, revision: 3, to: 'observing', reason: 'x', by: 'board' }),
    /前进|推进/, '更正不能用于前进');
  const r = mkt.correctActivityStatus(dataDir, { id: act.id, revision: 3, to: 'pending', reason: '误点了发布', by: 'board' });
  assert.equal(r.activity.status, 'pending');
  const last = r.activity.statusHistory[r.activity.statusHistory.length - 1];
  assert.equal(last.type, 'correct');
  assert.equal(last.reason || last.note, '误点了发布', '更正原因入历史');

  // stopped 恢复到此前状态
  mkt.setActivityStatus(dataDir, {
    id: act.id, revision: 4, to: 'stopped', payload: { stopReason: '暂停' }, by: 'board',
  });
  const r2 = mkt.correctActivityStatus(dataDir, { id: act.id, revision: 5, to: 'draft', reason: '停止误操作', by: 'board' });
  assert.equal(r2.activity.status, 'draft');
});

t('B11 保存不破坏状态不变量：published 清空发布凭据保存拒绝；reviewed 清空依据保存拒绝', () => {
  const { dataDir } = mkProject(README);
  const { ch, act } = seededActivity(dataDir);
  mkt.setActivityStatus(dataDir, { id: act.id, revision: 1, to: 'pending', payload: { contentDraft: 'x' }, by: 'board' });
  mkt.setActivityStatus(dataDir, {
    id: act.id, revision: 2, to: 'published',
    payload: { publishedAt: '2026-09-10T09:30', publishUrl: 'https://e/p' }, by: 'board',
  });
  assert.throws(() => mkt.saveActivity(dataDir, {
    id: act.id, revision: 3, data: activity({ channelId: ch.id, publishUrl: '', publishedAt: '' }), by: 'board',
  }), (e) => !!(e.fields && (e.fields.publishedAt || e.fields.publishUrl)), 'published 行动不能清空发布凭据');

  mkt.setActivityStatus(dataDir, { id: act.id, revision: 3, to: 'observing', by: 'board' });
  mkt.setActivityStatus(dataDir, {
    id: act.id, revision: 4, to: 'reviewed', payload: { reviewBasis: '依据', decision: 'stop' }, by: 'board',
  });
  assert.throws(() => mkt.saveActivity(dataDir, {
    id: act.id, revision: 5, data: activity({ channelId: ch.id, reviewBasis: '', decision: '' }), by: 'board',
  }), (e) => !!(e.fields && (e.fields.reviewBasis || e.fields.decision)), 'reviewed 行动不能清空复盘依据');
});

t('B12 复制为新实验：新 ID 保留来源；实际值/决策清空、计划保留；行动置草稿、发布信息清空、REQ 不复制；fromActivityId 只复制指定行动', () => {
  const { dataDir } = mkProject(README);
  const { ch, exp, act } = seededActivity(dataDir, { withExperiment: true });
  mkt.savePricing(dataDir, { data: { model: 'subscription', currency: 'CNY', cycle: 'monthly', packages: [] }, by: 'board' });
  mkt.saveExperiment(dataDir, {
    id: exp.id, revision: 1,
    data: experiment({ channelId: ch.id, pricingVersion: 'v1', budgetPlanned: 100, budgetActual: 80, hoursPlanned: 6, hoursActual: 5 }),
    by: 'board',
  });
  const act2 = mkt.createActivity(dataDir, {
    data: activity({ channelId: ch.id, experimentId: exp.id, title: '第二条' }), by: 'board',
  }).activity;
  mkt.setActivityStatus(dataDir, { id: act.id, revision: 1, to: 'pending', payload: { contentDraft: 'x' }, by: 'board' });
  mkt.setActivityStatus(dataDir, {
    id: act.id, revision: 2, to: 'published',
    payload: { publishedAt: '2026-09-10T09:30', publishUrl: 'https://e/p' }, by: 'board',
  });
  mkt.setActivityStatus(dataDir, { id: act.id, revision: 3, to: 'observing', by: 'board' });
  mkt.setActivityStatus(dataDir, {
    id: act.id, revision: 4, to: 'reviewed', payload: { reviewBasis: 'b', decision: 'adjust' }, by: 'board',
  });
  mkt.linkActivityReq(dataDir, { id: act.id, key: 'k1', title: '落地页改造', description: 'd', by: 'board' });

  // 整实验复制
  const r = mkt.copyExperiment(dataDir, { id: exp.id, by: 'board' });
  const neo = r.experiment;
  assert.notEqual(neo.id, exp.id, '新实验新 ID');
  assert.equal(neo.copiedFrom, exp.id, '保留来源');
  assert.equal(neo.pricingVersion, 'v1', '定价版本保留');
  assert.equal(neo.budgetPlanned, 100, '预算计划保留');
  assert.equal(neo.budgetActual, null, '实际支出清空');
  assert.equal(neo.hoursActual, null, '实际工时清空');
  assert.equal(neo.decision, null, '决策清空');
  assert.equal(neo.observationStart, null, '观察窗口清空（新尝试重新计划）');

  const board = mkt.readBoard(dataDir);
  const copied = board.activities.filter((a) => a.experimentId === neo.id);
  assert.equal(copied.length, 2, '两条行动都被复制');
  for (const c of copied) {
    assert.equal(c.status, 'draft', '行动置为草稿');
    assert.equal(c.publishUrl, '', '发布信息清空');
    assert.equal(c.linkedReqs.length, 0, '关联 REQ 不复制');
    assert.ok(c.copiedFrom, '行动保留来源');
  }
  // 源行动保持已复盘历史
  const srcAct = board.activities.find((a) => a.id === act.id);
  assert.equal(srcAct.status, 'reviewed', '来源历史保留');

  // fromActivityId 只复制指定行动
  const r2 = mkt.copyExperiment(dataDir, { id: exp.id, fromActivityId: act2.id, by: 'board' });
  const only = mkt.readBoard(dataDir).activities.filter((a) => a.experimentId === r2.experiment.id);
  assert.equal(only.length, 1);
  assert.equal(only[0].copiedFrom, act2.id);
});

t('B13 创建开发需求：submitted + 双向关联 + 同 key 幂等；key/标题校验', () => {
  const { root, dataDir } = mkProject(README);
  const { act } = seededActivity(dataDir);
  assert.throws(() => mkt.linkActivityReq(dataDir, { id: act.id, key: '', title: 't', by: 'board' }),
    (e) => !!(e.fields && e.fields.key), '缺幂等 key 应定位字段');
  assert.throws(() => mkt.linkActivityReq(dataDir, { id: act.id, key: 'k', title: ' ', by: 'board' }),
    (e) => !!(e.fields && e.fields.title), '缺标题应定位字段');

  const r = mkt.linkActivityReq(dataDir, { id: act.id, key: 'landing', title: '落地页改造', description: '加价格锚点', by: 'board' });
  assert.equal(r.created, true);
  assert.match(r.link.id, /^REQ-/, '创建为 REQ');
  const st = core.readStatus(path.join(dataDir, 'requirements', r.link.id));
  assert.equal(st.status, 'submitted', '人工创建进入 submitted，不自动接受');
  const readme = fs.readFileSync(path.join(dataDir, 'requirements', r.link.id, 'README.md'), 'utf8');
  assert.ok(readme.includes(act.id), 'REQ README 含行动来源（双向关联）');
  assert.ok(readme.includes('营销'), 'README 标注营销来源');

  const board = mkt.readBoard(dataDir);
  const linked = board.activities.find((a) => a.id === act.id).linkedReqs;
  assert.equal(linked.length, 1);
  assert.equal(linked[0].id, r.link.id, '行动记录 REQ 编号');

  // 同 key 重试不重复创建
  const again = mkt.linkActivityReq(dataDir, { id: act.id, key: 'landing', title: '落地页改造', description: 'd', by: 'board' });
  assert.equal(again.created, false, '幂等重试不重复创建');
  assert.equal(again.link.id, r.link.id);
  const ids = fs.readdirSync(path.join(dataDir, 'requirements')).filter((x) => x.startsWith('REQ-'));
  assert.equal(ids.length, 1, '仍只有一个 REQ 目录');
  assert.equal(root.length > 0, true);
});

t('B14 readBoard：未初始化空态；损坏文件只读占位；createdAt 排序', async () => {
  const parent = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'atb-mkt-board-empty-')));
  core.initData(parent);
  const dataDir0 = core.dataDirFrom(parent);
  assert.equal(mkt.readBoard(dataDir0).initialized, false, '未初始化营销 → 空态');

  const { dataDir } = mkProject(README);
  const { ch, exp, act } = seededActivity(dataDir);
  await new Promise((r) => setTimeout(r, 3)); // 确保 createdAt 可区分（toISOString 毫秒精度）
  const act2 = mkt.createActivity(dataDir, { data: activity({ channelId: ch.id, experimentId: exp.id }), by: 'board' }).activity;
  let board = mkt.readBoard(dataDir);
  assert.deepEqual(board.activities.map((a) => a.id), [act.id, act2.id], '按创建时间稳定排序');

  fs.writeFileSync(path.join(dataDir, 'marketing', 'activities', `${act2.id}.json`), '{ broken');
  board = mkt.readBoard(dataDir);
  const corrupt = board.activities.find((a) => a.id === act2.id);
  assert.equal(corrupt.corrupt, true, '损坏行动只读占位');
  assert.equal(board.activities.find((a) => a.id === act.id).corrupt, undefined, '其余照常');
  assert.throws(() => mkt.saveActivity(dataDir, {
    id: act2.id, revision: 1, data: activity({ channelId: ch.id }), by: 'board',
  }), /损坏/, '损坏实体不可写（不静默覆盖）');
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
