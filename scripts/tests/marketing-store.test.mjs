#!/usr/bin/env node
// REQ-20260910-019 营销档案 / 定位与定价版本管理 —— 数据层测试（S1~S10）
// 覆盖：初始化（README 草稿 / 幂等拒绝 / 未初始化看板）、定位+证据保存与校验、
// 金额字段校验、revision 冲突（旧文件不动）、定价版本不可变与显式设当前、
// 同名不同路径项目隔离、损坏文件处理
// 用法：node scripts/tests/marketing-store.test.mjs

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
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'atb-marketing-store-')));
  core.initData(root);
  if (readme != null) fs.writeFileSync(path.join(root, 'README.md'), readme);
  const dataDir = core.dataDirFrom(root);
  return { root, dataDir };
}

const README = '# Demo App\n\n一句话介绍：本地优先的团队看板。\n\n## 安装\n\nnpm i\n';

const positioning = (over = {}) => ({
  intro: '产品简介甲',
  stage: 'validating',
  markets: '北美 / 中文、英文',
  audience: '独立开发者',
  scenarios: '需求跟踪',
  painPoints: '工具割裂',
  alternatives: 'Trello、Linear',
  differentiators: '零依赖本地服务',
  links: 'https://example.com',
  stageGoal: '验证首次使用价值',
  primaryMetric: '激活人数',
  budget: 100,
  weeklyHours: 6,
  ...over,
});

const pricing = (over = {}) => ({
  model: 'subscription',
  currency: 'CNY',
  cycle: 'monthly',
  packages: [{ name: '专业版', benefits: '全部功能', price: 29 }],
  costBasis: '服务器 + 人工',
  competitorBasis: '同类 SaaS 约 50 元/月',
  validationMethod: '落地页价格测试',
  ...over,
});

t('S1 未初始化=空态；初始化生成 README 草稿（intro 取首个非标题段落、stage=exploring、revision=1、无定价）', () => {
  const { root, dataDir } = mkProject(README);
  let st = mkt.readState(dataDir);
  assert.equal(st.initialized, false, '未建立营销档案前是空态');

  const p = mkt.initProfile(dataDir, { projectRoot: root, by: 'board' });
  assert.equal(p.positioning.intro, '一句话介绍：本地优先的团队看板。', 'README 首个非标题段落作简介草稿');
  assert.equal(p.positioning.stage, 'exploring');
  assert.equal(p.revision, 1);
  assert.deepEqual(p.evidence, []);
  assert.equal(p.currentPricing, null, '初始化没有当前定价');
  assert.ok(fs.existsSync(path.join(dataDir, 'marketing', 'profile.json')), '档案落盘 profile.json');

  st = mkt.readState(dataDir);
  assert.equal(st.initialized, true);
  assert.equal(st.profile.revision, 1);
  assert.deepEqual(st.versions, [], '初始无定价版本');
  assert.equal(st.current, null);
});

t('S2 重复初始化拒绝；无 dataDir（未初始化看板）初始化报错', () => {
  const { root, dataDir } = mkProject(README);
  mkt.initProfile(dataDir, { projectRoot: root, by: 'board' });
  assert.throws(() => mkt.initProfile(dataDir, { projectRoot: root, by: 'board' }), /已初始化|已建立/, '重复初始化应拒绝');
  assert.throws(() => mkt.initProfile(path.join(root, 'nowhere'), { projectRoot: root, by: 'board' }), /未找到/, '未初始化看板应报错');
});

t('S3 保存定位与证据：落盘 + revision 递增；证据类型非法给出字段错误', () => {
  const { root, dataDir } = mkProject(README);
  mkt.initProfile(dataDir, { projectRoot: root, by: 'board' });

  const saved = mkt.saveProfile(dataDir, {
    revision: 1,
    positioning: positioning(),
    evidence: [{ type: 'fact', content: '访谈 5 人中 4 人愿意付费', source: '访谈记录 A', collectedAt: '2026-09-10' }],
    by: 'board',
  });
  assert.equal(saved.profile.revision, 2, '保存成功 revision 递增');
  assert.equal(saved.profile.evidence.length, 1);
  assert.equal(saved.profile.evidence[0].id, 'ev-1', '证据条目分配稳定 ID');
  assert.equal(saved.profile.positioning.audience, '独立开发者');

  const st = mkt.readState(dataDir);
  assert.equal(st.profile.positioning.stage, 'validating');

  assert.throws(() => mkt.saveProfile(dataDir, {
    revision: 2,
    positioning: positioning(),
    evidence: [{ type: 'wild', content: 'x', source: '', collectedAt: '2026-09-10' }],
    by: 'board',
  }), (e) => {
    assert.ok(e.fields && e.fields['evidence.0.type'], '证据类型错误应定位到字段');
    return e instanceof core.AtbError;
  }, '非法证据类型应 400 且带字段');
});

