#!/usr/bin/env node
// 单语言发布文档不生成语言切换入口，多语言继续按实际语言集互链。
import assert from 'node:assert/strict';
import { docLangSwitchLine, buildDocSummaryPrompt, buildDocProofreadPrompt } from '../lib/publish-flow.mjs';
for (const langs of [['cn'], ['en'], ['ja']]) {
  assert.equal(docLangSwitchLine('README', langs), '', '单语言没有切换目标');
  const summary = buildDocSummaryPrompt({ langs, customDocs: ['MIGRATION'] });
  assert.match(summary, /单语言.*不添加语言切换行/);
  assert.match(summary, /重写既有文档时移除旧语言切换行/, '单语言总结要求清除旧切换行');
  assert.doesNotMatch(summary, /\]\(\.\/README.*\.md\)/, '单语言不输出切换链接示例');
  assert.doesNotMatch(summary, /语言集的其余语言文档待/, '单语言无其余语言翻译任务说明');
  assert.match(summary, /MIGRATION.md/);
  const proofread = buildDocProofreadPrompt({ langs });
  assert.match(proofread, /单语言.*不要求语言切换行/);
  assert.match(proofread, /旧语言切换行.*确认移除/, '旧切换行仅提示人工确认移除');
  assert.doesNotMatch(proofread, /该行缺失、语言集不全/);
}
for (const langs of [['cn', 'en'], ['en', 'ja', 'cn']]) {
  const line = docLangSwitchLine('README', langs);
  assert.equal(line.split(' | ').length, langs.length);
  assert.ok(buildDocSummaryPrompt({ langs }).includes(line));
  assert.ok(buildDocProofreadPrompt({ langs }).includes(line));
}
console.log('BUG-20260929-002: 单语言与多语言提示词回归通过');
