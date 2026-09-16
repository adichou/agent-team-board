// REQ-20260915-002 Web App 自动识别与本机部署（webapp-profile）—— 产品发布 Web App 目标使用。
// 口径（README §3）：系统检查冻结源码的框架、项目架构、包管理器、脚本与框架配置，自动生成构建
// 命令、产物目录、本机部署环境与部署方式，无需用户填写；无构建步骤的项目按运行架构自动处理
// （静态直服），不强制 npm run build / dist/；识别失败展示具体原因与诊断，不猜执行、不转交用户
// 手填构建参数。部署为本机 127.0.0.1 静态服务（自动分配端口），不需要公网 URL。

import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import http from 'node:http';

// 框架 → 缺省产物目录（vite/astro → dist；react-scripts → build；next → .next（静态导出场景
// 由框架配置覆盖）；nuxt → .output/public）。有明确配置文件时可扩展覆盖，本期按缺省目录。
const FRAMEWORK_OUT = {
  vite: 'dist', astro: 'dist', 'react-scripts': 'build', next: '.next', nuxt: '.output/public',
  '@vue/cli': 'dist', svelte: 'build',
};
const FRAMEWORK_DEPS = {
  vite: ['vite'], astro: ['astro'], next: ['next'], nuxt: ['nuxt'],
  'react-scripts': ['react-scripts'], '@vue/cli': ['@vue/cli-service'], svelte: ['svelte'],
};

function readPackageJson(srcDir) {
  try {
    return JSON.parse(fs.readFileSync(path.join(srcDir, 'package.json'), 'utf8'));
  } catch {
    return null;
  }
}

// 从 package.json（deps ∪ devDeps ∪ scripts）识别框架；返回 null 表示无已知框架。
export function detectFramework(pkg) {
  const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
  for (const [fw, names] of Object.entries(FRAMEWORK_DEPS)) {
    if (names.some((n) => deps[n])) return fw;
  }
  return null;
}

// 纯函数核（预检用 git show 读取冻结源码文件时复用同一判定）。
export function detectWebAppProfileFrom({ packageJson = null, hasIndexHtml = false }) {
  if (packageJson) {
    const scripts = packageJson.scripts || {};
    const buildScript = typeof scripts.build === 'string' && scripts.build.trim() ? scripts.build.trim() : null;
    const framework = detectFramework(packageJson);
    const diagnostics = [];
    if (!framework) diagnostics.push('package.json 未声明已知前端框架依赖（vite / next / astro / nuxt / vue-cli / react-scripts / svelte）');
    if (!buildScript) diagnostics.push('package.json 缺少 scripts.build（无法自动生成构建命令）');
    if (!framework || !buildScript) {
      return {
        detected: false,
        reason: '无法从冻结源码自动识别构建方式（package.json 存在但框架或构建脚本缺失）',
        diagnostics,
      };
    }
    return {
      detected: true,
      kind: 'package',
      framework,
      buildCommand: buildScript,
      outputDir: FRAMEWORK_OUT[framework] || 'dist',
      needsInstall: true,
      version: typeof packageJson.version === 'string' && packageJson.version ? packageJson.version : null,
      versionProbe: 'package.json version',
    };
  }
  if (hasIndexHtml) {
    return {
      detected: true,
      kind: 'static',
      framework: 'static',
      buildCommand: null,
      outputDir: '.',
      needsInstall: false,
      version: null,
      versionProbe: '页面 meta app-version / 内容标识',
    };
  }
  return {
    detected: false,
    reason: '冻结源码既无 package.json 也无根 index.html：无法自动确定构建与运行方式',
    diagnostics: [
      '未找到 package.json（无法识别包管理与构建脚本）',
      '未找到根 index.html（无法按静态站点直服）',
    ],
  };
}

// 目录版（构建阶段对冻结 worktree 执行）。
export function detectWebAppProfile(srcDir) {
  const pkg = readPackageJson(srcDir);
  const hasIndexHtml = fs.existsSync(path.join(srcDir, 'index.html'));
  return detectWebAppProfileFrom({ packageJson: pkg, hasIndexHtml });
}

/* ---------- 本机部署环境 ---------- */

// 自动分配本机空闲端口（listen 0 取内核分配，关闭后立即供部署复用）。
export function allocLocalPort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.map': 'application/json',
};

// 内置静态服务（本机部署，无外部依赖；路径越界拒绝）。
export function startStaticServer(rootDir, port = null) {
  return new Promise((resolve, reject) => {
    const root = path.resolve(String(rootDir || '.'));
    const srv = http.createServer((req, res) => {
      const rel = decodeURIComponent(String(req.url || '/').split('?')[0]);
      let file = path.normalize(path.join(root, rel));
      if (!file.startsWith(root + path.sep) && file !== root) {
        res.writeHead(403).end('forbidden');
        return;
      }
      if (rel === '/' || rel === '') file = path.join(root, 'index.html');
      fs.stat(file, (err, st) => {
        if (err || !st.isFile()) {
          res.writeHead(404).end('not found');
          return;
        }
        res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
        fs.createReadStream(file).pipe(res);
      });
    });
    srv.on('error', reject);
    srv.listen(port || 0, '127.0.0.1', () => {
      const addr = srv.address();
      resolve({
        port: addr.port,
        url: `http://127.0.0.1:${addr.port}`,
        close: () => new Promise((done) => srv.close(() => done())),
      });
    });
  });
}
