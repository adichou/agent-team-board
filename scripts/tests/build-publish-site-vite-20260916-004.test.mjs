// REQ-20260916-004：官网目标适配 app-homepage-repo 新站点架构（Vite + Vue）。
// 预检「双语材料」新口径（注册 + content 成对 + 缺失清单）、产品 id 映射设置、
// site-deploy 构建 dist 与 site-verify 的 SPA fallback / 内容契约回验。
const cases=[]; const test=(name,fn)=>cases.push([name,fn]);
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import * as store from '../lib/build-publish-store.mjs';
import * as publish from '../lib/build-publish.mjs';
import { buildPublishApi } from '../lib/build-publish-api.mjs';
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atb-site-vite-test-'));
process.env.ATB_BUILD_PUBLISH_CONFIG = path.join(root, 'global.json');
const git = (cwd, ...args) => execFileSync('git', args, {cwd, encoding:'utf8'}).trim();

// 新架构官网仓库夹具：src/data/apps.js 注册 + content/<id>/ 中英成对 md +
// build 脚本产出模拟 Vite dist（壳 index.html 引用 base 前缀 assets，assets 内联
// content 路径串与注册串——真实站点经 import.meta.glob eager 打包后的可回验契约）。
function makeSite({id='demo',versions=['1.0','1.1'],register=true,docsPair=true,bundleChangelog=true,bundleApp=true,noIndex=false}={}){
 const repo=path.join(root,`site-${Math.random().toString(36).slice(2,8)}`);
 fs.mkdirSync(path.join(repo,'src','data'),{recursive:true});
 git(repo,'init','-b','main');
 fs.writeFileSync(path.join(repo,'package.json'),JSON.stringify({name:'site',private:true,scripts:{build:'node build.mjs'}}));
 fs.writeFileSync(path.join(repo,'vite.config.js'),"export default { base: '/app-homepage-repo/' }\n");
 fs.writeFileSync(path.join(repo,'src','data','apps.js'),`export const apps = [${register?`{ id: '${id}' }`:''}]\n`);
 const dir=path.join(repo,'content',id);
 for(const v of versions)for(const loc of ['zh','en']){
  fs.mkdirSync(path.join(dir,'changelog'),{recursive:true});
  fs.writeFileSync(path.join(dir,`changelog/v${v}.${loc}.md`),`---\nversion: ${v}\ndate: 2026-09-16\n---\n\n# ${v}\n`);
 }
 for(const loc of ['zh','en']){
  fs.writeFileSync(path.join(dir,`faq.${loc}.md`),'# FAQ\n');
  fs.writeFileSync(path.join(dir,`support.${loc}.md`),'# Support\n');
  if(docsPair){
   fs.mkdirSync(path.join(dir,'docs'),{recursive:true});
   fs.writeFileSync(path.join(dir,`docs/quick-start.${loc}.md`),'---\ntitle: Q\norder: 1\n---\n\n# Q\n');
  }
 }
 const bundle=[];
 if(bundleApp)bundle.push(`id:"${id}"`);
 if(bundleChangelog)for(const v of versions)for(const loc of ['zh','en'])bundle.push(`/content/${id}/changelog/v${v}.${loc}.md`);
 if(docsPair)for(const loc of ['zh','en'])bundle.push(`/content/${id}/docs/quick-start.${loc}.md`);
 fs.writeFileSync(path.join(repo,'build.mjs'),[
  "import fs from 'node:fs';",
  "fs.mkdirSync('dist/assets',{recursive:true});",
  `const shell='<!doctype html><html lang="zh-CN"><head><link rel="icon" href="/app-homepage-repo/favicon.svg"><link rel="stylesheet" href="/app-homepage-repo/assets/app.css"><script type="module" src="/app-homepage-repo/assets/app.js"></script></head><body><div id="app"></div><a href="https://example.com/external">external</a></body></html>';`,
  noIndex?"fs.writeFileSync('dist/assets/app.css','body{}');":"fs.writeFileSync('dist/index.html',shell);fs.writeFileSync('dist/assets/app.css','body{}');",
  `fs.writeFileSync('dist/assets/app.js',${JSON.stringify(bundle.join(';'))});`,
  "fs.writeFileSync('dist/favicon.svg','<svg xmlns=\\'http://www.w3.org/2000/svg\\'/>');",
 ].join('\n'));
 git(repo,'add','.');git(repo,'-c','user.name=T','-c','user.email=t@e.c','commit','-m','site');
 return repo;
}
function makeSource(name='demo'){
 const project=path.join(root,name);fs.mkdirSync(project,{recursive:true});
 git(project,'init','-b','main');
 fs.writeFileSync(path.join(project,'index.html'),'<html>1.0</html>');
 git(project,'add','.');git(project,'-c','user.name=T','-c','user.email=t@e.c','commit','-m','web');
 git(project,'branch','dev');
 const remote=path.join(root,`remote-${name}.git`);git(root,'init','--bare',remote);git(project,'remote','add','origin',remote);
 return project;
}
function mergedBld(project){
 return {id:'BLD-S',name:'t',status:'merged',items:[{itemId:'REQ-s',commit:git(project,'rev-parse','HEAD')}]};
}
async function runThrough(project,version){
 const db=path.join(project,'docs','agent-team-board');
 const run=await publish.create(db,project,mergedBld(project),version);
 await publish.precheck(db,project,run.id);
 const plan=await publish.plan(db,project,run.id);
 const result=await publish.start(db,project,run.id,plan.token);
 await result.completion;
 return {db,run,plan,done:store.readRun(db,run.id)};
}
const materialCheck=run=>run.precheck.checks.find(c=>c.label==='双语材料');

