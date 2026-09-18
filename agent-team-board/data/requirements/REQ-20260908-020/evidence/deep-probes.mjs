// 深测夹具仅写临时项目；运行：node <本文件绝对路径>。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../..');
const core = await import(`${repo}/scripts/lib/core.mjs`);
const r = await import(`${repo}/scripts/lib/refine-store.mjs`);
const states = await import(`${repo}/scripts/lib/refine-states.mjs`);
const settings = await import(`${repo}/scripts/lib/task-settings.mjs`);
const roots = [];
function project() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atb-020-deep-'));
  roots.push(root); core.initData(root);
  const d = core.dataDirFrom(root);
  function item(title='深测项') {
    const a = core.createItem(d, {type:'requirement',title});
    core.setStatus(d,a.id,'accepted',{by:'human'}); return a;
  }
  return {root,d,item,create: () => r.createRefineBatch(d,{projectRoot:root}).batch};
}
const results=[];
async function test(name,fn) {
  try {await fn(); results.push({name,result:'PASS'});}
  catch(e) {results.push({name,result:'FAIL',actual:e.message});}
}
await test('D01 最后一项执行期间新接受单，主调度 check 应继续',()=>{
  const p=project();p.item();const b=p.create();const run=r.nextRefineItem(p.d,b.batchId);
  p.item('在途时新接受');r.finishRefineRun(p.d,run.runId,{result:'failed',reason:'测试失败路径'});
  const check=r.checkRefineBatch(p.d,b.batchId);
  assert.equal(check.nextAction,'continue',JSON.stringify(check));
});
await test('D02 创建后、领取前人工完善 README，仍应按领取时基线取单',()=>{
  const p=project();const a=p.item();const b=p.create();
  fs.appendFileSync(path.join(core.resolveItemDir(p.d,a.id).dir,'README.md'),'\n人工追加背景\n');
  const next=r.nextRefineItem(p.d,b.batchId);
  assert.equal(next.itemId,a.id,JSON.stringify(next));
});
await test('D03 同轮已完成单驳回再接受，应再次进入本轮',()=>{
  const p=project();const a=p.item();p.item('保持队列未结束');const b=p.create();
  const run=r.nextRefineItem(p.d,b.batchId);
  fs.appendFileSync(path.join(run.itemDir,'README.md'),'\n补全说明\n');
  r.finishRefineRun(p.d,run.runId,{result:'done',summary:'补全'});
  core.setStatus(p.d,a.id,'submitted',{by:'human'});core.setStatus(p.d,a.id,'accepted',{by:'human'});
  const next=r.nextRefineItem(p.d,b.batchId);r.finishRefineRun(p.d,next.runId,{result:'failed',reason:'测试'});
  const again=r.nextRefineItem(p.d,b.batchId);
  assert.equal(again.itemId,a.id,JSON.stringify(again));
});
await test('D04 新候选加入后重复启动应返回同一进行中任务',()=>{
  const p=project();p.item();const b=p.create();p.item('新候选');const again=p.create();
  assert.equal(again.batchId,b.batchId,JSON.stringify(r.unfinishedRefineBatches(p.d).map(x=>x.batchId)));
});
await test('D05 codex 领取执行记录应保留 codex Agent',()=>{
  const p=project();p.item();const b=r.createRefineBatch(p.d,{projectRoot:p.root,mode:'codex'}).batch;
  const run=r.nextRefineItem(p.d,b.batchId,{owner:'codex-test'});
  assert.equal(r.getRefineRun(p.d,run.runId).mode,'codex');
});
await test('D06 终止后应显示重新启动入口（执行真实渲染函数）',()=>{
  const p=project();p.item();const b=p.create();r.abortRefineBatch(p.d,b.batchId);
  const summary=r.refineSummary(p.d,b.batchId);
  const source=fs.readFileSync(`${repo}/scripts/web/app.js`,'utf8');
  const fn=source.slice(source.indexOf('function renderRefinePanel() {'),source.indexOf('// 完善执行记录：'));
  const ctx={state:{refine:{data:{batch:summary.batch,counts:summary.counts,records:summary.records},mode:'zcode'}},
    visibleTaskAgents:()=>['zcode','codex'],esc:String,fmtTime:String,shortOwner:String,
    batchStatusLabel:String,refineRecordsHtml:()=>'',localStorage:{getItem:()=>''}};
  vm.createContext(ctx);const html=vm.runInContext(fn+'\nrenderRefinePanel()',ctx);
  assert.match(html,/id="refine(?:Next|Create)"/,'终止面板没有 refineNext/refineCreate 启动按钮');
});
await test('D07 终止后迟到 done 不得污染新任务完善中状态',()=>{
  const p=project();const a=p.item();const b=p.create();const old=r.nextRefineItem(p.d,b.batchId);
  r.abortRefineBatch(p.d,b.batchId);const fresh=p.create();r.nextRefineItem(p.d,fresh.batchId);
  assert.throws(()=>r.finishRefineRun(p.d,old.runId,{result:'done',summary:'迟到'}),/已收尾/);
  assert.equal(states.refineStateOf(p.d,a.id),'refining');
});
await test('D08 暂停不影响在途回执，恢复后可继续',()=>{
  const p=project();p.item();const b=p.create();const run=r.nextRefineItem(p.d,b.batchId);
  r.pauseRefineBatch(p.d,b.batchId,true);p.item('新增');
  r.finishRefineRun(p.d,run.runId,{result:'failed',reason:'测试'});
  assert.equal(r.nextRefineItem(p.d,b.batchId).stop,'paused');
  r.pauseRefineBatch(p.d,b.batchId,false);assert.ok(r.nextRefineItem(p.d,b.batchId).itemId);
});
await test('D09 无修改 done 拒绝且可继续 fail 收尾',()=>{
  const p=project();const a=p.item();const b=p.create();const run=r.nextRefineItem(p.d,b.batchId);
  assert.throws(()=>r.finishRefineRun(p.d,run.runId,{result:'done',summary:'无修改'}),/基线一致/);
  assert.equal(states.refineStateOf(p.d,a.id),'refining');
  r.finishRefineRun(p.d,run.runId,{result:'failed',reason:'未完善'});
  assert.equal(states.refineStateOf(p.d,a.id),'unrefined');
});
await test('D10 设置四路独立持久化且非法补丁不产生半写',()=>{
  const p=project();const models={};for(const kind of ['refine','develop']) {
    models[kind]={};for(const agent of ['zcode','codex'])models[kind][agent]={model:`${kind}-${agent}`,level:kind==='refine'?'high':'medium'};
  }
  settings.saveTaskSettings(p.d,{models});assert.deepEqual(settings.loadTaskSettings(p.d).models,models);
  assert.throws(()=>settings.saveTaskSettings(p.d,{agents:{refine:['zcode']},models:{develop:{codex:{level:'bad'}}}}));
  assert.deepEqual(settings.loadTaskSettings(p.d).agents.refine,['zcode','codex']);
});
await test('D11 双项目状态隔离',()=>{
  const a=project(),b=project();const ai=a.item(),bi=b.item();const ab=a.create();r.nextRefineItem(a.d,ab.batchId);
  assert.equal(states.refineStateOf(a.d,ai.id),'refining');assert.equal(states.refineStateOf(b.d,bi.id),'unrefined');
});
await test('D12 已终止任务的暂停请求不应复活任务',()=>{
  const p=project();p.item();const b=p.create();r.abortRefineBatch(p.d,b.batchId);r.pauseRefineBatch(p.d,b.batchId,true);
  assert.equal(r.getRefineBatch(p.d,b.batchId).status,'finished');
});
console.log(JSON.stringify(results,null,2));
console.log(`TOTAL ${results.length}; PASS ${results.filter(x=>x.result==='PASS').length}; FAIL ${results.filter(x=>x.result==='FAIL').length}`);
for(const root of roots)fs.rmSync(root,{recursive:true,force:true});
process.exitCode=results.some(x=>x.result==='FAIL')?1:0;
