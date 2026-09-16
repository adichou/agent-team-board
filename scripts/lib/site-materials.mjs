// REQ-20260915-002 官网双语材料（site-materials）—— 产品发布官网目标使用。
// 材料布局：<官网仓库根>/<项目名>/<lang>/<page>.html（zh / en 两语言子目录，页面文件同名，
// 功能描述与发行版本保持一致）。本层只做清单、完整性与指纹，不生成页面内容（草稿由用户在
// 官网仓库内准备，系统按清单核验并阻塞缺失项，不伪造材料）。
// 指纹口径：全部必备页文件 sha256 的有序汇总（内容变化 → 指纹变化 → 旧预检失效）。

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { AtbError } from './core.mjs';

export const SITE_LANGS = ['zh', 'en'];
// 必备页面（README §4：产品信息 / 访问使用方式 / 用户指南 FAQ / 更新日志；截图说明随页面携带）
export const REQUIRED_SITE_PAGES = [
  { key: 'index', label: '产品信息' },
  { key: 'usage', label: '访问与使用方式' },
  { key: 'guide', label: '用户指南 / FAQ' },
  { key: 'changelog', label: '公开更新日志' },
];

const sha256File = (file) => {
  try {
    return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  } catch {
    return null;
  }
};

// 项目名 → 安全子目录：仅 [A-Za-z0-9._-]，不得以 . - 开头外字符、不得含路径分隔/空白/越界。
export function safeContentDir(repoRoot, productName) {
  const name = String(productName || '').trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name) || name.includes('..') || name === '.' || name === '..') {
    throw new AtbError(`项目名「${name || '（空）'}」不是安全子目录（仅字母数字 . _ -，且不得越界）：请修正项目名后重试`);
  }
  const dir = path.join(String(repoRoot || ''), name);
  // 防御性：join 归一后必须仍在 repoRoot 内
  const root = path.resolve(String(repoRoot || ''));
  if (!path.resolve(dir).startsWith(root + path.sep)) {
    throw new AtbError(`项目名「${name}」越出官网仓库目录：不允许路径越界`);
  }
  return dir;
}

// 完整性核验：双语必备页逐文件存在 + 指纹；缺失以 {lang,page,label} 列出。
export function checkSiteMaterials(contentDir) {
  const files = [];
  const missing = [];
  for (const lang of SITE_LANGS) {
    for (const page of REQUIRED_SITE_PAGES) {
      const file = path.join(String(contentDir || ''), lang, `${page.key}.html`);
      const hash = sha256File(file);
      if (hash == null) {
        missing.push({ lang, page: page.key, label: page.label, path: file });
      } else {
        files.push({ lang, page: page.key, hash });
      }
    }
  }
  const fingerprint = files.length
    ? crypto.createHash('sha256').update(files.map((f) => `${f.lang}/${f.page}:${f.hash}`).sort().join('\n')).digest('hex')
    : null;
  return { ok: missing.length === 0, missing, files, fingerprint };
}

// 指纹快捷读取（目录缺失 → null，交由上层按「配置缺失」口径阻塞）。
export function materialsFingerprint(contentDir) {
  try {
    return checkSiteMaterials(contentDir).fingerprint;
  } catch {
    return null;
  }
}
