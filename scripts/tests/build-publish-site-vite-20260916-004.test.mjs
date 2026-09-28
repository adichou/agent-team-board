// REQ-20260916-004：官网目标适配 app-homepage-repo 新站点架构（Vite + Vue）。
// BUG-20260928-011 起预检口径重构：官网物料（注册 + content 成对）不再是预检检查项——
// 预检必选项为发布文档 / 挑选条目，物料缺口在执行阶段 site-deploy / site-verify 暴露。
// 本文件覆盖：产品 id 映射设置、site-deploy 构建 dist 与 site-verify 的 SPA fallback /
// 内容契约回验、预检新鲜度指纹（物料内容变化仍使旧预检失效）。
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
// 源码项目夹具（共享 build-publish-fixture）：main + dev（含文档提交，cherry-pick 回 main
// ——预检必选项①发布文档就绪）+ bare 远端。
const makeSource = (name) => makeProject(root, name);
async function runThrough(fx,version){
 const v=makeVersion(fx,{itemId:'REQ-20260916-004'});
 const run=await publish.create(fx.db,fx.project,v,version);
 const checked=await publish.precheck(fx.db,fx.project,run.id);
 assert.equal(checked.precheck.ok,true,JSON.stringify(checked.precheck.checks)); // 预检不再被官网物料口径阻塞
 const plan=await publish.plan(fx.db,fx.project,run.id);
 const result=await publish.start(fx.db,fx.project,run.id,plan.token);
 await result.completion;
 return {db:fx.db,run,plan,done:store.readRun(fx.db,run.id)};
}
// 预检结果不应再包含官网物料 / 旧 7 检标签（BUG-20260928-011 口径）。
const assertNoSiteChecks=(run)=>{
 for(const label of ['冻结范围','工作区','官网全局配置','双语材料','条目包含性','Web App 构建识别','原子推送预演'])
  assert.ok(!(run.precheck?.checks||[]).some(c=>c.label===label),`旧检查「${label}」不应再出现在预检结果中`);
};

test('P1 注册且 content 中英成对齐备 → 预检通过（无旧检查项）且全链路成功', async () => {
 store.saveConfig(makeSite({id:'p1',versions:['1.0']}));
 const {done}=await runThrough(makeSource('p1'),'1.0');
 assert.equal(done.precheck.ok,true,JSON.stringify(done.precheck.checks));
 assertNoSiteChecks(done);
 assert.equal(done.status,'succeeded',JSON.stringify(done.error||null));
});

test('P2 apps.js 未注册产品 → 预检仍通过，失败后移执行阶段 site-deploy 并提示未注册与产品 id', async () => {
 store.saveConfig(makeSite({id:'p2',versions:['1.0'],register:false}));
 const {done}=await runThrough(makeSource('p2'),'1.0');
 assertNoSiteChecks(done);
 assert.equal(done.status,'failed');
 assert.equal(done.error.stage,'site-deploy');
 assert.match(done.error.message,/apps\.js/);assert.match(done.error.message,/未注册/);assert.match(done.error.message,/p2/);
});

test('P3 缺 changelog 英文与 faq 英文 → 执行阶段 site-deploy 失败并逐项列出缺失文件', async () => {
 const repo=makeSite({id:'p3',versions:['1.0']});
 fs.rmSync(path.join(repo,'content','p3','changelog','v1.0.en.md'));
 fs.rmSync(path.join(repo,'content','p3','faq.en.md'));
 store.saveConfig(repo);
 const {done}=await runThrough(makeSource('p3'),'1.0');
 assert.equal(done.precheck.ok,true,'预检不再按物料口径阻塞');
 assert.equal(done.status,'failed');
 assert.equal(done.error.stage,'site-deploy');
 assert.match(done.error.message,/content\/p3\/changelog\/v1\.0\.en\.md/);
 assert.match(done.error.message,/content\/p3\/faq\.en\.md/);
 assert.doesNotMatch(done.error.message,/support/);
});

test('P4 docs 无中英成对文档 → 执行阶段 site-deploy 失败并提示成对要求与示例文件', async () => {
 store.saveConfig(makeSite({id:'p4',versions:['1.0'],docsPair:false}));
 const {done}=await runThrough(makeSource('p4'),'1.0');
 assert.equal(done.status,'failed');
 assert.equal(done.error.stage,'site-deploy');
 assert.match(done.error.message,/docs\/quick-start\.zh\.md/);assert.match(done.error.message,/en\.md/);
});

