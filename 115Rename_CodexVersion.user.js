// ==UserScript==
// @name         115Rename_CodexVersion_V2.4.10
// @namespace    http://tampermonkey.net/
// @version      2.4.10
// @description  预览后先清理小于200MiB的所有文件与作品子目录，必要时救援内层视频，核对完成后按原规则联网改名
// @match        https://115.com/*
// @match        https://*.115.com/*
// @grant        GM_xmlhttpRequest
// @connect      webapi.115.com
// @connect      www.javbus.com
// @connect      javbus.com
// @connect      avmoo.host
// @connect      avsox.host
// @downloadURL  https://raw.githubusercontent.com/maxlixiang/115-/main/115Rename_CodexVersion.user.js
// @updateURL    https://raw.githubusercontent.com/maxlixiang/115-/main/115Rename_CodexVersion.user.js
// @license      MIT
// ==/UserScript==

(function () {
    'use strict';
    const VERSION='2.4.10';
    const VIDEO=['mp4','mkv','avi','wmv','iso','rmvb','mov','ts','flv','m2ts','vob','mpg','mpeg','rm','m4v'];
    const utf8=new TextEncoder();
    const domain=/(?:[a-z0-9]+\.)+(?:com|net|org|xyz|me|cc|co|la|tv|vip|club|fun|top|info|to|cn|app)\b/gi;
    const ad=/免费18禁手游|同城上门|免费领取现金|在线观看|澳门皇冠赌场|主播免费看|万人在线直播秀|苍\s*老\s*师\s*强\s*力\s*推\s*荐|有趣台妹小视频/;
    const uniq=xs=>[...new Set(xs.filter(Boolean))];
    const trim=s=>s.replace(/^[\s，,；;]+|[\s，,；;]+$/g,'');
    const bytes=s=>utf8.encode(s).length;
    function splitVideo(name) {
        const re=new RegExp('\\.(?:'+VIDEO.join('|')+')(?=$|[\\s，,；;、\\u3400-\\u9fff])','gi');
        const m=[...name.matchAll(re)].pop();
        return m?{stem:name.slice(0,m.index)+name.slice(m.index+m[0].length),ext:m[0]}:null;
    }
    function canonical(code) {
        const parts=code.toUpperCase().replace(/\s+/g,'').replace(/_/g,'-').split('-');
        if(parts.length===2 && /^[A-Z]/.test(parts[0])) {
            const width=parts[0]==='HEYZO'?4:3;
            parts[1]=parts[1].replace(/^0+(?=\d)/,'').padStart(width,'0');
        }
        return parts.join('-');
    }
    function findCode(name) {
        const clean=name.replace(domain,s=>' '.repeat(s.length));
        const matches=[];
        const fc=/(?:^|[^a-z0-9])(FC2)[\s_-]*(?:PPV[\s_-]*)?(\d{5,8})(?!\d)/gi;
        for(const m of clean.matchAll(fc))matches.push({code:'FC2-PPV-'+m[2],start:m.index+m[0].indexOf(m[1]),end:m.index+m[0].length});
        for(const re of [/(?:^|[^a-z0-9])(T28)[\s_-]*(\d{3,4})(?!\d)/gi,/(?:^|[^a-z0-9])([a-z]{2,10}|N)[\s_-]*(\d{3,7})(?!\d)/gi,/(?:^|[^\d])(\d{6})[-_](\d{2,4})(?!\d)/g]) {
            for(const m of clean.matchAll(re)) {
                if(/^(?:HHD|BIG|FENGNIAO|X1080X|SIS)$/i.test(m[1]))continue;
                matches.push({code:canonical(m[1]+'-'+m[2]),start:m.index+m[0].indexOf(m[1]),end:m.index+m[0].length});
            }
        }
        return matches.sort((a,b)=>a.start-b.start)[0]||null;
    }
    function sameCode(a,b) {return canonical(a)===canonical(b);}
    function topComma(text) {
        const closes=[],pairs={'【':'】','[':']','（':'）','(':')','「':'」','『':'』'};
        for(let i=0;i<text.length;i++) {
            if(pairs[text[i]])closes.push(pairs[text[i]]);
            else if(text[i]===closes[closes.length-1])closes.pop();
            else if(/[，,]/.test(text[i])&&!closes.length)return i;
        }
        return -1;
    }
    function normalizeTag(text) {
        const t=text.trim();
        if(discardedLabel(t))return '';
        if(/^(?:U|UC|UNCENSORED|UNCEN|UNC)$/i.test(t))return '无码';
        if(/^(?:C|CH)$/i.test(t))return '中文字幕';
        const map={'中文':'中文字幕','中字':'中文字幕','中文字幕':'中文字幕','中文配音':'中文配音','高清':'高清','超清':'超清','全高清':'全高清','无码':'无码','無碼':'无码','有码':'有码','有碼':'有码','无修正':'无修正','無修正':'无修正'};
        if(map[t])return map[t];
        if(/^(?:[2468]K(?:分辨率)?|(?:720|1080|2160)[PI]|HD|SD|FHD|UHD)$/i.test(t))return t.replace(/分辨率$/,'').toUpperCase();
        // AI保持独立，不直接等同于无码。
        if(/^AI$/i.test(t))return 'AI';
        return '';
    }
    function desc(text) {
        return uniq((text.match(/中文字幕|中文配音|全高清|高清|超清|无码|無碼|有码|有碼|无修正|無修正|[2468]K(?:分辨率)?|(?:720|1080|2160)[PI]/gi)||[]).map(normalizeTag));
    }
    function mergeNotes(...lists) {
        const result=[],seen=new Set();
        const key=x=>x.replace(/\s+/g,' ').trim();
        for(const text of lists.flat()) {
            const raw=trim(String(text||''));if(!raw)continue;
            const parts=raw.split(/[，,]/).map(trim).filter(Boolean);
            const unseen=parts.filter(p=>!seen.has(key(p)));
            if(!unseen.length)continue;
            result.push(unseen.length===parts.length?raw:unseen.join('，'));
            unseen.forEach(p=>seen.add(key(p)));
        }
        return result;
    }
    function discardedLabel(text) {return /^(?:SD|CLOSE|W|X1080X|1080P)$/i.test(text.trim());}
    function cleanNotes(notes) {
        return mergeNotes(notes.map(raw=>{
            const parts=raw.split(/[，,]/);
            if(!parts.some(p=>discardedLabel(p.trim())))return raw;
            return parts.filter(p=>!discardedLabel(p.trim())).map(trim).filter(Boolean).join('，');
        }));
    }
    function repairSourcePrefix(stem) {
        const hit=findCode(stem);if(!hit)return {stem,repaired:false};
        const prefix=stem.slice(0,hit.start);
        const source=prefix.match(domain);
        const leftover=prefix.replace(domain,'').replace(/[\s@._-]/g,'');
        // 仅修复已确认的来源域名+无码描述+残缺右括号，不放宽人工备注的括号检查。
        if(source&&/^(?:破解(?:无码|無碼)|无码|無碼)】$/.test(leftover))return {stem:'【无码】'+stem.slice(hit.start),repaired:true};
        return {stem,repaired:false};
    }
    function promoteUNCNotes(notes,tags) {
        // UNC是版本描述；仅提取独立标记，保留时间和其他人工备注。
        return notes.map(raw=>{
            let promoted=false;
            const kept=raw.split(/[，,]/).map(part=>part.replace(/(^|[\s；;、])UNC(?=$|[\s；;、])/gi,(_,before)=>{
                promoted=true;return before;
            }).replace(/^[\s；;、]+|[\s；;、]+$/g,'')).filter(Boolean);
            if(!promoted)return raw;
            tags.push('无码');
            return kept.join('，');
        }).filter(Boolean);
    }
    function promote2KNotes(notes,tags) {
        const compound=text=>/^2K(?:分辨率)?[-_\s]+(?:C|CH)$/i.test(text.trim());
        return notes.flatMap(raw=>{
            const parts=raw.split(/[，,]/);
            if(!parts.some(compound))return [raw];
            tags.push('2K','中文字幕');
            const rest=parts.filter(p=>!compound(p)).map(trim).filter(Boolean).join('，');
            return rest?[rest]:[];
        });
    }
    function extractInfo(name,officialTitle='') {
        const video=splitVideo(name),rawStem=video?video.stem:name;
        const {stem}=repairSourcePrefix(rawStem);
        const hit=findCode(stem);
        const prefix=hit?stem.slice(0,hit.start).replace(/^\d{4}-\d{2}-\d{2}_/,'').replace(domain,'').replace(/\[\s*\]/g,'').trim():'';
        let tail=hit?(prefix?prefix+' ':'')+stem.slice(hit.end):stem;
        const notes=[],tags=[];
        if((tail.match(/【/g)||[]).length!==(tail.match(/】/g)||[]).length) {
            const header=tail.match(/^((?:【[^【】]*】)*)\s+([\s\S]+)$/);
            const comparable=t=>t.replace(/[\\/:*?"<>|]/g,' ').replace(/\s+/g,' ').trim();
            // 旧版可能把联网标题截断在【…中间。只有能与官方标题前缀核对时才恢复；未知备注仍跳过。
            if(/^\d{4}-\d{2}-\d{2}_/.test(stem)&&officialTitle&&header&&comparable(header[2]).length>=12&&comparable(officialTitle).startsWith(comparable(header[2])))tail=header[1];
            else return {notes,tags,skip:'原名【】不配对，先人工核对备注'};
        }
        const comma=topComma(tail);
        let body=comma<0?tail:tail.slice(0,comma);
        if(comma>=0)notes.push(trim(tail.slice(comma+1)));
        const bracketNotes=[];
        body=body.replace(/【([^】]*)】|\[([^\]]*)\]/g,(full,a,b)=>{
            const content=(a??b).trim();
            const explicit=content.match(/^备注[：:]([\s\S]*)$/);
            if(explicit) {bracketNotes.push(explicit[1]);return '';}
            if(discardedLabel(content))return '';
            const tag=normalizeTag(content);
            if(tag) {tags.push(tag);return '';}
            if(/^重复\d*$/.test(content))return '';
            // 明确的个人时间/短数字备注优先，不因联网标题碰巧含同样数字而丢失。
            if(!/[ぁ-ゖァ-ヺ]|映像|特典/.test(content)&&(/\d+\s*(?:小时|小時|分钟|分鐘|分|秒)|足交|舔脚|第一视角/.test(content)||/^\d+$/.test(content))) {
                bracketNotes.push(content);return '';
            }
            if(officialTitle.includes(full)||officialTitle.includes(content))return full;
            if(/[ぁ-ゖァ-ヺ]|映像|特典/.test(content))return full;
            if(content)bracketNotes.push(content);
            return '';
        });
        // 方括号备注在原名里先于末尾逗号备注，保留这个顺序。
        notes.unshift(...bracketNotes);
        tags.push(...desc(body));
        for(const m of body.matchAll(/(?:^|[-_.\s])(UC|CH|AI|C|U|uncensored|uncen|unc|HD|SD|FHD|UHD)(?=$|[^a-z])/gi)) {
            const before=body.slice(0,m.index).replace(/中文字幕|中文配音|全高清|高清|超清|无码|無碼|有码|有碼|[2468]K(?:分辨率)?|(?:720|1080|2160)[PI]/gi,'').replace(/\b(?:UC|CH|AI|C|U|uncensored|uncen|unc|HD|SD|FHD|UHD)\b/gi,'').replace(/[-_.\s]/g,'');
            // 短码只从番号附近的描述前缀识别，避免把作品标题中的LOVE U等词误当版本。
            if(!before)tags.push(normalizeTag(m[1]));
        }
        let timeBody=body;
        for(const t of ['中文字幕','中文配音','全高清','高清','超清','无码','無碼','有码','有碼','无修正','無修正'])timeBody=timeBody.split(t).join('');
        const trailing=timeBody.match(/(?:^|\s|[，,])((?:\d+\s*(?:小时|小時|分钟|分鐘|分|秒)[^ぁ-ゖァ-ヺ]*)?)$/);
        if(trailing&&trailing[1]&&!officialTitle.includes(trailing[1].trim()))notes.push(trailing[1].trim());
        // 无空格的“1小时22舔脚”等也按尾部个人备注保存；赠送说明位于日文括号内，不匹配这里。
        if(!notes.length) {
            const t=timeBody.match(/(\d+\s*(?:小时|小時|分钟|分鐘|分|秒)(?:[^ぁ-ゖァ-ヺ]*)?)$/);
            if(t&&!officialTitle.includes(t[1].trim()))notes.push(t[1].trim());
        }
        // Preserve the explicitly requested free-text keyword, including before a timestamp.
        const personalBody=officialTitle?timeBody.split(officialTitle).join(''):timeBody;
        if(hit&&personalBody.includes('舔脚')&&!notes.some(n=>n.includes('舔脚'))) {
            const matches=[...personalBody.matchAll(/舔脚(?:\s*\d+\s*(?:小时|小時|分钟|分鐘|分|秒)[^ぁ-ゖァ-ヺ，,]*)?/g)].map(m=>trim(m[0]));
            for(const text of uniq(matches).reverse()) {
                for(let i=notes.length-1;i>=0;i--)if(notes[i].trim()&&text.endsWith(notes[i].trim()))notes.splice(i,1);
                notes.unshift(text);
            }
        }
        return {notes:cleanNotes(promote2KNotes(promoteUNCNotes(notes,tags),tags)),tags:uniq(tags).filter(t=>!discardedLabel(t)),body,hit};
    }
    function readVideoStructure(tail) {
        const versions=[],parts=[],quality=[];
        const comma=topComma(tail);
        let rest=(comma<0?tail:tail.slice(0,comma)).replace(domain,'');
        rest=rest.replace(/【([^】]*)】|\[([^\]]*)\]/g,(_,a,b)=>{
            const token=(a??b).trim();
            if(/^(?:UNCENSORED|UNCEN|UNC|UC|CH|AI|U|C)$/i.test(token))versions.push(token.toUpperCase());
            return '';
        });
        rest=rest.replace(/\bJP\s*(?:無碼|无码)破解|破解(?:无码|無碼)/gi,'');
        rest=rest.replace(/中文字幕|中文配音|全高清|高清|超清|无码|無碼|有码|有碼|无修正|無修正/gi,'');
        for(let step=0;step<24;step++) {
            const source=rest.match(/^[\s.-]*(?:hhb)?_000(?:\s*\^\s*WM)?(?=$|[-_.\s])/i);
            if(source){rest=rest.slice(source[0].length);continue;}
            const separators=rest.match(/^[\s._()\-]+/)?.[0]||'';
            rest=rest.slice(separators.length);if(!rest)break;
            const version=rest.match(/^(UNCENSORED|UNCEN|UNC|UC|CH|AI|U|C)(?=$|[-_.\s^]|[\u3400-\u9fff])/i);
            if(version){versions.push(version[1].toUpperCase());rest=rest.slice(version[0].length);continue;}
            const namedPart=rest.match(/^(CD|PART|PRAT|PT)\s*(\d+)(?=$|[-_.\s^])/i);
            if(namedPart){
                const n=namedPart[2].replace(/^0+(?=\d)/,'');
                parts.push(namedPart[1].toUpperCase()==='CD'?'CD'+n:n);
                rest=rest.slice(namedPart[0].length);continue;
            }
            const part=rest.match(/^([AB]|\d{1,3})(?=$|[-_.\s^])/i);
            // 字母/裸数字分集需明确的横线/下划线，避免把标题“A …”或人工数字42当分集。
            if(part&&(/[-_]/.test(separators)||(/^[AB]$/i.test(part[1])&&part[0].length===rest.length))){
                parts.push(part[1].toUpperCase());rest=rest.slice(part[0].length);continue;
            }
            const ignored=rest.match(/^(?:CLOSE|W|SD|X1080X|1080P|GG5)(?=$|[-_.\s^])/i);
            if(ignored){rest=rest.slice(ignored[0].length);continue;}
            const q=rest.match(/^(?:FULL\s+HD|FHD|UHD|HD|1080I|[2468]K|(?:720|2160)[PI])(?=$|[-_.\s^])/i);
            if(q){quality.push(normalizeTag(q[0].toUpperCase()==='FULL HD'?'FHD':q[0]));rest=rest.slice(q[0].length);continue;}
            break;
        }
        return {part:parts.join('-'),versions:uniq(versions),quality:uniq(quality),residual:rest};
    }
    function videoInfo(item,officialTitle='') {
        const video=splitVideo(item.name);
        if(!video)return {skip:'非视频文件',notes:[],tags:[]};
        if(ad.test(item.name))return {skip:'疑似推广或内容不明视频，手动核对',notes:[],tags:[]};
        const hit=findCode(video.stem),tail=hit?video.stem.slice(hit.end):'';
        if(/(?:^|[-_.\s])SP(?=$|[-_.\s，,【])/i.test(tail)||/^SP$/i.test(video.stem))return {skip:'SP预览文件，保留原名待人工处理',notes:[],tags:[],preview:true};
        const info=extractInfo(item.name,officialTitle);
        if(info.skip)return {...info,video,hit};
        const structure=readVideoStructure(tail);
        const suffix=tail.match(/^[-_.\s]*(UNCENSORED|UNCEN|UNC|UC|CH|U|C)(?=$|[^a-z])/i);
        info.tags=uniq([...info.tags.filter(t=>t!=='AI'),...structure.versions.filter(v=>v!=='AI').map(normalizeTag),...desc(info.body||''),...structure.quality,suffix?normalizeTag(suffix[1]):'']).filter(t=>!discardedLabel(t));
        let residual=structure.residual;
        for(const note of info.notes)residual=residual.split(note).join('');
        residual=residual.replace(/^[\s@_.~\-()^]+|[\s@_.~\-()^]+$/g,'');
        if(hit&&residual&&residual.length<=32&&!/[ぁ-ゖァ-ヺ]/.test(residual)&&!officialTitle.includes(residual)&&!discardedLabel(residual)&&!info.notes.some(n=>n.includes(residual)))info.notes=mergeNotes(info.notes,[residual]);
        info.notes=cleanNotes(info.notes);
        return {...info,video,hit,part:structure.part,segment:structure.part,versions:structure.versions,sourceRepaired:repairSourcePrefix(video.stem).repaired};
    }
    function validDate(raw) {
        const m=String(raw||'').match(/(?:^|\D)(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})(?:日|\D|$)/);
        if(!m)return '';
        const [y,mo,day]=m.slice(1).map(Number),date=new Date(Date.UTC(y,mo-1,day));
        return date.getUTCFullYear()===y&&date.getUTCMonth()===mo-1&&date.getUTCDate()===day?`${y}-${String(mo).padStart(2,'0')}-${String(day).padStart(2,'0')}`:'';
    }
    function cleanTitle(title,code) {
        let t=String(title||'').replace(/\s+/g,' ').trim();
        const hit=findCode(t);
        if(hit&&sameCode(hit.code,code)&&hit.start===0)t=t.slice(hit.end).replace(/^[\s_-]+/,'');
        return t;
    }
    function checkedMeta(meta,code) {
        if(!meta||!sameCode(meta.code||'',code)||!validDate(meta.date)||!cleanTitle(meta.title,code))throw Error('查询结果的番号、发行日期或作品名称不完整/不匹配');
        return {...meta,code:canonical(meta.code),date:validDate(meta.date),title:cleanTitle(meta.title,code)};
    }
    function parseDocument(doc,requested,url) {
        const texts=selectors=>[...doc.querySelectorAll(selectors)].map(el=>el.textContent.trim());
        let id='',date='';
        for(const text of texts('.info p, .movie-info p, .info li')) {
            if(/識別碼|识别码|識別番號|番号|ID\s*:/i.test(text))id=findCode(text)?.code||id;
            if(/發行日期|发行日期|発売日|Release\s*Date|Released/i.test(text))date=validDate(text)||date;
        }
        const heading=doc.querySelector('h3')?.textContent||doc.querySelector('.bigImage img')?.getAttribute('title')||'';
        if(id&&sameCode(id,requested)&&date&&heading)return {meta:checkedMeta({code:id,date,title:heading,source:url},requested)};
        // 原插件的数据源搜索卡片：必须逐卡片匹配番号，不能直接采用第一条结果。
        const links=[];
        for(const card of doc.querySelectorAll('.movie-box, .item')) {
            const image=card.querySelector('.photo-frame img, img');
            const title=image?.getAttribute('title')||card.querySelector('.photo-info span')?.textContent||'';
            const cardDates=[...card.querySelectorAll('.photo-info date, date')].map(e=>e.textContent.trim());
            const cardCode=cardDates.map(t=>findCode(t)?.code).find(Boolean)||findCode(title)?.code;
            if(!cardCode||!sameCode(cardCode,requested))continue;
            const release=cardDates.map(validDate).find(Boolean);
            if(title&&release)return {meta:checkedMeta({code:cardCode,date:release,title,source:url},requested)};
            const a=card.matches('a')?card:card.querySelector('a[href]');
            if(a?.getAttribute('href'))links.push(new URL(a.getAttribute('href'),url).href);
        }
        return {links:uniq(links)};
    }
    function buildFolderName(meta,tags,notes) {
        const prefix=meta.date+'_'+meta.code+uniq(tags).map(t=>'【'+t+'】').join('')+(notes.length?'【备注：'+notes.join('，')+'】':'');
        if(bytes(prefix)+2>240)return {skip:'描述或备注过长，保留原名；不截断备注'};
        let title='',depth=0;
        const safeTitle=meta.title.replace(/[\\/:*?"<>|]/g,' ').replace(/\s+/g,' ').trim();
        for(const ch of safeTitle) {
            const nextDepth=Math.max(0,depth+(ch==='【'?1:ch==='】'?-1:0));
            if(bytes(prefix+' '+title+ch+'】'.repeat(nextDepth))>240)break;
            title+=ch;depth=nextDepth;
        }
        title=title.trimEnd()+'】'.repeat(depth);
        if(!title)return {skip:'作品名称无法容纳，保留原名'};
        // 只规范联网获取的作品名中的文件名禁用字符，人工标签和备注不做静默删改。
        const normalizedTitle=title;
        const name=prefix+' '+normalizedTitle;
        if(/[\\/:*?"<>|]/.test(prefix))return {skip:'个人备注或描述含禁用字符，保留原名待核对'};
        return {name,notice:title!==meta.title?'作品名按长度缩短；描述、备注完整保留':''};
    }
    function planFolder(folder,children,metadata) {
        const hit=findCode(folder.name);
        if(!hit)return {folder:{...folder,oldName:folder.name,newName:folder.name,skip:'分类目录，无作品番号'},videos:[]};
        let meta;
        try{meta=checkedMeta(metadata,hit.code);}catch(e){return {folder:{...folder,oldName:folder.name,newName:folder.name,skip:e.message},videos:[]};}
        const original=extractInfo(folder.name,meta.title);
        if(original.skip)return {folder:{...folder,oldName:folder.name,newName:folder.name,skip:original.skip},videos:[]};
        const videoItems=children.filter(x=>!x.folder&&splitVideo(x.name));
        const parsed=videoItems.map(item=>({item,info:videoInfo(item,meta.title)}));
        const mains=parsed.filter(x=>!x.info.skip);
        const related=mains.filter(x=>x.info.hit?sameCode(x.info.hit.code,meta.code):mains.length===1);
        const notes=cleanNotes(mergeNotes(original.notes,...related.map(x=>x.info.notes)));
        const tags=uniq([...original.tags,...related.flatMap(x=>x.info.tags)]).filter(t=>!discardedLabel(t));
        const built=buildFolderName(meta,tags,notes);
        const row={...folder,code:meta.code,oldName:folder.name,newName:built.name||folder.name,skip:built.skip||'',notice:built.notice||'',notes,tags,metadata:meta};
        const counts=new Map();
        for(const x of related){const key=x.info.part||'';counts.set(key,(counts.get(key)||0)+1);}
        const videos=parsed.map(({item,info})=>{
            const v={...item,oldName:item.name,newName:item.name,skip:'',notice:'',dependsOn:folder.id};
            if(info.skip)v.skip=info.skip;
            else if(info.hit&&!sameCode(info.hit.code,meta.code))v.skip='视频番号与父目录不一致，手动核对';
            else if(!info.hit&&mains.length>1)v.skip='同目录多个视频且此文件番号不明，需人工核对';
            else {
                const part=info.part?'-'+info.part:'';
                const keepVersion=(counts.get(info.part||'')||0)>1;
                const version=keepVersion&&info.versions.length?'-'+info.versions.join('-'):'';
                v.newName=meta.code+part+version+info.video.ext.toLowerCase();
                const notices=[];
                if(info.part)notices.push('分集编号保留，来源前缀和主体已规范');
                if(version)notices.push('同目录多版本，保留版本区别后缀');
                if(info.sourceRepaired)notices.push('已清理可确认的广告前缀残缺括号');
                if(!info.hit)notices.push('使用父目录番号；视频原名未识别到番号');
                v.notice=notices.join('；');
            }
            if(row.skip&&v.newName!==v.oldName)v.skip='文件夹计划失败，视频保留原名以保护备注';
            return v;
        });
        return {folder:row,videos};
    }
    function independentTitleVideos(folder,children) {
        const parentHit=findCode(folder.name);
        if(!parentHit||/^FC2(?:[-_]|$)/i.test(folder.name))return [];
        const parentInfo=extractInfo(folder.name);
        if(parentInfo.skip)return [];
        const parsed=children.filter(x=>!x.folder&&splitVideo(x.name)).map(item=>({item,info:videoInfo(item)}));
        const counts=new Map();
        for(const x of parsed)if(!x.info.skip&&x.info.hit&&sameCode(x.info.hit.code,parentHit.code)){const k=x.info.part||'';counts.set(k,(counts.get(k)||0)+1);}
        const rows=[];
        for(const {item,info} of parsed) {
            if(info.skip||!info.hit||!sameCode(info.hit.code,parentHit.code)||info.notes.length)continue;
            if(info.tags.some(t=>!parentInfo.tags.includes(t)))continue;
            const stem=info.video.stem;
            if(bytes(stem)<=240&&!/[ぁ-ゖァ-ヺ]/.test(stem))continue;
            // Long-title tail numbering is ambiguous; do not remove a possible episode number.
            if(!info.part&&/[-_](?:[AB]|\d{1,3})$/i.test(stem.trim()))continue;
            if(/[-_](?:UC|CH|U|C|UNCENSORED|UNCEN|UNC|[2468]K|HD|FHD|UHD|AI)$/i.test(stem.trim()))continue;
            const part=info.part?'-'+info.part:'';
            const version=(counts.get(info.part||'')||0)>1&&info.versions.length?'-'+info.versions.join('-'):'';
            const newName=parentHit.code+part+version+info.video.ext.toLowerCase();
            if(item.name===newName)continue;
            rows.push({...item,oldName:item.name,newName,skip:'',notice:'长标题视频先规范；番号与父目录一致，无需转存备注',dependsOn:folder.id,independentVideo:true});
        }
        return rows;
    }
    function settle(rows,siblings) {
        const targets=new Map();
        for(const r of rows) {
            if(r.skip||r.oldName===r.newName)continue;
            if(r.parentId===null||r.parentId===undefined){r.skip='无法确认父目录，跳过';continue;}
            const key=String(r.parentId)+'\0'+r.newName.toLowerCase();
            if(!targets.has(key))targets.set(key,[]);targets.get(key).push(r);
        }
        for(const group of targets.values())if(group.length>1)for(const r of group)r.skip='同级目标名称相同；保留所有原文件夹/文件';
        for(const r of rows)if(!r.skip&&r.oldName!==r.newName&&(siblings.get(String(r.parentId))||[]).some(x=>!(String(x.id)===String(r.id)&&Boolean(x.folder)===Boolean(r.folder))&&x.name.toLowerCase()===r.newName.toLowerCase()))r.skip='同级已有目标名称，保留原名';
        const folderRows=new Map(rows.filter(r=>r.folder).map(r=>[String(r.id),r]));
        for(const r of rows)if(!r.folder&&!r.independentVideo&&!r.skip&&r.newName!==r.oldName){const p=folderRows.get(String(r.dependsOn));if(!p||p.skip)r.skip='所属作品文件夹未能处理，视频保留原名以保护备注';}
        return rows;
    }
    function matchesSavedName(row,actualName) {
        if(row.folder)return actualName===row.newName;
        const a=splitVideo(actualName),b=splitVideo(row.newName);
        return Boolean(a&&b&&a.stem===b.stem&&a.ext.toLowerCase()===b.ext.toLowerCase());
    }
    function rewriteFolderLabels(name) {
        // 只处理完整顶层【标签】，不进入【备注：…】内部，也不改日期/标题。
        let out='',cursor=0,depth=0,start=-1;const seen=new Set();
        for(let i=0;i<name.length;i++) {
            if(name[i]==='【'){if(depth===0)start=i;depth++;}
            else if(name[i]==='】'&&depth>0) {
                depth--;if(depth!==0)continue;
                const full=name.slice(start,i+1),content=name.slice(start+1,i);
                out+=name.slice(cursor,start);
                const label=/^(?:U|UC|C|CH|UNCENSORED|UNCEN|UNC)$/i.test(content)?normalizeTag(content):content;
                if(label==='无码'||label==='中文字幕') {
                    if(!seen.has(label)){out+='【'+label+'】';seen.add(label);}
                }else out+=full;
                cursor=i+1;
            }
        }
        return out+name.slice(cursor);
    }
    function collectIssues(rows,logs=[],context={}) {
        const issues=[],key=r=>(r.folder?'d':'f')+String(r.id);
        const executed=new Map(logs.map(r=>[key(r),r]));
        function add(row,category,severity,reason,extra={}) {
            const done=row?executed.get(key(row)):null;
            issues.push({category,severity,reason,...(row?{id:String(row.id),parentId:row.parentId,folder:Boolean(row.folder),originalPath:row.path,oldName:row.oldName,plannedName:row.newName,actualName:done?.actualName??null}:{}),...extra});
        }
        for(const row of rows) {
            if(row.skip&&!/^(?:非视频文件|分类目录，无作品番号)$/.test(row.skip))add(row,'plan_skipped','待人工核对',row.skip);
            if(row.notice?.includes('视频原名未识别到番号'))add(row,'code_from_parent','待核对内容',row.notice);
            if(row.notes?.some(n=>/\d+\s*分\s*\.\d{3}\b/.test(n)))add(row,'ambiguous_note','待核对备注','备注含疑似作品总时长/来源编号，原文已保留：'+row.notes.join('，'));
        }
        for(const log of logs)if(log.result!=='成功且已回读确认')add(log,'execution_unconfirmed','执行异常',log.result,{readbacks:log.readbacks||[]});
        if(context.error&&!logs.some(r=>r.result!=='成功且已回读确认'))add(null,context.phase==='scan'?'scan_error':'execution_stopped','执行中断',context.error);
        if(context.executed)for(const row of rows)if(!row.skip&&row.oldName!==row.newName&&!executed.has(key(row)))add(row,'not_executed','未执行，需重扫',context.error||'批次停止，未执行此项目');
        return issues;
    }
    function buildIssueReport(rows,logs=[],context={},cleanupLogs=[],stopped=false) {
        const issues=collectIssues(rows,logs,context);
        // Keep only the failed operation's identifying fields, never normal logs or snapshots.
        for(const failure of cleanupLogs.filter(x=>x.action==='cleanup_failed')) {
            const operation=failure.lastOperation;
            const requested=operation&&/_requested$/.test(operation.action||'')?operation:null;
            const item=requested?.file||requested?.directory;
            const details={category:'cleanup_failed',severity:'清理异常',reason:failure.error||'清理失败',originalPath:failure.path||item?.path||null};
            if(requested)details.operation=requested.action;
            if(item){details.id=String(item.id);details.parentId=item.parentId;details.folder=Boolean(requested.directory);details.oldName=item.name;}
            if(requested?.to){details.targetParentId=String(requested.to.id);details.targetFolderName=requested.to.name;}
            const existing=issues.find(x=>x.category==='execution_stopped'&&x.reason===failure.error);
            if(existing)Object.assign(existing,details);else issues.push(details);
        }
        if(!issues.length)return null;
        return {version:VERSION,createdAt:new Date().toISOString(),phase:context.phase||'scan',completed:!context.error,stopped:Boolean(stopped),summary:{issueCount:issues.length},issues};
    }
    const CLEAN_LIMIT=209715200;
    const cleanupFingerprint=xs=>JSON.stringify(xs.map(x=>[x.folder?'d':'f',String(x.id),x.name,x.folder?null:x.size]).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b))));
    function buildCleanup(items,snapshots) {
        const nodes=new Map(items.filter(x=>x.folder).map(x=>[String(x.id),x]));
        const parent=x=>nodes.get(String(x.parentId));
        const ancestors=x=>{const result=[],seen=new Set();for(let p=parent(x);p;p=parent(p)){if(seen.has(p.id))throw Error('目录层级循环，停止');seen.add(p.id);result.push(p);}return result;};
        for(const x of items.filter(x=>!x.folder))if(!Number.isSafeInteger(x.size)||x.size<0)throw Error('文件大小未知或无效，禁止自动清理：'+x.path);
        const works=items.filter(x=>x.folder&&findCode(x.name)&&!ancestors(x).some(a=>findCode(a.name)));
        const moves=[],deleteDirs=[];
        for(const work of works){
            const direct=items.filter(x=>String(x.parentId)===String(work.id));
            const subdirs=direct.filter(x=>x.folder);
            for(const dir of subdirs){const contents=items.filter(x=>ancestors(x).some(p=>String(p.id)===String(dir.id)));deleteDirs.push({...dir,contents});}
            if(direct.some(x=>!x.folder&&splitVideo(x.name)&&x.size>=CLEAN_LIMIT))continue;
            const rescue=items.filter(x=>!x.folder&&x.size>=CLEAN_LIMIT&&splitVideo(x.name)&&ancestors(x).some(p=>String(p.id)===String(work.id))&&String(x.parentId)!==String(work.id));
            const names=new Set(direct.map(x=>x.name.toLowerCase()));
            for(const file of rescue){
                if(names.has(file.name.toLowerCase()))throw Error('内层视频移到外层会重名，未提交任何清理：'+file.path);
                names.add(file.name.toLowerCase());moves.push({file:{...file},to:{...work},newPath:work.path+'/'+file.name});
            }
        }
        const covered=x=>deleteDirs.some(d=>String(d.id)===String(x.id)||ancestors(x).some(p=>String(p.id)===String(d.id)));
        const deleteFiles=items.filter(x=>!x.folder&&x.size<CLEAN_LIMIT&&!covered(x));
        const rescued=new Map(moves.map(x=>[String(x.file.id),x]));
        const future=items.flatMap(x=>{
            const m=!x.folder&&rescued.get(String(x.id));
            if(m)return [{...x,parentId:String(m.to.id),path:m.newPath}];
            if(covered(x)||(!x.folder&&x.size<CLEAN_LIMIT))return [];
            return [{...x}];
        });
        const key=x=>(x.folder?'d':'f')+x.id,kept=new Map(future.map(x=>[key(x),x]));
        const cache=new Map();
        for(const [cid,list] of snapshots){
            if(nodes.has(String(cid))&&!kept.has('d'+cid))continue;
            cache.set(String(cid),list.flatMap(x=>{
                const selected=items.some(y=>key(y)===key(x));if(!selected)return [{...x}];
                const next=kept.get(key(x));return next&&String(next.parentId)===String(cid)?[{...next}]:[];
            }));
        }
        for(const m of moves){const list=cache.get(String(m.to.id));if(!list)throw Error('救援目标目录快照缺失');list.push({...kept.get('f'+m.file.id)});}
        return {limit:CLEAN_LIMIT,moves,deleteFiles,deleteDirs,items:future,cache,originalItems:items.map(x=>({...x})),originalSnapshots:new Map([...snapshots].map(([id,xs])=>[String(id),xs.map(x=>({...x}))]))};
    }
    const READ_CONCURRENCY=3;
    async function parallelRead(values,visit,check=()=>{}) {
        const items=[...values];let cursor=0,failure=null;
        async function worker() {
            while(!failure) {
                try {
                    check();const i=cursor++;if(i>=items.length)return;
                    await visit(items[i],i);
                }catch(error){if(!failure)failure=error instanceof Error?error:Error(String(error));}
            }
        }
        // 失败后不再启动新请求，等待已发出的读取结束，再把错误交给调用方。
        await Promise.all(Array.from({length:Math.min(READ_CONCURRENCY,items.length)},worker));
        if(failure)throw failure;
    }
    function cleanupVerificationScope(plan) {
        const snapshots=new Map([...plan.originalSnapshots].map(([id,xs])=>[String(id),xs]));
        const folders=new Map();
        for(const xs of snapshots.values())for(const item of xs)if(item.folder)folders.set(String(item.id),item);
        for(const item of plan.originalItems)if(item.folder)folders.set(String(item.id),item);
        const affected=new Set();
        function add(cid) {
            cid=String(cid);const seen=new Set();
            while(true) {
                if(seen.has(cid))throw Error('清理核对目录层级循环');seen.add(cid);
                if(!snapshots.has(cid))throw Error('清理核对快照缺失（cid='+cid+'）');
                affected.add(cid);
                const parent=folders.get(cid)?.parentId;
                if(parent===undefined||parent===null||!snapshots.has(String(parent)))break;
                cid=String(parent);
            }
        }
        for(const move of plan.moves){add(move.file.parentId);add(move.to.id);}
        for(const file of plan.deleteFiles)add(file.parentId);
        for(const dir of plan.deleteDirs){add(dir.parentId);add(dir.id);for(const item of dir.contents)if(item.folder)add(item.id);}
        // 只缩小清理阶段的范围；后续改名仍会单独核对所有待改名目录。
        return affected;
    }
    async function executeCleanup(plan,{list,post,log,check=()=>{},pause=ms=>new Promise(r=>setTimeout(r,ms)),progress=()=>{}}) {
        const expected=new Map([...plan.originalSnapshots].map(([id,xs])=>[id,xs.map(x=>({...x}))]));
        const scope=cleanupVerificationScope(plan);
        async function verify(cid){check();const got=await list(String(cid));if(!expected.has(String(cid))||cleanupFingerprint(got)!==cleanupFingerprint(expected.get(String(cid))))throw Error('清理前目录内容或大小已变化，请重扫（cid='+cid+'）');}
        let verified=0;
        await parallelRead(scope,async cid=>{await verify(cid);progress('清理前核对相关目录 '+(++verified)+'/'+scope.size);},check);
        async function confirm(cids){
            for(let attempt=0;attempt<3;attempt++){
                let ok=true;
                for(const cid of cids){check();const got=await list(String(cid));if(cleanupFingerprint(got)!==cleanupFingerprint(expected.get(String(cid))))ok=false;}
                if(ok)return;
                if(attempt<2)await pause(700);
            }
            throw Error('清理操作已提交但未回读确认，停止；请重新扫描，不自动重试写入');
        }
        for(const move of plan.moves){
            check();const from=String(move.file.parentId),to=String(move.to.id);progress('救援内层视频：'+move.file.name);
            await parallelRead(new Set([from,to]),verify,check);log({action:'move_requested',...move});
            await post('/files/move',{fid:move.file.id,pid:to});
            expected.set(from,expected.get(from).filter(x=>x.folder||String(x.id)!==String(move.file.id)));
            expected.get(to).push({...move.file,parentId:to});await confirm([from,to]);log({action:'move_confirmed',...move});
        }
        for(const file of plan.deleteFiles){
            check();const cid=String(file.parentId);progress('删除小文件：'+file.name);await verify(cid);
            log({action:'delete_small_requested',file});await post('/rb/delete',{fid:file.id,pid:cid});
            expected.set(cid,expected.get(cid).filter(x=>x.folder||String(x.id)!==String(file.id)));await confirm([cid]);log({action:'delete_small_confirmed',file});
        }
        for(const dir of plan.deleteDirs){
            check();const cid=String(dir.parentId);progress('删除作品子目录（含剩余内容）：'+dir.name);
            await parallelRead(new Set([cid,String(dir.id),...dir.contents.filter(x=>x.folder).map(x=>String(x.id))]),verify,check);
            log({action:'delete_subfolder_requested',directory:dir});await post('/rb/delete',{fid:dir.id,pid:cid});
            expected.set(cid,expected.get(cid).filter(x=>!x.folder||String(x.id)!==String(dir.id)));await confirm([cid]);log({action:'delete_subfolder_confirmed',directory:dir});
        }
        const remaining=[...scope].filter(cid=>plan.cache.has(cid));
        await parallelRead(remaining,async cid=>{check();const got=await list(cid);if(cleanupFingerprint(got)!==cleanupFingerprint(plan.cache.get(cid)))throw Error('清理后状态与改名预览不一致，停止并重新扫描（cid='+cid+'）');},check);
    }

    function taskProgressText(progress) {
        if(!progress)return '';
        const cleaning=progress.phase==='cleanup';
        const total=cleaning?progress.cleanupTotal:progress.renameTotal;
        const done=cleaning?progress.cleanupDone:progress.renameDone;
        return (cleaning?'清理':'改名')+'：已完成 '+done+' / '+total+'，剩余 '+Math.max(0,total-done)+' 项';
    }
    const PRIMARY_SOURCE='javbus';
    function detect115Page(doc,href) {
        try{if(/^\/storage(?:\/|$)/i.test(new URL(href).pathname))return 'modern';}catch{}
        if(doc.querySelector('iframe[rel="wangpan"]')||doc.querySelector('li[file_type][cate_id],li[file_type][file_id]'))return 'legacy';
        return 'unknown';
    }
    const core={PRIMARY_SOURCE,detect115Page,taskProgressText,buildIssueReport,independentTitleVideos,CLEAN_LIMIT,READ_CONCURRENCY,parallelRead,cleanupVerificationScope,cleanupFingerprint,buildCleanup,executeCleanup,discardedLabel,cleanNotes,repairSourcePrefix,readVideoStructure,VERSION,splitVideo,canonical,findCode,sameCode,topComma,normalizeTag,desc,mergeNotes,extractInfo,videoInfo,validDate,cleanTitle,checkedMeta,parseDocument,buildFolderName,planFolder,settle,matchesSavedName,rewriteFolderLabels,collectIssues};
    if(typeof module!=='undefined'&&module.exports){module.exports=core;return;}
    if(window.top!==window.self)return;

    const state={rows:[],cache:new Map(),metadata:new Map(),busy:false,cancel:false,logs:[],items:[],scanOK:false,issueContext:{phase:'scan'},cleanup:null,cleanupLogs:[],taskProgress:null};
    const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
    const trusted=new Set(['webapi.115.com','www.javbus.com','javbus.com','avmoo.host','avsox.host']);
    function checkStop(){if(state.cancel)throw Error('用户停止');}
    function rawRequest(url,body) {
        checkStop();
        const u=new URL(url);
        if(u.protocol!=='https:'||!trusted.has(u.hostname))return Promise.reject(Error('拒绝访问非配置的数据源'));
        return new Promise((resolve,reject)=>GM_xmlhttpRequest({method:body?'POST':'GET',url,timeout:20000,
            headers:body?{'Content-Type':'application/x-www-form-urlencoded; charset=UTF-8'}:{},
            data:body?new URLSearchParams(body).toString():undefined,
            onload:r=>{
                if(r.status<200||r.status>=300){reject(Error('HTTP '+r.status));return;}
                if(r.finalUrl&&!trusted.has(new URL(r.finalUrl).hostname)){reject(Error('数据源重定向到未知站点'));return;}
                resolve(r.responseText);
            },onerror:()=>reject(Error('网络请求失败')),ontimeout:()=>reject(Error('请求超时'))}));
    }
    async function requestJSON(url,body) {
        const text=await rawRequest(url,body);let result;
        try{result=JSON.parse(text);}catch{throw Error('115返回的不是JSON，可能登录已失效');}
        if(!result.state)throw Error(result.error||result.msg||'115接口返回失败');
        return result;
    }
    async function listing(cid,fresh=false) {
        cid=String(cid);
        if(!fresh&&state.cache.has(cid))return state.cache.get(cid);
        const all=[],seen=new Set();
        for(let offset=0;;) {
            checkStop();
            const q=new URLSearchParams({aid:'1',cid,offset:String(offset),limit:'1000',show_dir:'1',cur:'1',format:'json',o:'file_name',asc:'1'});
            const data=await requestJSON('https://webapi.115.com/files?'+q);
            if(!Array.isArray(data.data))throw Error('115文件列表结构不符合预期');
            const page=data.data.map(x=>{
                const file=Boolean(x.fid&&String(x.fid)!=='0');
                const rawSize=x.s??x.file_size??x.size;
                const size=file&&/^(?:0|[1-9]\d*)$/.test(String(rawSize))?Number(rawSize):null;
                return {id:String(file?x.fid:x.cid),parentId:cid,folder:!file,name:x.n,size};
            });
            for(const x of page) {
                const key=(x.folder?'d':'f')+x.id;
                if(!/^\d+$/.test(x.id)||typeof x.name!=='string'||seen.has(key))throw Error('115列表条目异常或分页重复，停止');
                seen.add(key);all.push(x);
            }
            offset+=page.length;
            const count=data.count===null||data.count===undefined?NaN:Number(data.count);
            if(!page.length||(Number.isFinite(count)&&offset>=count)||page.length<1000)break;
            await sleep(150);
        }
        state.cache.set(cid,all);return all;
    }
    async function lookupUncached(code,primary) {
        const bus=['https://www.javbus.com/'+encodeURIComponent(code),'https://www.javbus.com/search/'+encodeURIComponent(code),'https://www.javbus.com/uncensored/search/'+encodeURIComponent(code)];
        const moo=['https://avmoo.host/cn/search/'+encodeURIComponent(code),'https://avsox.host/cn/search/'+encodeURIComponent(code)];
        const urls=primary==='avmoo'?[...moo,...bus]:[...bus,...moo];
        const failures=[];
        const visited=new Set();
        for(let i=0;i<urls.length;i++) {
            checkStop();const url=urls[i];if(visited.has(url))continue;visited.add(url);
            try {
                const text=await rawRequest(url);
                const doc=new DOMParser().parseFromString(text,'text/html');
                const parsed=parseDocument(doc,code,url);
                if(parsed.meta)return parsed.meta;
                for(const link of (parsed.links||[]).slice(0,2)) {
                    const u=new URL(link);if(u.protocol==='https:'&&trusted.has(u.hostname)&&u.hostname!=='webapi.115.com'&&!visited.has(link))urls.splice(i+1,0,link);
                }
                failures.push(new URL(url).hostname+':未找到匹配的番号、日期及标题');
            }catch(e){failures.push(new URL(url).hostname+':'+e.message);}
            await sleep(500);
            if(visited.size>=9)break;
        }
        throw Error('联网查询失败（不猜填资料）：'+failures.join('；'));
    }
    async function lookup(code,primary) {
        code=canonical(code);
        if(!state.metadata.has(code)) {
            await sleep(500);checkStop();
            state.metadata.set(code,lookupUncached(code,primary));
        }
        return state.metadata.get(code);
    }
    function selection() {
        const frame=document.querySelector('iframe[rel="wangpan"]');
        const doc=frame?frame.contentDocument:document;
        if(!doc)throw Error('无法读取115文件列表，请进入网盘文件页面');
        const current=doc.location.href.match(/[?&#]cid=(\d+)/)?.[1]??null;
        const selected=[...doc.querySelectorAll('li.selected[file_type]')].map(el=>({
            id:el.getAttribute(el.getAttribute('file_type')==='0'?'cate_id':'file_id'),
            folder:el.getAttribute('file_type')==='0',name:el.getAttribute('title'),
            parentId:el.getAttribute('p_id')||el.getAttribute('parent_id')||el.getAttribute('pid')||current
        }));
        if(!selected.length)throw Error('请先在115选中作品文件夹、人物文件夹或合集目录');
        if(selected.some(x=>!x.folder))throw Error('本版请选择文件夹，让插件同时保存文件夹备注和处理内部视频');
        if(selected.some(x=>!/^\d+$/.test(x.id)||!x.name))throw Error('选中条目信息不完整');
        return selected;
    }
    function download(name,data) {
        const text=typeof data==='string'?data:JSON.stringify(data,null,2);
        const blob=new Blob([text],{type:'application/json;charset=utf-8'}),url=URL.createObjectURL(blob);
        const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),60000);
    }
    // Shadow DOM keeps the 115 page's styles and delegated clicks out of the controls.
    if(document.getElementById('rename115-codex-host'))return;
    const mount=document.createElement('div');
    mount.id='rename115-codex-host';
    mount.style.cssText='all:initial!important;position:fixed!important;inset:0!important;z-index:2147483647!important;pointer-events:none!important;';
    const shadow=mount.attachShadow({mode:'open'});
    const style=document.createElement('style');
    style.textContent=`
      :host{font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI","Microsoft YaHei",sans-serif;color:#172b46;color-scheme:light}
      *,*::before,*::after{box-sizing:border-box} [hidden]{display:none!important}
      button,a{touch-action:manipulation} button{font:inherit;cursor:pointer;border:1px solid #d8e1ed;background:#fff;color:#33465f;border-radius:9px;padding:9px 13px;line-height:1.35;transition:background .12s,border-color .12s}
      button:hover:not(:disabled){background:#f0f5fc;border-color:#a9bedc} button:disabled{background:#f3f5f8;color:#96a3b5;border-color:#e5eaf0;cursor:not-allowed}
      button:focus-visible,a:focus-visible{outline:3px solid #92baff;outline-offset:3px} a{color:#2563eb;text-decoration:none} a:hover{text-decoration:underline}
      .launcher{pointer-events:auto;position:fixed;right:20px;bottom:20px;display:flex;align-items:center;gap:10px;padding:10px 14px 10px 10px;background:#fff;border:1px solid #d9e3f0;border-radius:16px;box-shadow:0 5px 22px #1932541c}
      .logo{display:inline-flex;align-items:center;justify-content:center;width:34px;height:34px;background:#2563eb;color:#fff;border-radius:10px;font-size:14px;font-weight:750;letter-spacing:-.5px;flex-shrink:0}
      .launcher-title{font-size:14px;font-weight:650}.launcher-state{display:block;font-size:11px;color:#74849b;text-align:left;margin-top:1px}
      .panel{pointer-events:auto;position:fixed;right:20px;bottom:20px;width:min(1040px,calc(100vw - 40px));height:min(700px,calc(100vh - 40px));display:flex;flex-direction:column;background:#fff;border:1px solid #dce4ef;border-radius:18px;box-shadow:0 12px 48px #19325425;overflow:hidden}
      .header{padding:18px 20px;display:flex;align-items:center;gap:12px;border-bottom:1px solid #edf1f6;flex-shrink:0}
      .heading{flex:1;min-width:0}.title{font-size:17px;font-weight:700;line-height:1.3}.subtitle{font-size:11px;color:#78889e;margin-top:3px;letter-spacing:.25px}
      .version{font-size:11px;color:#64748b;background:#f1f5fa;border:1px solid #e4eaf3;border-radius:7px;padding:3px 7px}.collapse{padding:7px 10px;font-size:12px}
      .body{padding:16px 20px 14px;display:flex;flex:1;min-height:0;flex-direction:column;gap:13px;overflow:hidden}
      .overview{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;flex-shrink:0}.steps{font-size:12px;color:#667990}.steps b{font-weight:600;color:#334e70}.source{font-size:11px;background:#f6f8fc;border:1px solid #e6ecf4;border-radius:7px;padding:5px 8px;color:#657a96}
      .rules{background:#f7f9fc;border:1px solid #e9eef5;border-radius:10px;padding:10px 12px;display:flex;flex-direction:column;gap:4px;font-size:12px;color:#63758d;flex-shrink:0}.rules strong{font-weight:600;color:#304968}.rules .format{font-size:12px;color:#354e70}
      .warning{padding:12px 14px;background:#fff8eb;border:1px solid #f2dfb8;border-radius:10px;flex-shrink:0}.warning strong{display:block;font-size:13px;color:#82581c;margin-bottom:5px}.warning p{font-size:12px;color:#876b42;margin:0 0 8px}.warning-actions{display:flex;gap:14px;align-items:center;flex-wrap:wrap}.warning button{font-size:11px;padding:5px 8px;background:transparent;border-color:#e7d3ad;color:#876b42}.warning a{font-size:12px;font-weight:600;color:#8c5a14}
      .actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap;flex-shrink:0}.primary{background:#2563eb;border-color:#2563eb;color:#fff;font-weight:600}.primary:hover:not(:disabled){background:#1d4ed8;border-color:#1d4ed8}.execute:not(:disabled){background:#fff4ec;color:#9a4d20;border-color:#efd4bc}.stop{margin-left:auto;font-size:12px;padding:8px 10px}
      .status{flex:0 0 auto;min-height:52px;max-height:100px;overflow:auto;display:flex;align-items:flex-start;gap:10px;flex-wrap:wrap;padding:10px 12px;background:#f9fbfe;border:1px solid #e8eef7;border-radius:10px;font-size:12px;color:#536b87}
      .status-text{flex:1;min-width:180px;overflow-wrap:anywhere}.progress{margin-left:auto;flex-shrink:0;white-space:nowrap;font-size:12px;font-weight:650;color:#1d5ba9;background:#eaf2ff;border-radius:6px;padding:2px 7px}.progress:empty{display:none}
      .preview{flex:1;min-height:0;width:100%;overflow:auto;border:1px solid #e6ecf4;border-radius:10px;background:#fff}.empty{height:100%;min-height:90px;display:flex;align-items:center;justify-content:center;text-align:center;padding:22px;color:#8795a8;font-size:12px}.empty strong{display:block;color:#617791;font-size:13px;font-weight:500;margin-bottom:6px}
      .preview table tr:first-child{position:sticky;top:0;background:#f2f6fb;color:#526b89;font-weight:600;z-index:1}.preview table td{border-color:#e8edf5!important;font-size:12px!important}.preview table tr:not(:first-child):nth-child(odd){background:#fbfcfe}
      .footer{font-size:11px;color:#8a98ac;display:flex;justify-content:space-between;gap:12px;flex-shrink:0}
      @media(max-width:640px){.panel{right:10px;bottom:10px;width:calc(100vw - 20px);height:min(760px,calc(100vh - 20px));border-radius:14px}.header{padding:14px 12px;gap:8px}.body{padding:12px;gap:10px}.version{display:none}.actions{gap:6px}.actions button{font-size:12px;padding:8px 10px}.stop{margin-left:0}.source{font-size:10px}.status-text{min-width:140px}.launcher{right:14px;bottom:14px}.footer{font-size:10px}.rules{font-size:11px}}
    `;
    shadow.appendChild(style);
    const launcher=document.createElement('button');
    launcher.type='button';launcher.className='launcher';launcher.setAttribute('data-a','launcher');launcher.setAttribute('aria-label','打开115文件整理');launcher.setAttribute('aria-expanded','false');
    launcher.innerHTML='<span class="logo">115</span><span><span class="launcher-title">文件整理</span><span class="launcher-state" data-a="launcher-progress">点击展开</span></span>';
    const panel=document.createElement('section');panel.className='panel';panel.hidden=true;panel.setAttribute('aria-label','115文件整理面板');
    panel.innerHTML=`<header class="header"><span class="logo">115</span><div class="heading"><div class="title">文件整理</div><div class="subtitle">115Rename · Codex Version</div></div><span class="version">v${VERSION}</span><button type="button" class="collapse" data-a="toggle">收起</button></header>
      <div class="body" data-a="body">
        <div class="overview"><span class="steps"><b>扫描预览</b>　›　备份与核对　›　清理并改名</span><span class="source">javbus 优先 · avmoo 备用</span></div>
        <div class="warning" data-a="compat-warning" role="alert" hidden><strong data-a="compat-title">请先切回115旧版</strong><p data-a="compat-detail"></p><div class="warning-actions"><a data-a="legacy-link" href="https://115.com/?old=1" target="_self">切换到115旧版 →</a><button type="button" data-a="detect">重新检测页面</button></div></div>
        <div class="rules"><div class="format">日期_番号【描述】【备注：…】 作品名称</div><div>清理 <strong>小于200 MiB的所有文件</strong>及作品内部子目录；外层无保留视频时先移出内层视频。删除移入回收站。</div></div>
        <div class="actions"><button type="button" class="primary" data-a="scan">联网扫描并预览</button><button type="button" data-a="backup">下载原名和预览</button><button type="button" class="execute" data-a="run" disabled>执行清理并改名</button><button type="button" data-a="issues" disabled>下载异常清单</button><button type="button" class="stop" data-a="stop">停止</button></div>
        <div class="status" data-a="status" role="status"><span class="status-text" data-a="status-text">请先选中文件夹，再扫描预览。</span><span class="progress" data-a="task-progress"></span></div>
        <div class="preview" data-a="preview"><div class="empty"><div><strong>先预览，再执行</strong>扫描后在这里核对原名称、目标名称和清理项目。</div></div></div>
        <div class="footer"><span>仅支持115旧版文件页面</span><span>扫描不会修改文件</span></div>
      </div>`;
    shadow.append(launcher,panel);
    function setPanelOpen(open){panel.hidden=!open;launcher.hidden=open;launcher.setAttribute('aria-expanded',String(open));if(open)refreshCompatibility();}
    function refreshCompatibility(){
        const mode=detect115Page(document,location.href);
        const compatible=mode==='legacy';
        el('compat-warning').hidden=compatible;
        el('compat-title').textContent=mode==='modern'?'当前是115新版，请先切回旧版':'未检测到115旧版文件列表';
        el('compat-detail').textContent=mode==='modern'?'当前插件暂不支持新版的选中项结构。切回旧版后，刷新页面并重新选中文件夹，再进行扫描。':'请打开115旧版网盘的文件列表。若页面仍在加载，稍后点击“重新检测页面”。';
        el('scan').disabled=state.busy||!compatible;
        if(!compatible){state.scanOK=false;el('run').disabled=true;}
        return compatible;
    }
    function ensureLegacyPage(){if(refreshCompatibility())return true;status('请先切换到115旧版文件页面，再使用扫描或执行功能。');return false;}

    const el=a=>panel.querySelector('[data-a="'+a+'"]');
    const updateTaskProgress=()=>{
        el('task-progress').textContent=taskProgressText(state.taskProgress);
        const p=state.taskProgress,remaining=p?Math.max(0,p.cleanupTotal-p.cleanupDone+p.renameTotal-p.renameDone):0;
        launcher.querySelector('[data-a=launcher-progress]').textContent=p?(remaining?'剩余 '+remaining+' 项':state.busy?'正在核对':'已完成'):'点击展开';
    };
    const status=t=>{el('status-text').textContent=t;updateTaskProgress();};
    const backup=()=>({version:VERSION,createdAt:new Date().toISOString(),rows:state.rows,snapshots:[...state.cache],cleanup:cleanupBackup(),cleanupLogs:state.cleanupLogs});
    function cleanupBackup(){const p=state.cleanup;return p?{limit:p.limit,moves:p.moves,deleteFiles:p.deleteFiles,deleteDirs:p.deleteDirs,originalItems:p.originalItems,originalSnapshots:[...p.originalSnapshots],expectedSnapshots:[...p.cache]}:null;}
    function cleanupCount(){const p=state.cleanup;return p?p.moves.length+p.deleteFiles.length+p.deleteDirs.length:0;}
    function refreshIssueButton() {el('issues').disabled=state.busy||!collectIssues(state.rows,state.logs,state.issueContext).length;}
    function exportIssues(context=state.issueContext) {
        const report=buildIssueReport(state.rows,state.logs,context,state.cleanupLogs,state.cancel);
        if(!report)return null;
        download('115改名异常与待确认-'+Date.now()+'.json',report);return report;
    }
    function render() {
        const host=el('preview');host.replaceChildren();host.style.display='block';
        const table=document.createElement('table');table.style.cssText='border-collapse:collapse;width:100%;font-size:12px;table-layout:fixed;min-width:850px';
        const p=state.cleanup;
        const cleanRows=p?[...p.moves.map(m=>['先移动内层保留视频',m.file.path,m.newPath]),...p.deleteFiles.map(f=>['删除小文件（'+f.size+'字节 < 200 MiB）',f.path,'移入回收站；不提取备注']),...p.deleteDirs.map(d=>['删除整个作品子目录（剩余内容不看大小）',d.path,'含'+d.contents.filter(x=>!x.folder&&!p.moves.some(m=>String(m.file.id)===String(x.id))).length+'个待随目录删除的文件；包括大文件'])]:[];
        const data=[['状态 / 说明','原路径','拟修改名称 / 清理动作'],...cleanRows,...state.rows.map(r=>[r.skip||((r.oldName===r.newName?'保持原名':'将改名')+(r.notice?'；'+r.notice:'')),r.path,r.newName])];
        for(const cells of data) {
            const tr=document.createElement('tr');
            for(const value of cells){const td=document.createElement('td');td.textContent=value;td.style.cssText='border:1px solid #ddd;padding:6px;vertical-align:top;overflow-wrap:anywhere;white-space:pre-wrap';tr.appendChild(td);}table.appendChild(tr);
        }
        host.appendChild(table);
        const todo=state.rows.filter(r=>!r.skip&&r.oldName!==r.newName);
        status('清理预览：移动'+(state.cleanup?.moves.length||0)+'个视频，删除'+(state.cleanup?.deleteFiles.length||0)+'个小文件、'+(state.cleanup?.deleteDirs.length||0)+'个子目录；扫描完成：'+state.rows.length+'项，待改名'+todo.length+'项，跳过'+state.rows.filter(r=>r.skip).length+'项；联网缓存'+state.metadata.size+'个番号。备注已并入文件夹计划，请逐项核对。');
        el('run').disabled=!todo.length&&!cleanupCount();
        // 全部项目被跳过而无法点击执行时，也提供诊断；正常无需修改不生成异常JSON。
        if(!todo.length&&!cleanupCount())exportIssues();
    }
    async function scan() {
        if(state.busy)return;
        if(!ensureLegacyPage())return;
        state.taskProgress=null;updateTaskProgress();
        if(typeof GM_xmlhttpRequest!=='function'){status('无法使用油猴网络权限：请确认脚本头部完整、已保存并刷新115页面。');return;}
        status('扫描按钮已响应，正在读取选中的文件夹…');
        state.busy=true;state.cancel=false;state.scanOK=false;state.rows=[];state.items=[];state.logs=[];state.issueContext={phase:'scan'};state.cleanup=null;state.cleanupLogs=[];state.cache.clear();state.metadata.clear();el('run').disabled=true;el('scan').disabled=true;el('issues').disabled=true;
        const seen=new Set();
        async function collect(item,path='') {
            checkStop();const key=(item.folder?'d':'f')+item.id;if(seen.has(key))return;seen.add(key);
            const current={...item,path:path?path+'/'+item.name:item.name};state.items.push(current);
            status('读取目录：'+state.items.length+'项，'+item.name);
            if(item.parentId!==null&&item.parentId!==undefined)await listing(item.parentId);
            if(item.folder){const children=await listing(item.id);for(const child of children)await collect(child,current.path);}
        }
        try {
            const selected=selection();for(const item of selected)await collect(item);
            state.cleanup=buildCleanup(state.items,state.cache);
            state.items=state.cleanup.items;state.cache=new Map([...state.cleanup.cache].map(([id,xs])=>[id,xs.map(x=>({...x}))]));
            const primary=PRIMARY_SOURCE;
            const videosAdded=new Set();let foldersDone=0;
            for(const folder of state.items.filter(x=>x.folder)) {
                checkStop();const hit=findCode(folder.name),children=state.cache.get(String(folder.id))||[];
                let planned;
                if(hit) {
                    status('联网查询 '+hit.code+'；已处理'+foldersDone+'个目录，缓存'+state.metadata.size+'个番号');
                    try{planned=planFolder(folder,children,await lookup(hit.code,primary));}
                    catch(e){checkStop();planned={folder:{...folder,oldName:folder.name,newName:folder.name,skip:e.message},videos:[]};}
                }else planned={folder:{...folder,oldName:folder.name,newName:folder.name,skip:'分类目录，无作品番号'},videos:[]};
                const independent=independentTitleVideos(folder,children);
                for(const candidate of independent) {
                    const i=planned.videos.findIndex(v=>String(v.id)===String(candidate.id));
                    if(i<0)planned.videos.push(candidate);
                    else if(!planned.videos[i].skip&&planned.videos[i].newName===candidate.newName)planned.videos[i]={...planned.videos[i],...candidate};
                }
                state.rows.push(planned.folder);foldersDone++;
                for(const v of planned.videos) {
                    const item=state.items.find(x=>!x.folder&&x.id===v.id&&String(x.parentId)===String(folder.id));
                    state.rows.push({...v,path:item?.path||folder.path+'/'+v.oldName});videosAdded.add(v.id);
                }
                for(const item of children.filter(x=>!x.folder))if(!videosAdded.has(item.id)) {
                    const actual=state.items.find(x=>!x.folder&&x.id===item.id);
                    state.rows.push({...item,oldName:item.name,newName:item.name,path:actual?.path||folder.path+'/'+item.name,skip:splitVideo(item.name)?'所属作品文件夹未处理，保留原名':'非视频文件'});
                    videosAdded.add(item.id);
                }
            }
            settle(state.rows,state.cache);state.scanOK=true;render();
        }catch(e){state.scanOK=false;state.issueContext={phase:'scan',error:e.message};status('扫描停止：'+e.message+'。未提交清理或改名，请重新扫描。');el('run').disabled=true;}
        finally{state.busy=false;el('scan').disabled=false;refreshIssueButton();updateTaskProgress();}
    }
    const fingerprint=items=>JSON.stringify(items.map(x=>(x.folder?'d':'f')+x.id+'\0'+x.name).sort());
    async function confirmSaved(row) {
        const observations=[];
        for(const delay of [0,500,1500]) {
            if(delay)await sleep(delay);checkStop();
            try {
                const items=await listing(row.parentId,true);
                const actual=items.find(x=>String(x.id)===String(row.id)&&x.folder===row.folder);
                observations.push({actualName:actual?.name??null,at:new Date().toISOString()});
                if(actual&&matchesSavedName(row,actual.name))return {actualName:actual.name,readbacks:observations};
            }catch(e){observations.push({error:e.message,at:new Date().toISOString()});if(state.cancel)throw e;}
        }
        const error=Error('3次回读仍未确认目标名称：期望='+row.newName+'；实际='+JSON.stringify(observations));
        error.readbacks=observations;throw error;
    }
    async function run() {
        if(state.busy||!state.scanOK)return;
        if(!ensureLegacyPage())return;
        const todo=state.rows.filter(r=>!r.skip&&r.newName!==r.oldName);if(!todo.length&&!cleanupCount())return;
        if(!confirm('请确认清理与改名预览：\n先移动'+state.cleanup.moves.length+'个内层大视频；删除'+state.cleanup.deleteFiles.length+'个小于200 MiB的文件；删除'+state.cleanup.deleteDirs.length+'个作品子目录及其剩余全部内容（包括大文件）。\n被删除小文件不提取备注。删除移至回收站，不清空回收站。\n清理全部核对成功后再修改'+todo.length+'个名称。无备注的安全长标题视频先规范，其余视频先保护文件夹备注。任何失败立即停止。继续吗？'))return;
        state.busy=true;state.cancel=false;state.logs=[];state.cleanupLogs=[];state.scanOK=false;el('run').disabled=true;el('scan').disabled=true;el('issues').disabled=true;
        state.taskProgress={phase:'cleanup',cleanupTotal:cleanupCount(),cleanupDone:0,renameTotal:todo.length,renameDone:0};updateTaskProgress();
        const initial=new Map([...state.cache].map(([cid,items])=>[cid,fingerprint(items)]));
        const folderRows=new Map(state.rows.filter(r=>r.folder).map(r=>[String(r.id),r]));
        download('115改名前备份-'+Date.now()+'.json',backup());
        const success=new Set(),failed=new Set();let runError='';
        try {
            try{await executeCleanup(state.cleanup,{list:cid=>listing(cid,true),post:(path,body)=>requestJSON('https://webapi.115.com'+path,body),log:event=>{state.cleanupLogs.push({at:new Date().toISOString(),...event});if(['move_confirmed','delete_small_confirmed','delete_subfolder_confirmed'].includes(event.action)){state.taskProgress.cleanupDone++;updateTaskProgress();}},check:checkStop,pause:sleep,progress:status});}
            catch(e){const last=state.cleanupLogs.at(-1),path=last?.file?.path||last?.directory?.path||'执行前目录核对';e.message='清理阶段停止：'+path+'；'+e.message;state.cleanupLogs.push({at:new Date().toISOString(),action:'cleanup_failed',path,error:e.message,lastOperation:last||null});throw e;}
            state.cache=new Map([...state.cleanup.cache].map(([id,xs])=>[id,xs.map(x=>({...x}))]));
            state.taskProgress.phase='rename';updateTaskProgress();
            const cids=new Set(todo.map(r=>String(r.parentId)));
            for(const r of todo) {
                if(r.folder)cids.add(String(r.id));
                else {const p=folderRows.get(String(r.dependsOn));if(p?.parentId!==null&&p?.parentId!==undefined)cids.add(String(p.parentId));}
            }
            let count=0;
            await parallelRead(cids,async cid=>{
                checkStop();
                const current=await listing(cid,true);
                if(!initial.has(cid)||fingerprint(current)!==initial.get(cid))throw Error('目录内容已变化（cid='+cid+'），未开始改名，请重新扫描');
                status('改名前核对目录 '+(++count)+'/'+cids.size);
            },checkStop);
            // 同一目录的内容不变且文件夹本身无需改名时，视为备注已在原名保存。
            for(const r of state.rows.filter(r=>r.folder&&!r.skip&&r.oldName===r.newName))success.add(String(r.id));
            const ordered=[...todo.filter(r=>!r.folder&&r.independentVideo),...todo.filter(r=>r.folder).sort((a,b)=>a.path.split('/').length-b.path.split('/').length),...todo.filter(r=>!r.folder&&!r.independentVideo)];
            for(const r of ordered) {
                checkStop();
                if(!r.folder&&!r.independentVideo&&!success.has(String(r.dependsOn))) {
                    state.logs.push({...r,result:'未执行：所属文件夹未成功保存，保护视频原备注'});continue;
                }
                status('正在改名：'+r.oldName);
                try {
                    await requestJSON('https://webapi.115.com/files/edit',{fid:r.id,file_name:r.newName});
                    // 回读实际名称，避免接口成功但未按目标落盘时删除视频上的唯一备注。
                    const confirmed=await confirmSaved(r);
                    if(r.folder)success.add(String(r.id));
                    state.logs.push({...r,...confirmed,result:'成功且已回读确认'});
                    state.taskProgress.renameDone++;updateTaskProgress();
                }catch(e){failed.add(String(r.id));state.logs.push({...r,readbacks:e.readbacks||[],result:'失败或未确认：'+e.message});throw e;}
                await sleep(250);
            }
            status('清理已完成并核对；改名成功并回读确认'+state.logs.filter(r=>r.result==='成功且已回读确认').length+'项。刷新115查看；再次操作请重新扫描。');
        }catch(e){runError=e.message;status('已停止：'+e.message+'；已完成操作不会自动回滚，详见结果日志。');}
        finally{
            download('115改名结果-'+Date.now()+'.json',{version:VERSION,createdAt:new Date().toISOString(),logs:state.logs,cleanupLogs:state.cleanupLogs,cleanup:cleanupBackup(),failed:[...failed]});
            state.issueContext={phase:'execute',executed:true,error:runError};
            const report=exportIssues();
            status(el('status-text').textContent+(report?'；异常/待确认'+report.issues.length+'项，已单独触发JSON下载。':'；无异常，不生成异常JSON。'));
            state.busy=false;el('scan').disabled=false;refreshIssueButton();updateTaskProgress();
        }
    }
    const bind=(action,handler)=>el(action).addEventListener('click',event=>{
        event.preventDefault();event.stopPropagation();
        try{Promise.resolve(handler()).catch(error=>status('操作异常：'+(error.message||String(error))));}
        catch(error){status('操作异常：'+(error.message||String(error)));}
    });
    bind('scan',scan);bind('run',run);
    bind('backup',()=>download('115原名与预览-'+Date.now()+'.json',backup()));
    bind('issues',()=>{if(!state.busy&&!exportIssues())status('当前没有异常或待人工确认项，不生成异常JSON。');});
    bind('stop',()=>{state.cancel=true;status('已请求停止；当前网络请求结束后停止。');});
    launcher.addEventListener('click',event=>{event.preventDefault();event.stopPropagation();setPanelOpen(true);});
    bind('toggle',()=>setPanelOpen(false));
    bind('detect',()=>{if(refreshCompatibility())status('已检测到115旧版，请先选中文件夹，再扫描预览。');});
    window.addEventListener('popstate',()=>{if(!panel.hidden)refreshCompatibility();});
    window.addEventListener('hashchange',()=>{if(!panel.hidden)refreshCompatibility();});
    status('插件已就绪；请先选中文件夹，再点“联网扫描并预览”。');
    (document.body||document.documentElement).appendChild(mount);
    setPanelOpen(false);
})();
