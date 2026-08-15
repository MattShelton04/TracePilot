#!/usr/bin/env node
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
const args=process.argv.slice(2); const val=(f,d)=>{const i=args.indexOf(f);return i>=0?args[i+1]:d};
const base=resolve(val('--base','artifacts/visual-regression/base'));
const head=resolve(val('--head','artifacts/visual-regression/head'));
const out=resolve(val('--output','artifacts/visual-regression/report')); mkdirSync(out,{recursive:true});
const b=JSON.parse(readFileSync(join(base,'manifest.json'),'utf8')); const h=JSON.parse(readFileSync(join(head,'manifest.json'),'utf8'));
const bm=new Map(b.results.map(x=>[`${x.id}:${x.viewport}`,x])); const rows=[];
for(const item of h.results){
 const key=`${item.id}:${item.viewport}`, before=bm.get(key); let mismatch=null,diff=null;
 if(before?.screenshot&&item.screenshot&&existsSync(join(base,before.screenshot))){
  const a=PNG.sync.read(readFileSync(join(base,before.screenshot))), z=PNG.sync.read(readFileSync(join(head,item.screenshot)));
  if(a.width===z.width&&a.height===z.height){const d=new PNG({width:a.width,height:a.height});const n=pixelmatch(a.data,z.data,d.data,a.width,a.height,{threshold:.1,includeAA:false});mismatch=n/(a.width*a.height);diff=`${item.id}-${item.viewport}-diff.png`;writeFileSync(join(out,diff),PNG.sync.write(d));}
 }
 rows.push({id:item.id,title:item.title,path:item.path,viewport:item.viewport,before:before?.screenshot||null,after:item.screenshot||null,diff,mismatch,status:item.status});
}
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const html=`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>TracePilot visual review</title><style>body{font:14px system-ui;margin:0;background:#0b0e14;color:#eef2ff}header{padding:24px;position:sticky;top:0;background:#111827eF;z-index:2}main{padding:24px;display:grid;gap:28px}.card{border:1px solid #334155;border-radius:12px;overflow:hidden;background:#111827}.meta{padding:14px}.grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:1px;background:#334155}.pane{background:#0f172a;padding:8px}.pane img{width:100%;display:block}.empty{aspect-ratio:16/10;display:grid;place-items:center;color:#94a3b8}@media(max-width:900px){.grid{grid-template-columns:1fr}}</style></head><body><header><h1>TracePilot before/after visual review</h1><p>${rows.length} route/viewport captures. Images are live Playwright renders; no documentation-image fallback.</p></header><main>${rows.map(r=>`<article class="card"><div class="meta"><strong>${esc(r.title)}</strong> <code>${esc(r.path)}</code> · ${esc(r.viewport)} · mismatch ${r.mismatch==null?'n/a':(r.mismatch*100).toFixed(3)+'%'}</div><div class="grid">${[['Before',r.before&&`../base/${r.before}`],['After',r.after&&`../head/${r.after}`],['Diff',r.diff]].map(([l,s])=>`<section class="pane"><h2>${l}</h2>${s?`<img loading="lazy" src="${esc(s)}" alt="${esc(l)} ${esc(r.title)}">`:'<div class="empty">Not available</div>'}</section>`).join('')}</div></article>`).join('')}</main></body></html>`;
writeFileSync(join(out,'index.html'),html);writeFileSync(join(out,'summary.json'),JSON.stringify({schema_version:1,rows},null,2)+'\n');
console.log(`Visual report: ${join(out,'index.html')}`);
