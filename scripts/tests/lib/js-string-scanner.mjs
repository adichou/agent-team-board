// REQ-20260911-005 i18n 覆盖测试用 JS 源码字符串扫描器。
// 正确处理：引号字符串、模板串、转义、行/块注释、正则字面量（启发式判别：
// / 的前一有效字符处于表达式位置才视为正则）、模板 ${} 插值递归（嵌套字符串/
// 嵌套模板中的中文字符串同样提出；插值在 value 中记为 ◇，不含表达式内容）。
// 失同步兜底：单/双引号串不允许跨行，出现换行按普通字符回退重扫。
// 用法：makeScanner().run(src) → [{quote, value}]；scanHtml(html) → 同构；
//       extractFragments(records) → {texts, attrs}（词典候选片段）。
function makeScanner() {
  const out = [];
  let src = '';
  let n = 0;
  let i = 0;
  let prevSig = '';

  const isRegexPos = () => {
    if (!prevSig) return true;
    if (/[)\]A-Za-z0-9_$.\u4e00-\u9fff]/.test(prevSig)) return false;
    return true;
  };

  function skipLineComment() { while (i < n && src[i] !== '\n') i++; }
  function skipBlockComment() { i += 2; while (i < n && !(src[i] === '*' && src[i + 1] === '/')) i++; i += 2; }
  function skipRegex() {
    i++;
    let inClass = false;
    while (i < n) {
      const d = src[i];
      if (d === '\\') { i += 2; continue; }
      if (d === '[') inClass = true;
      else if (d === ']') inClass = false;
      else if (d === '/' && !inClass) break;
      else if (d === '\n') break;
      i++;
    }
    i++;
    while (i < n && /[a-z]/i.test(src[i])) i++;
    prevSig = '/';
  }

  function readString(quote) {
    const start = i;
    let val = '';
    i++;
    while (i < n) {
      const d = src[i];
      if (d === '\\') { i += 2; continue; }
      if (d === quote) { i++; break; }
      if (quote === '`' && d === '$' && src[i + 1] === '{') {
        i += 2;
        let depth = 1;
        while (i < n && depth > 0) {
          const e = src[i];
          if (e === "'" || e === '"' || e === '`') { readString(e); continue; }
          if (e === '/' && src[i + 1] === '/') { skipLineComment(); continue; }
          if (e === '/' && src[i + 1] === '*') { skipBlockComment(); continue; }
          if (e === '{') depth++;
          else if (e === '}') { depth--; if (depth === 0) { i++; break; } }
          i++;
        }
        val += '\u25C7';
        continue;
      }
      val += d;
      i++;
    }
    if (/[\u4e00-\u9fff]/.test(val) && (quote === '`' || !/[\n\r]/.test(val))) {
      out.push({ quote, value: val });
    }
    return { val, start };
  }

  function scan() {
    while (i < n) {
      const c = src[i];
      if (c === '/' && src[i + 1] === '/') { skipLineComment(); continue; }
      if (c === '/' && src[i + 1] === '*') { skipBlockComment(); continue; }
      if (c === '/' && isRegexPos()) { skipRegex(); continue; }
      if (c === '"' || c === "'" || c === '`') {
        const quote = c;
        const { val, start } = readString(quote);
        if (quote !== '`' && /[\n\r]/.test(val)) { i = start + 1; continue; }
        prevSig = quote;
        continue;
      }
      if (!/\s/.test(c)) prevSig = c;
      i++;
    }
  }

  return {
    run(text) {
      src = text;
      n = text.length;
      i = 0;
      prevSig = '';
      scan();
      return out;
    },
  };
}

function scanHtml(src) {
  const out = [];
  const noComment = src.replace(/<!--[\s\S]*?-->/g, '');
  for (const m of noComment.matchAll(/>([^<>]*[\u4e00-\u9fff][^<>]*)</g)) {
    const v = m[1].trim();
    if (v) out.push({ quote: 'html-text', value: v });
  }
  for (const m of noComment.matchAll(/(\w[\w-]*)="([^"]*[\u4e00-\u9fff][^"]*)"/g)) {
    out.push({ quote: 'html-attr:' + m[1], value: m[2].trim() });
  }
  return out;
}

// 片段化：把字符串/模板值切成词典候选片段。
// texts = 文本位置片段（剥离完整标签后剩的中文文本行，或整条无标签字符串）；
// attrs = 属性位置片段（attr="…"）。插值在扫描阶段已记为 ◇，值内不含 <> 表达式残留。
function extractFragments(records) {
  const texts = new Set();
  const attrs = new Set();
  for (const { quote, value } of records) {
    const v = value;
    const isHtml = /<[a-zA-Z!/]/.test(v);
    if (isHtml) {
      const stripped = v.replace(/<[^<>]*>/g, '\n');
      for (const line of stripped.split('\n')) {
        const t = line.trim();
        if (t && /[\u4e00-\u9fff]/.test(t) && !t.includes('="')) texts.add(t);
      }
    } else if (/[\u4e00-\u9fff]/.test(v) && !v.includes('="')) {
      texts.add(v.trim());
    }
    // 属性位置：HTML 与「标签内部属性串」（模板里拼接注入的 disabled title="…" 等）都提取
    for (const m of v.matchAll(/[\w-]+="([^"<>]*[\u4e00-\u9fff\u25C7][^"<>]*)"/g)) {
      const t = m[1].trim();
      if (t && /[\u4e00-\u9fff]/.test(t)) attrs.add(t);
    }
    if (typeof quote === 'string' && quote.startsWith('html-attr')) attrs.add(v.trim());
  }
  return { texts: [...texts].sort(), attrs: [...attrs].sort() };
}

export { makeScanner, scanHtml, extractFragments };
