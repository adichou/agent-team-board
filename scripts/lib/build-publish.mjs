// BUG-20260916-001：构建发布执行器。所有变更仅在确认计划后执行，预检只读。
// REQ-20260929-002：发布删除全部执行阶段（源码推送 / Web App 构建与回验 / 官网构建与回验）
// 与构建识别（profile）——发布收敛为「检查 → 二次确认 → 更新版本计划状态」：确认通过后仅
// 将版本计划置为「已发布」（发布时间取确认时点），全程无 git push、无官网仓库构建、无本机
// 回验；发布不再要求源码远端与官网仓库配置。存量旧运行（含阶段 / 目标 / 目录数据）原样兼容。
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { AtbError, listItems } from './core.mjs';
import { MAIN_BRANCH, resolveMainBranch } from './git-flow.mjs';
import * as store from './build-publish-store.mjs';
import * as buildStore from './build-store.mjs';
import * as flow from './publish-flow.mjs';
import * as docsSummary from './docs-summary-store.mjs';
import * as docsTranslate from './docs-translate-store.mjs';
const exec=promisify(execFile);
const active=new Map();
const command=async(cwd,bin,args)=>{try{return (await exec(bin,args,{cwd,timeout:180000,maxBuffer:8*1024*1024})).stdout.trim();}catch(e){throw new AtbError(`${bin} ${args[0]} 失败：${String(e.stderr||e.message).slice(0,1000)}`);}};
const git=(root,...args)=>command(root,'git',args);
// BUG-20260929-003：主分支名统一按 resolveMainBranch() 解析取用（REQ-20260916-005 的
// main→master 回退，git-flow 同源）；解析为 null（空仓库等无基点）时回退 main——维持既有
// rev-parse refs/heads/main 报错路径不变。覆盖冻结 mainSha、文档合并核验与条目包含性核验。
const mainBranchOf=(root)=>resolveMainBranch(root)||MAIN_BRANCH;
const mainRef=(root)=>`refs/heads/${mainBranchOf(root)}`;
export async function inputs(root,run){
 // REQ-20260929-002：冻结输入收敛为本地只读 refs——不再解析源码远端、不读官网配置与物料
 //（未配置官网仓库乃至无 origin 远端的项目均可发布；发布成败与源码构建形态无关）。
 const mainBranch=mainBranchOf(root);
 return {mainBranch,mainSha:await git(root,'rev-parse',`refs/heads/${mainBranch}`),devSha:await git(root,'rev-parse','refs/heads/dev'),version:run.version};
}
// REQ-20260920-003：包含性检验适配重放证据——隔离合并以 cherry-pick 重放提交进 main，原始
// commit 不再是 main 祖先；认可「原始提交为祖先」或「记录的重放提交为祖先」两种证据。
// BUG-20260921-015：一条目多提交——条目的全部提交逐一核验（旧单提交形态兜底 [commit]），
// 与隔离分析 / 合并执行使用同一提交集合；任一提交缺失即报错。
const itemCommitsAll=(items)=>(Array.isArray(items)?items:[]).flatMap((it)=>[...new Set((Array.isArray(it?.commits)&&it.commits.length?it.commits:[it?.commit]).map((h)=>String(h||'').toLowerCase()).filter(Boolean))]);
async function isAncestor(root,commit,mainSha){
 try{await git(root,'merge-base','--is-ancestor',commit,mainSha);return true;}catch{return false;}
}
export async function assertItemsIncluded(root, items, mainSha, replays = []) {
  const rs = (replays || []).map((r) => ({ ...r, original: String(r.original || '').toLowerCase() }));
  const included = async (commit) => {
    if (await isAncestor(root, commit, mainSha)) return true;
    const r = rs.find((x) => x.original === String(commit).toLowerCase());
    if (!r) return false;
    return isAncestor(root, r.replayed, mainSha);
  };
  for (const item of items) {
    const commits = itemCommitsAll([item]);
    for (const commit of commits) {
      if (!(await included(commit))) {
        throw new AtbError(`条目 ${item.itemId} 的提交（${String(commit).slice(0, 12)}）未包含在主分支（含重放证据核对）`);
      }
    }
  }
}
export async function create(dataDir,root,bld,version){
 if(bld.status!=='merged'||!bld.items?.length)throw new AtbError('仅已合并且包含条目的版本可创建发布');
 const seed={productId:path.basename(root),bldId:bld.id,bldName:bld.name,version};
 const current=await inputs(root,seed);
 await assertItemsIncluded(root,bld.items,current.mainSha,bld.merge?.replays);
 const extra=await git(root,'log',current.mainSha,'--not',...itemCommitsAll(bld.items),...(bld.merge?.replays||[]).map(r=>r.replayed),'--format=%H %s');
 return store.createRun(dataDir,{...seed,frozen:{...current,items:bld.items,replays:bld.merge?.replays||[],extraCommits:extra.split('\n').filter(Boolean)}});
}
function assertIdle(dataDir,id){
 if(active.has(`${dataDir}:${id}`)||store.listRuns(dataDir).some(r=>r.id!==id&&['running','prechecking'].includes(r.status)))throw new AtbError('项目已有活动发布，请等待结束');
}
// BUG-20260928-011 预检口径重构：必选 2 项（①发布文档审核 / 提交 / 合并 main、②挑选条目
// 合并 main——沿用 assertItemsIncluded 的重放证据口径）+ 可选提醒 1 项（已完成未挑选条目，
// 不阻塞）。REQ-20260929-002：构建识别（profile）计算与落库整体移除——预检结果不再含
// profile 字段，预检通过与否与源码构建形态无关；冻结输入仍照实计算，作为预检新鲜度指纹
//（plan 校验）。
const docReadFile=(root)=>(f)=>{try{return fs.readFileSync(path.join(root,f),'utf8');}catch{return null;}};
const docStatFile=(root)=>(f)=>{try{return fs.statSync(path.join(root,f)).mtimeMs;}catch{return null;}};
// 必选①：复用发布文档两阶段既有事实源（publish-flow 求值 + docs-summary / docs-translate
// 账本标记 + 版本记录 docs / docsMerge 落账与重放证据），不重新发明判定。
async function assertDocsReady(dataDir,root,run){
 const v=buildStore.readVersion(dataDir,run.bldId); // 版本记录缺失 → 找不到版本计划，安全侧不通过
 const read=docReadFile(root);
 const marks={...docsSummary.summaryMarksForVer(dataDir,v.id),...docsTranslate.translateMarksForVer(dataDir,v.id)};
 const flowEval=flow.evaluateDocsFlow(v,read,marks,{statFile:docStatFile(root)});
 if(flowEval.missing.length)throw new AtbError(`发布文档未全部审核通过：缺 ${flowEval.missing.length} 个（${flowEval.missing.map((m)=>`${m.file}（${flow.DOCS_FLOW_LABEL[m.state]||m.state}）`).join('、')}）`);
 const docsEval=flow.evaluateDocsState(v,read);
 if(docsEval.overall!=='committed')throw new AtbError(`发布文档未提交或已变化：${docsEval.reasons[0]||'请先提交发布文档'}`);
 // 已合并入 main：认可「文档提交在 main」或「记录的重放提交在 main」两种证据（与条目包含性同口径）
 const docCommit=String(v.docs?.commitHash||'').toLowerCase();
 const replay=(v.docsMerge?.replays||[]).find((r)=>String(r.original||'').toLowerCase()===docCommit)?.replayed;
 const mainSha=await git(root,'rev-parse',mainRef(root));
 if(!(await isAncestor(root,String(replay||docCommit),mainSha)))throw new AtbError(`发布文档尚未合并到 main：请先完成「文档合并」步（文档提交 ${docCommit.slice(0,12)} 不在 main 历史中）`);
}
// 提醒项：当前项目已完成（done）但未纳入任何版本计划（任意状态均视为已挑选——含已发布
// 版本，跨版本不重复提醒）的条目差集；读取失败不产生提醒（提醒不阻塞，宁可漏提不误拦）。
function unpickedDoneItems(dataDir){
 try{
  const occupied=buildStore.occupiedItemMap(dataDir);
  return listItems(dataDir).filter((i)=>i.status==='done'&&!occupied.has(i.id)).map((i)=>i.id);
 }catch{return[];}
}
export async function precheck(dataDir,root,id){
 assertIdle(dataDir,id);
 let run=store.readRun(dataDir,id);
 if(!['draft','failed','canceled'].includes(run.status))throw new AtbError('当前状态不可预检');
 const key=`${dataDir}:${id}`;active.set(key,true);
 store.updateRun(dataDir,id,r=>{r.status='prechecking';});
 const checks=[];
 const check=async(label,fn)=>{try{await fn();checks.push({label,ok:true});}catch(e){checks.push({label,ok:false,detail:e.message});}};
 let current=null;
 try{
  // 冻结输入：只算检查，不作为口径——失败不阻塞预检（plan 阶段反馈）。
  try{current=await inputs(root,run);}catch{/* 分支缺失等问题交由 plan 阶段反馈 */}
  await check('发布文档',()=>assertDocsReady(dataDir,root,run));
  await check('挑选条目',async()=>{
   let v=null;try{v=buildStore.readVersion(dataDir,run.bldId);}catch{}
   // 按版本计划当前清单核验（运行冻结后补入的条目同样覆盖；版本记录缺失回退冻结快照）
   await assertItemsIncluded(root,v?.items?.length?v.items:run.frozen.items,await git(root,'rev-parse',mainRef(root)),v?.merge?.replays||run.frozen.replays||[]);
  });
  const remind=unpickedDoneItems(dataDir);
  if(remind.length)checks.push({label:'已完成未挑选条目',ok:true,advisory:true,detail:`存在 ${remind.length} 个已完成但未纳入任何版本计划的条目：${remind.join('、')}（不阻塞本次发布，可考虑纳入后续版本）`});
  return store.updateRun(dataDir,id,r=>{
   r.status=run.status==='failed'?'failed':'draft';r.precheck={ok:checks.every(c=>c.ok),checks,inputs:current,fingerprint:store.fingerprint(current),at:new Date().toISOString()};
  });
 }finally{active.delete(key);}
}
export async function refreeze(dataDir,root,id){
 assertIdle(dataDir,id);const run=store.readRun(dataDir,id);
 if(!['draft','failed','canceled'].includes(run.status))throw new AtbError('当前状态不可重新冻结');
 // REQ-20260929-002：新发布运行无 stages（执行阶段已删除）；存量旧运行有执行证据仍不可替换冻结。
 if((run.stages||[]).some(s=>s.status==='done'))throw new AtbError('已有执行证据，请创建新发行版本，不能替换历史冻结');
 const current=await inputs(root,run);
 await assertItemsIncluded(root,run.frozen.items,current.mainSha,run.frozen.replays);
 const extra=await git(root,'log',current.mainSha,'--not',...itemCommitsAll(run.frozen.items),...(run.frozen.replays||[]).map(r=>r.replayed),'--format=%H %s');
 return store.updateRun(dataDir,id,r=>{r.frozen={...r.frozen,...current,extraCommits:extra.split('\n').filter(Boolean)};r.precheck=null;r.status='draft';});
}
export async function plan(dataDir,root,id){
 const run=store.readRun(dataDir,id),current=await inputs(root,run);
 if(!run.precheck?.ok||run.precheck.fingerprint!==store.fingerprint(current))throw new AtbError('预检未通过或已失效，请重新预检');
 // REQ-20260929-002：发布计划收敛为 1 条——确认后仅更新版本计划状态（原 3 条：原子推送
 // master/dev、构建 Web App 并本机回验、官网仓库 npm install / npm run build 并回验，全删）。
 return {token:run.precheck.fingerprint,frozen:run.frozen,steps:[`将版本计划 ${run.bldName||run.bldId} 状态更新为「已发布」（v${run.version}；发布时间取确认时点，不推送远端、不构建官网仓库）`],warning:run.frozen.extraCommits?.length?`冻结范围含额外提交：${run.frozen.extraCommits.join('；')}`:null};
}
// BUG-20260928-015 确认锁回退：发布运行以失败 / 取消终态收尾时调用（取消 ≠ 发布成功）。
// 仅当该运行的确认仍挂账（confirmedRunId 匹配）且按失败口径判定时清除确认锁（成功不可逆）；
// 版本记录缺失 / 写入失败不阻断发布收尾（与 start 处确认落账同宽口径）。
const rollbackConfirm=(dataDir,run)=>{if(run?.bldId){try{buildStore.rollbackReleaseConfirm(dataDir,run.bldId,{runId:run.id});}catch{/* 确认回退失败不阻断收尾 */}}};
export async function start(dataDir,root,id,token){
 assertIdle(dataDir,id);const run=store.readRun(dataDir,id);
 if(!['draft','failed','canceled'].includes(run.status))throw new AtbError('当前状态不可发布');
 const p=await plan(dataDir,root,id);
 if(!token||token!==p.token)throw new AtbError('请先预览并确认当前发布计划');
 // await 后重新抢占，防两个同时通过新鲜度检查的启动重复执行。
 assertIdle(dataDir,id);const key=`${dataDir}:${id}`;active.set(key,true);
 try{
  store.updateRun(dataDir,id,r=>{r.status='running';r.cancelRequested=false;r.error=null;});
  // REQ-20260929-002 发布动作收敛为状态更新：确认落账即正式发布（version.json
  // release.confirmedAt 幂等首认固化，releasedAt 取确认时点）——状态更新是唯一动作，落账
  // 失败即发布失败（不再吞错：run 置 failed 并回退确认锁，反馈原因可重试，不产生假成功）。
  try{
   if(run.bldId)buildStore.recordReleaseConfirm(dataDir,run.bldId,{runId:run.id});
  }catch(e){
   const failed=store.updateRun(dataDir,id,r=>{r.status='failed';r.error={message:e.message};});
   rollbackConfirm(dataDir,failed);
   throw e;
  }
  // 无执行阶段：确认成功即终态 succeeded（不产生 stages / targets / directories）。
  const fin=store.updateRun(dataDir,id,r=>{r.status='succeeded';});
  return {run:fin};
 }finally{active.delete(key);}
}
export function cancel(dataDir,id){const run=store.updateRun(dataDir,id,r=>{if(['running','prechecking'].includes(r.status))r.cancelRequested=true;else if(r.status!=='succeeded')r.status='canceled';});if(run.status==='canceled')rollbackConfirm(dataDir,run);return run;}
export function recover(dataDir){for(const r of store.listRuns(dataDir))if(['running','prechecking'].includes(r.status)&&!active.has(`${dataDir}:${r.id}`)){store.updateRun(dataDir,r.id,x=>{x.status='failed';x.error={message:'服务中断，请重新预检并确认重试'};});rollbackConfirm(dataDir,r);}}
export async function openDirectory(dataDir,id,target,{platform=process.platform,open=p=>exec('/usr/bin/open',['-a','Finder',p])}={}){
 // REQ-20260929-002：目录查看仅对存量旧运行有意义（新发布不产生目录数据），保留既有读取。
 const info=store.directoryInfo(store.readRun(dataDir,id),target);
 if(!info.available)throw new AtbError(info.reason);
 if(platform!=='darwin')throw new AtbError('Finder 仅在 macOS 本机可用');
 await open(info.path);return {message:'已请求 Finder 打开'};
}
