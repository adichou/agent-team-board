// REQ-20260915-002 官网语言选择（site-lang）—— 官网发布模块 / 生成页面使用。
// 口径（README §4）：
//   - 默认按浏览器语言优先级依次匹配：zh 及其地区变体 → 中文（zh），en 及其地区变体 → 英文（en）；
//   - 无匹配语言 / 无法读取 → 回退英文（en）；
//   - 手动偏好（'zh' | 'en'）优先于浏览器语言；'auto' = 跟随浏览器（恢复自动选择）；
//   - 浏览器存储不可用时切换仍在当前页面生效（存储由生成页面承载，本层纯函数不依赖存储）。

export const SITE_LANGS = ['zh', 'en'];

const langPrefix = (tag) => String(tag || '').trim().toLowerCase().split('-')[0] || '';

// 按浏览器语言优先级取第一个命中（zh* → 'zh'，en* → 'en'）；无命中返回 null。
export function matchBrowserLanguage(languages) {
  const list = Array.isArray(languages) ? languages : [];
  for (const tag of list) {
    const p = langPrefix(tag);
    if (p === 'zh') return 'zh';
    if (p === 'en') return 'en';
  }
  return null;
}

// 语言选择：stored ∈ {'zh','en'}（手动偏好，优先）| 'auto'（跟随浏览器）| null（未设置 → 跟随浏览器）。
export function pickSiteLanguage({ browserLanguages, stored = null } = {}) {
  if (stored === 'zh' || stored === 'en') return stored;
  return matchBrowserLanguage(browserLanguages) || 'en';
}
