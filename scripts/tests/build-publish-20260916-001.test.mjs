// BUG-20260916-001：独立存储、全局配置失效和目录快照契约。
const cases=[]; const test=(name,fn)=>cases.push([name,fn]);
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import * as store from '../lib/build-publish-store.mjs';
import * as publish from '../lib/build-publish.mjs';
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atb-publish-test-'));
process.env.ATB_BUILD_PUBLISH_CONFIG = path.join(root, 'global.json');
const git = (cwd, ...args) => execFileSync('git', args, {cwd, encoding:'utf8'}).trim();
const repo = path.join(root,'site'); fs.mkdirSync(repo); git(repo,'init','-b','main'); git(repo,'-c','user.name=Test','-c','user.email=test@example.com','commit','--allow-empty','-m','init');
const board = path.join(root,'board');
test('全局配置验证失败不覆盖有效值，变化递增修订', () => {
 const a=store.saveConfig(repo); assert.equal(a.homepageRepoRoot,fs.realpathSync(repo));
 assert.throws(()=>store.saveConfig('relative'),/绝对/);
 assert.throws(()=>store.saveConfig(root),/仓库/);
 assert.deepEqual(store.readConfig(),a);
 assert.equal(store.saveConfig(repo).revision,a.revision);
});
test('独立运行存储隔离项目、版本，旧产品记录不可读取', () => {
 const a=store.createRun(board,{bldId:'BLD-A',version:'1.0',frozen:{},productId:'demo'});
 assert.match(a.id,/^BPUB-/); assert.equal(store.listRuns(path.join(root,'other')).length,0);
 assert.equal(store.listRuns(board,'BLD-B').length,0);
 assert.throws(()=>store.readRun(board,'../legacy'),/编号/);
 assert.ok(fs.existsSync(path.join(board,'builds','publish-runs',a.id,'run.json')));
});
test('Finder 仅使用结果路径，未生成禁用，删除后拒绝，不读取最新配置', async () => {
 const out=path.join(root,'output');fs.mkdirSync(out);
 const run=store.createRun(board,{bldId:'BLD-A',version:'2.0',frozen:{homepage:{repoRoot:repo}},productId:'demo'});
 store.updateRun(board,run.id,r=>{r.directories.webapp={path:out};});
 assert.equal(store.directoryInfo(store.readRun(board,run.id),'webapp').available,true);
 assert.equal(store.directoryInfo(run,'site').available,false);
 let opened;await publish.openDirectory(board,run.id,'webapp',{platform:'darwin',open:async p=>{opened=p;}});assert.equal(opened,out);
 fs.rmdirSync(out);await assert.rejects(()=>publish.openDirectory(board,run.id,'webapp',{platform:'darwin',open:async()=>assert.fail()}),/访问|不存在/);
});
test('新模块不导入旧发布 API、执行器或存储', () => {
 for(const file of ['build-publish.mjs','build-publish-store.mjs','build-publish-api.mjs']) {
  assert.doesNotMatch(fs.readFileSync(new URL('../lib/'+file,import.meta.url),'utf8'),/from ['"].*(?:product-release|release-store|release-git|webapp-profile|site-materials)/);
 }
 assert.doesNotMatch(fs.readFileSync(new URL('../web/build.js',import.meta.url),'utf8'),/\/api\/product-release/);
});

test('真实临时 Git 双目标执行、计划确认、防重复、全局改动失效与成功目录快照', async () => {
 const project=path.join(root,'demo');fs.mkdirSync(project);
 git(project,'init','-b','main');
 fs.writeFileSync(path.join(project,'index.html'),'<html>1.0</html>');
 git(project,'add','.');git(project,'-c','user.name=Test','-c','user.email=test@example.com','commit','-m','web');
 git(project,'branch','dev');
 const remote=path.join(root,'remote.git');git(root,'init','--bare',remote);git(project,'remote','add','origin',remote);
 for(const lang of ['zh','en']){
  const dir=path.join(repo,'demo',lang);fs.mkdirSync(dir,{recursive:true});
  for(const page of ['index','usage','guide','changelog'])fs.writeFileSync(path.join(dir,page+'.html'),`<html>1.0 <a href="../${lang==='zh'?'en':'zh'}/index.html">language</a></html>`);
 }
 const db=path.join(project,'docs','agent-team-board');const bld={id:'BLD-X',name:'test',status:'merged',items:[{itemId:'REQ-test',commit:git(project,'rev-parse','HEAD')}]};
 const run=await publish.create(db,project,bld,'1.0');
 await assert.rejects(()=>publish.start(db,project,run.id,'invented'),/预检/);
 const checked=await publish.precheck(db,project,run.id);assert.equal(checked.precheck.ok,true,JSON.stringify(checked.precheck.checks));
 const p=await publish.plan(db,project,run.id);
 await assert.rejects(()=>publish.start(db,project,run.id,'wrong'),/确认/);
 const result=await publish.start(db,project,run.id,p.token);
 await assert.rejects(()=>publish.start(db,project,run.id,p.token),/活动|状态/);
 await result.completion;
 const done=store.readRun(db,run.id);assert.equal(done.status,'succeeded',JSON.stringify(done));
 assert.equal(done.targets.webapp.status,'done');assert.equal(done.targets.site.status,'done');
 assert.equal(store.directoryInfo(done,'site').path,path.join(fs.realpathSync(repo),'demo'));
 assert.equal(git(remote,'rev-parse','main'),run.frozen.mainSha);
 await assert.rejects(()=>publish.create(db,project,bld,'1.0'),/已发布/);
 const next=await publish.create(db,project,bld,'1.1');await publish.precheck(db,project,next.id);
 const other=path.join(root,'site2');fs.mkdirSync(other);git(other,'init','-b','main');git(other,'-c','user.name=Test','-c','user.email=test@example.com','commit','--allow-empty','-m','site2');
 store.saveConfig(other);
 await assert.rejects(()=>publish.plan(db,project,next.id),/失效/);
 assert.equal(store.directoryInfo(store.readRun(db,run.id),'site').path,path.join(fs.realpathSync(repo),'demo'));
 publish.stopServers();
});

for(const [name,fn] of cases){await fn();console.log(`PASS ${name}`);}
fs.rmSync(root,{recursive:true,force:true});
