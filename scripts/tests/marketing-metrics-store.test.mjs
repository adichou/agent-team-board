#!/usr/bin/env node
// REQ-20260910-021 效果与复盘 —— 数据层测试（M1~M14）
// 覆盖：指标字典（默认播种 / 自定义 / 损坏报错）、手工观察（null/零/校验/修订幂等与历史）、
// 来源隔离、CSV 预览行级错误 / 原子提交 / 重复导入幂等 / 值冲突修订或跳过、
// readEffect 卡片口径（未录入 / 真实零 / 存量不跨日期 / 关注不跨平台 / 币种分开 / 可加求和）、
// 派生转化率三态、复盘快照固定、数据不足复盘、筛选、损坏占位。
// 用法：node scripts/tests/marketing-metrics-store.test.mjs

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as core from '../lib/core.mjs';
import * as mkt from '../lib/marketing-store.mjs';

const cases = [];
const t = (name, fn) => cases.push([name, fn]);

function mkProject() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'atb-mkt-metrics-store-')));
  core.initData(root);
  fs.writeFileSync(path.join(root, 'README.md'), '# Demo\n\n营销指标测试项目。\n');
  const dataDir = core.dataDirFrom(root);
  mkt.initProfile(dataDir, { projectRoot: root, by: 'board' });
  return { root, dataDir };
}

const channel = (over = {}) => ({
  platform: 'X', link: '', audience: '', languages: '', formats: '',
  priority: 'medium', reason: '', weeklyEffort: null, dataAccess: '', capabilities: '', ...over,
});

function seedChannel(dataDir, platform = 'X') {
  return mkt.createChannel(dataDir, { data: channel({ platform }), by: 'board' }).channel;
}
function seedExperiment(dataDir, channelId = null) {
  return mkt.createExperiment(dataDir, {
    data: {
      channelId, hypothesis: '日更短帖带来访问', primaryMetric: '访问数',
      observationStart: '', observationEnd: '', successCriteria: '',
      currency: '', budgetPlanned: null, budgetActual: null, hoursPlanned: null, hoursActual: null,
      pricingVersion: null, decision: null, decisionBasis: '',
    },
    by: 'board',
  }).experiment;
}

const obs = (over = {}) => ({
  metricKey: 'activations', dateStart: '2026-09-01', dateEnd: '2026-09-07',
  value: 12, channelId: null, experimentId: null, source: '手工记录', timezone: 'UTC+8',
  unit: '', ...over,
});

t('M1 指标定义：默认字典播种五分类；自定义指标校验；definitions.json 损坏报错不静默重建', () => {
  const { dataDir } = mkProject();
  let defs = mkt.readMetricDefinitions(dataDir);
  assert.ok(fs.existsSync(path.join(dataDir, 'marketing', 'metrics', 'definitions.json')), '首次读取播种落盘');
  assert.ok(defs.definitions.length >= 15, '默认字典覆盖五分类');
  const cats = new Set(defs.definitions.map((d) => d.category));
  for (const c of mkt.METRIC_CATEGORIES) assert.ok(cats.has(c), `分类 ${c} 有指标`);
  const byName = defs.definitions.find((d) => d.name === '订阅新增');
  assert.equal(byName.key, 'subsNew', '订阅新增 key 稳定');
  assert.equal(byName.kind, 'delta');

  // 自定义：名称必填、key 唯一、枚举校验
  assert.throws(() => mkt.addMetricDefinition(dataDir, { data: { name: '', category: 'usage', kind: 'delta', unit: '次' }, by: 'board' }),
    (e) => !!(e.fields && e.fields.name), '名称必填定位字段');
  assert.throws(() => mkt.addMetricDefinition(dataDir, { data: { name: '邮件打开', key: 'subsNew', category: 'usage', kind: 'delta', unit: '次' }, by: 'board' }),
    (e) => !!(e.fields && e.fields.key), 'key 冲突定位字段');
  assert.throws(() => mkt.addMetricDefinition(dataDir, { data: { name: '邮件打开', category: 'hot', kind: 'delta', unit: '次' }, by: 'board' }),
    (e) => !!(e.fields && e.fields.category), '分类枚举定位字段');
  assert.throws(() => mkt.addMetricDefinition(dataDir, { data: { name: '邮件打开', category: 'usage', kind: 'speed', unit: '次' }, by: 'board' }),
    (e) => !!(e.fields && e.fields.kind), '种类枚举定位字段');
  const r = mkt.addMetricDefinition(dataDir, { data: { name: '邮件打开率分子', category: 'engagement', kind: 'events', unit: '次', dedup: '不去重' }, by: 'board' });
  assert.match(r.definition.key, /^mk-/, '自定义指标分配 key');
  assert.equal(mkt.readMetricDefinitions(dataDir).definitions.length, defs.definitions.length + 1, '追加不覆盖');

  // 损坏 → 报错（不静默重建）
  fs.writeFileSync(path.join(dataDir, 'marketing', 'metrics', 'definitions.json'), '{ broken');
  assert.throws(() => mkt.readMetricDefinitions(dataDir), /损坏/, '损坏定义文件报错');
});

