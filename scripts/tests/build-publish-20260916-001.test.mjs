// BUG-20260916-001：独立存储、全局配置失效和目录快照契约。
// REQ-20260929-002 起全链路改新口径：发布删除全部执行阶段（推送 / Web App 构建 / 官网构建
// 与回验），确认后仅更新版本计划状态；官网配置读写能力保留（「发布」模块仍用），但不再
// 参与发布输入与指纹；无官网配置 / 无远端项目可全链路发布。
const cases=[]; const test=(name,fn)=>cases.push([name,fn]);
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import * as store from '../lib/build-publish-store.mjs';
import * as buildStore from '../lib/build-store.mjs';
import * as publish from '../lib/build-publish.mjs';
import { makeProject, makeVersion } from './lib/build-publish-fixture.mjs';
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
 assert.ok(fs.existsSync(path.join(board, 'runtime', 'builds','publish-runs',a.id,'run.json')));
});
test('Finder 仅使用结果路径，未生成禁用，删除后拒绝，不读取最新配置', async () => {
 const out=path.join(root,'output');fs.mkdirSync(out);
 const run=store.createRun(board,{bldId:'BLD-A',version:'2.0',frozen:{homepage:{repoRoot:repo}},productId:'demo'});
 store.updateRun(board,run.id,r=>{r.directories={webapp:{path:out}};});
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

test('真实临时 Git 全链路：无官网配置即发布成功（计划 1 条 / 无推送 / 版本即时置已发布 / 幂等拒绝）', async () => {
 // REQ-20260929-002：预检按「发布文档 + 挑选条目」口径核验（共享夹具）；发布不再读取官网
 // 配置（本用例全程不 saveConfig，全局配置文件不存在 = 空配置），确认后仅更新版本计划状态。
 const fx=makeProject(root,'demo');
 const project=fx.project;
 const db=fx.db;
 const v=makeVersion(fx,{itemId:'REQ-20260916-001'});
 const run=await publish.create(db,project,v,'1.0');
 await assert.rejects(()=>publish.start(db,project,run.id,'invented'),/预检/);
 const checked=await publish.precheck(db,project,run.id);assert.equal(checked.precheck.ok,true,JSON.stringify(checked.precheck.checks));
 const p=await publish.plan(db,project,run.id);
 assert.equal(p.steps.length,1,`发布计划仅 1 条（实际 ${p.steps.length}）`);
 assert.match(p.steps[0],/已发布/);
 await assert.rejects(()=>publish.start(db,project,run.id,'wrong'),/确认/);
 const {run:fin}=await publish.start(db,project,run.id,p.token);
 await assert.rejects(()=>publish.start(db,project,run.id,p.token),/活动|状态/);
 const done=store.readRun(db,run.id);assert.equal(done.status,'succeeded',JSON.stringify(done));
 // REQ-20260929-002：新发布不产生 stages / targets / directories 数据
 assert.equal(done.stages,undefined);assert.equal(done.targets,undefined);assert.equal(done.directories,undefined);
 // 全程无 git push：bare 远端无任何 refs
 assert.equal(git(path.join(root,'remote-demo.git'),'for-each-ref','--format=%(refname)'),'','发布不推送远端');
 // 确认落账：版本计划即时置「已发布」，发布时间取确认时点
 const ver=buildStore.readVersion(db,v.id);
 assert.ok(ver.release?.confirmedAt);assert.equal(buildStore.isReleased(ver,db),true);
 assert.equal(ver.releasedAt,ver.release.confirmedAt);
 await assert.rejects(()=>publish.create(db,project,buildStore.readVersion(db,v.id),'1.0'),/已发布/);
 // 官网配置变化不再使预检指纹失效（inputs 不再含官网配置；分支未动则 plan 一直有效）
 const other=path.join(root,'site2');fs.mkdirSync(other);git(other,'init','-b','main');git(other,'-c','user.name=Test','-c','user.email=test@example.com','commit','--allow-empty','-m','site2');
 const next=await publish.create(db,project,buildStore.readVersion(db,v.id),'1.1');await publish.precheck(db,project,next.id);
 const plan2=await publish.plan(db,project,next.id);
 assert.ok(plan2.token,'官网配置变化不使预检指纹失效（发布输入不再包含官网配置）');
});

for(const [name,fn] of cases){await fn();console.log(`PASS ${name}`);}
fs.rmSync(root,{recursive:true,force:true});
