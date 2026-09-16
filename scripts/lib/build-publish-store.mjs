// BUG-20260916-001：构建发布独立事实源，无旧配置或运行迁移。
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { AtbError, writeJsonAtomic } from './core.mjs';
const configFile=()=>process.env.ATB_BUILD_PUBLISH_CONFIG || path.join(os.homedir(),'.agent-team-board','build-publish.json');
export function readConfig(){
 try{return JSON.parse(fs.readFileSync(configFile(),'utf8'));}catch(e){if(e.code==='ENOENT')return {homepageRepoRoot:'',revision:0};throw new AtbError(`官网配置读取失败：${e.message}`);}
}
export function validateRepo(value){
 const root=String(value||'').trim();
 if(!path.isAbsolute(root))throw new AtbError('官网仓库必须填写完整绝对路径');
 try{if(!fs.statSync(root).isDirectory())throw Error('不是目录');fs.accessSync(root,fs.constants.R_OK|fs.constants.W_OK|fs.constants.X_OK);}catch(e){throw new AtbError(`官网目录不可访问：${e.message}`);}
 try{
  const top=execFileSync('git',['rev-parse','--show-toplevel'],{cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
  if(fs.realpathSync(top)!==fs.realpathSync(root))throw Error('必须为仓库根目录');
  execFileSync('git',['rev-parse','--verify','refs/heads/main'],{cwd:root,stdio:'pipe'});
 }catch(e){throw new AtbError(`官网必须是具有 main 分支的 Git 仓库根目录：${e.message}`);}
 return fs.realpathSync(root);
}
export function saveConfig(value){
 const homepageRepoRoot=validateRepo(value), old=readConfig();
 // REQ-20260916-004：保留 productIds 映射，官网仓库根变更才递增修订。
 const cfg={...old,homepageRepoRoot,revision:old.revision+(old.homepageRepoRoot===homepageRepoRoot?0:1)};
 fs.mkdirSync(path.dirname(configFile()),{recursive:true});writeJsonAtomic(configFile(),cfg);return cfg;
}
// REQ-20260916-004：官网产品 id 默认取项目目录名，按项目覆盖映射（全局共享配置内）。
export function resolveProductId(config,projectName){
 const id=(config.productIds||{})[projectName];
 return typeof id==='string'&&id?id:projectName;
}
export function saveProductId(projectName,productId){
 const id=String(productId||'').trim(),old=readConfig(),map={...(old.productIds||{})};
 if(!id||id===projectName)delete map[projectName];
 else{
  if(!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(id))throw new AtbError('官网产品 id 非法：仅允许字母、数字与 . _ -，且以字母或数字开头');
  map[projectName]=id;
 }
 const cfg={...old,productIds:map};
 fs.mkdirSync(path.dirname(configFile()),{recursive:true});writeJsonAtomic(configFile(),cfg);return cfg;
}
export const runsRoot=dataDir=>path.join(dataDir,'builds','publish-runs');
export function runDir(dataDir,id){if(!/^BPUB-[a-f0-9-]{36}$/.test(id))throw new AtbError('构建发布运行编号非法');return path.join(runsRoot(dataDir),id);}
export function readRun(dataDir,id){try{return JSON.parse(fs.readFileSync(path.join(runDir(dataDir,id),'run.json'),'utf8'));}catch(e){throw new AtbError(`构建发布运行读取失败：${e.message}`);}}
export function listRuns(dataDir,bldId){
 if(!fs.existsSync(runsRoot(dataDir)))return [];
 return fs.readdirSync(runsRoot(dataDir)).filter(id=>/^BPUB-/.test(id)).map(id=>readRun(dataDir,id)).filter(r=>!bldId||r.bldId===bldId).sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
}
export const steps=[['sync-source','源码 main/dev 原子推送'],['webapp-build','冻结源码构建'],['webapp-verify','Web App 本机回验'],['site-deploy','官网构建与部署'],['site-verify','官网本机回验']];
export function createRun(dataDir,input){
 if(!/^[A-Za-z0-9][A-Za-z0-9._+-]{0,31}$/.test(input.version||''))throw new AtbError('发行版本号非法');
 const runs=listRuns(dataDir);
 if(runs.some(r=>['running','prechecking'].includes(r.status)))throw new AtbError('当前项目已有活动发布');
 if(runs.some(r=>r.version===input.version&&r.status==='succeeded'))throw new AtbError('该发行版本已发布');
 const run={...input,id:`BPUB-${crypto.randomUUID()}`,status:'draft',createdAt:new Date().toISOString(),stages:steps.map(([key,label])=>({key,label,status:'pending'})),targets:{webapp:{status:'pending'},site:{status:'pending'}},directories:{},logs:[],precheck:null,cancelRequested:false};
 fs.mkdirSync(runDir(dataDir,run.id),{recursive:true});writeJsonAtomic(path.join(runDir(dataDir,run.id),'run.json'),run);return run;
}
export function updateRun(dataDir,id,change){const run=readRun(dataDir,id);change(run);run.updatedAt=new Date().toISOString();writeJsonAtomic(path.join(runDir(dataDir,id),'run.json'),run);return run;}
export function fingerprint(value){return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');}
export function directoryInfo(run,target){
 if(!['webapp','site'].includes(target))throw new AtbError('未知发布目录');
 const saved=run.directories?.[target];
 if(!saved?.path)return {path:null,available:false,reason:run.status==='running'?'生成中':run.status==='succeeded'?'未记录（待确认）':run.status==='failed'?`未生成：${run.error?.message||'阶段未完成'}`:'尚未生成'};
 try{if(!path.isAbsolute(saved.path)||!fs.statSync(saved.path).isDirectory())throw Error('目录不存在');fs.accessSync(saved.path,fs.constants.R_OK|fs.constants.X_OK);return {...saved,available:true,reason:null};}catch(e){return {...saved,available:false,reason:`目录不可访问：${e.message}`};}
}
