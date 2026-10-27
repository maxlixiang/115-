const test=require('node:test');
const assert=require('node:assert/strict');
const c=require('../115Rename_CodexVersion.user.js');
const dir=(id,parentId,name)=>({id,parentId,name,folder:true,path:name});
const file=(id,parentId,name,size)=>({id,parentId,name,size,folder:false,path:parentId+'/'+name});
function fixture({count=3,unrelated=0,works=1}={}){
 const items=[],snapshots=new Map([['0',[]]]);
 for(let i=0;i<works;i++){
  const id=String(i+1),work=dir(id,'0','ABC-'+String(123+i));
  const children=[file('large'+id,id,work.name+'.mp4',2**30)];
  for(let j=0;j<count;j++)children.push(file('small'+id+'_'+j,id,'small'+j+'.txt',100));
  items.push(work,...children);snapshots.get('0').push(work);snapshots.set(id,children);
 }
 for(let i=0;i<unrelated;i++){const id='unused'+i,folder=dir(id,'0','分类'+i);items.push(folder);snapshots.get('0').push(folder);snapshots.set(id,[]);}
 const plan=c.buildCleanup(items,snapshots),db=new Map([...snapshots].map(([id,xs])=>[id,xs.map(x=>({...x}))]));
 const reads=[],posts=[],events=[];let liveWrites=0,maxWrites=0;
 const list=async id=>{id=String(id);reads.push(id);return (db.get(id)||[]).map(x=>({...x}));};
 const post=async(url,body)=>{
  liveWrites++;maxWrites=Math.max(maxWrites,liveWrites);posts.push({url,...body});
  await Promise.resolve();
  assert.equal(url,'/rb/delete');assert.ok(plan.deleteFiles.some(x=>x.id===body.fid&&x.parentId===body.pid));
  db.set(body.pid,db.get(body.pid).filter(x=>x.folder||x.id!==body.fid));liveWrites--;
 };
 return {plan,db,reads,posts,events,list,post,getMaxWrites:()=>maxWrites,log:x=>events.push(x)};
}

test('100 small files avoid reading 1000 unrelated directories, with each delete confirmed',async()=>{
 const f=fixture({count:100,unrelated:1000});
 assert.deepEqual([...c.cleanupVerificationScope(f.plan)].sort(),['0','1']);
 await c.executeCleanup(f.plan,{list:f.list,post:f.post,log:f.log,pause:async()=>{}});
 assert.equal(f.posts.length,100);assert.equal(f.getMaxWrites(),1);
 assert.equal(f.events.filter(x=>x.action==='delete_small_confirmed').length,100);
 assert.equal(f.reads.length,204);assert.ok(f.reads.every(id=>id==='0'||id==='1'));
 assert.equal(f.db.get('1').length,1);assert.equal(f.db.get('1')[0].size,2**30);
 const oldReads=f.plan.originalSnapshots.size*2+f.plan.deleteFiles.length*2;
 assert.equal(oldReads,2204);
});

test('no cleanup writes means no cleanup verification reads; renames retain their own preflight',async()=>{
 const f=fixture({count:0,unrelated:1000});
 await c.executeCleanup(f.plan,{list:f.list,post:f.post,log:f.log});
 assert.equal(f.reads.length,0);assert.equal(f.posts.length,0);
});

test('read concurrency is bounded at three and writes remain sequential',async()=>{
 const f=fixture({count:1,works:5});let active=0,max=0;
 const list=async id=>{active++;max=Math.max(max,active);await new Promise(r=>setTimeout(r,2));try{return await f.list(id);}finally{active--;}};
 await c.executeCleanup(f.plan,{list,post:async(...args)=>{assert.equal(active,0);return f.post(...args);},log:f.log});
 assert.equal(max,3);assert.equal(active,0);assert.equal(f.getMaxWrites(),1);assert.equal(f.posts.length,5);
});

