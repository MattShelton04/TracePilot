#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
const root=resolve(import.meta.dirname,'../..');
const manifest=JSON.parse(readFileSync(resolve(root,'tests/visual-regression/routes.json'),'utf8'));
const source=readFileSync(resolve(root,manifest.generated_from));
const actual=createHash('sha256').update(source).digest('hex');
const errors=[];
if(actual!==manifest.source_sha256) errors.push(`Production router changed (${manifest.generated_from}); run pnpm routes:generate`);
if(!Array.isArray(manifest.routes)||manifest.routes.length===0) errors.push('Route catalogue is empty');
const ids=new Set(), paths=new Set();
for(const route of manifest.routes){
  if(!route.path?.startsWith('/')) errors.push(`Invalid route path: ${route.path}`);
  if(ids.has(route.id)) errors.push(`Duplicate route identity: ${route.id}`); ids.add(route.id);
  if(paths.has(route.path)) errors.push(`Duplicate route path: ${route.path}`); paths.add(route.path);
}
if(errors.length){ console.error(errors.map(x=>`- ${x}`).join('\n')); process.exit(1); }
console.log(`Route catalogue OK: ${manifest.routes.length} routed views`);