t('S4 金额字段：负数 / 非数字拒绝并定位字段；null（未知）与正数通过', () => {
  const { root, dataDir } = mkProject(README);
  mkt.initProfile(dataDir, { projectRoot: root, by: 'board' });

  assert.throws(() => mkt.saveProfile(dataDir, { revision: 1, positioning: positioning({ budget: -5 }), evidence: [], by: 'board' }),
    (e) => !!(e.fields && e.fields['positioning.budget']), '预算为负应定位字段');
  assert.throws(() => mkt.saveProfile(dataDir, { revision: 1, positioning: positioning({ weeklyHours: 'abc' }), evidence: [], by: 'board' }),
    (e) => !!(e.fields && e.fields['positioning.weeklyHours']), '工时非数字应定位字段');

  const ok = mkt.saveProfile(dataDir, { revision: 1, positioning: positioning({ budget: null, weeklyHours: 0 }), evidence: [], by: 'board' });
  assert.equal(ok.profile.positioning.budget, null, 'null=未知可通过');
  assert.equal(ok.profile.positioning.weeklyHours, 0, '0=实际零可通过');
});

t('S5 revision 过期保存 → 冲突错误（带当前 revision），旧 profile.json 字节不变', () => {
  const { root, dataDir } = mkProject(README);
  mkt.initProfile(dataDir, { projectRoot: root, by: 'board' });
  mkt.saveProfile(dataDir, { revision: 1, positioning: positioning({ intro: '第一版' }), evidence: [], by: 'board' });
  const before = fs.readFileSync(path.join(dataDir, 'marketing', 'profile.json'), 'utf8');

  try {
    mkt.saveProfile(dataDir, { revision: 1, positioning: positioning({ intro: '陈旧写入' }), evidence: [], by: 'board' });
    assert.fail('过期 revision 应抛冲突');
  } catch (e) {
    assert.ok(e instanceof mkt.MarketingConflictError, '冲突错误类型可辨识');
    assert.equal(e.currentRevision, 2, '冲突错误携带服务端最新 revision');
  }
  const after = fs.readFileSync(path.join(dataDir, 'marketing', 'profile.json'), 'utf8');
  assert.equal(after, before, '冲突失败不改动旧文件');
});

t('S6 定价保存两次产生 v1、v2 且 v1 字节不变；保存新版本不改变当前定价指针', () => {
  const { root, dataDir } = mkProject(README);
  mkt.initProfile(dataDir, { projectRoot: root, by: 'board' });

  const v1 = mkt.savePricing(dataDir, { data: pricing({ packages: [{ name: '专业版', benefits: '全部功能', price: 29 }] }), by: 'board' });
  assert.equal(v1.version.version, 'v1');
  const v1Raw = fs.readFileSync(path.join(dataDir, 'marketing', 'pricing', 'v1.json'), 'utf8');

  const v2 = mkt.savePricing(dataDir, { data: pricing({ packages: [{ name: '专业版', benefits: '全部功能', price: 39 }] }), by: 'board' });
  assert.equal(v2.version.version, 'v2', '第二次保存生成新版本');

  assert.equal(fs.readFileSync(path.join(dataDir, 'marketing', 'pricing', 'v1.json'), 'utf8'), v1Raw, 'v1 不可覆盖');

  const st = mkt.readState(dataDir);
  assert.equal(st.profile.currentPricing, null, '保存候选不会自动成为当前定价');
  assert.deepEqual(st.versions.map((v) => v.version), ['v1', 'v2'], '版本历史保留');
});

