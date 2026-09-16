// BUG-20260916-001：新构建发布路由，不依赖旧发布模块初始化。
import * as store from './build-publish-store.mjs';
import * as publish from './build-publish.mjs';
import { readVersion } from './build-store.mjs';
import { AtbError } from './core.mjs';
export async function buildPublishApi({method,pathname,body={},root,dataDir}){
 if(pathname==='/api/build-publish/config'){
  if(method==='GET')return {config:store.readConfig()};
  if(method==='POST')return {config:store.saveConfig(body.homepageRepoRoot)};
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
