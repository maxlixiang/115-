const test=require('node:test');
const assert=require('node:assert/strict');
const c=require('../115Rename_CodexVersion.user.js');
const directory=name=>({id:'1',parentId:'0',folder:true,name,path:name});
const file=(name,id='2',size=2**30)=>({id,parentId:'1',folder:false,name,path:'ABC-123/'+name,size});
const metadata={code:'ABC-123',date:'2024-01-01',title:'テスト作品'};

test('legacy and modern pages are distinguished without network calls',()=>{
 const none={querySelector:()=>null},legacy={querySelector:query=>query.includes('iframe')?{}:null};
 assert.equal(c.detect115Page(none,'https://115.com/storage/netdisk'),'modern');
 assert.equal(c.detect115Page(legacy,'https://115.com/?mode=wangpan'),'legacy');
 assert.equal(c.detect115Page(none,'https://115.com/'),'unknown');
 assert.equal(c.PRIMARY_SOURCE,'javbus');
});

test('2K-C and timestamps remain separate descriptions and personal notes',()=>{
 const p=c.planFolder(directory('ABC-123【备注：2K-C，30分】'),[file('ABC-123.mp4')],metadata);
 assert(p.folder.tags.includes('2K')&&p.folder.tags.includes('中文字幕'));
 assert.deepEqual(p.folder.notes,['30分']);
 assert.equal(p.videos[0].newName,'ABC-123.mp4');
});

test('free text keyword before a timestamp is preserved',()=>{
 const p=c.planFolder(directory('ABC-123 舔脚1小时07'),[file('ABC-123.mp4')],metadata);
 assert.deepEqual(p.folder.notes,['舔脚1小时07']);
});

test('episode identifiers remain on videos',()=>{
 const p=c.planFolder(directory('ABC-123'),[file('source@ABC-123-A.mp4'),file('source@ABC-123-B.mp4','3')],metadata);
 assert.deepEqual(p.videos.map(x=>x.newName),['ABC-123-A.mp4','ABC-123-B.mp4']);
});

test('same-directory multi-version suffixes prevent accidental overwrites',()=>{
 const p=c.planFolder(directory('ABC-123'),[file('ABC-123.mp4'),file('ABC-123-UC.mp4','3')],metadata);
 assert.deepEqual(p.videos.map(x=>x.newName),['ABC-123.mp4','ABC-123-UC.mp4']);
});

test('title truncation preserves notes and is not an exception',()=>{
 const p=c.planFolder(directory('ABC-123【备注：30分】'),[],{...metadata,title:'長いテスト作品'.repeat(100)});
 assert(Buffer.byteLength(p.folder.newName,'utf8')<=240);
 assert(p.folder.newName.includes('【备注：30分】'));
 assert.deepEqual(c.collectIssues([p.folder]),[]);
});

test('exceptions omit normal cleanup logs and snapshots',()=>{
 const row={id:'2',parentId:'1',folder:false,path:'ABC-123/item.mp4',oldName:'item.mp4',newName:'ABC-123.mp4',skip:'目标重名'};
 const report=c.buildIssueReport([row],[],{phase:'scan'},[{action:'delete_small_confirmed',file:{id:'3',name:'test.txt'}}]);
 assert.equal(report.issues.length,1);
 assert(!('cleanupLogs' in report)&&!('cleanup' in report));
 assert.equal(c.buildIssueReport([],[],{},[{action:'delete_small_confirmed'}]),null);
});

function cleanupFixture(directVideo=false){
 const root=directory('ABC-123'),inner={id:'3',parentId:'1',folder:true,name:'内层',path:'ABC-123/内层'};
 const small=file('small.txt','4',c.CLEAN_LIMIT-1),equal=file('ABC-123.mp4','5',c.CLEAN_LIMIT);
 equal.parentId='3';equal.path='ABC-123/内层/ABC-123.mp4';
 const items=[root,inner,small,equal],snapshots=new Map([['0',[root]],['1',[inner,small]],['3',[equal]]]);
 if(directVideo){const direct=file('ABC-123.mkv','6');items.push(direct);snapshots.get('1').push(direct);}
 return {items,snapshots};
}

test('200 MiB boundary is strict and inner video is rescued before directory cleanup',()=>{
 assert.equal(c.CLEAN_LIMIT,209715200);
 const f=cleanupFixture(),p=c.buildCleanup(f.items,f.snapshots);
 assert.equal(p.deleteFiles.length,1);assert.equal(p.moves.length,1);assert.equal(p.deleteDirs.length,1);
 assert.equal(p.moves[0].file.size,c.CLEAN_LIMIT);
 assert(p.items.some(x=>x.id==='5'&&x.parentId==='1'));
 assert(!p.items.some(x=>x.id==='3'||x.id==='4'));
});

test('an existing direct video keeps the approved nested-directory deletion behavior',()=>{
 const f=cleanupFixture(true),p=c.buildCleanup(f.items,f.snapshots);
 assert.equal(p.moves.length,0);
 assert(!p.items.some(x=>x.id==='5'));
 assert(p.items.some(x=>x.id==='6'));
});

test('cleanup rejects unknown file sizes',()=>{
 const f=cleanupFixture();f.items.find(x=>x.id==='5').size=null;
 assert.throws(()=>c.buildCleanup(f.items,f.snapshots),/大小未知/);
});

test('cleanup detects a changed snapshot before sending any write',async()=>{
 const f=cleanupFixture(),p=c.buildCleanup(f.items,f.snapshots);let writes=0;
 await assert.rejects(()=>c.executeCleanup(p,{
  list:async id=>id==='1'?[]:f.snapshots.get(id),post:async()=>{writes++;},log:()=>{},pause:async()=>{}
 }),/已变化/);
 assert.equal(writes,0);
});

test('confirmed-only progress counts expose remaining tasks',()=>{
 assert.equal(c.taskProgressText({phase:'rename',renameTotal:100,renameDone:38}),'改名：已完成 38 / 100，剩余 62 项');
});