test('P1 注册且 content 中英成对齐备 → 预检双语材料通过', async () => {
 store.saveConfig(makeSite({id:'p1',versions:['1.0']}));
 const project=makeSource('p1');
 const {done}=await runThrough(project,'1.0');
 assert.equal(materialCheck(done).ok,true,JSON.stringify(done.precheck.checks));
});

test('P2 apps.js 未注册产品 → 失败提示未注册与产品 id', async () => {
 store.saveConfig(makeSite({id:'p2',versions:['1.0'],register:false}));
 const project=makeSource('p2');
 const db=path.join(project,'docs','agent-team-board');
 const run=await publish.create(db,project,mergedBld(project),'1.0');
 const checked=await publish.precheck(db,project,run.id);
 const mat=materialCheck(checked);
 assert.equal(mat.ok,false);
 assert.match(mat.detail,/apps\.js/);assert.match(mat.detail,/未注册/);assert.match(mat.detail,/p2/);
});

test('P3 缺 changelog 英文与 faq 英文 → 失败逐项列出缺失文件', async () => {
 const repo=makeSite({id:'p3',versions:['1.0']});
 fs.rmSync(path.join(repo,'content','p3','changelog','v1.0.en.md'));
 fs.rmSync(path.join(repo,'content','p3','faq.en.md'));
 store.saveConfig(repo);
 const project=makeSource('p3');
 const db=path.join(project,'docs','agent-team-board');
 const run=await publish.create(db,project,mergedBld(project),'1.0');
 const checked=await publish.precheck(db,project,run.id);
 const mat=materialCheck(checked);
 assert.equal(mat.ok,false);
 assert.match(mat.detail,/content\/p3\/changelog\/v1\.0\.en\.md/);
 assert.match(mat.detail,/content\/p3\/faq\.en\.md/);
 assert.doesNotMatch(mat.detail,/support/);
});

test('P4 docs 无中英成对文档 → 失败提示成对要求与示例文件', async () => {
 store.saveConfig(makeSite({id:'p4',versions:['1.0'],docsPair:false}));
 const project=makeSource('p4');
 const db=path.join(project,'docs','agent-team-board');
 const run=await publish.create(db,project,mergedBld(project),'1.0');
 const checked=await publish.precheck(db,project,run.id);
 const mat=materialCheck(checked);
 assert.equal(mat.ok,false);
 assert.match(mat.detail,/docs\/quick-start\.zh\.md/);assert.match(mat.detail,/en\.md/);
});

test('P5+P6 产品 id 默认取项目目录名，productIds 映射可覆盖', async () => {
 const repo=makeSite({id:'demo',versions:['1.0']});
 store.saveConfig(repo);
 const project=makeSource('cam-media-man-mobile');
 const db=path.join(project,'docs','agent-team-board');
 const bld=mergedBld(project);
 const run=await publish.create(db,project,bld,'1.0');
 const checked=await publish.precheck(db,project,run.id);
 assert.equal(materialCheck(checked).ok,false);assert.match(materialCheck(checked).detail,/cam-media-man-mobile/);
 store.saveProductId('cam-media-man-mobile','demo');
 const again=await publish.precheck(db,project,run.id);
 assert.equal(materialCheck(again).ok,true,materialCheck(again).detail);
});

