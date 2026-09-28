// 构建发布测试共享夹具（BUG-20260928-011 起预检按「发布文档 + 挑选条目」口径核验）：
// 构造「文档已审核 / 已提交 / 已合并入 main + 条目已合并（含 cherry-pick 重放证据）」的
// 版本计划，供 build-publish 系列测试复用。真实临时 Git 仓库，无 mock。
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import * as buildStore from '../../lib/build-store.mjs';

export const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
export const gcommit = (cwd, msg, ...files) => {
  for (const f of files) git(cwd, 'add', '--', f);
  git(cwd, '-c', 'user.name=T', '-c', 'user.email=t@e.c', 'commit', '--allow-empty', '-m', msg);
  return git(cwd, 'rev-parse', 'HEAD');
};
export const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

// 默认语言集 cn,en：4 类 × 2 语言 + LICENSE 单文件，共 9 个发布文档文件。
export const DOC_FILES = ['README.md', 'CHANGELOG.md', 'FEATURES.md', 'AGENTS.md',
  'README_en.md', 'CHANGELOG_en.md', 'FEATURES_en.md', 'AGENTS_en.md', 'LICENSE.md'];
// 先写默认语言文件再写 _en 文件（保证 mtime 顺序不触发基准变更回退）。
export const writeDocs = (project, tag = 'v1') => {
  for (const f of DOC_FILES.filter((x) => !/_en\.md$/.test(x))) fs.writeFileSync(path.join(project, f), `# ${f} ${tag}\n`);
  for (const f of DOC_FILES.filter((x) => /_en\.md$/.test(x))) fs.writeFileSync(path.join(project, f), `# ${f} ${tag}\n`);
};
export const docHashes = (project) => Object.fromEntries(DOC_FILES.map((f) => [f, sha256(fs.readFileSync(path.join(project, f), 'utf8'))]));

// 项目夹具：main（web 提交）+ dev（条目提交 + 文档提交）；文档提交按需 cherry-pick 回 main
//（重放证据口径，与真实隔离合并一致）。itemReplay=true 时条目提交经 cherry-pick 进 main
//（原始提交不在 main 历史内，靠重放证据核验）。
export function makeProject(root, name, { pickDocs = true, itemReplay = false } = {}) {
  const project = path.join(root, name);
  fs.mkdirSync(project);
  git(project, 'init', '-b', 'main');
  fs.writeFileSync(path.join(project, 'index.html'), '<html>1.0</html>');
  const web = gcommit(project, 'web', 'index.html');
  git(project, 'branch', 'dev');
  const remote = path.join(root, `remote-${name}.git`);
  git(root, 'init', '--bare', remote);
  git(project, 'remote', 'add', 'origin', remote);
  git(project, 'checkout', 'dev');
  let item = web;
  let itemReplayed = null;
  if (itemReplay) {
    fs.writeFileSync(path.join(project, 'feat.txt'), 'feat');
    item = gcommit(project, 'feat', 'feat.txt');
    git(project, 'checkout', 'main');
    git(project, '-c', 'user.name=T', '-c', 'user.email=t@e.c', 'cherry-pick', item);
    itemReplayed = git(project, 'rev-parse', 'HEAD');
    git(project, 'checkout', 'dev');
  }
  writeDocs(project);
  const docs = gcommit(project, 'docs: 发布文档', ...DOC_FILES);
  let mainDocs;
  if (pickDocs) {
    git(project, 'checkout', 'main');
    git(project, '-c', 'user.name=T', '-c', 'user.email=t@e.c', 'cherry-pick', docs);
    mainDocs = git(project, 'rev-parse', 'HEAD');
    git(project, 'checkout', 'dev');
  } else {
    mainDocs = itemReplayed || web; // main 头：未重放文档提交
  }
  return { project, db: path.join(project, 'agent-team-board'), web, item, itemReplayed, docs, mainDocs };
}

// 版本计划夹具：merged 状态 + 条目（含重放证据）+ 文档审核 / 提交 / 合并落账（withDocs
// 关闭时逐项省略，供阻塞分支用例自行拼装部分事实）。
export function makeVersion(fx, { itemId = 'REQ-20260928-101', withDocs = true } = {}) {
  const v = buildStore.createVersion(fx.db, {
    name: '测试版本', version: '1.0.0',
    items: [{ itemId, commits: [fx.item] }],
  });
  buildStore.beginMerge(fx.db, v.id);
  buildStore.finishMerge(fx.db, v.id, { results: [{ itemId, ok: true }], mainSha: fx.mainDocs });
  if (fx.itemReplayed) buildStore.saveMergeReplays(fx.db, v.id, [{ itemId, original: fx.item, replayed: fx.itemReplayed }]);
  if (withDocs) {
    const h = docHashes(fx.project);
    for (const f of DOC_FILES) buildStore.recordDocsReview(fx.db, v.id, { file: f, hash: h[f] });
    buildStore.recordDocsCommit(fx.db, v.id, { commitHash: fx.docs, files: h, scopeFp: 'fp-test' });
    if (fx.mainDocs !== fx.item) {
      buildStore.recordDocsMerge(fx.db, v.id, {
        commitHash: fx.docs, replayedHash: fx.mainDocs, mainSha: fx.mainDocs,
        replays: [{ itemId: 'docs', original: fx.docs, replayed: fx.mainDocs }],
      });
    }
  }
  return buildStore.readVersion(fx.db, v.id);
}
