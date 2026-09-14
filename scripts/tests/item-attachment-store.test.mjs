#!/usr/bin/env node
// REQ-20260909-009 新建需求 / Bug 描述支持截图 —— 数据层（core.createItem 附件扩展）测试 S1–S7。
// 用法：node scripts/tests/item-attachment-store.test.mjs

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const core = await import(new URL('../lib/core.mjs', import.meta.url));

const cases = [];
const t = (name, fn) => cases.push([name, fn]);

function tmpDataDir() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atb-item-att-'));
  const dataDir = path.join(root, 'docs', 'agent-team-board');
  fs.mkdirSync(dataDir, { recursive: true });
  return dataDir;
}

const b64 = (s) => Buffer.from(s).toString('base64');
const attDir = (dataDir, id) => path.join(dataDir, 'requirements', id, 'attachments');
const bugAttDir = (dataDir, id) => path.join(dataDir, 'bugs', id, 'attachments');
const readme = (dataDir, id, bug = false) =>
  fs.readFileSync(path.join(dataDir, bug ? 'bugs' : 'requirements', id, 'README.md'), 'utf8');

t('S1 创建带附件：落盘 attachments/ 子目录，README 描述（需求）/ 现象（Bug）节末尾按添加顺序追加引用行', () => {
  const dataDir = tmpDataDir();
  const st = core.createItem(dataDir, {
    type: 'requirement',
    title: '带截图的需求',
    description: '看下面的截图',
    by: 't',
    attachments: [
      { name: 'a.png', dataBase64: b64('png-a') },
      { name: 'b.jpg', dataBase64: b64('jpg-b') },
    ],
  });
  assert.match(st.id, /^REQ-\d{8}-\d{3}$/);
  assert.deepEqual(fs.readdirSync(attDir(dataDir, st.id)).sort(), ['a.png', 'b.jpg']);
  assert.equal(fs.readFileSync(path.join(attDir(dataDir, st.id), 'a.png'), 'utf8'), 'png-a');
  const md = readme(dataDir, st.id);
  assert.match(md, /## 描述\n\n看下面的截图\n\n!\[截图\]\(attachments\/a\.png\)\n!\[截图\]\(attachments\/b\.jpg\)\n\n## 验收标准/, '引用行应按添加顺序追加在描述节末尾');

  const bug = core.createItem(dataDir, {
    type: 'bug',
    title: '带截图的 Bug',
    description: '现象见截图',
    by: 't',
    attachments: [{ name: 'err.png', dataBase64: b64('png-err') }],
  });
  assert.deepEqual(fs.readdirSync(bugAttDir(dataDir, bug.id)), ['err.png']);
  const bmd = readme(dataDir, bug.id, true);
  assert.match(bmd, /## 现象\n\n现象见截图\n\n!\[截图\]\(attachments\/err\.png\)\n\n## 复现步骤/, 'Bug 引用行应追加在现象节末尾');
});

t('S1b 描述为空但有附件：描述节只写引用行（不写「（待补充）」占位）', () => {
  const dataDir = tmpDataDir();
  const st = core.createItem(dataDir, {
    type: 'requirement', title: '空描述带图', description: '', by: 't',
    attachments: [{ name: 'only.png', dataBase64: b64('x') }],
  });
  const md = readme(dataDir, st.id);
  assert.doesNotMatch(md, /（待补充）\n\n!\[截图\]/);
  assert.match(md, /## 描述\n\n!\[截图\]\(attachments\/only\.png\)\n\n## 验收标准/);
});

t('S2 同名附件自动加序号不覆盖，README 引用落盘后的最终文件名', () => {
  const dataDir = tmpDataDir();
  const st = core.createItem(dataDir, {
    type: 'bug', title: '同名去重', description: '', by: 't',
    attachments: [
      { name: 'shot.png', dataBase64: b64('one') },
      { name: 'shot.png', dataBase64: b64('two') },
    ],
  });
  assert.deepEqual(fs.readdirSync(bugAttDir(dataDir, st.id)).sort(), ['shot-2.png', 'shot.png']);
  assert.equal(fs.readFileSync(path.join(bugAttDir(dataDir, st.id), 'shot.png'), 'utf8'), 'one');
  assert.equal(fs.readFileSync(path.join(bugAttDir(dataDir, st.id), 'shot-2.png'), 'utf8'), 'two');
  const md = readme(dataDir, st.id, true);
  assert.match(md, /!\[截图\]\(attachments\/shot\.png\)\n!\[截图\]\(attachments\/shot-2\.png\)/, '引用行应使用去重后的最终文件名');
});

t('S3 服务端二次校验整单拒绝：非白名单后缀 / 超 8MB / 防穿越文件名 / 缺数据，不创建目录不占号', () => {
  const dataDir = tmpDataDir();
  core.createItem(dataDir, { type: 'requirement', title: '占位', by: 't' }); // 占 001 号
  const before = fs.readdirSync(path.join(dataDir, 'requirements'));
  const bad = [
    [{ name: 'evil.sh', dataBase64: b64('x') }],                                        // 非白名单后缀
    [{ name: 'big.png', dataBase64: Buffer.alloc(8 * 1024 * 1024 + 1).toString('base64') }], // 超 8MB
    [{ name: '../escape.png', dataBase64: b64('x') }],                                  // 穿越
    [{ name: 'no-data.png' }],                                                          // 缺数据
    [{ name: 'ok.png', dataBase64: b64('x') }, { name: 'bad.txt', dataBase64: b64('x') }], // 混合非法也整单拒绝
  ];
  for (const attachments of bad) {
    assert.throws(
      () => core.createItem(dataDir, { type: 'requirement', title: '被拒', by: 't', attachments }),
      (e) => {
        assert.ok(e instanceof core.AtbError, '应为 AtbError（服务端映射 400）');
        assert.match(e.message, /图片|8MB|文件名|数据/);
        return true;
      },
    );
  }
  assert.deepEqual(fs.readdirSync(path.join(dataDir, 'requirements')), before, '被拒的单不得留下半写入条目目录');
});

t('S4 张数上限 9：第 10 张整单拒绝', () => {
  const dataDir = tmpDataDir();
  const nine = Array.from({ length: 9 }, (_, i) => ({ name: `s${i}.png`, dataBase64: b64('x') }));
  const st = core.createItem(dataDir, { type: 'requirement', title: '九张', by: 't', attachments: nine });
  assert.equal(fs.readdirSync(attDir(dataDir, st.id)).length, 9, '恰好 9 张应成功');
  const ten = [...nine, { name: 't.png', dataBase64: b64('x') }];
  assert.throws(
    () => core.createItem(dataDir, { type: 'requirement', title: '十张', by: 't', attachments: ten }),
    /9|张/,
  );
  assert.equal(fs.readdirSync(path.join(dataDir, 'requirements')).length, 1, '超限整单拒绝不留目录');
});

t('S5 无附件创建口径不变：README 无引用行、无 attachments/ 目录', () => {
  const dataDir = tmpDataDir();
  const st = core.createItem(dataDir, { type: 'requirement', title: '纯文本', description: '描述', by: 't' });
  const md = readme(dataDir, st.id);
  assert.match(md, /## 描述\n\n描述\n\n## 验收标准/);
  assert.doesNotMatch(md, /attachments\//);
  assert.equal(fs.existsSync(attDir(dataDir, st.id)), false, '无附件不应创建 attachments 目录');
});

t('S6 「✎ 修改」兼容：载入描述（含图片行）；仅改标题不动描述节；改描述整体替换保留图片行', () => {
  const dataDir = tmpDataDir();
  const st = core.createItem(dataDir, {
    type: 'bug', title: '编辑兼容', description: '现象描述', by: 't',
    attachments: [{ name: 'shot.png', dataBase64: b64('x') }],
  });
  // 载入口径：readDescriptionSection 返回的原文包含图片引用行（前端编辑框以此预填）
  const cur = core.readDescriptionSection(path.join(dataDir, 'bugs', st.id), 'bug');
  assert.match(cur, /!\[截图\]\(attachments\/shot\.png\)/, '描述节原文应包含图片行');

  // 仅改标题：描述节不动（图片行保留）
  core.editItem(dataDir, st.id, { title: '编辑兼容改', by: 't' });
  const md1 = readme(dataDir, st.id, true);
  assert.match(md1, /# BUG-[\d-]+ 编辑兼容改/);
  assert.match(md1, /## 现象\n\n现象描述\n\n!\[截图\]\(attachments\/shot\.png\)/, '仅改标题不得清除图片行');

  // 改描述整体替换：基于载入原文（含图片行）补充内容保存 → 图片行与新增内容都在
  core.editItem(dataDir, st.id, { description: `${cur}\n\n补充：详情见上图`, by: 't' });
  const md2 = readme(dataDir, st.id, true);
  assert.match(md2, /!\[截图\]\(attachments\/shot\.png\)/, '描述整体替换不意外清除图片行');
  assert.match(md2, /补充：详情见上图/, '新增描述应写入');
  const section2 = core.readDescriptionSection(path.join(dataDir, 'bugs', st.id), 'bug');
  assert.ok(section2.includes('![截图](attachments/shot.png)') && section2.includes('补充：详情见上图'), '图片行与新增内容均应在现象节内');
});

t('S7 附件读取：白名单 + 防穿越 + 8MB 展示上限', () => {
  const dataDir = tmpDataDir();
  const st = core.createItem(dataDir, {
    type: 'requirement', title: '读取', description: '', by: 't',
    attachments: [{ name: 'ok.png', dataBase64: b64('bytes') }],
  });
  const dir = path.join(dataDir, 'requirements', st.id);
  assert.equal(core.readItemAttachment(dir, 'ok.png').toString(), 'bytes');
  assert.equal(core.attachmentMime('ok.png'), 'image/png');
  assert.equal(core.attachmentMime('nope.sh'), null, '非白名单无 MIME');
  assert.throws(() => core.readItemAttachment(dir, '../status.json'), /文件名|非法|不存在/, '读取防穿越');
  assert.throws(() => core.readItemAttachment(dir, 'missing.png'), /不存在/);
  fs.writeFileSync(path.join(dir, 'attachments', 'big.png'), Buffer.alloc(8 * 1024 * 1024 + 1));
  assert.throws(() => core.readItemAttachment(dir, 'big.png'), /8MB/, '超限不在线展示');
});

let failed = 0;
for (const [name, fn] of cases) {
  try { await fn(); console.log(`✓ ${name}`); }
  catch (e) { failed++; console.error(`✗ ${name}\n${e.stack}`); }
}
console.log(`\n${cases.length} 个用例，失败 ${failed}`);
process.exitCode = failed ? 1 : 0;