test('failed parallel preflight drains in-flight reads before rejecting and submits no writes',async()=>{
 const f=fixture({count:1,works:5});let active=0,starts=0;
 const list=async id=>{active++;starts++;await new Promise(r=>setTimeout(r,id==='0'?1:8));try{if(id==='0')throw Error('read failed');return await f.list(id);}finally{active--;}};
 await assert.rejects(c.executeCleanup(f.plan,{list,post:f.post,log:f.log}),/read failed/);
 assert.equal(active,0);assert.equal(starts,3);assert.equal(f.posts.length,0);
});

test('a changed affected directory fails before any cleanup writes',async()=>{
 const f=fixture({count:1,works:4});f.db.get('4').push(file('new','4','new.txt',1));
 await assert.rejects(c.executeCleanup(f.plan,{list:f.list,post:f.post,log:f.log}),/已变化/);
 assert.equal(f.posts.length,0);
});

test('moving an affected work out of its parent is still detected',async()=>{
 const f=fixture({count:1});f.db.set('0',[]);
 await assert.rejects(c.executeCleanup(f.plan,{list:f.list,post:f.post,log:f.log}),/已变化/);
 assert.equal(f.posts.length,0);
});

test('unconfirmed delete is not retried and prevents the next delete',async()=>{
 const f=fixture({count:3});
 await assert.rejects(c.executeCleanup(f.plan,{list:f.list,post:async(url,body)=>{f.posts.push({url,...body});},log:f.log,pause:async()=>{}}),/未回读确认/);
 assert.equal(f.posts.length,1);assert.equal(f.events.filter(x=>x.action==='delete_small_confirmed').length,0);
});

test('readback errors stop subsequent writes without retrying the delete',async()=>{
 const f=fixture({count:2});let submitted=false;
 await assert.rejects(c.executeCleanup(f.plan,{list:async id=>{if(submitted)throw Error('readback failed');return f.list(id);},post:async(...args)=>{await f.post(...args);submitted=true;},log:f.log}),/readback failed/);
 assert.equal(f.posts.length,1);
});

test('rescue and nested-directory cleanup check every affected descendant and skip deleted dirs in final reads',async()=>{
 const work=dir('1','0','ABC-123'),inner=dir('2','1','内层'),deep=dir('3','2','更内层'),video=file('4','3','ABC-123.mp4',2**30);
 const items=[work,inner,deep,video],snaps=new Map([['0',[work]],['1',[inner]],['2',[deep]],['3',[video]],['unrelated',[]]]);
 const plan=c.buildCleanup(items,snaps),scope=c.cleanupVerificationScope(plan);assert.deepEqual([...scope].sort(),['0','1','2','3']);
 const db=new Map([...snaps].map(([id,xs])=>[id,xs.map(x=>({...x}))])),writes=[];let deleted=false;
 await c.executeCleanup(plan,{
  list:async id=>{assert.notEqual(id,'unrelated');assert.ok(!deleted||!['2','3'].includes(id));return (db.get(id)||[]).map(x=>({...x}));},
  post:async(url,b)=>{writes.push(url);if(url==='/files/move'){db.set('3',[]);db.get('1').push({...video,parentId:'1'});}else{assert.equal(b.fid,'2');db.set('1',db.get('1').filter(x=>x.id!=='2'));db.delete('2');db.delete('3');deleted=true;}},
  log:()=>{}
 });
 assert.deepEqual(writes,['/files/move','/rb/delete']);assert.ok(db.get('1').some(x=>x.id==='4'));
});

test('stop during parallel reads starts no further reads and no writes',async()=>{
 const f=fixture({count:1,works:5});let stopped=false,active=0;
 await assert.rejects(c.executeCleanup(f.plan,{
  list:async id=>{active++;await new Promise(r=>setTimeout(r,2));try{stopped=true;return f.list(id);}finally{active--;}},
  post:f.post,log:f.log,check:()=>{if(stopped)throw Error('用户停止');}
 }),/用户停止/);
 assert.equal(active,0);assert.equal(f.posts.length,0);
});
