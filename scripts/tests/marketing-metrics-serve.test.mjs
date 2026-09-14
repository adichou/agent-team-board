#!/usr/bin/env node
// REQ-20260910-021 效果与复盘 —— 服务接口测试（E1~E5）
// 覆盖：effect 读取（空态 / 卡片 / 筛选）、手工观察（201 / 修订缺理由 400 / 未知指标 400）、
// CSV 预览与提交（行级错误 400 且不写入 / 模板端点）、复盘创建（201 / 400 / 快照标注）、
// 自定义指标（201 / 重复 key 400）。
// 用法：node scripts/tests/marketing-metrics-serve.test.mjs

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function req(port, method, pathname, body) {
  return new Promise((resolve, reject) => {
    const payload = body == null ? null : JSON.stringify(body);
    const r = http.request({
      hostname: '127.0.0.1', port, path: pathname, method,
      headers: payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {},
      timeout: 6000,
    }, (rs) => {
      const chunks = [];
      rs.on('data', (c) => chunks.push(c));
      rs.on('end', () => {
        const buf = Buffer.concat(chunks);
        let json = null;
        try { json = JSON.parse(buf.toString() || '{}'); } catch {}
        resolve({ status: rs.statusCode, json, text: buf.toString() });
      });
    });
    r.on('error', reject);
    r.on('timeout', () => { r.destroy(); reject(new Error('timeout')); });
    if (payload) r.write(payload);
    r.end();
  });
}

const cases = [];
const t = (name, fn) => cases.push([name, fn]);

const CSV_OK = [
  'date_start,date_end,metric,value,currency,channel,experiment,source,tz',
  '2026-09-01,2026-09-07,订阅新增,3,人,,,,UTC+8',
  '2026-09-01,2026-09-07,激活,13,人,,,,UTC+8',
].join('\n');
const CSV_BAD = [
  'date_start,date_end,metric,value,currency,channel,experiment,source,tz',
  '2026-09-01,2026-09-07,点赞,45,次,,,,UTC+8',
  '2026-09-01,2026-09-07,点赞,abc,次,,,,UTC+8',
].join('\n');