t('S7 定价校验：模式枚举；非免费缺币种 / 订阅缺周期 → 字段错误；免费无币种可通过；价格非法定位字段；null=未知价格通过', () => {
  const { root, dataDir } = mkProject(README);
  mkt.initProfile(dataDir, { projectRoot: root, by: 'board' });

  assert.throws(() => mkt.savePricing(dataDir, { data: pricing({ model: 'donation' }), by: 'board' }),
    (e) => !!(e.fields && e.fields.model), '收费模式枚举外应定位字段');
  assert.throws(() => mkt.savePricing(dataDir, { data: pricing({ currency: '' }), by: 'board' }),
    (e) => !!(e.fields && e.fields.currency), '订阅缺币种应定位字段');
  assert.throws(() => mkt.savePricing(dataDir, { data: pricing({ model: 'onetime', currency: '', cycle: '' }), by: 'board' }),
    (e) => !!(e.fields && e.fields.currency), '买断缺币种应定位字段');
  assert.throws(() => mkt.savePricing(dataDir, { data: pricing({ cycle: '' }), by: 'board' }),
    (e) => !!(e.fields && e.fields.cycle), '订阅缺周期应定位字段');
  assert.throws(() => mkt.savePricing(dataDir, { data: pricing({ packages: [{ name: 'X', benefits: 'b', price: -1 }] }), by: 'board' }),
    (e) => !!(e.fields && e.fields['packages.0.price']), '负数价格应定位字段');
  assert.throws(() => mkt.savePricing(dataDir, { data: pricing({ packages: [{ name: 'X', benefits: 'b', price: '贵' }] }), by: 'board' }),
    (e) => !!(e.fields && e.fields['packages.0.price']), '非数字价格应定位字段');

  const free = mkt.savePricing(dataDir, { data: pricing({ model: 'free', currency: '', cycle: '', packages: [] }), by: 'board' });
  assert.equal(free.version.model, 'free', '免费模式无币种可通过');
  const unknown = mkt.savePricing(dataDir, { data: pricing({ packages: [{ name: '入门版', benefits: '基础功能', price: null }] }), by: 'board' });
  assert.equal(unknown.version.packages[0].price, null, '未知价格留 null，不生成无依据确定价');
});

t('S8 显式设为当前方案：成功更新指针；指向不存在版本拒绝', () => {
  const { root, dataDir } = mkProject(README);
  mkt.initProfile(dataDir, { projectRoot: root, by: 'board' });
  mkt.savePricing(dataDir, { data: pricing(), by: 'board' });
  mkt.savePricing(dataDir, { data: pricing({ packages: [{ name: '专业版', benefits: '全部功能', price: 39 }] }), by: 'board' });

  const st = mkt.setCurrentPricing(dataDir, { version: 'v1', by: 'board' });
  assert.equal(st.profile.currentPricing, 'v1');
  assert.equal(st.current, 'v1', '读取口径一致');
  assert.throws(() => mkt.setCurrentPricing(dataDir, { version: 'v9', by: 'board' }), /不存在/, '未知版本应拒绝');
});

t('S9 同名不同路径项目互不串数据', () => {
  const parent = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'atb-marketing-twin-')));
  const a = path.join(parent, 'proj');
  const b = path.join(parent, 'sub', 'proj');
  fs.mkdirSync(a, { recursive: true });
  fs.mkdirSync(b, { recursive: true });
  fs.writeFileSync(path.join(a, 'README.md'), '# A\n\n项目甲简介。\n');
  fs.writeFileSync(path.join(b, 'README.md'), '# B\n\n项目乙简介。\n');
  core.initData(a);
  core.initData(b);

  mkt.initProfile(core.dataDirFrom(a), { projectRoot: a, by: 'board' });
  mkt.initProfile(core.dataDirFrom(b), { projectRoot: b, by: 'board' });
  mkt.saveProfile(core.dataDirFrom(a), { revision: 1, positioning: positioning({ intro: '甲的定位' }), evidence: [], by: 'board' });

  const sa = mkt.readState(core.dataDirFrom(a));
  const sb = mkt.readState(core.dataDirFrom(b));
  assert.equal(sa.profile.positioning.intro, '甲的定位');
  assert.equal(sb.profile.positioning.intro, '项目乙简介。', '乙保持自己的 README 草稿');
  assert.equal(sb.profile.revision, 1, '乙未被甲的保存波及');
});

t('S10 损坏处理：profile.json 损坏读取报错不静默重建；单个定价版本损坏标注 corrupt、其余照常', () => {
  const { root, dataDir } = mkProject(README);
  mkt.initProfile(dataDir, { projectRoot: root, by: 'board' });
  mkt.savePricing(dataDir, { data: pricing(), by: 'board' });
  mkt.savePricing(dataDir, { data: pricing({ packages: [{ name: '专业版', benefits: '全部功能', price: 39 }] }), by: 'board' });

  fs.writeFileSync(path.join(dataDir, 'marketing', 'pricing', 'v2.json'), '{ broken json');
  let st = mkt.readState(dataDir);
  assert.equal(st.versions.length, 2, '损坏版本仍占历史位');
  assert.equal(st.versions.find((v) => v.version === 'v2').corrupt, true, '损坏版本标注 corrupt');
  assert.equal(st.versions.find((v) => v.version === 'v1').corrupt, undefined, 'v1 照常可读');

  fs.writeFileSync(path.join(dataDir, 'marketing', 'profile.json'), 'not json at all');
  assert.throws(() => mkt.readState(dataDir), /损坏|无法解析/, '档案损坏应报错而非静默重建');
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
