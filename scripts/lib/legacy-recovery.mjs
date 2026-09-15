// 历史运行的处理证据独立存档；Git 验证证明的身份与覆盖，内容归属须由登记者逐项审阅。
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { AtbError } from './core.mjs';

export function legacyPaths(ac) {
  return [...new Set([...(ac.pendingManual || []), ...(ac.heldGroups?.test || []), ...(ac.heldGroups?.biz || [])])].sort();
}
function files(dataDir, runId) {
  if (!/^run-[a-zA-Z0-9-]+$/.test(runId)) throw new AtbError('无效运行编号');
  return { ledger:path.join(dataDir,'dispatch','runs',runId,'auto-commit.json'), run:path.join(dataDir,'dispatch','runs',runId,'run.json'), record:path.join(dataDir,'confirms','recoveries',`${runId}.json`) };
}
function digest(text) { return crypto.createHash('sha256').update(text).digest('hex'); }
function git(root, args) {
  const r=spawnSync('git',args,{cwd:root,encoding:'utf8',timeout:10000});
  return r.status===0 ? r.stdout.trim() : null;
}
function validate(root, runId, run, ac, raw, rec) {
  if (rec.version!==1 || rec.runId!==runId || rec.itemId!==ac.itemId || run.itemId!==ac.itemId || run.runId!==runId || run.phase!=='reported' || rec.ledgerDigest!==digest(raw)) return '处理记录与原运行/账本不匹配';
  if (!['committed','withdrawn'].includes(rec.type) || !rec.note?.trim() || !rec.reviewedBy?.trim() || !Number.isFinite(Date.parse(rec.reviewedAt))) return '缺少处理类型或逐项核验说明';
  const expected=legacyPaths(ac);
  if (!expected.length || !Array.isArray(rec.paths) || rec.paths.length!==expected.length || new Set(rec.paths.map(p=>p.path)).size!==expected.length || rec.paths.some(p=>!expected.includes(p.path))) return '处理证据未完整覆盖遗留路径与暂扣路径';
  const anchors=(ac.commits || []).map(c=>c.hash);
  for (const proof of rec.paths) {
    if (!proof.note?.trim() || !/^[a-f0-9]{40,64}$/.test(proof.commit || '') || !(proof.blob===null || /^[a-f0-9]{40,64}$/.test(proof.blob || ''))) return `路径 ${proof.path} 缺少内容证明`;
    if (git(root,['merge-base','--is-ancestor',proof.commit,'HEAD'])===null) return `路径 ${proof.path} 的证明提交不在当前历史`;
    if (anchors.some(hash=>!/^[a-f0-9]{7,64}$/.test(hash) || git(root,['merge-base','--is-ancestor',hash,proof.commit])===null)) return `路径 ${proof.path} 的证明早于原运行提交或历史不相容`;
    const blob=git(root,['rev-parse','--verify',`${proof.commit}:${proof.path}`]);
    if (blob!==proof.blob) return `路径 ${proof.path} 内容指纹不匹配`;
    // 补交必须有该路径的真实变更；撤销可以证明回到已有基线或删除，仍需逐路径审阅说明。
    if (rec.type==='committed') {
      const changed=git(root,['diff-tree','--root','--no-commit-id','--name-only','-r',proof.commit,'--',proof.path]);
      if (!changed || anchors.includes(proof.commit)) return `路径 ${proof.path} 缺少补交改动证明`;
    }
  }
  return null;
}

export function legacyRecoveryStatus(dataDir, root, runId) {
  const f=files(dataDir,runId);
  if (!fs.existsSync(f.record)) return {exists:false,valid:false};
  try {
    const raw=fs.readFileSync(f.ledger,'utf8');
    const reason=validate(root,runId,JSON.parse(fs.readFileSync(f.run,'utf8')),JSON.parse(raw),raw,JSON.parse(fs.readFileSync(f.record,'utf8')));
    return {exists:true,valid:!reason,reason};
  } catch {return {exists:true,valid:false,reason:'历史处理证据无法读取或格式损坏'};}
}

export function recordLegacyRecovery(dataDir,root,runId,evidence) {
  const f=files(dataDir,runId);
  const raw=fs.readFileSync(f.ledger,'utf8');
  const ac=JSON.parse(raw), run=JSON.parse(fs.readFileSync(f.run,'utf8'));
  if (evidence.ledgerDigest && evidence.ledgerDigest !== digest(raw)) throw new AtbError('审阅时的原账本已变化，请重新核验');
  const rec={...evidence,version:1,runId,itemId:ac.itemId,ledgerDigest:digest(raw),reviewedAt:new Date().toISOString()};
  const reason=validate(root,runId,run,ac,raw,rec);
  if(reason) throw new AtbError(reason);
  fs.mkdirSync(path.dirname(f.record),{recursive:true});
  const temp=`${f.record}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  try {fs.writeFileSync(temp,JSON.stringify(rec,null,2)+'\n',{flag:'wx'});fs.renameSync(temp,f.record);}
  finally {fs.rmSync(temp,{force:true});}
  return rec;
}