t('M2 手工观察创建：null=未知与 0=真实零均可录入；负数 / 非法日期 / 未知指标 / 归属不存在定位字段；商业指标必须带币种', () => {
  const { dataDir } = mkProject();
  const r0 = mkt.recordObservation(dataDir, { data: obs({ value: null }), by: 'board' });
  assert.equal(r0.observation.value, null, '空值=未知');
  assert.equal(r0.created, true);
  const rz = mkt.recordObservation(dataDir, { data: obs({ dateStart: '2026-09-08', dateEnd: '2026-09-14', value: 0 }), by: 'board' });
  assert.equal(rz.observation.value, 0, '真实零可录入');
  assert.equal(rz.observation.source, '手工记录');

  assert.throws(() => mkt.recordObservation(dataDir, { data: obs({ value: -3 }), by: 'board' }),
    (e) => !!(e.fields && e.fields.value), '负数定位字段');
  assert.throws(() => mkt.recordObservation(dataDir, { data: obs({ dateStart: '2026-02-30' }), by: 'board' }),
    (e) => !!(e.fields && e.fields.dateStart), '不存在的日历日期定位字段');
  assert.throws(() => mkt.recordObservation(dataDir, { data: obs({ metricKey: '跳出率' }), by: 'board' }),
    (e) => !!(e.fields && e.fields.metricKey), '未知指标定位字段');
  assert.throws(() => mkt.recordObservation(dataDir, { data: obs({ channelId: 'ch-x' }), by: 'board' }),
    (e) => !!(e.fields && e.fields.channelId), '渠道不存在定位字段');
  assert.throws(() => mkt.recordObservation(dataDir, { data: obs({ experimentId: 'exp-x' }), by: 'board' }),
    (e) => !!(e.fields && e.fields.experimentId), '实验不存在定位字段');
  assert.throws(() => mkt.recordObservation(dataDir, { data: obs({ dateStart: '2026-09-14', dateEnd: '2026-09-01' }), by: 'board' }),
    (e) => !!(e.fields && e.fields.dateEnd), '结束早于开始定位字段');

  // 收入：币种必填（不同币种不默认换算）
  assert.throws(() => mkt.recordObservation(dataDir, { data: obs({ metricKey: 'revenue', value: 680, unit: '' }), by: 'board' }),
    (e) => !!(e.fields && e.fields.unit), '商业金额缺币种定位字段');
  const rev = mkt.recordObservation(dataDir, { data: obs({ metricKey: 'revenue', value: 680, unit: 'CNY' }), by: 'board' });
  assert.equal(rev.observation.unit, 'CNY');
  assert.ok(fs.existsSync(path.join(dataDir, 'marketing', 'metrics', 'observations', `${rev.observation.id}.json`)), '观察落盘');
});

