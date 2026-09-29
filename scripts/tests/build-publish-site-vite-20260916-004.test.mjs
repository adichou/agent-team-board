// REQ-20260916-004：官网目标适配 app-homepage-repo 新站点架构（Vite + Vue）——原口径为
// site-deploy / site-verify 在官网仓库执行 npm 构建并回验。REQ-20260929-002 人工定夺：
// 「构建」模块发布删除全部执行阶段（含官网构建与回验），官网物料 / 注册 / content 材料不再
// 参与发布输入与预检口径。本文件改为验证：
//   ① 产品 id 映射与 config API 保留（「发布」模块 PREL 与设置页仍用）；
//   ② 官网各形态（已注册 / 未注册 / 无 content / 构建产物缺失 / 官网未配置）均不再影响
//      BPUB 发布——预检通过、计划 1 条、确认即成功；
//   ③ 官网内容变化不使预检指纹失效（inputs 不再收集官网材料）。
const cases=[]; const test=(name,fn)=>cases.push([name,fn]);
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import * as store from '../lib/build-publish-store.mjs';
import * as publish from '../lib/build-publish.mjs';
import { buildPublishApi } from '../lib/build-publish-api.mjs';
import { makeProject, makeVersion } from './lib/build-publish-fixture.mjs';
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atb-site-vite-test-'));
process.env.ATB_BUILD_PUBLISH_CONFIG = path.join(root, 'global.json');
const git = (cwd, ...args) => execFileSync('git', args, {cwd, encoding:'utf8'}).trim();

