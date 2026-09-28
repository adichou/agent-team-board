// BUG-20260916-001：构建发布执行器。所有变更仅在确认计划后执行，预检只读。
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { AtbError, listItems } from './core.mjs';
import * as store from './build-publish-store.mjs';
import * as buildStore from './build-store.mjs';
import * as flow from './publish-flow.mjs';
import * as docsSummary from './docs-summary-store.mjs';
import * as docsTranslate from './docs-translate-store.mjs';
const exec=promisify(execFile);
const active=new Map(), servers=new Map();
const command=async(cwd,bin,args)=>{try{return (await exec(bin,args,{cwd,timeout:180000,maxBuffer:8*1024*1024})).stdout.trim();}catch(e){throw new AtbError(`${bin} ${args[0]} 失败：${String(e.stderr||e.message).slice(0,1000)}`);}};
const git=(root,...args)=>command(root,'git',args);
export function contentDir(repoRoot,product){
 if(!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(product)||product.includes('..'))throw new AtbError('项目名无法作为安全官网内容目录');
 return path.join(repoRoot,'content',product);
}
const escRegExp=s=>String(s).replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
// REQ-20260916-004：新架构（Vite + Vue 站点）双语材料口径——src/data/apps.js 注册 +
// content/<产品id>/ 中英成对 md。
// BUG-20260928-013：删除 content/<产品id>/ 双语成对内容文件（changelog / faq / support /
// docs）的强制检查——缺失即跳过，不参与材料指纹收集（文件不读、不 fingerprint）；
// src/data/apps.js 存在性与产品注册检查保留。
function siteMaterials(repoRoot,productId){
 const errors=[];let apps='';
 try{apps=fs.readFileSync(path.join(repoRoot,'src','data','apps.js'),'utf8');}catch{errors.push('官网仓库缺少 src/data/apps.js');}
 if(apps&&!new RegExp(`id:\\s*['"]${escRegExp(productId)}['"]`).test(apps))errors.push(`src/data/apps.js 未注册产品 ${productId}（可在设置中配置官网产品 id 映射）`);
 if(errors.length)throw new AtbError(errors.join('；'));
 return [];
}
// 子路径 base 从官网仓库 vite 配置解析（GitHub Pages 项目站点部署），缺省根路径。
function siteBase(repoRoot){
 for(const f of ['vite.config.js','vite.config.mjs','vite.config.ts']){
  try{const m=fs.readFileSync(path.join(repoRoot,f),'utf8').match(/base:\s*['"]([^'"]+)['"]/);if(m)return m[1];}catch{}
 }
 return '/';
}
async function profile(root,sha){
 let pkg=null,index=null;
 try{pkg=JSON.parse(await git(root,'show',`${sha}:package.json`));}catch{}
 try{index=await git(root,'show',`${sha}:index.html`);}catch{}
 if(pkg?.scripts?.build){
  const deps={...pkg.dependencies,...pkg.devDependencies};
  const match=[['vite','dist'],['astro','dist'],['react-scripts','build'],['@vue/cli-service','dist'],['nuxt','.output/public']].find(([name])=>deps[name]);
  if(!match)throw new AtbError('无法自动识别构建产物目录；当前支持静态页面、Vite、Astro、CRA、Vue CLI、Nuxt 静态产物');
  let manager='npm';
  for(const [file,name] of [['pnpm-lock.yaml','pnpm'],['yarn.lock','yarn']]){try{await git(root,'cat-file','-e',`${sha}:${file}`);manager=name;break;}catch{}}
  return {kind:'package',outputDir:match[1],manager,version:pkg.version};
 }
 if(index!==null)return {kind:'static',outputDir:'.',version:null};
 throw new AtbError('冻结源码没有可识别的 Web App 构建或根 index.html');
}
export async function inputs(root,run){
 const remotes=(await git(root,'remote')).split('\n').filter(Boolean);
 const remote=remotes.includes('origin')?'origin':remotes.length===1?remotes[0]:null;
 if(!remote)throw new AtbError('源码远端缺失或歧义');
 const config=store.readConfig();
 const productId=store.resolveProductId(config,path.basename(root));
 const homepage={repoRoot:config.homepageRepoRoot,revision:config.revision,productId,contentDir:config.homepageRepoRoot?contentDir(config.homepageRepoRoot,productId):''};
 let materialFiles=null,materialError=null;
 if(homepage.repoRoot){try{materialFiles=siteMaterials(homepage.repoRoot,productId);}catch(e){materialError=e.message;}}
 return {mainSha:await git(root,'rev-parse','refs/heads/main'),devSha:await git(root,'rev-parse','refs/heads/dev'),remote,remoteUrlHash:store.fingerprint(await git(root,'remote','get-url','--push',remote)),homepage,materialFiles,materialError,version:run.version};
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
async function clean(root){
 // untracked-files=normal 会把看板目录折叠成 "?? agent-team-board/"，导致其内运行记录被误判为脏；用 all 展开完整路径后排除（REQ-20260916-007：runtime 整目录忽略，仅 data/ 可能出现）。
 const dirty=await git(root,'status','--porcelain','--untracked-files=all');
 if(dirty.split('\n').filter(Boolean).some(l=>{const p=l.slice(3).split(' -> ').pop().trim();return !(p.startsWith('agent-team-board/')||p==='.gitignore')}))throw new AtbError('源码工作区有未提交修改，请先处理；不自动暂存或丢弃');
}
// BUG-20260928-011 预检口径重构：必选 2 项（①发布文档审核 / 提交 / 合并 main、②挑选条目
// 合并 main——沿用 assertItemsIncluded 的重放证据口径）+ 可选提醒 1 项（已完成未挑选条目，
// 不阻塞）。旧 7 检中的其余检查（冻结范围 / 工作区 / 官网全局配置 / 双语材料 / Web App
// 构建识别 / 原子推送预演）全部移除：相应失败后移到执行阶段暴露（2026-09-28 人工定夺，
// 不设预检兜底；官网物料旧口径不再阻塞发布）。冻结输入与构建识别仍照实计算，分别作为
// 预检新鲜度指纹（plan 校验）与执行阶段数据，但不再构成检查项。
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
 const mainSha=await git(root,'rev-parse','refs/heads/main');
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
 let current=null,detected=null;
 try{
  // 冻结输入 / 构建识别：只算检查，不作为口径——失败不阻塞预检（plan / 执行阶段反馈）。
  try{current=await inputs(root,run);}catch{/* 远端 / 官网配置问题交由 plan / 执行阶段反馈 */}
  try{detected=await profile(root,run.frozen.mainSha);}catch{detected=null;}
  await check('发布文档',()=>assertDocsReady(dataDir,root,run));
  await check('挑选条目',async()=>{
   let v=null;try{v=buildStore.readVersion(dataDir,run.bldId);}catch{}
   // 按版本计划当前清单核验（运行冻结后补入的条目同样覆盖；版本记录缺失回退冻结快照）
   await assertItemsIncluded(root,v?.items?.length?v.items:run.frozen.items,await git(root,'rev-parse','refs/heads/main'),v?.merge?.replays||run.frozen.replays||[]);
  });
  const remind=unpickedDoneItems(dataDir);
  if(remind.length)checks.push({label:'已完成未挑选条目',ok:true,advisory:true,detail:`存在 ${remind.length} 个已完成但未纳入任何版本计划的条目：${remind.join('、')}（不阻塞本次发布，可考虑纳入后续版本）`});
  return store.updateRun(dataDir,id,r=>{
   r.status=run.status==='failed'?'failed':'draft';r.precheck={ok:checks.every(c=>c.ok),checks,inputs:current,fingerprint:store.fingerprint(current),profile:detected,at:new Date().toISOString()};
   // 官网设置允许补齐，但分支必须显式重新冻结。
   if(current)r.frozen.homepage=current.homepage;
  });
 }finally{active.delete(key);}
}
export async function refreeze(dataDir,root,id){
 assertIdle(dataDir,id);const run=store.readRun(dataDir,id);
 if(!['draft','failed','canceled'].includes(run.status))throw new AtbError('当前状态不可重新冻结');
 if(run.stages.some(s=>s.status==='done'))throw new AtbError('已有执行证据，请创建新发行版本，不能替换历史冻结');
 const current=await inputs(root,run);
 await assertItemsIncluded(root,run.frozen.items,current.mainSha,run.frozen.replays);
 const extra=await git(root,'log',current.mainSha,'--not',...itemCommitsAll(run.frozen.items),...(run.frozen.replays||[]).map(r=>r.replayed),'--format=%H %s');
 return store.updateRun(dataDir,id,r=>{r.frozen={...r.frozen,...current,extraCommits:extra.split('\n').filter(Boolean)};r.precheck=null;r.status='draft';});
}
export async function plan(dataDir,root,id){
 const run=store.readRun(dataDir,id),current=await inputs(root,run);
 if(!run.precheck?.ok||run.precheck.fingerprint!==store.fingerprint(current))throw new AtbError('预检未通过或已失效，请重新预检');
 // BUG-20260928-014：计划文案与执行口径一致——不切换源码分支，按显式 SHA 原子推送两分支。
 return {token:run.precheck.fingerprint,frozen:run.frozen,steps:[`不切换工作区分支，原子推送 main ${current.mainSha} / dev ${current.devSha} 至 ${current.remote}`,`从冻结 main 构建 Web App ${run.version} 并本机回验`,`官网仓库 ${current.homepage.repoRoot} 执行 npm install 与 npm run build（产物 dist）并本机回验`],warning:run.frozen.extraCommits?.length?`冻结范围含额外提交：${run.frozen.extraCommits.join('；')}`:null};
}
function serve(root,base='/'){
 return new Promise((resolve,reject)=>{
  const server=http.createServer((req,res)=>{
   try{
    let p=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
    if(base!=='/'&&p.startsWith(base))p=p.slice(base.length-1);// 剥离子路径 base（GitHub Pages 项目站点）
    const file=path.resolve(root,'.'+p);
    let target=fs.existsSync(file)&&fs.statSync(file).isDirectory()?path.join(file,'index.html'):file;
    if(!fs.existsSync(target))target=path.join(root,'index.html');// SPA fallback：history 路由未知路径回壳页
    const real=fs.realpathSync(target),siteRoot=fs.realpathSync(root);
    if(!real.startsWith(siteRoot+path.sep))throw Error('越界');
    const type={'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml'}[path.extname(real)]||'application/octet-stream';
    res.writeHead(200,{'Content-Type':type});fs.createReadStream(real).pipe(res);
   }catch{res.writeHead(404).end('not found');}
  });server.on('error',reject);server.listen(0,'127.0.0.1',()=>resolve({url:`http://127.0.0.1:${server.address().port}`,close:()=>server.close()}));
 });
}
function get(url){return new Promise((resolve,reject)=>{const req=http.get(url,res=>{let body='';res.on('data',v=>body+=v);res.on('end',()=>res.statusCode===200?resolve(body):reject(Error(`HTTP ${res.statusCode}`)));});req.on('error',reject);req.setTimeout(10000,()=>req.destroy(Error('回验超时')));});}
// REQ-20260916-004：新架构回验。站点为 CSR SPA——壳页不含内容，内容经 import.meta.glob
// 构建期内联进 assets（文件路径串可 grep），据此做无浏览器的产物契约校验；语言切换为客户端
// 按钮，以 zh↔/en 镜像路由可达为口径。
// BUG-20260928-013：删除 changelog / docs 内容的内联检查（产物不再要求内联
// /content/<产品id>/changelog/… 与 docs/… 路径串，docs 路由可达随之移除）；
// 产品注册信息检查与 faq / support / changelog 路由可达保留。
async function verifySite(url,productId,base){
 const origin=new URL(url).origin;
 const page=p=>`${origin}${base==='/'?'':base.replace(/\/$/,'')}${p}`;
 const bundle=[await get(page('/'))];
 for(const [,ref] of bundle[0].matchAll(/(?:href|src)=["']([^"']+)["']/g)){
  if(/^(https?:|mailto:|tel:)/.test(ref))continue;// 外链 https 放行
  const target=new URL(ref,page('/'));
  if(target.origin!==origin)throw Error('官网链接越出本机站点');
  bundle.push(await get(target.href));
 }
 const text=bundle.join('\n');
 if(!new RegExp(`id:\\s*["']${escRegExp(productId)}["']`).test(text))throw Error(`构建产物未包含产品 ${productId} 的注册信息，产品页无法渲染`);
 for(const r of [`/apps/${productId}`,`/apps/${productId}/faq`,`/apps/${productId}/changelog`,'/support'])
  for(const u of [page(r),page(`/en${r}`)])await get(u);
}
async function execute(dataDir,root,id){
 const key=`${dataDir}:${id}`,log=message=>store.updateRun(dataDir,id,r=>r.logs.push({at:new Date().toISOString(),message}));
 const save=(fn)=>store.updateRun(dataDir,id,fn);
 const startServer=async(target,dir,base='/')=>{
  const name=`${key}:${target}`;servers.get(name)?.close();const server=await serve(dir,base);servers.set(name,server);
  save(r=>{r.targets[target].localUrl=server.url;});return server.url;
 };
 try{
  for(const [stageKey] of store.steps){
   let run=store.readRun(dataDir,id);
   if(run.cancelRequested){save(r=>{r.status='canceled';});return;}
   // 回验总是重新执行，进程重启后重新启动本机服务。
   if(run.stages.find(s=>s.key===stageKey).status==='done'&&!stageKey.endsWith('verify'))continue;
   save(r=>{r.stages.find(s=>s.key===stageKey).status='running';});log(`开始 ${stageKey}`);
   try{
    if(stageKey==='sync-source'){
     // BUG-20260928-014：发布全程不切换用户工作区分支——删除 checkout main，本地一致性
     // 校验改为只读 ref 比对（rev-parse refs/heads/main === 冻结 mainSha，与原 HEAD 比对同
     // 语义且不依赖当前分支）；推送用显式 SHA refspec，本就不要求本地检出该分支。
     await clean(root);
     if(await git(root,'rev-parse','refs/heads/main')!==run.frozen.mainSha)throw Error('main 与冻结源码不一致');
     await git(root,'push','--atomic',run.frozen.remote,`${run.frozen.mainSha}:refs/heads/main`,`${run.frozen.devSha}:refs/heads/dev`);
     const refs=await git(root,'ls-remote',run.frozen.remote,'refs/heads/main','refs/heads/dev');
     for(const branch of ['main','dev'])if(!refs.includes(`${run.frozen[branch+'Sha']}\trefs/heads/${branch}`))throw Error(`远端 ${branch} SHA 回验不匹配`);
    }
    if(stageKey==='webapp-build'){
     const source=path.join(store.runDir(dataDir,id),'source'),output=path.join(store.runDir(dataDir,id),'artifacts');
     if(!fs.existsSync(source))await git(root,'worktree','add','--detach',source,run.frozen.mainSha);
     if(await git(source,'rev-parse','HEAD')!==run.frozen.mainSha)throw Error('构建 worktree 不匹配冻结源码');
     const p=run.precheck.profile;
     // BUG-20260928-011：构建识别不再作为预检检查项——识别失败后移执行阶段暴露（此处给出
     // 明确错误，而非让执行以空引用崩溃）。
     if(!p)throw Error('无法识别冻结源码的 Web App 构建方式（预检已不含构建识别项；请检查冻结 main 的 package.json / index.html）');
     if(p.kind==='package'){await command(source,p.manager,['install']);await command(source,p.manager,['run','build']);}
     const built=path.join(source,p.outputDir);
     if(!fs.existsSync(path.join(built,'index.html')))throw Error('构建产物缺少 index.html，无法静态部署');
     fs.mkdirSync(output,{recursive:true});fs.cpSync(built,output,{recursive:true,filter:file=>!['.git','node_modules','docs'].includes(path.basename(file))});
     save(r=>{r.directories.webapp={path:output};});
    }
    if(stageKey==='webapp-verify'){
     const dir=store.readRun(dataDir,id).directories.webapp?.path;if(!dir)throw Error('构建物目录未生成');
     const url=await startServer('webapp',dir),body=await get(url);
     if(!body.includes(run.version)&&run.precheck.profile.version!==run.version)throw Error('Web App 版本回验失败');
     save(r=>{r.targets.webapp.status='done';r.targets.webapp.verifiedVersion=r.version;});
    }
    if(stageKey==='site-deploy'){
     // REQ-20260916-004：在官网仓库执行 npm install 与 npm run build，产物以 dist/ 为准。
     const {repoRoot,productId}=run.frozen.homepage;
     store.validateRepo(repoRoot);siteMaterials(repoRoot,productId);
     await command(repoRoot,'npm',['install']);
     await command(repoRoot,'npm',['run','build']);
     const dist=path.join(repoRoot,'dist');
     if(!fs.existsSync(path.join(dist,'index.html')))throw Error('官网构建产物缺少 dist/index.html');
     save(r=>{r.directories.site={path:dist,repoRoot,base:siteBase(repoRoot)};});
    }
    if(stageKey==='site-verify'){
     const site=store.readRun(dataDir,id).directories.site;if(!site?.path)throw Error('官网构建产物目录未生成');
     const {productId}=store.readRun(dataDir,id).frozen.homepage;
     const url=await startServer('site',site.path,site.base);
     await verifySite(url,productId,site.base||'/');
     save(r=>{r.targets.site.status='done';r.targets.site.verifiedVersion=r.version;});
    }
    save(r=>{r.stages.find(s=>s.key===stageKey).status='done';});log(`完成 ${stageKey}`);
   }catch(e){save(r=>{r.status='failed';r.error={message:e.message,stage:stageKey};const s=r.stages.find(s=>s.key===stageKey);s.status='failed';s.error=e.message;if(stageKey.startsWith('webapp'))r.targets.webapp.status='failed';if(stageKey.startsWith('site'))r.targets.site.status='failed';});log(e.message);return;}
  }
  save(r=>{r.status=r.targets.webapp.status==='done'&&r.targets.site.status==='done'?'succeeded':'failed';});
 }finally{active.delete(key);}
}
export async function start(dataDir,root,id,token){
 assertIdle(dataDir,id);const run=store.readRun(dataDir,id);
 if(!['draft','failed','canceled'].includes(run.status))throw new AtbError('当前状态不可发布');
 const p=await plan(dataDir,root,id);
 if(!token||token!==p.token)throw new AtbError('请先预览并确认当前发布计划');
 // await 后重新抢占，防两个同时通过新鲜度检查的启动重复执行。
 assertIdle(dataDir,id);active.set(`${dataDir}:${id}`,true);
 store.updateRun(dataDir,id,r=>{r.status='running';r.cancelRequested=false;r.error=null;});
 // BUG-20260928-005 正式发布确认落账：start 仅经「发布」按钮二次确认后的一键发布链路
 //（或既有运行的重试）触发——此刻即正式发布时点（version.json release.confirmedAt，
 // 幂等首认固化）；推送动作本身不落此账。版本记录缺失 / 写入失败不阻断发布执行。
 if(run.bldId){try{buildStore.recordReleaseConfirm(dataDir,run.bldId,{runId:run.id});}catch{/* 确认落账失败不阻断发布 */}}
 const completion=execute(dataDir,root,id);completion.catch(e=>{store.updateRun(dataDir,id,r=>{r.status='failed';r.error={message:e.message};});});
 return {run:store.readRun(dataDir,id),completion};
}
export function cancel(dataDir,id){return store.updateRun(dataDir,id,r=>{if(['running','prechecking'].includes(r.status))r.cancelRequested=true;else if(r.status!=='succeeded')r.status='canceled';});}
export function recover(dataDir){for(const r of store.listRuns(dataDir))if(['running','prechecking'].includes(r.status)&&!active.has(`${dataDir}:${r.id}`))store.updateRun(dataDir,r.id,x=>{x.status='failed';x.error={message:'服务中断，请重新预检并确认重试'};});}
export async function openDirectory(dataDir,id,target,{platform=process.platform,open=p=>exec('/usr/bin/open',['-a','Finder',p])}={}){
 const info=store.directoryInfo(store.readRun(dataDir,id),target);
 if(!info.available)throw new AtbError(info.reason);
 if(platform!=='darwin')throw new AtbError('Finder 仅在 macOS 本机可用');
 await open(info.path);return {message:'已请求 Finder 打开'};
}
export function stopServers(){for(const s of servers.values())s.close();servers.clear();}
