// BUG-20260914-022：真实 Git 仓库验证按运行保存的处理证据，不以路径再次变脏推翻旧处理结果。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import * as core from '../lib/core.mjs';
import { legacyConfirmViews } from '../lib/confirm-store.mjs';
import * as recovery from '../lib/legacy-recovery.mjs';
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atb-recovery-'));
function git(...args) {
  const r = spawnSync('git', ['-c', 'user.name=Fixture', '-c', 'user.email=f@example.com', ...args], { cwd: root, encoding: 'utf8' });
  assert.equal(r.status, 0, `${args.join(' ')}: ${r.stderr}`); return r.stdout.trim();
}
try {
  core.initData(root);
  const data = core.dataDirFrom(root);
  const item = core.createItem(data, { type: 'bug', title: '历史恢复' });
  git('init', '-q');
  for (const p of ['code.js', 'test.js']) fs.writeFileSync(path.join(root,p), 'old\n');
  git('add', '.'); git('commit', '-qm', 'baseline');
  const base = git('rev-parse', 'HEAD');
  const runId = 'run-fixture-001';
  const runDir = path.join(data, 'dispatch', 'runs', runId);
  fs.mkdirSync(runDir, {recursive:true});
  const ac = { itemId:item.id, pendingManual:['code.js'], heldGroups:{test:['test.js'],biz:[]}, commits:[{hash:base}] };
  fs.writeFileSync(path.join(runDir,'auto-commit.json'), JSON.stringify(ac));
  fs.writeFileSync(path.join(runDir,'run.json'), JSON.stringify({runId,itemId:item.id,phase:'reported'}));
  const original = fs.readFileSync(path.join(runDir,'auto-commit.json'),'utf8');
  for (const p of ['code.js','test.js']) fs.writeFileSync(path.join(root,p), 'fixed\n');
  assert.equal(legacyConfirmViews(data,root)[0].pendingCount,2,'暂扣测试也须呈现');
  git('add','--','code.js'); git('commit','-qm','partial');
  const partial=git('rev-parse','HEAD');
  const evidence = commit => ({ type:'committed', reviewedBy:'fixture-reviewer', note:'已逐路径核对实现与测试', paths:['code.js','test.js'].map(p=>({path:p,commit,blob:git('rev-parse',`${commit}:${p}`),note:'核对本轮改动内容'})) });
  assert.throws(()=>recovery.recordLegacyRecovery(data,root,runId,{...evidence(partial),paths:evidence(partial).paths.slice(0,1)}),/路径|覆盖/);
  assert.throws(()=>recovery.recordLegacyRecovery(data,root,runId,evidence(partial)),/改动|证明/,'未变更的暂扣测试不能拿旧 blob 冒充补交');
  git('add','--','test.js'); git('commit','-qm','complete');
  const full=git('rev-parse','HEAD');
  const e=evidence(full);
  e.paths[0].commit=partial; e.paths[0].blob=git('rev-parse',`${partial}:code.js`);
  assert.throws(()=>recovery.recordLegacyRecovery(data,root,runId,{...e,ledgerDigest:"changed"}),/账本已变化/);
  recovery.recordLegacyRecovery(data,root,runId,e);
  fs.writeFileSync(path.join(root,'code.js'),'new task\n');
  assert.equal(legacyConfirmViews(data,root).length,0,'新任务改同路径不能复活旧运行');
  assert.equal(fs.readFileSync(path.join(runDir,'auto-commit.json'),'utf8'),original,'原账本不变');
  const file=path.join(data,'confirms','recoveries',`${runId}.json`);
  const saved=fs.readFileSync(file,'utf8');
  const before=fs.statSync(file).mtimeMs;
  legacyConfirmViews(data,root);
  assert.equal(fs.statSync(file).mtimeMs,before,'读取无写入副作用');
  for(const mutate of [r=>r.itemId='BUG-wrong',r=>r.runId='run-wrong',r=>r.paths.pop(),r=>r.paths[0].blob='0'.repeat(40),r=>r.ledgerDigest='wrong']) {
    const r=JSON.parse(saved);mutate(r);fs.writeFileSync(file,JSON.stringify(r));
    assert.equal(legacyConfirmViews(data,root).length,1,'错误证据不得消除旧运行');
  }
  fs.writeFileSync(file,saved);
  git('checkout','--force','--detach',base);
  assert.equal(legacyConfirmViews(data,root).length,1,'证明不在当前历史不能隐藏');
  git('checkout','--force','--detach',full);
  fs.writeFileSync(path.join(root,'code.js'),'new task again\n');
  const second=path.join(data,'dispatch','runs','run-fixture-002');fs.mkdirSync(second);
  fs.writeFileSync(path.join(second,'auto-commit.json'),original);
  fs.writeFileSync(path.join(second,'run.json'),JSON.stringify({runId:'run-fixture-002',itemId:item.id,phase:'reported'}));
  assert.equal(legacyConfirmViews(data,root).length,1,'同条目新运行不继承旧证据');
  fs.rmSync(second,{recursive:true});
  fs.writeFileSync(file,'{broken');
  assert.equal(legacyConfirmViews(data,root).length,1,'坏记录不能当成功');
  fs.writeFileSync(file,saved);
  for (const p of ['code.js','test.js']) fs.writeFileSync(path.join(root,p),'old\n');
  git('add','--','code.js','test.js'); git('commit','-qm','withdraw original change');
  const withdrawalCommit=git('rev-parse','HEAD');
  const withdrawn={...e,type:'withdrawn',note:'经明确授权撤销旧方案，逐路径核验撤销后的基线'};
  withdrawn.paths=withdrawn.paths.map(p=>({...p,commit:withdrawalCommit,blob:git('rev-parse',`${withdrawalCommit}:${p.path}`)}));
  assert.throws(()=>recovery.recordLegacyRecovery(data,root,runId,{...withdrawn,note:""}),/说明/);
  recovery.recordLegacyRecovery(data,root,runId,withdrawn);
  fs.writeFileSync(path.join(root,"code.js"),"new task after withdrawal\n");
  assert.equal(legacyConfirmViews(data,root).length,0,'明确撤销的已核验证据亦可阻止复活');
  console.log('✓ 遗留/暂扣覆盖、部分补交拒绝、再次修改、无写入读取、错误证据、历史有效性、新运行及撤销');
} finally {fs.rmSync(root,{recursive:true,force:true});}
