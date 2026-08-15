#!/usr/bin/env node
import { chromium } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import http from 'node:http';
const scriptRoot=resolve(import.meta.dirname,'../..');
const args=process.argv.slice(2);
const val=(f,d)=>{const i=args.indexOf(f);return i>=0?args[i+1]:d};
const repo=resolve(val('--repo',scriptRoot));
const output=resolve(val('--output',join(scriptRoot,'artifacts/visual-regression/current')));
const routesFile=resolve(val('--routes',join(scriptRoot,'tests/visual-regression/routes.json')));
const port=Number(val('--port','4173'));
const allowMissing=args.includes('--allow-missing-routes');
const viewportName=val('--viewport','desktop');
const viewport=viewportName==='mobile'?{width:390,height:844}:{width:1440,height:1000};
mkdirSync(output,{recursive:true});
const routeDoc=JSON.parse(readFileSync(routesFile,'utf8'));
const routes=routeDoc.routes||[];
function findVitePackage(root){
  const queue=[root];
  while(queue.length){
    const d=queue.shift();
    for(const e of readdirSync(d,{withFileTypes:true})){
      if(['.git','node_modules','target','dist','artifacts'].includes(e.name)) continue;
      const p=join(d,e.name);
      if(e.isDirectory()){ if(p.split('/').length-root.split('/').length<5) queue.push(p); continue; }
      if(e.name!=='package.json') continue;
      try{ const j=JSON.parse(readFileSync(p,'utf8')); const all={...j.dependencies,...j.devDependencies};
        if(all.vite && (all.vue||all['@vitejs/plugin-vue']) && statSync(dirname(p)).isDirectory()) return dirname(p);
      }catch{}
    }
  }
  throw new Error(`Unable to locate the Vite/Vue package under ${root}`);
}
const appDir=findVitePackage(repo);
const pnpm=process.env.PNPM_BIN||process.env.npm_execpath||'pnpm';
const child=spawn(pnpm,['--dir',appDir,'exec','vite','--host','127.0.0.1','--port',String(port),'--strictPort'],{
  cwd:repo,env:{...process.env,VITE_TRACEPILOT_E2E:'1',VITE_E2E:'1',NODE_ENV:'test'},stdio:['ignore','pipe','pipe']
});
let serverLog=''; child.stdout.on('data',d=>serverLog+=d); child.stderr.on('data',d=>serverLog+=d);
const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function waitForServer(){
  const end=Date.now()+60000;
  while(Date.now()<end){
    if(child.exitCode!==null) throw new Error(`Vite exited ${child.exitCode}\n${serverLog}`);
    const ok=await new Promise(resolve=>{const req=http.get(`http://127.0.0.1:${port}/`,r=>{r.resume();resolve(r.statusCode<500)});req.on('error',()=>resolve(false));req.setTimeout(1000,()=>{req.destroy();resolve(false)});});
    if(ok)return; await wait(250);
  }
  throw new Error(`Vite did not become ready\n${serverLog}`);
}
const initMock=()=>{
  const callbacks=new Map(); let callbackId=1;
  const emptyStats={total:0,count:0,tokens:0,cost:0,duration_ms:0,items:[],series:[],breakdown:[],by_day:[],by_model:[],by_provider:[]};
  const hybrid=()=>Object.assign([],emptyStats,{status:'idle',state:'idle',ready:true,running:false,progress:0,data:[],results:[],rows:[],columns:[],sessions:[],projects:[],repositories:[]});
  const invoke=async(command,args={})=>{
    const c=String(command).replace(/^plugin:[^|]+\|/,'').toLowerCase();
    if(c==='open'||c==='save') return null;
    if(c==='listen'||c.endsWith('_listen')) return 1;
    if(c==='unlisten'||c.endsWith('_unlisten')||c==='emit') return null;
    if(c.includes('app_info')) return {name:'TracePilot',version:'0.0.0-e2e',tauri_version:'2-e2e'};
    if(c.includes('version')) return '0.0.0-e2e';
    if(/^(is_|has_|can_|should_)/.test(c)||/(exists|enabled|available|installed|configured)$/.test(c)) return false;
    if(/^(count_|total_)/.test(c)||/(count|size)$/.test(c)) return 0;
    if(/^(list_|search_|query_|recent_|load_all|read_dir|entries)/.test(c)||/(sessions|projects|repositories|worktrees|skills|servers|models|providers|events|messages|files|branches|commits|tags|todos)$/.test(c)) return [];
    if(/(stats|statistics|summary|metrics|analytics|usage|breakdown|overview)/.test(c)) return {...emptyStats};
    if(/(settings|preferences|configuration|config)$/.test(c)) return hybrid();
    if(/(status|state|health)$/.test(c)) return {status:'idle',state:'idle',ready:true,running:false,progress:0};
    if(/(path|directory|folder)$/.test(c)) return null;
    if(/^(create_|update_|set_|save_|delete_|remove_|cancel_|start_|stop_|open_|close_|reveal_|copy_)/.test(c)) return null;
    return hybrid();
  };
  const internals={
    invoke,
    transformCallback(callback,once=false){const id=callbackId++;callbacks.set(id,{callback,once});window[`_${id}`]=(payload)=>{const x=callbacks.get(id);if(!x)return;x.callback(payload);if(x.once)callbacks.delete(id)};return id;},
    unregisterCallback(id){callbacks.delete(id);delete window[`_${id}`]},
    convertFileSrc(path){return String(path)},
    metadata:{currentWindow:{label:'main'},currentWebview:{label:'main',windowLabel:'main'}}
  };
  Object.defineProperty(window,'__TAURI_INTERNALS__',{value:internals,configurable:true});
  Object.defineProperty(window,'__TRACEPILOT_E2E__',{value:{invoke},configurable:true});
};
let browser;
const results=[];
try{
  await waitForServer();
  browser=await chromium.launch({headless:true});
  const context=await browser.newContext({viewport,colorScheme:'dark',locale:'en-AU',timezoneId:'Australia/Sydney',reducedMotion:'reduce',deviceScaleFactor:1});
  await context.addInitScript(initMock);
  for(const route of routes){
    const page=await context.newPage(); const errors=[];
    page.on('console',m=>{if(m.type()==='error')errors.push(`console: ${m.text()}`)});
    page.on('pageerror',e=>errors.push(`pageerror: ${e.message}`));
    const item={...route,viewport:viewportName,url:`http://127.0.0.1:${port}${route.path}`,screenshot:null,errors:[],accessibility:[]};
    try{
      await page.goto(item.url,{waitUntil:'domcontentloaded',timeout:30000});
      await page.waitForTimeout(900);
      const identity=await page.locator('[data-route-id],[data-route-name],[data-page-id],html[data-route-id],body[data-route-id]').evaluateAll(nodes=>nodes.map(n=>({
        routeId:n.getAttribute('data-route-id'),routeName:n.getAttribute('data-route-name'),pageId:n.getAttribute('data-page-id')})));
      const candidates=[route.id,route.name,route.path].map(x=>String(x).toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,''));
      const rendered=identity.some(x=>Object.values(x).some(v=>v&&candidates.includes(String(v).toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,''))));
      if(!rendered) throw new Error(`Expected stable route identity for ${route.path}; found ${JSON.stringify(identity)}`);
      const body=(await page.locator('body').innerText()).slice(0,3000);
      if(/(?:404|page not found|route not found)/i.test(body)) throw new Error(`Fallback/Not Found content rendered for ${route.path}`);
      const file=`${route.id}-${viewportName}.png`;
      await page.screenshot({path:join(output,file),fullPage:true,animations:'disabled'}); item.screenshot=file;
      const axe=await new AxeBuilder({page}).disableRules(['color-contrast']).analyze();
      item.accessibility=axe.violations.filter(v=>['serious','critical'].includes(v.impact||''));
      if(item.accessibility.length) throw new Error(`${item.accessibility.length} serious/critical accessibility violations`);
      item.errors=errors;
      if(errors.length) throw new Error(errors.join('\n'));
      item.status='passed';
    }catch(error){
      if(!item.screenshot){try{const file=`${route.id}-${viewportName}-failure.png`;await page.screenshot({path:join(output,file),fullPage:true,animations:'disabled'});item.screenshot=file}catch{}}
      item.status='failed';item.errors=[...errors,String(error?.stack||error)]; if(!allowMissing) results.push(item); else {item.status='missing';results.push(item);}
    }
    if(!results.includes(item))results.push(item);
    await page.close();
  }
}finally{
  if(browser)await browser.close();
  child.kill('SIGTERM'); await Promise.race([new Promise(r=>child.once('exit',r)),wait(3000)]); if(child.exitCode===null)child.kill('SIGKILL');
  writeFileSync(join(output,'server.log'),serverLog);
  writeFileSync(join(output,'manifest.json'),JSON.stringify({schema_version:1,repo,viewport:viewportName,generated_at:new Date().toISOString(),results},null,2)+'\n');
}
const failed=results.filter(x=>x.status==='failed');
console.log(`Captured ${results.filter(x=>x.status==='passed').length}/${results.length} ${viewportName} routes to ${output}`);
if(failed.length){console.error(failed.map(x=>`${x.path}: ${x.errors.at(-1)}`).join('\n'));process.exit(1)}
