#!/usr/bin/env node
// REQ-20260915-002 官网双语材料（site-materials）测试 E1~E4
// 用法：node scripts/tests/site-materials.test.mjs

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as m from '../lib/site-materials.mjs';

const cases = [];
const t = (name, fn) => cases.push([name, fn]);

const LANGS = ['zh', 'en'];
const PAGES = ['index', 'usage', 'guide', 'changelog'];

function mkSite({ product = 'demo-app', skip = [] } = {}) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'atb-site-')));
  const contentDir = path.join(root, product);
  for (const lang of LANGS) {
    fs.mkdirSync(path.join(contentDir, lang), { recursive: true });
    for (const page of PAGES) {
      if (skip.includes(`${lang}/${page}`)) continue;
      fs.writeFileSync(path.join(contentDir, lang, `${page}.html`), `<!doctype html><html lang="${lang}"><meta name="site-version" content="1.2.0"><a href="#" data-webapp-entry>App</a> ${page}-${lang}`);
    }
  }
  return { root, contentDir };
}

t('E1 双语齐备 → 通过，指纹稳定', () => {
  const { contentDir } = mkSite();
  const r = m.checkSiteMaterials(contentDir);
  assert.equal(r.ok, true);
  assert.deepEqual(r.missing, []);
  assert.equal(r.files.length, LANGS.length * PAGES.length);
  const r2 = m.checkSiteMaterials(contentDir);
  assert.equal(r2.fingerprint, r.fingerprint);
});

t('E2 缺英文某页 → 列出缺失清单（语言+页面），不通过', () => {
  const { contentDir } = mkSite({ skip: ['en/guide', 'zh/changelog'] });
  const r = m.checkSiteMaterials(contentDir);
  assert.equal(r.ok, false);
  const keys = r.missing.map((x) => `${x.lang}/${x.page}`);
  assert.ok(keys.includes('en/guide'));
  assert.ok(keys.includes('zh/changelog'));
  assert.equal(r.missing.length, 2);
});

t('E3 内容变化 → 指纹变化（旧预检失效口径）', () => {
  const { contentDir } = mkSite();
  const before = m.checkSiteMaterials(contentDir).fingerprint;
  fs.writeFileSync(path.join(contentDir, 'zh/index.html'), 'changed');
  const after = m.checkSiteMaterials(contentDir).fingerprint;
  assert.notEqual(before, after);
  // 目录不存在 → 指纹 null（配置缺失口径）
  assert.equal(m.materialsFingerprint(path.join(contentDir, 'nope')), null);
});

t('E4 项目名安全子目录：非法项目名拒绝；正常项目名拼接内容目录', () => {
  const root = '/tmp/homepage';
  assert.equal(m.safeContentDir(root, 'demo-app'), path.join(root, 'demo-app'));
  for (const bad of ['..', 'a/b', 'a b', '.hidden-ok?', '', 'a\\b', '-abs']) {
    assert.throws(() => m.safeContentDir(root, bad), /项目名|子目录/, JSON.stringify(bad));
  }
  // path.join 归一后越界仍拒绝（防御性：传入带分隔符已在上面覆盖）
  assert.ok(m.safeContentDir(root, 'Agent-Team-Board.2').startsWith(root));
});

/* ---------- 执行 ---------- */

let failed = 0;
for (const [name, fn] of cases) {
  try {
    await fn();
    console.log(`✓ ${name}`);
  } catch (e) {
    failed++;
    console.error(`✗ ${name}\n${e && e.stack ? e.stack : e}`);
  }
}
console.log(`site-materials：${cases.length - failed}/${cases.length} 通过`);
process.exit(failed ? 1 : 0);