// 官网仓库夹具（保留原构造形态：src/data/apps.js 注册 + content 材料 + build 脚本产物），
// 用于验证「官网形态与发布成败解耦」；register=false / noContent / noIndex 等制造各种缺口。
function makeSite({id='demo',versions=['1.0','1.1'],register=true,docsPair=true,bundleChangelog=true,bundleApp=true,noIndex=false,noContent=false}={}){
 const repo=path.join(root,`site-${Math.random().toString(36).slice(2,8)}`);
 fs.mkdirSync(path.join(repo,'src','data'),{recursive:true});
 git(repo,'init','-b','main');
 fs.writeFileSync(path.join(repo,'package.json'),JSON.stringify({name:'site',private:true,scripts:{build:'node build.mjs'}}));
 fs.writeFileSync(path.join(repo,'vite.config.js'),"export default { base: '/app-homepage-repo/' }\n");
 fs.writeFileSync(path.join(repo,'src','data','apps.js'),`export const apps = [${register?`{ id: '${id}' }`:''}]\n`);
 if(!noContent){
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
// 源码项目夹具（共享 build-publish-fixture）：main + dev（含文档提交，cherry-pick 回 main
//——预检必选项①发布文档就绪）+ bare 远端。
const makeSource = (name) => makeProject(root, name);
// REQ-20260929-002：全链路 = 预检 → 计划（1 条）→ 确认即成功；官网形态不参与成败。
async function runThrough(fx,version){
 const v=makeVersion(fx,{itemId:'REQ-20260916-004'});
 const run=await publish.create(fx.db,fx.project,v,version);
 const checked=await publish.precheck(fx.db,fx.project,run.id);
 assert.equal(checked.precheck.ok,true,JSON.stringify(checked.precheck.checks)); // 官网形态不再影响预检
 const plan=await publish.plan(fx.db,fx.project,run.id);
 assert.equal(plan.steps.length,1,'发布计划仅 1 条（更新版本计划状态）');
 const {run:done}=await publish.start(fx.db,fx.project,run.id,plan.token);
 return {db:fx.db,run,plan,done:store.readRun(fx.db,run.id)};
}

test('P1 官网注册且材料齐备 → 预检通过、确认即成功（无官网构建执行）', async () => {
 store.saveConfig(makeSite({id:'p1',versions:['1.0']}));
 const {done}=await runThrough(makeSource('p1'),'1.0');
 assert.equal(done.status,'succeeded',JSON.stringify(done.error||null));
 assert.equal(done.directories,undefined,'不再产生官网构建目录数据');
});

test('P2 apps.js 未注册产品 → 不再阻塞：预检通过、发布成功（原 site-deploy 失败口径删除）', async () => {
 store.saveConfig(makeSite({id:'p2',versions:['1.0'],register:false}));
 const {done}=await runThrough(makeSource('p2'),'1.0');
 assert.equal(done.status,'succeeded','官网未注册不再影响发布');
});

test('P3/P4 content 材料缺口（changelog / faq / docs 不成对）→ 发布成功', async () => {
 const repo=makeSite({id:'p3',versions:['1.0']});
 fs.rmSync(path.join(repo,'content','p3','changelog','v1.0.en.md'));
 fs.rmSync(path.join(repo,'content','p3','faq.en.md'));
 store.saveConfig(repo);
 const {done}=await runThrough(makeSource('p3'),'1.0');
 assert.equal(done.status,'succeeded');
 store.saveConfig(makeSite({id:'p4',versions:['1.0'],docsPair:false}));
 const {done:d4}=await runThrough(makeSource('p4'),'1.0');
 assert.equal(d4.status,'succeeded');
});

test('N1 content 目录整体缺失 / D2 构建产物缺 index.html / V2 产物缺注册串 → 均发布成功（不再执行官网构建回验）', async () => {
 store.saveConfig(makeSite({id:'n1',versions:['1.0'],noContent:true}));
 const {done}=await runThrough(makeSource('n1'),'1.0');
 assert.equal(done.status,'succeeded');
 store.saveConfig(makeSite({id:'d2',versions:['1.0'],noIndex:true}));
 const {done:d2}=await runThrough(makeSource('d2'),'1.0');
 assert.equal(d2.status,'succeeded','构建产物缺失不再在 site-deploy 暴露（阶段已删）');
 store.saveConfig(makeSite({id:'v2',versions:['1.0'],bundleApp:false}));
 const {done:v2}=await runThrough(makeSource('v2'),'1.0');
 assert.equal(v2.status,'succeeded','产物注册串缺失不再在 site-verify 暴露（阶段已删）');
});

test('P5 产品 id 默认取项目目录名，映射可覆盖（config 能力保留，仅不再影响发布成败）', async () => {
 const repo=makeSite({id:'demo',versions:['1.0']});
 store.saveConfig(repo);
 const fx=makeSource('cam-media-man-mobile');
 // 默认产品 id = 项目目录名（官网未注册该 id）→ 发布仍成功（物料口径退出发布）
 const {done}=await runThrough(fx,'1.0');
 assert.equal(done.status,'succeeded');
 // 映射覆盖能力保留（PREL / 设置页仍用）
 store.saveProductId('cam-media-man-mobile','demo');
 assert.equal(store.resolveProductId(store.readConfig(),'cam-media-man-mobile'),'demo');
});

test('P7 官网材料内容变更 → 不参与预检指纹，plan 仍有效', async () => {
 store.saveConfig(makeSite({id:'p7',versions:['1.0']}));
 const fx=makeSource('p7');
 const v=makeVersion(fx,{itemId:'REQ-20260916-004'});
 const run=await publish.create(fx.db,fx.project,v,'1.0');
 const checked=await publish.precheck(fx.db,fx.project,run.id);
 assert.equal(checked.precheck.ok,true);
 fs.writeFileSync(path.join(store.readConfig().homepageRepoRoot,'content','p7','faq.zh.md'),'# FAQ changed\n');
 const plan=await publish.plan(fx.db,fx.project,run.id);
 assert.ok(plan.token,'官网材料变化不使预检指纹失效（inputs 不再收集官网材料）');
});

test('S1 saveProductId 写入/清除映射并持久化，非法 id 拒绝', () => {
 store.saveConfig(makeSite({id:'demo'}));
 const cfg=store.saveProductId('proj-x','demo');
 assert.equal(cfg.productIds['proj-x'],'demo');
 assert.equal(store.resolveProductId(store.readConfig(),'other'),'other');
 assert.throws(()=>store.saveProductId('proj-x','../evil'),/非法/);
 const cleared=store.saveProductId('proj-x','');
 assert.equal(cleared.productIds['proj-x'],undefined);
 assert.equal(store.resolveProductId(store.readConfig(),'proj-x'),'proj-x');
});

test('S2 config API 按当前项目写入映射并回显 projectProductId', async () => {
 store.saveConfig(makeSite({id:'demo'}));
 const fx=makeSource('api-proj');
 const saved=await buildPublishApi({method:'POST',pathname:'/api/build-publish/config',body:{productId:'demo'},root:fx.project,dataDir:null});
 assert.equal(saved.config.productIds['api-proj'],'demo');
 const got=await buildPublishApi({method:'GET',pathname:'/api/build-publish/config',body:{},root:fx.project,dataDir:null});
 assert.equal(got.projectProductId,'demo');
});

test('S3 官网完全未配置（全局配置为空）→ 发布成功', async () => {
 const fx=makeSource('s3-nocfg');
 const {done}=await runThrough(fx,'1.0');
 assert.equal(done.status,'succeeded','未配置官网仓库不阻塞发布（REQ-20260929-002）');
});

for(const [name,fn] of cases){await fn();console.log(`PASS ${name}`);}
fs.rmSync(root,{recursive:true,force:true});