test('P5+P6 产品 id 默认取项目目录名，productIds 映射可覆盖后重试成功', async () => {
 const repo=makeSite({id:'demo',versions:['1.0']});
 store.saveConfig(repo);
 const fx=makeSource('cam-media-man-mobile');
 const {run,done}=await runThrough(fx,'1.0');
 // 默认产品 id = 项目目录名：content/cam-media-man-mobile 不存在 → 执行阶段 site-deploy 失败
 assert.equal(done.precheck.ok,true,'预检不再按产品 id / 物料口径阻塞');
 assert.equal(done.status,'failed');
 assert.match(done.error.message,/cam-media-man-mobile/);
 // 配置映射覆盖后：重新预检（指纹刷新）→ 计划 → 重试，只补失败阶段即成功
 store.saveProductId('cam-media-man-mobile','demo');
 const re=await publish.precheck(fx.db,fx.project,run.id);
 assert.equal(re.precheck.ok,true,JSON.stringify(re.precheck.checks));
 const plan=await publish.plan(fx.db,fx.project,run.id);
 const retry=await publish.start(fx.db,fx.project,run.id,plan.token);
 await retry.completion;
 const done2=store.readRun(fx.db,run.id);
 assert.equal(done2.status,'succeeded',JSON.stringify(done2.error||null));
});

test('P7 材料内容变更 → 旧预检指纹失效，plan 拒绝', async () => {
 store.saveConfig(makeSite({id:'p7',versions:['1.0']}));
 const fx=makeSource('p7');
 const v=makeVersion(fx,{itemId:'REQ-20260916-004'});
 const run=await publish.create(fx.db,fx.project,v,'1.0');
 const checked=await publish.precheck(fx.db,fx.project,run.id);
 assert.equal(checked.precheck.ok,true);
 fs.writeFileSync(path.join(store.readConfig().homepageRepoRoot,'content','p7','faq.zh.md'),'# FAQ changed\n');
 await assert.rejects(()=>publish.plan(fx.db,fx.project,run.id),/失效/);
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
 const fx=makeSource('api-proj');
 const saved=await buildPublishApi({method:'POST',pathname:'/api/build-publish/config',body:{productId:'demo'},root:fx.project,dataDir:null});
 assert.equal(saved.config.productIds['api-proj'],'demo');
 const got=await buildPublishApi({method:'GET',pathname:'/api/build-publish/config',body:{},root:fx.project,dataDir:null});
 assert.equal(got.projectProductId,'demo');
});

test('D1 全链路成功：官网 npm 构建、产物目录 dist、阶段全绿', async () => {
 const repo=makeSite({id:'d1',versions:['1.0','1.1']});
 store.saveConfig(repo);
 const {run,plan,done}=await runThrough(makeSource('d1'),'1.0');
 assert.match(plan.steps[2],/npm install/);assert.match(plan.steps[2],/dist/);
 assert.equal(done.status,'succeeded',JSON.stringify(done));
 assert.equal(done.targets.webapp.status,'done');
 assert.equal(done.targets.site.status,'done');
 assert.equal(store.directoryInfo(done,'site').path,path.join(fs.realpathSync(repo),'dist'));
 assert.equal(git(path.join(root,'remote-d1.git'),'rev-parse','main'),run.frozen.mainSha);
});

test('D2 构建产物缺 dist/index.html → site-deploy 失败并说明', async () => {
 store.saveConfig(makeSite({id:'d2',versions:['1.0'],noIndex:true}));
 const {done}=await runThrough(makeSource('d2'),'1.0');
 assert.equal(done.status,'failed');
 assert.equal(done.error.stage,'site-deploy');
 assert.match(done.error.message,/dist\/index\.html/);
});

test('V1 构建产物缺更新版本条目 → site-verify 失败并指明 changelog', async () => {
 store.saveConfig(makeSite({id:'v1',versions:['1.0'],bundleChangelog:false}));
 const {done}=await runThrough(makeSource('v1'),'1.0');
 assert.equal(done.status,'failed');
 assert.equal(done.error.stage,'site-verify');
 assert.match(done.error.message,/changelog\/v1\.0/);
});

test('V2 构建产物缺产品注册串 → site-verify 失败并指明产品页无法渲染', async () => {
 store.saveConfig(makeSite({id:'v2',versions:['1.0'],bundleApp:false}));
 const {done}=await runThrough(makeSource('v2'),'1.0');
 assert.equal(done.status,'failed');
 assert.equal(done.error.stage,'site-verify');
 assert.match(done.error.message,/v2/);assert.match(done.error.message,/产品/);
});

for(const [name,fn] of cases){await fn();console.log(`PASS ${name}`);}
publish.stopServers();// 回验本机服务不关会挂住事件循环，进程无法退出
fs.rmSync(root,{recursive:true,force:true});
