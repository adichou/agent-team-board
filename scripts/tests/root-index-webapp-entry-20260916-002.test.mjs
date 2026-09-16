#!/usr/bin/env node
// REQ-20260916-002 补充发布流水线可识别的 Web App 静态入口 —— 集成测试
// 用法：node scripts/tests/root-index-webapp-entry-20260916-002.test.mjs
// 纯文件内容断言：无子进程、无端口。覆盖 test-cases.md 的 T01–T07。
// 背景：发布执行器 scripts/lib/build-publish.mjs 识别「仓库根 index.html 静态站」形态，
// 且发布回验（webapp-verify）会 GET 首页并检查 body.includes(run.version)。

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const htmlPath = path.join(repoRoot, 'index.html');

const cases = [];
const t = (name, fn) => cases.push([name, fn]);

t('T01 仓库根存在 index.html 且为 HTML 文档（DOCTYPE/html/UTF-8/title 齐备）', () => {
  assert.equal(fs.existsSync(htmlPath), true, '仓库根应存在 index.html');
  const html = fs.readFileSync(htmlPath, 'utf8');
  assert.match(html, /<!DOCTYPE html>/i, '应有 <!DOCTYPE html> 声明');
  assert.match(html, /<html[\s>]/i, '应有 <html> 根元素');
  assert.match(html, /charset\s*=\s*["']?utf-8/i, '应声明 UTF-8 charset');
  assert.match(html, /<title>[^<]+<\/title>/i, '应有非空 <title>');
});

t('T02 自包含：无外部资源引用（仅允许页内锚点 href="#…"）', () => {
  const html = fs.readFileSync(htmlPath, 'utf8');
  assert.doesNotMatch(html, /\b(src|href|poster|data)\s*=\s*["']https?:\/\//i, '不得有 http(s) 外链资源');
  assert.doesNotMatch(html, /<script\b[^>]*\bsrc\s*=/i, '不得有 <script src=…> 外链脚本');
  assert.doesNotMatch(html, /<link\b/i, '不得有 <link> 外链（含外链样式）');
  assert.doesNotMatch(html, /@import\b/i, 'CSS 不得有 @import 外链');
  const hrefs = [...html.matchAll(/\bhref\s*=\s*["']([^"']*)["']/gi)].map((m) => m[1]);
  for (const h of hrefs) {
    assert.ok(h.startsWith('#'), `href 只允许页内锚点，实际：${h}`);
  }
});

t('T03 页面正文包含发行版本号字符串 1.0.0（发布回验 body.includes 口径）', () => {
  const html = fs.readFileSync(htmlPath, 'utf8');
  assert.ok(html.includes('1.0.0'), '页面应包含版本号 1.0.0（webapp-verify 检查项）');
});

t('T04 双语：主体中文（lang="zh" 起始）且含英文摘要区（lang="en" 区块 + English 标题）', () => {
  const html = fs.readFileSync(htmlPath, 'utf8');
  assert.match(html, /<html[^>]*\blang\s*=\s*["']zh/i, '<html> 应以 lang="zh…" 起始');
  assert.match(html, /\blang\s*=\s*["']en["']/, '应存在 lang="en" 标注的英文摘要区块');
  assert.match(html, /English\s*Summary/i, '应存在 English Summary 英文标题');
});

t('T05 内容完整性：产品介绍/核心能力/Status Board 启动/Electron 四类文案齐备', () => {
  const html = fs.readFileSync(htmlPath, 'utf8');
  assert.match(html, /产品介绍/, '应有产品介绍');
  assert.match(html, /核心能力/, '应有核心能力');
  assert.match(html, /server\.mjs/, '应说明 server.mjs 启动方式');
  assert.match(html, /8888/, '应说明 8888 端口');
  assert.match(html, /npm\s+run\s+app/, '应说明 npm run app');
  assert.match(html, /npm\s+run\s+dist/, '应说明 npm run dist');
});

t('T06 无构建步骤泄漏：无打包器产物引用；package.json 无 scripts.build 且版本 0.1.0 不动', () => {
  const html = fs.readFileSync(htmlPath, 'utf8');
  assert.doesNotMatch(html, /\/assets\//, '不得引用打包器产物路径 /assets/');
  assert.doesNotMatch(html, /\bsrc\s*=\s*["'][^"']*\.js["']/i, '不得外链 .js 模块');
  assert.doesNotMatch(html, /\b(vite|astro|vue-cli|nuxt|react-scripts)\b/i, '不得出现打包器构建标识');
  const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
  assert.equal(pkg.scripts?.build, undefined, 'package.json 不得添加 scripts.build（避免发布执行器误走 package 形态）');
  assert.equal(pkg.version, '0.1.0', 'package.json 版本号应保持 0.1.0 不动');
});

t('T07 交互自包含：存在内联 <script> 块，且无 fetch/XHR 网络请求', () => {
  const html = fs.readFileSync(htmlPath, 'utf8');
  assert.match(html, /<script(?![^>]*\bsrc\s*=)[^>]*>/i, '应存在内联 <script> 块（复制按钮等）');
  assert.doesNotMatch(html, /\bfetch\s*\(/, '不得使用 fetch 网络请求');
  assert.doesNotMatch(html, /XMLHttpRequest/, '不得使用 XMLHttpRequest');
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