t('M3 修订：同键同值幂等；不同值缺理由拒绝；带理由升 revision 入历史（保留旧值）', () => {
  const { dataDir } = mkProject();
  const a = mkt.recordObservation(dataDir, { data: obs({ value: 12 }), by: 'board' }).observation;
  assert.equal(a.revision, 1);
  assert.equal(a.history.length, 1, '初始登记入历史');
  assert.equal(a.history[0].reason, '初始登记');

  // 同值幂等
  const again = mkt.recordObservation(dataDir, { data: obs({ value: 12 }), by: 'board' });
  assert.equal(again.created, false);
  assert.equal(again.revised, false);
  assert.equal(again.observation.revision, 1, 'revision 不变');
  const files = fs.readdirSync(path.join(dataDir, 'marketing', 'metrics', 'observations'));
  assert.equal(files.length, 1, '不新增记录');

  // 不同值缺理由
  assert.throws(() => mkt.recordObservation(dataDir, { data: obs({ value: 13 }), by: 'board' }),
    (e) => !!(e.fields && e.fields.reason), '修订缺修改理由定位字段');
  assert.equal(JSON.parse(fs.readFileSync(path.join(dataDir, 'marketing', 'metrics', 'observations', `${a.id}.json`), 'utf8')).revision, 1, '失败不改文件');

  // 带理由修订
  const r2 = mkt.recordObservation(dataDir, { data: obs({ value: 13, reason: '补录漏统计的一天' }), by: 'board' });
  assert.equal(r2.revised, true);
  assert.equal(r2.observation.revision, 2);
  assert.equal(r2.observation.value, 13);
  assert.deepEqual(r2.observation.history.map((h) => h.value), [12, 13], '历史保留旧值');
  assert.equal(r2.observation.history[1].reason, '补录漏统计的一天');
});

t('M4 来源不重复计算：同键不同来源同值复用同一条观察（不静默改写来源）；不同值走修订', () => {
  const { dataDir } = mkProject();
  const m1 = mkt.recordObservation(dataDir, { data: obs({ source: '手工记录', value: 10 }), by: 'board' }).observation;
  const m2 = mkt.recordObservation(dataDir, { data: obs({ source: 'CSV 导入', value: 10 }), by: 'board' });
  assert.equal(m2.created, false);
  assert.equal(m2.revised, false);
  assert.equal(m2.observation.id, m1.id, '来源相同（同观察键）的手工与同步记录不重复计算');
  assert.equal(m2.observation.source, '手工记录', '无变化不静默改写来源');
  assert.equal(fs.readdirSync(path.join(dataDir, 'marketing', 'metrics', 'observations')).length, 1);

  // 不同来源不同值 → 冲突走修订（带理由），不静默相加
  const m3 = mkt.recordObservation(dataDir, { data: obs({ source: 'CSV 导入', value: 11, reason: '同步修正数值' }), by: 'board' });
  assert.equal(m3.revised, true);
  assert.equal(m3.observation.source, 'CSV 导入', '修订后来源更新为本次写入方');
  const eff = mkt.readEffect(dataDir, {});
  assert.equal(eff.cards.find((c) => c.metricKey === 'activations').value, 11, '不重复相加');
});

t('M5 CSV 预览：合法行 new；错误行带行号与原因；预览不写盘', () => {
  const { dataDir } = mkProject();
  const csv = [
    'date_start,date_end,metric,value,currency,channel,experiment,source,tz',
    '2026-09-01,2026-09-07,订阅新增,2,人,,,,UTC+8',
    '2026-09-01,2026-09-07,点赞,abc,次,,,,UTC+8',
    '2026-13-01,2026-09-07,激活,5,人,,,,UTC+8',
    '2026-09-08,2026-09-07,收入,120,CNY,,,,UTC+8',
    '2026-09-01,2026-09-07,跳出率,9,%,,,,UTC+8',
    '2026-09-01,2026-09-07,Star 新增,7,个,,exp-x,,UTC+8',
  ].join('\n');
  const p = mkt.previewImportCsv(dataDir, { csv });
  assert.equal(p.ok, false, '存在错误行');
  assert.equal(p.rows.length, 6, '六条数据行');
  assert.equal(p.rows[0].status, 'new');
  assert.equal(p.rows[0].rowNo, 2, '行号按文件物理行（表头为第 1 行）');
  const errs = p.rows.filter((r) => r.status === 'error');
  assert.equal(errs.length, 5);
  assert.match(errs[0].error, /数字/, '非数字值');
  assert.equal(errs[0].rowNo, 3);
  assert.match(errs.find((e) => e.rowNo === 4).error, /日期/);
  assert.match(errs.find((e) => e.rowNo === 5).error, /早于/);
  assert.match(errs.find((e) => e.rowNo === 6).error, /指标/);
  assert.match(errs.find((e) => e.rowNo === 7).error, /实验/);
  assert.ok(!fs.existsSync(path.join(dataDir, 'marketing', 'metrics', 'observations')), '预览不写盘');

  // 表头不可自动识别且映射缺必填列 → 整体错误
  const generic = ['a,b,c,d,e,f,g,h,i', '2026-09-01,2026-09-07,订阅新增,2,人,,,,UTC+8'].join('\n');
  assert.throws(() => mkt.previewImportCsv(dataDir, { csv: generic, mapping: { start: 0, end: 1 } }),
    /映射|必填/, '缺少必填映射报错');
  const mapped = mkt.previewImportCsv(dataDir, {
    csv: generic, mapping: { start: 0, end: 1, metric: 2, value: 3, unit: 4, timezone: 8 },
  });
  assert.equal(mapped.ok, true, '手工映射可完成预览');
  assert.equal(mapped.rows[0].status, 'new');
});