test('P7 材料内容变更 → 旧预检指纹失效，plan 拒绝', async () => {
 store.saveConfig(makeSite({id:'p7',versions:['1.0']}));
 const project=makeSource('p7');
 const db=path.join(project,'docs','agent-team-board');
 const run=await publish.create(db,project,mergedBld(project),'1.0');
 const checked=await publish.precheck(db,project,run.id);
 assert.equal(checked.precheck.ok,true);
 fs.writeFileSync(path.join(store.readConfig().homepageRepoRoot,'content','p7','faq.zh.md'),'# FAQ changed\n');
 await assert.rejects(()=>publish.plan(db,project,run.id),/失效/);
});

test('S1 saveProductId 写入/清除映射并持久化，非法 id 拒绝', () => {
 store.saveConfig(makeSite({id:'demo'}));
 const cfg=store.saveProductId('proj-x','demo');
 assert.equal(cfg.productIds['proj-x'],'demo');
 assert.equal(store.resolveProductId(store.readConfig(),'proj-x'),'demo');
 assert.equal(store.resolveProductId(store.readConfig(),'other'),'other');
 store.saveProductId('proj-x','demo');
 assert.throws(()=>store.saveProductId('proj-x','../evil'),/非法/);
 const cleared=store.saveProductId('proj-x','');
 assert.equal(cleared.productIds['proj-x'],undefined);
 assert.equal(store.resolveProductId(store.readConfig(),'proj-x'),'proj-x');
 assert.equal(store.readConfig().productIds['proj-x'],undefined);
});

test('S2 config API 按当前项目写入映射并回显 projectProductId', async () => {
 store.saveConfig(makeSite({id:'demo'}));
 const project=makeSource('api-proj');
 const saved=await buildPublishApi({method:'POST',pathname:'/api/build-publish/config',body:{productId:'demo'},root:project,dataDir:null});
 assert.equal(saved.config.productIds['api-proj'],'demo');
 const got=await buildPublishApi({method:'GET',pathname:'/api/build-publish/config',body:{},root:project,dataDir:null});
 assert.equal(got.projectProductId,'demo');
});

test('D1 全链路成功：官网 npm 构建、产物目录 dist、阶段全绿', async () => {
 const repo=makeSite({id:'d1',versions:['1.0','1.1']});
 store.saveConfig(repo);
 const project=makeSource('d1');
 const {run,plan,done}=await runThrough(project,'1.0');
 assert.match(plan.steps[2],/npm install/);assert.match(plan.steps[2],/dist/);
 assert.equal(done.status,'succeeded',JSON.stringify(done));
 assert.equal(done.targets.webapp.status,'done');
 assert.equal(done.targets.site.status,'done');
 assert.equal(store.directoryInfo(done,'site').path,path.join(fs.realpathSync(repo),'dist'));
 assert.equal(git(path.join(root,'remote-d1.git'),'rev-parse','main'),run.frozen.mainSha);
});

test('D2 构建产物缺 dist/index.html → site-deploy 失败并说明', async () => {
 store.saveConfig(makeSite({id:'d2',versions:['1.0'],noIndex:true}));
 const project=makeSource('d2');
 const {done}=await runThrough(project,'1.0');
 assert.equal(done.status,'failed');
 assert.equal(done.error.stage,'site-deploy');
 assert.match(done.error.message,/dist\/index\.html/);
});

test('V1 构建产物缺更新版本条目 → site-verify 失败并指明 changelog', async () => {
 store.saveConfig(makeSite({id:'v1',versions:['1.0'],bundleChangelog:false}));
 const project=makeSource('v1');
 const {done}=await runThrough(project,'1.0');
 assert.equal(done.status,'failed');
 assert.equal(done.error.stage,'site-verify');
 assert.match(done.error.message,/changelog\/v1\.0/);
});

test('V2 构建产物缺产品注册串 → site-verify 失败并指明产品页无法渲染', async () => {
 store.saveConfig(makeSite({id:'v2',versions:['1.0'],bundleApp:false}));
 const project=makeSource('v2');
 const {done}=await runThrough(project,'1.0');
 assert.equal(done.status,'failed');
 assert.equal(done.error.stage,'site-verify');
 assert.match(done.error.message,/v2/);assert.match(done.error.message,/产品/);
});

for(const [name,fn] of cases){await fn();console.log(`PASS ${name}`);}
publish.stopServers();// 回验本机服务不关会挂住事件循环，进程无法退出
fs.rmSync(root,{recursive:true,force:true});
