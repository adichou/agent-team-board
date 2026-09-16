// BUG-20260916-001：构建发布执行器。所有变更仅在确认计划后执行，预检只读。
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { AtbError } from './core.mjs';
import * as store from './build-publish-store.mjs';
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
// content/<产品id>/ 中英成对 md；缺失项一次性列入错误信息。
function siteMaterials(repoRoot,productId,version){
 const errors=[];let apps='';
 try{apps=fs.readFileSync(path.join(repoRoot,'src','data','apps.js'),'utf8');}catch{errors.push('官网仓库缺少 src/data/apps.js');}
 if(apps&&!new RegExp(`id:\\s*['"]${escRegExp(productId)}['"]`).test(apps))errors.push(`src/data/apps.js 未注册产品 ${productId}（可在设置中配置官网产品 id 映射）`);
 const dir=contentDir(repoRoot,productId),missing=[];
 for(const f of [`changelog/v${version}.zh.md`,`changelog/v${version}.en.md`,'faq.zh.md','faq.en.md','support.zh.md','support.en.md'])
  if(!fs.existsSync(path.join(dir,f)))missing.push(`content/${productId}/${f}`);
 let docs=[];try{docs=fs.readdirSync(path.join(dir,'docs'));}catch{}
 const slugs=[...new Set(docs.map(f=>f.replace(/\.(zh|en)\.md$/,'')))].filter(s=>docs.includes(`${s}.zh.md`)&&docs.includes(`${s}.en.md`));
 if(!slugs.length)missing.push(`content/${productId}/docs/ 的中英成对文档（如 docs/quick-start.zh.md 与 docs/quick-start.en.md）`);
 if(missing.length)errors.push(`缺少：${missing.join('、')}`);
 if(errors.length)throw new AtbError(errors.join('；'));
 return [...[`changelog/v${version}.zh.md`,`changelog/v${version}.en.md`,'faq.zh.md','faq.en.md','support.zh.md','support.en.md'],...slugs.flatMap(s=>[`docs/${s}.zh.md`,`docs/${s}.en.md`])]
  .map(f=>({relative:f,hash:store.fingerprint(fs.readFileSync(path.join(dir,f),'utf8'))}));
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
 if(homepage.repoRoot){try{materialFiles=siteMaterials(homepage.repoRoot,productId,run.version);}catch(e){materialError=e.message;}}
 return {mainSha:await git(root,'rev-parse','refs/heads/main'),devSha:await git(root,'rev-parse','refs/heads/dev'),remote,remoteUrlHash:store.fingerprint(await git(root,'remote','get-url','--push',remote)),homepage,materialFiles,materialError,version:run.version};
}
export async function create(dataDir,root,bld,version){
 if(bld.status!=='merged'||!bld.items?.length)throw new AtbError('仅已合并且包含条目的版本可创建发布');
 const seed={productId:path.basename(root),bldId:bld.id,bldName:bld.name,version};
 const current=await inputs(root,seed);
 for(const item of bld.items)await git(root,'merge-base','--is-ancestor',item.commit,current.mainSha);
 const extra=await git(root,'log',current.mainSha,'--not',...bld.items.map(i=>i.commit),'--format=%H %s');
 return store.createRun(dataDir,{...seed,frozen:{...current,items:bld.items,extraCommits:extra.split('\n').filter(Boolean)}});
}
function assertIdle(dataDir,id){
 if(active.has(`${dataDir}:${id}`)||store.listRuns(dataDir).some(r=>r.id!==id&&['running','prechecking'].includes(r.status)))throw new AtbError('项目已有活动发布，请等待结束');
}
async function clean(root){
 // untracked-files=normal 会把看板数据目录折叠成 "?? docs/"，导致其内运行记录被误判为脏；用 all 展开完整路径后排除。
 const dirty=await git(root,'status','--porcelain','--untracked-files=all');
 if(dirty.split('\n').filter(Boolean).some(l=>!l.slice(3).startsWith('docs/agent-team-board/')))throw new AtbError('源码工作区有未提交修改，请先处理；不自动暂存或丢弃');
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
  await check('冻结范围',async()=>{current=await inputs(root,run);if(current.mainSha!==run.frozen.mainSha||current.devSha!==run.frozen.devSha)throw Error('分支已前进，请重新冻结');});
  await check('工作区',()=>clean(root));
  await check('官网全局配置',()=>store.validateRepo(store.readConfig().homepageRepoRoot));
  await check('双语材料',()=>{if(!current?.materialFiles)throw Error(current?.materialError||'官网双语材料缺失');});
  await check('条目包含性',async()=>{for(const i of run.frozen.items)await git(root,'merge-base','--is-ancestor',i.commit,run.frozen.mainSha);});
  await check('Web App 构建识别',async()=>{detected=await profile(root,run.frozen.mainSha);if(detected.version&&detected.version!==run.version)throw Error('冻结 package.json 版本与发行版本不一致');});
  await check('原子推送预演',()=>git(root,'push','--dry-run','--atomic',run.frozen.remote,'refs/heads/main:refs/heads/main','refs/heads/dev:refs/heads/dev'));
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
 for(const i of run.frozen.items)await git(root,'merge-base','--is-ancestor',i.commit,current.mainSha);
 const extra=await git(root,'log',current.mainSha,'--not',...run.frozen.items.map(i=>i.commit),'--format=%H %s');
 return store.updateRun(dataDir,id,r=>{r.frozen={...r.frozen,...current,extraCommits:extra.split('\n').filter(Boolean)};r.precheck=null;r.status='draft';});
}
export async function plan(dataDir,root,id){
 const run=store.readRun(dataDir,id),current=await inputs(root,run);
 if(!run.precheck?.ok||run.precheck.fingerprint!==store.fingerprint(current))throw new AtbError('预检未通过或已失效，请重新预检');
 return {token:run.precheck.fingerprint,frozen:run.frozen,steps:[`切换源码 main，并原子推送 main ${current.mainSha} / dev ${current.devSha} 至 ${current.remote}`,`从冻结 main 构建 Web App ${run.version} 并本机回验`,`官网仓库 ${current.homepage.repoRoot} 执行 npm install 与 npm run build（产物 dist）并本机回验`],warning:run.frozen.extraCommits?.length?`冻结范围含额外提交：${run.frozen.extraCommits.join('；')}`:null};
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
async function verifySite(url,productId,version,base){
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
 for(const locale of ['zh','en'])if(!text.includes(`/content/${productId}/changelog/v${version}.${locale}.md`))throw Error(`官网更新内容缺少 ${version} 的${locale==='zh'?'中':'英'}文条目（content/${productId}/changelog/v${version}.${locale}.md）`);
 const slugs=[...new Set([...text.matchAll(new RegExp(`/content/${escRegExp(productId)}/docs/([A-Za-z0-9._-]+)\\.zh\\.md`,'g'))].map(m=>m[1]))];
 if(!slugs.length)throw Error(`构建产物未包含文档内容（content/${productId}/docs/）`);
 for(const r of [`/apps/${productId}`,`/apps/${productId}/docs`,`/apps/${productId}/faq`,`/apps/${productId}/changelog`,'/support',...slugs.map(s=>`/apps/${productId}/docs/${s}`)])
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
     await clean(root);await git(root,'checkout','main');
     if(await git(root,'rev-parse','HEAD')!==run.frozen.mainSha)throw Error('main 与冻结源码不一致');
     await git(root,'push','--atomic',run.frozen.remote,`${run.frozen.mainSha}:refs/heads/main`,`${run.frozen.devSha}:refs/heads/dev`);
     const refs=await git(root,'ls-remote',run.frozen.remote,'refs/heads/main','refs/heads/dev');
     for(const branch of ['main','dev'])if(!refs.includes(`${run.frozen[branch+'Sha']}\trefs/heads/${branch}`))throw Error(`远端 ${branch} SHA 回验不匹配`);
    }
    if(stageKey==='webapp-build'){
     const source=path.join(store.runDir(dataDir,id),'source'),output=path.join(store.runDir(dataDir,id),'artifacts');
     if(!fs.existsSync(source))await git(root,'worktree','add','--detach',source,run.frozen.mainSha);
     if(await git(source,'rev-parse','HEAD')!==run.frozen.mainSha)throw Error('构建 worktree 不匹配冻结源码');
     const p=run.precheck.profile;
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
     store.validateRepo(repoRoot);siteMaterials(repoRoot,productId,run.version);
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
     await verifySite(url,productId,run.version,site.base||'/');
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
