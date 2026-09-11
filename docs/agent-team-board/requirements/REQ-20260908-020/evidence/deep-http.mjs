// 隔离 HTTP 集成验证，不连接用户当前看板服务。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import http from 'node:http';
const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../../../..');
const core=await import(`${repo}/scripts/lib/core.mjs`);
const refine=await import(`${repo}/scripts/lib/refine-store.mjs`);
const root=fs.mkdtempSync(path.join(os.tmpdir(),'atb-020-http-'));
core.initData(root);const d=core.dataDirFrom(root);
for(const kind of ['refine','develop']) {
  const a=core.createItem(d,{type:'requirement',title:kind});core.setStatus(d,a.id,'accepted',{by:'human'});
  if(kind==='develop')core.setStatus(d,a.id,'planned',{by:'human'});
}
const port=44000+Math.floor(Math.random()*10000);
const server=spawn(process.execPath,[`${repo}/scripts/server.mjs`],{cwd:root,env:{...process.env,ATB_PORT:String(port),ATB_REGISTRY:path.join(root,'registry.json')},stdio:'ignore'});
async function api(route,body) {
  return new Promise((resolve,reject)=>{
    const req=http.request(`http://127.0.0.1:${port}${route}${route.includes('?')?'&':'?'}project=${encodeURIComponent(root)}`,
      {method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json'}},res=>{
        let data='';res.on('data',chunk=>data+=chunk);res.on('end',()=>{try{
          const json=JSON.parse(data);assert.equal(res.statusCode,200,data);resolve(json);
        }catch(e){reject(e);}});
      });req.on('error',reject);req.end(body===undefined?undefined:JSON.stringify(body));
  });
}
try {
  let ready=false;for(let i=0;i<60;i++){try{await api('/api/health');ready=true;break;}catch{await new Promise(r=>setTimeout(r,100));}}
  assert.ok(ready,'服务启动');
  const models={};for(const kind of ['refine','develop']){models[kind]={};for(const agent of ['zcode','codex'])models[kind][agent]={model:`probe-${kind}-${agent}`,level:kind==='refine'?'high':'medium'};}
  await api('/api/tasks/settings',{models,agents:{refine:['zcode','codex'],develop:['zcode','codex']}});
  assert.deepEqual((await api('/api/tasks/settings')).settings.models,models);console.log('PASS H01 HTTP 四路设置保存/读取');
  for(const kind of ['refine','develop'])for(const agent of ['zcode','codex']){
    const route=kind==='refine'?'refine':'batch';
    const created=await api(`/api/${route}/create`,{mode:agent,agent});
    assert.ok(created.prompt.includes(models[kind][agent].model),JSON.stringify(created));
    assert.ok(created.prompt.includes(models[kind][agent].level));
    if(kind==='refine'){
      assert.equal(refine.listRefineRuns(d,created.batchId).total,0,'创建不应后台自动执行');
      const run=refine.nextRefineItem(d,created.batchId,{owner:`${agent}-http`});
      const item=await api(`/api/item/${run.itemId}`);
      assert.ok(JSON.stringify(item).includes('refining'),'接口应暴露完善中');
      await api('/api/refine/abort',{batchId:created.batchId});
      assert.ok(JSON.stringify(await api(`/api/item/${run.itemId}`)).includes('unrefined'));
      const current=await api('/api/refine/current');
      assert.ok(current.batch.aborted,'终止后 API 仍返回已终止 batch，验证面板分支输入');
    }else await api('/api/batch/abort',{batchId:created.batchId});
    console.log(`PASS H ${kind}/${agent} 模型提示词注入、创建及终止${kind==='refine'?'、三态 API、无后台执行':''}`);
  }
}finally{
  const closed=once(server,'close');server.kill('SIGTERM');await closed;fs.rmSync(root,{recursive:true,force:true});
}
