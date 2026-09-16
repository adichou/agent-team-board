// BUG-20260916-001：新构建发布路由，不依赖旧发布模块初始化。
// REQ-20260916-004：config 接口支持按项目覆盖官网产品 id 映射（productIds）。
import path from 'node:path';
import * as store from './build-publish-store.mjs';
import * as publish from './build-publish.mjs';
import { readVersion } from './build-store.mjs';
import { AtbError } from './core.mjs';
export async function buildPublishApi({method,pathname,body={},root,dataDir}){
 if(pathname==='/api/build-publish/config'){
  const current=store.readConfig();
  if(method==='GET')return {config:current,projectProductId:store.resolveProductId(current,path.basename(root||''))};
  if(method==='POST'){
   let next=current;
   if(body.homepageRepoRoot!==undefined)next=store.saveConfig(body.homepageRepoRoot);
   if(typeof body.productId==='string'){
    if(!root)throw new AtbError('缺少项目上下文，无法设置官网产品 id 映射');
    next=store.saveProductId(path.basename(root),body.productId);
   }
   return {config:next,projectProductId:store.resolveProductId(next,path.basename(root||''))};
  }
 }
 if(!dataDir)throw new AtbError('请先初始化项目看板');
 if(method==='GET'&&pathname==='/api/build-publish/state'){
  publish.recover(dataDir);return {runs:store.listRuns(dataDir),config:store.readConfig()};
 }
 if(method==='POST'&&pathname==='/api/build-publish/from-build')return {run:await publish.create(dataDir,root,readVersion(dataDir,body.bldId),body.version)};
 const match=pathname.match(/^\/api\/build-publish\/run\/(BPUB-[a-f0-9-]{36})(?:\/([a-z]+))?$/);
 if(!match)throw new AtbError('未知构建发布接口');
 const [,id,action]=match;
 if(method==='GET'&&!action){
  publish.recover(dataDir);const run=store.readRun(dataDir,id);
  let current;try{current=await publish.inputs(root,run);}catch{}
  if(run.precheck?.ok&&store.fingerprint(current)!==run.precheck.fingerprint)run.precheck={...run.precheck,ok:false,stale:true};
  return {run,logs:run.logs,directories:{webapp:store.directoryInfo(run,'webapp'),site:store.directoryInfo(run,'site')}};
 }
 if(method==='GET'&&action==='plan')return {plan:await publish.plan(dataDir,root,id)};
 if(method==='POST'){
  if(action==='precheck')return {run:await publish.precheck(dataDir,root,id)};
  if(action==='refreeze')return {run:await publish.refreeze(dataDir,root,id)};
  if(action==='start'||action==='retry'){const {run}=await publish.start(dataDir,root,id,body.token);return {run};}
  if(action==='cancel')return {run:publish.cancel(dataDir,id)};
  if(action==='open')return publish.openDirectory(dataDir,id,body.target);
 }
 throw new AtbError('未知构建发布操作');
}