t('E1~E5 /api/marketing 效果与复盘接口', async () => {
  const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'atb-mkt-metrics-serve-')));
  const root = path.join(tmp, 'proj');
  fs.mkdirSync(root);
  fs.writeFileSync(path.join(root, 'README.md'), '# Demo\n\n效果页服务测试项目。\n');
  await new Promise((resolve) => {
    const p = spawn(process.execPath, [path.join(pluginRoot, 'scripts', 'atb.mjs'), 'init', '--dir', root], { stdio: 'ignore' });
    p.on('close', resolve);
  });

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
      try { await req(port, 'GET', '/api/health'); up = true; break; } catch {}
    }
    assert.ok(up, '服务应启动');

    // E1：未初始化营销 → effect 空态；初始化后返回定义 / 卡片 / 观察 / 复盘
    let r = await req(port, 'GET', `/api/marketing/effect${P}`);
    assert.equal(r.status, 200);
    assert.equal(r.json.initialized, false);
    await req(port, 'POST', `/api/marketing/init${P}`, {});
    r = await req(port, 'GET', `/api/marketing/effect${P}`);
    assert.equal(r.json.initialized, true);
    assert.ok(r.json.definitions.length >= 15, '默认指标字典');
    assert.ok(r.json.cards.some((c) => c.metricKey === 'subsNew'));
    assert.deepEqual(r.json.observations, []);
    assert.deepEqual(r.json.reviews, []);
    const likesNone = r.json.cards.find((c) => c.metricKey === 'likes');
    assert.equal(likesNone.status, 'none', '未录入');

    // E2：手工观察——合法 201；修订缺理由 400 fields；未知指标 400
    r = await req(port, 'POST', `/api/marketing/observation${P}`, {
      data: { metricKey: '激活', dateStart: '2026-09-01', dateEnd: '2026-09-07', value: 12 },
    });
    assert.equal(r.status, 201);
    assert.equal(r.json.created, true);
    assert.equal(r.json.observation.source, '手工记录');
    r = await req(port, 'POST', `/api/marketing/observation${P}`, {
      data: { metricKey: '激活', dateStart: '2026-09-01', dateEnd: '2026-09-07', value: 13 },
    });
    assert.equal(r.status, 400);
    assert.ok(r.json.fields && r.json.fields.reason, '修订缺理由定位字段');
    r = await req(port, 'POST', `/api/marketing/observation${P}`, {
      data: { metricKey: '跳出率', dateStart: '2026-09-01', dateEnd: '2026-09-07', value: 1 },
    });
    assert.equal(r.status, 400);
    assert.ok(r.json.fields && r.json.fields.metricKey, '未知指标定位字段');
    r = await req(port, 'POST', `/api/marketing/observation${P}`, {
      data: { metricKey: '激活', dateStart: '2026-09-01', dateEnd: '2026-09-07', value: 13, reason: '重新统计' },
    });
    assert.equal(r.status, 200);
    assert.equal(r.json.revised, true);

    // effect 卡片反映修订值 + 筛选
    r = await req(port, 'GET', `/api/marketing/effect${P}&from=2026-09-01&to=2026-09-07`);
    assert.equal(r.json.cards.find((c) => c.metricKey === 'activations').value, 13);
    r = await req(port, 'GET', `/api/marketing/effect${P}&from=2026-09-08&to=2026-09-30`);
    assert.equal(r.json.cards.find((c) => c.metricKey === 'activations').status, 'none', '日期范围外未录入');

    // E3：CSV 预览与提交
    r = await req(port, 'GET', `/api/marketing/import/template${P}`);
    assert.equal(r.status, 200);
    assert.ok(r.text.startsWith('date_start,date_end,metric'), '模板为 UTF-8 CSV 文本');
    assert.match(r.text, /订阅新增/);

    r = await req(port, 'POST', `/api/marketing/import/preview${P}`, { csv: CSV_BAD });
    assert.equal(r.status, 200);
    assert.equal(r.json.ok, false);
    const errRow = r.json.rows.find((x) => x.status === 'error');
    assert.equal(errRow.rowNo, 3, '错误行行号');
    assert.match(errRow.error, /数字/);

    r = await req(port, 'POST', `/api/marketing/import/commit${P}`, { csv: CSV_BAD });
    assert.equal(r.status, 400);
    assert.ok(r.json.fields && r.json.fields['rows.3'], '错误行阻止提交并定位');
    r = await req(port, 'GET', `/api/marketing/effect${P}`);
    assert.equal(r.json.cards.find((c) => c.metricKey === 'likes').status, 'none', '不写入部分数据');

    // 合法导入 → 提交成功（激活 13 行与既有手工修订一致 → 幂等不变）；重复导入无变化
    r = await req(port, 'POST', `/api/marketing/import/commit${P}`, { csv: CSV_OK });
    assert.equal(r.status, 200);
    assert.equal(r.json.created, 1);
    assert.equal(r.json.unchanged, 1, '来源不同但同键同值不重复计算');
    r = await req(port, 'POST', `/api/marketing/import/commit${P}`, { csv: CSV_OK });
    assert.equal(r.json.created, 0);
    assert.equal(r.json.unchanged, 2, '重复导入为无变化');

    // 值冲突（激活 12→99）：未选择 400；选择修订成功
    const conflictCsv = 'date_start,date_end,metric,value,currency,channel,experiment,source,tz\n2026-09-01,2026-09-07,激活,99,人,,,,UTC+8';
    r = await req(port, 'POST', `/api/marketing/import/preview${P}`, { csv: conflictCsv });
    assert.equal(r.json.rows[0].status, 'conflict');
    r = await req(port, 'POST', `/api/marketing/import/commit${P}`, { csv: conflictCsv });
    assert.equal(r.status, 400);
    assert.match(r.json.fields['rows.2'], /修订|跳过/);
    r = await req(port, 'POST', `/api/marketing/import/commit${P}`, {
      csv: conflictCsv, choices: { 2: { action: 'revise', reason: '后台修正统计口径' } },
    });
    assert.equal(r.status, 200);
    assert.equal(r.json.revised, 1);

    // E4：复盘创建——缺必填 400；合法 201；effect 含复盘与快照
    r = await req(port, 'POST', `/api/marketing/review${P}`, {
      data: { periodStart: '2026-09-01', periodEnd: '2026-09-07' },
    });
    assert.equal(r.status, 400);
    assert.ok(r.json.fields && r.json.fields.conclusion, '结论必填');
    r = await req(port, 'POST', `/api/marketing/review${P}`, {
      data: {
        periodStart: '2026-09-01', periodEnd: '2026-09-07',
        target: '激活 ≥ 10 人', actual: '99 人', basis: '效果页观察记录',
        conclusion: '显著超出预期', nextStep: '扩大渠道投入',
      },
    });
    assert.equal(r.status, 201);
    assert.ok(r.json.review.snapshot.length >= 2, '快照捕获周期内观察');
    assert.ok(r.json.review.snapshot.every((s) => s.observationId));
    r = await req(port, 'GET', `/api/marketing/effect${P}`);
    assert.equal(r.json.reviews.length, 1);
    assert.equal(r.json.reviews[0].conclusion, '显著超出预期');
    assert.ok(r.json.reviews[0].snapshot.length >= 2, 'effect 复盘含快照');

    // E5：自定义指标——201；重复 key 400；可用于观察
    r = await req(port, 'POST', `/api/marketing/metric${P}`, {
      data: { name: '邮件打开', key: 'emailOpens', category: 'engagement', kind: 'events', unit: '次' },
    });
    assert.equal(r.status, 201);
    assert.equal(r.json.definition.key, 'emailOpens');
    r = await req(port, 'POST', `/api/marketing/metric${P}`, {
      data: { name: '邮件打开2', key: 'emailOpens', category: 'engagement', kind: 'events', unit: '次' },
    });
    assert.equal(r.status, 400);
    assert.ok(r.json.fields && r.json.fields.key, '重复 key 定位字段');
    r = await req(port, 'POST', `/api/marketing/observation${P}`, {
      data: { metricKey: 'emailOpens', dateStart: '2026-09-01', dateEnd: '2026-09-07', value: 40 },
    });
    assert.equal(r.status, 201);
    r = await req(port, 'GET', `/api/marketing/effect${P}`);
    assert.equal(r.json.cards.find((c) => c.metricKey === 'emailOpens').value, 40);
  } finally {
    server.kill('SIGKILL');
  }
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
