#!/usr/bin/env node
// BUG-20260915-012：验证看板写入剪贴板边界，不能替代目标应用的粘贴验收。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source = fs.readFileSync(new URL('../web/app.js', import.meta.url), 'utf8');
const functions = ['buildDocRef', 'copyPlain'].map(name => {
  const match = source.match(new RegExp(`^(?:async )?function ${name}\\([\\s\\S]*?^\\}`, 'm'));
  assert.ok(match, `应能提取 ${name}`);
  return match[0];
}).join('\n');
for (const fallback of [false, true]) {
  let written, removed = false, selected = false;
  const textarea = { value: '', style: {}, select() { selected = true; }, remove() { removed = true; } };
  const context = vm.createContext({
    navigator: { clipboard: { async writeText(text) {
      if (fallback) throw new Error('模拟权限拒绝');
      written = text;
    } } },
    document: {
      createElement(tag) { assert.equal(tag, 'textarea'); return textarea; },
      body: { appendChild() {} },
      execCommand(command) {
        assert.equal(command, 'copy');
        assert.ok(selected, '降级复制必须先选中文本');
        written = textarea.value;
        return true;
      },
    },
  });
  vm.runInContext(functions, context);
  const prompt = context.buildDocRef({ id: 'BUG-20260915-012', name: 'README.md', path: '/project/README.md', start: 1, end: 2, text: '第一行\n第二行' });
  assert.equal(await context.copyPlain(prompt), true);
  assert.equal(written, prompt, '复制边界必须逐字保留提示词');
  assert.equal(written.charCodeAt(written.length - 1), 10, '写入文本最后一个字符必须为 LF');
  assert.ok(!written.endsWith('\n\n'), '末尾恰一个换行');
  if (fallback) assert.ok(removed, '降级临时文本域必须清理');
  console.log(`✓ ${fallback ? 'execCommand 降级' : 'Clipboard API'}：原样保留末尾 LF`);
}