t('M6 CSV 提交：全部合法一次成功；存在错误行原子拒绝零写入', () => {
  const { dataDir } = mkProject();
  const csv = [
    'date_start,date_end,metric,value,currency,channel,experiment,source,tz',
    '2026-09-01,2026-09-07,展示次数,2100,次,,,,UTC+8',
    '2026-09-01,2026-09-07,付费人数,0,人,,,,UTC+8',
  ].join('\n');
  const p = mkt.previewImportCsv(dataDir, { csv });
  assert.equal(p.ok, true);
  const c = mkt.commitImportCsv(dataDir, { csv, by: 'board' });
  assert.equal(c.created, 2);
  assert.equal(c.revised, 0);
  const files = fs.readdirSync(path.join(dataDir, 'marketing', 'metrics', 'observations'));
  assert.equal(files.length, 2, '一次提交全部落盘');
  assert.equal(c.effect.cards.find((x) => x.metricKey === 'payers').value, 0, '真实零入卡');

  // 含错误行 → 原子拒绝
  const bad = [
    'date_start,date_end,metric,value,currency,channel,experiment,source,tz',
    '2026-09-01,2026-09-07,点赞,45,次,,,,UTC+8',
    '2026-09-01,2026-09-07,点赞,bad,次,,,,UTC+8',
  ].join('\n');
  assert.throws(() => mkt.commitImportCsv(dataDir, { csv: bad, by: 'board' }), /错误行|行 3|第 3 行/, '错误行阻止提交');
  assert.equal(fs.readdirSync(path.join(dataDir, 'marketing', 'metrics', 'observations')).length, 2, '不写入部分数据');
});

t('M7 CSV 重复导入：同文件再导入为无变化', () => {
  const { dataDir } = mkProject();
  const csv = [
    'date_start,date_end,metric,value,currency,channel,experiment,source,tz',
    '2026-09-01,2026-09-07,订阅新增,3,人,,,,UTC+8',
    '2026-09-01,2026-09-07,激活,5,人,,,,UTC+8',
  ].join('\n');
  mkt.commitImportCsv(dataDir, { csv, by: 'board' });
  const again = mkt.commitImportCsv(dataDir, { csv, by: 'board' });
  assert.equal(again.created, 0, '不新增');
  assert.equal(again.revised, 0, '不升 revision');
  assert.equal(again.unchanged, 2, '标记无变化');
  assert.equal(fs.readdirSync(path.join(dataDir, 'marketing', 'metrics', 'observations')).length, 2);
});

