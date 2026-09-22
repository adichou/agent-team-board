// REQ-20260922-005 主流开源协议目录 —— 弹框「选择开源协议」的唯一事实源（服务端）。
// 字段：id（SPDX 标识）/ name（协议名）/ url（官网网址）/ copyleft（none 宽松 | weak 弱
// 著佐权 | strong 强著佐权）/ definition（中文定义）/ pros · cons（中文优劣，各至少一条）。
// 顺序：宽松（MIT、Apache-2.0、BSD-3、BSD-2、ISC）→ 著佐权（MPL-2.0 / LGPL-3.0 弱、
// GPL-3.0 / AGPL-3.0 强）→ 公共域风格（Unlicense、0BSD）。
// 标准文本 licenseTextOf(id) 读 ./license-texts/<SPDX-ID>.txt：SPDX license-list-data
// 权威文本（https://github.com/spdx/license-list-data，各许可证自身均明示允许逐字复制，
// 属数据资料而非库源码）；BSD 系文本的 SPDX match 变量已归一为 <year> <owner> 占位模板，
// 占位符（如 MIT 的 <year> <copyright holders>）原样保留，由人工在审查时确认填写
//（REQ-20260922-002 口径：许可证选择与确认是人工动作，AI 不生成许可证文本）。
// 开源选型（REQ-20260909-015）：候选 npm 包 spdx-license-list 为 CC-BY-4.0（不在白名单）
// 禁止引入；本模块为静态目录数据 + 内嵌权威文本，无第三方库可复用，不引入依赖。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const LICENSE_CATALOG = [
  {
    id: 'MIT',
    name: 'MIT License',
    url: 'https://opensource.org/license/MIT',
    copyleft: 'none',
    definition: '最常用的宽松许可：几乎允许任何使用、修改与再分发（含商用与闭源），只需保留版权与许可声明。',
    pros: ['极简，条款易读易遵守', '兼容绝大多数其他协议，商用闭源友好', '生态采用面最广，开源项目默认首选之一'],
    cons: ['不含专利授权条款（对比 Apache-2.0）', '不要求修改后开源，衍生品可完全闭源'],
  },
  {
    id: 'Apache-2.0',
    name: 'Apache License 2.0',
    url: 'https://www.apache.org/licenses/LICENSE-2.0',
    copyleft: 'none',
    definition: '宽松许可并含明确专利授权与商标条款：允许商用、修改与再分发，需保留声明并标注修改。',
    pros: ['含专利授权，降低专利诉讼风险', '要求标注修改，工程协作口径清晰', '可与 GPL-3.0 单向兼容组合'],
    cons: ['条款较长，合规成本高于 MIT / BSD', '分发时需附上完整许可文本'],
  },
  {
    id: 'BSD-3-Clause',
    name: 'BSD 3-Clause License',
    url: 'https://opensource.org/license/BSD-3-Clause',
    copyleft: 'none',
    definition: '经典宽松许可（BSD 三条款）：保留声明即可任意使用与再分发，附加禁止以作者名义背书宣传。',
    pros: ['条款简短、约束少，商用友好', '「非背书」条款保护作者名义'],
    cons: ['不含专利授权条款', '不要求衍生品开源'],
  },
  {
    id: 'BSD-2-Clause',
    name: 'BSD 2-Clause License',
    url: 'https://opensource.org/license/BSD-2-Clause',
    copyleft: 'none',
    definition: 'BSD 两条款（简化版）：保留版权与声明即可任意使用与再分发，无背书限制条款。',
    pros: ['极简宽松，合规负担最小'],
    cons: ['无专利授权、无背书保护', '生态使用面窄于 MIT'],
  },
  {
    id: 'ISC',
    name: 'ISC License',
    url: 'https://opensource.org/license/ISC',
    copyleft: 'none',
    definition: 'MIT 的功能等价简化版（OpenBSD / FreeBSD 系常用），法律措辞更现代简练。',
    pros: ['文本最简练之一，语义与 MIT 等价'],
    cons: ['认知度低于 MIT，部分法务不熟悉'],
  },
  {
    id: 'MPL-2.0',
    name: 'Mozilla Public License 2.0',
    url: 'https://www.mozilla.org/en-US/MPL/2.0/',
    copyleft: 'weak',
    definition: '文件级弱著佐权：修改 MPL 文件本身须以 MPL 开源，可与专有代码以文件为界组合分发。',
    pros: ['文件级隔离：专有代码可并存同仓库', '含专利授权与专利报复防御条款'],
    cons: ['文件内修改须开源，混合工程需厘清边界', '合规复杂度高于宽松协议'],
  },
  {
    id: 'LGPL-3.0-only',
    name: 'GNU LGPL v3.0',
    url: 'https://www.gnu.org/licenses/lgpl-3.0.html',
    copyleft: 'weak',
    definition: '库级弱著佐权（基于 GPL-3.0）：以库形式被链接的应用可闭源，修改库本身须以 LGPL 开源。',
    pros: ['允许闭源应用链接使用', '库本身的改进强制回馈社区'],
    cons: ['动态 / 静态链接与衍生判定复杂', '标准文本含 GPL 全文，篇幅长'],
  },
  {
    id: 'GPL-3.0-only',
    name: 'GNU GPL v3.0',
    url: 'https://www.gnu.org/licenses/gpl-3.0.html',
    copyleft: 'strong',
    definition: '强著佐权：分发基于 GPL 的软件必须以 GPL 向接收者提供完整对应源码。',
    pros: ['强制开源衍生作品，防止闭源分叉', '含专利授权与反硬件锁定（tivoization）条款'],
    cons: ['传染性强，与商业闭源模式冲突', '源码提供义务使合规要求高'],
  },
  {
    id: 'AGPL-3.0-only',
    name: 'GNU AGPL v3.0',
    url: 'https://www.gnu.org/licenses/agpl-3.0.html',
    copyleft: 'strong',
    definition: '最强著佐权：即使仅以网络服务（SaaS）形式提供、不分发二进制，也须向用户提供修改后的完整源码。',
    pros: ['堵住「服务化规避开源」的漏洞', '云服务场景保障源码开放'],
    cons: ['SaaS 场景合规成本最高', '多数商业产品政策明确禁用 AGPL 依赖'],
  },
  {
    id: 'Unlicense',
    name: 'The Unlicense',
    url: 'https://unlicense.org/',
    copyleft: 'none',
    definition: '公共域奉献：放弃全部版权，允许任何用途，不附加任何条件。',
    pros: ['零条件，自由度最高', '可被 GPL 项目吸收使用'],
    cons: ['部分司法辖区「公共域奉献」效力存疑', '无专利条款，企业采用谨慎'],
  },
  {
    id: '0BSD',
    name: 'Zero-Clause BSD',
    url: 'https://opensource.org/license/0BSD',
    copyleft: 'none',
    definition: '零条款 BSD：仅保留「允许任何用途」一句的公共域风格许可。',
    pros: ['义务只有一句「允许一切」，最简', '比 Unlicense 措辞更保守稳妥'],
    cons: ['不含专利授权', '生态采用尚新，认知度低'],
  },
];

// 标准文本读取（首读缓存；文本文件缺失返回 null——目录与 texts 目录同源提交，仅防御）。
const TEXTS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'license-texts');
const textCache = new Map();

export function licenseTextOf(id) {
  const key = String(id || '').trim();
  if (!/^[A-Za-z0-9.\-]+$/.test(key)) return null;
  if (textCache.has(key)) return textCache.get(key);
  let text = null;
  try {
    const file = path.join(TEXTS_DIR, `${key}.txt`);
    const resolved = path.resolve(file);
    if ((resolved + path.sep).startsWith(TEXTS_DIR + path.sep)) {
      const raw = fs.readFileSync(resolved, 'utf8');
      text = raw.endsWith('\n') ? raw : `${raw}\n`;
    }
  } catch { text = null; }
  textCache.set(key, text);
  return text;
}

// API 视图：元数据 + text（GET /api/build/doc-licenses 响应体；前端选中即以此文本走
// 既有 /api/build/docs/save 白名单通道写盘，不新增写入口径）。
export function licenseCatalogView() {
  return LICENSE_CATALOG.map((x) => ({ ...x, text: licenseTextOf(x.id) }));
}
