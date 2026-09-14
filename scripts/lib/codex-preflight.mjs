// BUG-20260906-010：静态检查只证明实际检查过的条件，不调用模型。
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { buildExecArgs } from './codex-adapter.mjs';

export function checkCodexEnvironment({ cliPath, projectRoot, dataDir, allowNonGit = false }) {
  const checks = [];
  let executable = false;
  try {
    fs.accessSync(cliPath, fs.constants.X_OK);
    executable = fs.statSync(cliPath).isFile();
  } catch {}
  checks.push({ id: 'cli', ok: executable, label: 'codex CLI 可执行', detail: cliPath || '未探测到 codex CLI' });

  const probe = (args) => executable ? spawnSync(cliPath, args, {
    cwd: projectRoot, encoding: 'utf8', timeout: 5000, input: '', maxBuffer: 512 * 1024,
  }) : null;
  const version = probe(['--version']);
  checks.push({ id: 'cli-version', ok: version?.status === 0 && !!version.stdout?.trim(),
    label: 'CLI 版本', detail: version?.stdout?.trim() || '无法获取版本' });

  const results = [null, '00000000-0000-0000-0000-000000000000'].map((resumeThreadId) => {
    const args = buildExecArgs({ projectRoot, resumeThreadId, allowNonGit,
      finalMessageFile: path.join(dataDir, 'dispatch', 'preflight-output-unused.md') });
    // --help 仅检查实际参数能否解析，不创建会话、不写最终回复、不发送提示词。
    const result = probe([...args, '--help']);
    const flags = ['--json', '--output-last-message', ...(allowNonGit ? ['--skip-git-repo-check'] : [])];
    const ok = result?.status === 0 && flags.every((flag) => result.stdout?.includes(flag));
    const name = resumeThreadId ? 'exec resume' : 'exec';
    return { ok, detail: ok ? `${name} 参数解析通过` :
      `${name} 参数未通过：${result?.error?.message || result?.stderr?.trim() || '帮助未声明必需参数'}` };
  });
  checks.push({ id: 'exec-args', ok: results.every((r) => r.ok),
    label: '新建与续跑参数兼容', detail: results.map((r) => r.detail).join('；') });

  const git = spawnSync('git', ['-C', projectRoot, 'rev-parse', '--is-inside-work-tree'], {
    encoding: 'utf8', timeout: 5000,
  });
  const inGit = git.status === 0 && git.stdout?.trim() === 'true';
  checks.push({ id: 'project-policy', ok: inGit || allowNonGit,
    label: '项目运行约束', detail: allowNonGit ?
      '已明确允许非 Git 项目执行（--skip-git-repo-check）；沙箱和审批沿用本机设置' : inGit ?
        '项目位于 Git 工作区' : '项目不在 Git 工作区；请先建立 Git 仓库，或在运行配置中明确允许非 Git 项目执行' });
  let writable = false;
  try {
    for (const dir of [projectRoot, dataDir]) fs.accessSync(dir, fs.constants.R_OK | fs.constants.W_OK);
    writable = true;
  } catch {}
  checks.push({ id: 'project-access', ok: writable, label: '服务进程可读写项目与看板目录',
    detail: writable ? '文件访问检查通过；CLI 内部沙箱权限仍以本机配置和实际运行结果为准' : '项目或看板目录不可读写' });
  return checks;
}