t('M8 CSV 值冲突：未选择处理方式拒绝；skip 保持原值；revise 需理由并升 revision', () => {
  const { dataDir } = mkProject();
  mkt.recordObservation(dataDir, { data: obs({ value: 12 }), by: 'board' });
  const csv = [
    'date_start,date_end,metric,value,currency,channel,experiment,source,tz',
    '2026-09-01,2026-09-07,激活,20,人,,,,UTC+8',
  ].join('\n');
  const p = mkt.previewImportCsv(dataDir, { csv });
  assert.equal(p.rows[0].status, 'conflict', '同键不同值识别为冲突');
  assert.equal(p.rows[0].existingValue, 12, '返回现有值');
  assert.ok(p.rows[0].existingId, '返回现有记录 ID');

  // 未选择 → 拒绝
  assert.throws(() => mkt.commitImportCsv(dataDir, { csv, by: 'board' }), /冲突|选择/, '冲突行需选择修订或跳过');
  let eff = mkt.readEffect(dataDir, {});
  assert.equal(eff.cards.find((c) => c.metricKey === 'activations').value, 12, '不静默相加');

  // skip → 保持原值
  const c1 = mkt.commitImportCsv(dataDir, { csv, choices: { 2: { action: 'skip' } }, by: 'board' });
  assert.equal(c1.skipped, 1);
  eff = mkt.readEffect(dataDir, {});
  assert.equal(eff.cards.find((c) => c.metricKey === 'activations').value, 12);

  // revise 缺理由 → 拒绝
  assert.throws(() => mkt.commitImportCsv(dataDir, { csv, choices: { 2: { action: 'revise' } }, by: 'board' }),
    (e) => !!(e.fields && e.fields['rows.2.reason']), '修订缺理由定位字段');
  // revise 带理由
  const c2 = mkt.commitImportCsv(dataDir, { csv, choices: { 2: { action: 'revise', reason: '原值少统计一天' } }, by: 'board' });
  assert.equal(c2.revised, 1);
  eff = mkt.readEffect(dataDir, {});
  const card = eff.cards.find((c) => c.metricKey === 'activations');
  assert.equal(card.value, 20, '修订后展示新值');
  assert.equal(card.revision, 2, '卡片透出修订号');
});

t('M9 readEffect 卡片：三态、存量取最新、关注不跨平台、币种分开、同单位求和', () => {
  const { dataDir } = mkProject();
  const chX = seedChannel(dataDir, 'X');
  const chR = seedChannel(dataDir, 'Reddit');

  // 未录入
  let eff = mkt.readEffect(dataDir, {});
  assert.equal(eff.cards.find((c) => c.metricKey === 'likes').status, 'none', '无观察=未录入');

  // 真实零 vs 数值
  mkt.recordObservation(dataDir, { data: obs({ metricKey: 'payers', value: 0 }), by: 'board' });
  mkt.recordObservation(dataDir, { data: obs({ metricKey: 'activations', value: 12 }), by: 'board' });
  eff = mkt.readEffect(dataDir, {});
  assert.equal(eff.cards.find((c) => c.metricKey === 'payers').value, 0);
  assert.equal(eff.cards.find((c) => c.metricKey === 'activations').value, 12);

  // 存量（粉丝总数）：两个周期取最新，不跨日期相加
  mkt.recordObservation(dataDir, { data: obs({ metricKey: 'starsTotal', dateStart: '2026-08-25', dateEnd: '2026-08-31', value: 21 }), by: 'board' });
  mkt.recordObservation(dataDir, { data: obs({ metricKey: 'starsTotal', dateStart: '2026-09-01', dateEnd: '2026-09-07', value: 34 }), by: 'board' });
  eff = mkt.readEffect(dataDir, {});
  assert.equal(eff.cards.find((c) => c.metricKey === 'starsTotal').value, 34, '存量取最新周期');

  // 关注类（订阅新增 delta）：跨平台分开呈现，不求和
  mkt.recordObservation(dataDir, { data: obs({ metricKey: 'subsNew', channelId: chX.id, value: 3 }), by: 'board' });
  mkt.recordObservation(dataDir, { data: obs({ metricKey: 'subsNew', channelId: chR.id, value: 5 }), by: 'board' });
  eff = mkt.readEffect(dataDir, {});
  const subs = eff.cards.find((c) => c.metricKey === 'subsNew');
  assert.equal(subs.status, 'split', '跨平台分开呈现');
  assert.equal(subs.parts.length, 2);
  assert.notEqual(subs.parts[0].value + subs.parts[1].value, subs.value || 0, '不展示伪去重总数');
  assert.match(subs.note, /不跨平台/, '卡片说明');

  // 不同币种分开呈现（收入 CNY + USD）
  mkt.recordObservation(dataDir, { data: obs({ metricKey: 'revenue', value: 680, unit: 'CNY' }), by: 'board' });
  mkt.recordObservation(dataDir, { data: obs({ metricKey: 'revenue', dateStart: '2026-09-08', dateEnd: '2026-09-14', value: 90, unit: 'USD' }), by: 'board' });
  eff = mkt.readEffect(dataDir, {});
  const revCard = eff.cards.find((c) => c.metricKey === 'revenue');
  assert.equal(revCard.status, 'split', '不同币种分开');
  assert.deepEqual(revCard.parts.map((p) => p.unit).sort(), ['CNY', 'USD']);
  assert.match(revCard.note, /币种/);

  // 同单位期间增量（点赞）跨周期求和
  mkt.recordObservation(dataDir, { data: obs({ metricKey: 'likes', value: 51, dateStart: '2026-08-25', dateEnd: '2026-08-31' }), by: 'board' });
  mkt.recordObservation(dataDir, { data: obs({ metricKey: 'likes', value: 87 }), by: 'board' });
  eff = mkt.readEffect(dataDir, {});
  assert.equal(eff.cards.find((c) => c.metricKey === 'likes').value, 138, '同口径可加求和');

  // 独立人数（访客）跨周期 / 跨范围不相加
  mkt.recordObservation(dataDir, { data: obs({ metricKey: 'visitors', value: 230 }), by: 'board' });
  mkt.recordObservation(dataDir, { data: obs({ metricKey: 'visitors', value: 180, dateStart: '2026-08-25', dateEnd: '2026-08-31' }), by: 'board' });
  eff = mkt.readEffect(dataDir, {});
  const vis = eff.cards.find((c) => c.metricKey === 'visitors');
  assert.equal(vis.status, 'split', '独立人数按去重口径分开呈现');
  assert.match(vis.note, /去重|独立/);
});

