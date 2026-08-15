#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
const root=resolve(import.meta.dirname,'../..');
const manifest=JSON.parse(readFileSync(resolve(root,'tests/visual-regression/routes.json'),'utf8'));
const args=process.argv.slice(2);
const value=(flag,fallback)=>{const i=args.indexOf(flag);return i>=0?args[i+1]:fallback};
let files=[];
const fileList=value('--files','');
if(fileList) files=readFileSync(resolve(fileList),'utf8').split(/\r?\n/).filter(Boolean);
else {
  const base=value('--base',process.env.GITHUB_BASE_SHA||'HEAD^');
  const head=value('--head',process.env.GITHUB_SHA||'HEAD');
  files=execFileSync('git',['diff','--name-only',base,head],{cwd:root,encoding:'utf8'}).split(/\r?\n/).filter(Boolean);
}
const force=args.includes('--all')||process.env.TRACEPILOT_VISUAL_ALL==='1';
const broad=[
  /^package(?:-lock)?\.json$/, /^pnpm-lock\.yaml$/, /^vite\.config/, /^apps\/[^/]+\/src\/(?:App|main)\./,
  /\/router\//, /\/(?:styles|theme|tokens)\//, /\.(?:css|scss|less)$/, /^packages\/ui\//,
  /\/(?:components|composables)\/(?:common|shared|layout|navigation|modal|drawer)/i,
  /^apps\/[^/]+\/src-tauri\//
];
let selected=[];
if(force||files.some(f=>broad.some(re=>re.test(f)))) selected=[...manifest.routes];
else {
  const changedNames=new Set(files.map(f=>basename(f).replace(/\.[^.]+$/,'')));
  selected=manifest.routes.filter(r=>{
    if(!r.component) return false;
    const name=basename(r.component).replace(/\.[^.]+$/,'');
    return changedNames.has(name)||files.some(f=>f.includes(r.component.replace(/^@\//,'')));
  });
}
// Changes to feature code with no precise mapping are safer as all routes; docs-only changes select none.
if(!selected.length && files.some(f=>!/^(?:docs\/|\.github\/|.*\.md$)/.test(f))) selected=[...manifest.routes];
const out={schema_version:1,changed_files:files,scope:selected.length===manifest.routes.length?'all':selected.length?'affected':'none',routes:selected};
const output=value('--output','artifacts/visual-regression/affected-routes.json');
writeFileSync(resolve(root,output),JSON.stringify(out,null,2)+'\n');
console.log(`Visual scope: ${out.scope}; ${selected.length}/${manifest.routes.length} routes`);
