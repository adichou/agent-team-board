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
 // REQ-20260916-004：官网侧为新架构（Vite + Vue）夹具——src/data/apps.js 注册、content 中英成对、
 // build 脚本产出模拟 dist（壳引用 base 前缀 assets，assets 内联 content 路径串与注册串）。
 fs.writeFileSync(path.join(repo,'package.json'),JSON.stringify({name:'site',private:true,scripts:{build:'node build.mjs'}}));
 fs.writeFileSync(path.join(repo,'vite.config.js'),"export default { base: '/app-homepage-repo/' }\n");
 fs.mkdirSync(path.join(repo,'src','data'),{recursive:true});
 fs.writeFileSync(path.join(repo,'src','data','apps.js'),"export const apps = [{ id: 'demo' }]\n");
 for(const v of ['1.0','1.1'])for(const lang of ['zh','en']){
  fs.mkdirSync(path.join(repo,'content','demo','changelog'),{recursive:true});
  fs.mkdirSync(path.join(repo,'content','demo','docs'),{recursive:true});
  fs.writeFileSync(path.join(repo,'content','demo','changelog',`v${v}.${lang}.md`),`---\nversion: ${v}\n---\n`);
  fs.writeFileSync(path.join(repo,'content','demo','docs',`quick-start.${lang}.md`),'docs');
 }
 for(const lang of ['zh','en']){
  fs.writeFileSync(path.join(repo,'content','demo',`faq.${lang}.md`),'faq');
  fs.writeFileSync(path.join(repo,'content','demo',`support.${lang}.md`),'support');
 }
 const bundle=['id:"demo"'];
 for(const v of ['1.0','1.1'])for(const lang of ['zh','en'])bundle.push(`/content/demo/changelog/v${v}.${lang}.md`,`/content/demo/docs/quick-start.${lang}.md`);
 fs.writeFileSync(path.join(repo,'build.mjs'),[
  "import fs from 'node:fs';",
  "fs.mkdirSync('dist/assets',{recursive:true});",
  `fs.writeFileSync('dist/index.html','<!doctype html><html lang="zh-CN"><head><link rel="icon" href="/app-homepage-repo/favicon.svg"><script type="module" src="/app-homepage-repo/assets/app.js"></script></head><body><div id="app"></div><a href="https://github.com/example/demo">external</a></body></html>');`,
  `fs.writeFileSync('dist/assets/app.js',${JSON.stringify(bundle.join(';'))});`,
  "fs.writeFileSync('dist/favicon.svg','<svg xmlns=\\'http://www.w3.org/2000/svg\\'/>');",
 ].join('\n'));
 git(repo,'add','.');git(repo,'-c','user.name=Test','-c','user.email=test@example.com','commit','-m','site');
 const db=path.join(project,'docs','agent-team-board');const bld={id:'BLD-X',name:'test',status:'merged',items:[{itemId:'REQ-test',commit:git(project,'rev-parse','HEAD')}]};
 const run=await publish.create(db,project,bld,'1.0');
 await assert.rejects(()=>publish.start(db,project,run.id,'invented'),/预检/);
 const checked=await publish.precheck(db,project,run.id);assert.equal(checked.precheck.ok,true,JSON.stringify(checked.precheck.checks));
 const p=await publish.plan(db,project,run.id);
 assert.match(p.steps[2],/dist/);
 await assert.rejects(()=>publish.start(db,project,run.id,'wrong'),/确认/);
 const result=await publish.start(db,project,run.id,p.token);
 await assert.rejects(()=>publish.start(db,project,run.id,p.token),/活动|状态/);
 await result.completion;
 const done=store.readRun(db,run.id);assert.equal(done.status,'succeeded',JSON.stringify(done));
 assert.equal(done.targets.webapp.status,'done');assert.equal(done.targets.site.status,'done');
 assert.equal(store.directoryInfo(done,'site').path,path.join(fs.realpathSync(repo),'dist'));
 assert.equal(git(remote,'rev-parse','main'),run.frozen.mainSha);
 await assert.rejects(()=>publish.create(db,project,bld,'1.0'),/已发布/);
 const next=await publish.create(db,project,bld,'1.1');await publish.precheck(db,project,next.id);
 const other=path.join(root,'site2');fs.mkdirSync(other);git(other,'init','-b','main');git(other,'-c','user.name=Test','-c','user.email=test@example.com','commit','--allow-empty','-m','site2');
 store.saveConfig(other);
 await assert.rejects(()=>publish.plan(db,project,next.id),/失效/);
 assert.equal(store.directoryInfo(store.readRun(db,run.id),'site').path,path.join(fs.realpathSync(repo),'dist'));
 publish.stopServers();
});

for(const [name,fn] of cases){await fn();console.log(`PASS ${name}`);}
fs.rmSync(root,{recursive:true,force:true});