t('M10 派生转化率：口径一致才计算；分母为零 / 未录入 / 范围不一致给出原因', () => {
  const { dataDir } = mkProject();
  // 无数据 → 分母未录入
  let eff = mkt.readEffect(dataDir, {});
  let d = eff.derived.find((x) => x.key === 'activationRate');
  assert.equal(d.status, 'not-computable');
  assert.match(d.reason, /未录入/);

  // 范围不一致（访客周期不同）→ 口径不一致
  mkt.recordObservation(dataDir, { data: obs({ metricKey: 'activations', value: 12 }), by: 'board' });
  mkt.recordObservation(dataDir, { data: obs({ metricKey: 'visitors', value: 230, dateStart: '2026-08-25', dateEnd: '2026-08-31' }), by: 'board' });
  eff = mkt.readEffect(dataDir, {});
  d = eff.derived.find((x) => x.key === 'activationRate');
  assert.equal(d.status, 'not-computable');
  assert.match(d.reason, /口径|范围/);

  // 对齐 + 分母有效 → 计算
  mkt.recordObservation(dataDir, { data: obs({ metricKey: 'visitors', value: 240, source: 'CSV 导入' }), by: 'board' });
  eff = mkt.readEffect(dataDir, {});
  d = eff.derived.find((x) => x.key === 'activationRate');
  assert.equal(d.status, 'value');
  assert.equal(d.value, 0.05, '12/240');

  // 分母为零 → 不可计算
  const { dataDir: d2 } = mkProject();
  mkt.recordObservation(d2, { data: obs({ metricKey: 'activations', value: 3 }), by: 'board' });
  mkt.recordObservation(d2, { data: obs({ metricKey: 'visitors', value: 0 }), by: 'board' });
  const e2 = mkt.readEffect(d2, {});
  const dz = e2.derived.find((x) => x.key === 'activationRate');
  assert.equal(dz.status, 'not-computable');
  assert.match(dz.reason, /分母为零/);
});

t('M11 复盘：快照固定（后续观察修订不改变历史复盘依据）', () => {
  const { dataDir } = mkProject();
  const o1 = mkt.recordObservation(dataDir, { data: obs({ value: 12 }), by: 'board' }).observation;
  const r = mkt.createReview(dataDir, {
    data: {
      experimentId: null, periodStart: '2026-09-01', periodEnd: '2026-09-07',
      target: '激活 ≥ 10 人', actual: '12 人', basis: '效果页观察记录', conclusion: '达成假设', nextStep: '扩大投放',
    },
    by: 'board',
  });
  const rv = r.review;
  assert.match(rv.id, /^rev-/);
  assert.equal(rv.insufficient, false);
  assert.equal(rv.snapshot.length, 1, '快照捕获周期内观察');
  assert.equal(rv.snapshot[0].value, 12);
  assert.equal(rv.snapshot[0].observationId, o1.id);
  assert.equal(rv.snapshot[0].revision, o1.revision);

  // 后续修订观察 → 快照不变
  mkt.recordObservation(dataDir, { data: obs({ value: 99, reason: '重新统计' }), by: 'board' });
  const eff = mkt.readEffect(dataDir, {});
  const rv2 = eff.reviews.find((x) => x.id === rv.id);
  assert.equal(rv2.snapshot[0].value, 12, '复盘依据不随数据修订改变');
  assert.equal(rv2.snapshot[0].revision, 1);
});

