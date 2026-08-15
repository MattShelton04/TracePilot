#!/usr/bin/env node
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
const args=process.argv.slice(2), val=(f,d)=>{const i=args.indexOf(f);return i>=0?args[i+1]:d};
const capture=resolve(val('--capture','artifacts/visual-regression/head'));
const output=resolve(val('--output','artifacts/visual-regression/storyboard'));
mkdirSync(output,{recursive:true});
const m=JSON.parse(readFileSync(join(capture,'manifest.json'),'utf8'));
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const rows=m.results.filter(x=>x.screenshot);
const html=`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>TracePilot application storyboard</title><style>body{font:14px system-ui;margin:0;background:#0b0e14;color:#eef2ff}header{padding:28px;position:sticky;top:0;background:#0b0e14ef;z-index:2}main{padding:24px;display:grid;grid-template-columns:repeat(auto-fit,minmax(380px,1fr));gap:20px}article{background:#111827;border:1px solid #334155;border-radius:12px;overflow:hidden}h2,p{margin:0}.meta{padding:14px;display:grid;gap:5px}img{width:100%;display:block;background:#020617}</style></head><body><header><h1>TracePilot application storyboard</h1><p>${rows.length} live route captures generated ${esc(m.generated_at)}. These are not copied from <code>docs/images</code>.</p></header><main>${rows.map(r=>`<article><div class="meta"><h2>${esc(r.title)}</h2><p><code>${esc(r.path)}</code> · ${esc(r.viewport)}</p></div><img loading="lazy" src="../head/${esc(r.screenshot)}" alt="${esc(r.title)} application view"></article>`).join('')}</main></body></html>`;
writeFileSync(join(output,'index.html'),html);console.log(`Storyboard: ${join(output,'index.html')}`);
