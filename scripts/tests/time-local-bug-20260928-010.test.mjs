// BUG-20260928-010：在独立时区进程中执行实际界面格式化函数，覆盖跨日与夏令时。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

if (!process.env.ATB_TIME_TEST_CHILD) {
  for (const tz of ['Asia/Shanghai', 'America/Los_Angeles', 'UTC']) {
    const result = spawnSync(process.execPath, [fileURLToPath(import.meta.url)], {
      env: { ...process.env, TZ: tz, ATB_TIME_TEST_CHILD: '1' }, encoding: 'utf8',
    });
    assert.equal(result.status, 0, `${tz}: ${result.stdout}\n${result.stderr}`);
    process.stdout.write(result.stdout);
  }
} else {
  const times = {
    'Asia/Shanghai': ['2026-09-28 17:56:07', '2027-01-01 07:30:09', '2026-01-01 08:30:11'],
    'America/Los_Angeles': ['2026-09-28 02:56:07', '2026-12-31 15:30:09', '2025-12-31 16:30:11'],
    UTC: ['2026-09-28 09:56:07', '2026-12-31 23:30:09', '2026-01-01 00:30:11'],
  }[process.env.TZ];
  const inputs = ['2026-09-28T09:56:07.000Z', '2026-12-31T23:30:09Z', '2026-01-01T00:30:11Z'];
  for (const name of ['build', 'release', 'app', 'oncall', 'marketing', 'req-disc']) {
    const source = fs.readFileSync(new URL(`../web/${name}.js`, import.meta.url), 'utf8');
    const declaration = source.match(/(?:const fmtTime = [\s\S]*?;\n(?=  (?:const|\/\/))|function fmtTime\(iso\) \{[\s\S]*?\n\s*\})/);
    assert.ok(declaration, `${name} 时间格式化入口存在`);
    const fn = vm.runInNewContext(`${declaration[0]}\nfmtTime`);
    const expected = (s) => name === 'release' ? s : ['build', 'req-disc'].includes(name) ? s.slice(0, 16) : s.slice(5, 16);
    inputs.forEach((input, i) => assert.equal(fn(input), expected(times[i]), `${name} ${input}`));
    assert.equal(fn('2026-09-28T17:56:07+08:00'), expected(times[0]), `${name} 显式偏移`);
    if (['build', 'release'].includes(name)) {
      for (const empty of [null, undefined, '', 'invalid']) assert.equal(fn(empty), '—', `${name} 空值或无效时间`);
    }
  }
  console.log(`✓ ${process.env.TZ}：六个界面入口本地时间、跨年、偏移与空值检查通过`);
}