t('M12 复盘校验与数据不足：必填定位字段；实验不存在拒绝；无数据未标数据不足拒绝；标记后可保存', () => {
  const { dataDir } = mkProject();
  const base = { periodStart: '2026-09-01', periodEnd: '2026-09-14' };
  assert.throws(() => mkt.createReview(dataDir, { data: { ...base }, by: 'board' }),
    (e) => !!(e.fields && e.fields.conclusion), '结论必填');
  assert.throws(() => mkt.createReview(dataDir, { data: { ...base, conclusion: 'x', experimentId: 'exp-x' }, by: 'board' }),
    (e) => !!(e.fields && e.fields.experimentId), '实验不存在定位字段');
  assert.throws(() => mkt.createReview(dataDir, {
    data: { ...base, conclusion: 'x', target: 't', actual: 'a' }, by: 'board',
  }), (e) => !!(e.fields && e.fields.insufficient), '无数据未标数据不足拒绝');
  const r = mkt.createReview(dataDir, {
    data: { ...base, conclusion: '样本不足，暂不能判断', insufficient: true }, by: 'board',
  });
  assert.equal(r.review.insufficient, true);
  assert.equal(r.review.snapshot.length, 0, '不伪造依据');
  assert.equal(r.review.target, '', '不伪造目标 / 实际');
});

t('M13 readEffect 筛选：渠道 / 实验 / 日期范围', () => {
  const { dataDir } = mkProject();
  const ch = seedChannel(dataDir, 'X');
  const exp = seedExperiment(dataDir, ch.id);
  mkt.recordObservation(dataDir, { data: obs({ channelId: ch.id, experimentId: exp.id, value: 5 }), by: 'board' });
  mkt.recordObservation(dataDir, { data: obs({ value: 7, dateStart: '2026-09-08', dateEnd: '2026-09-14' }), by: 'board' });

  let eff = mkt.readEffect(dataDir, { channelId: ch.id });
  assert.equal(eff.observations.length, 1, '渠道过滤');
  assert.equal(eff.cards.find((c) => c.metricKey === 'activations').value, 5);

  eff = mkt.readEffect(dataDir, { experimentId: exp.id });
  assert.equal(eff.observations.length, 1, '实验过滤');

  eff = mkt.readEffect(dataDir, { from: '2026-09-08', to: '2026-09-30' });
  assert.equal(eff.observations.length, 1, '日期范围过滤');
  assert.equal(eff.observations[0].dateStart, '2026-09-08');

  // 复盘归属实验过滤
  mkt.createReview(dataDir, {
    data: { experimentId: exp.id, periodStart: '2026-09-01', periodEnd: '2026-09-07', conclusion: 'c', insufficient: true },
    by: 'board',
  });
  eff = mkt.readEffect(dataDir, { experimentId: exp.id });
  assert.equal(eff.reviews.length, 1);
  eff = mkt.readEffect(dataDir, {});
  assert.equal(eff.reviews.length, 1, '未过滤时全部复盘');
});

t('M14 观察读取：损坏文件只读占位，其余照常；修订入口拒绝损坏观察', () => {
  const { dataDir } = mkProject();
  const a = mkt.recordObservation(dataDir, { data: obs({ value: 12 }), by: 'board' }).observation;
  const b = mkt.recordObservation(dataDir, { data: obs({ value: 3, dateStart: '2026-09-08', dateEnd: '2026-09-14' }), by: 'board' }).observation;
  fs.writeFileSync(path.join(dataDir, 'marketing', 'metrics', 'observations', `${b.id}.json`), '{ broken');
  const eff = mkt.readEffect(dataDir, {});
  assert.equal(eff.observations.find((o) => o.id === b.id).corrupt, true, '损坏只读占位');
  assert.ok(eff.observations.find((o) => o.id === a.id).corrupt === undefined, '其余照常');
  assert.equal(eff.cards.find((c) => c.metricKey === 'activations').value, 12, '损坏记录不参与汇总');
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
