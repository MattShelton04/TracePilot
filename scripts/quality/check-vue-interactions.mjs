#!/usr/bin/env node
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
const root=resolve(import.meta.dirname,'../..');
const ignored=new Set(['.git','node_modules','target','dist','coverage','artifacts']);
const files=[];const queue=[root];
while(queue.length){const d=queue.shift();for(const e of readdirSync(d,{withFileTypes:true})){
  if(ignored.has(e.name))continue;const p=join(d,e.name);if(e.isDirectory())queue.push(p);else if(e.name.endsWith('.vue'))files.push(p);
}}
const errors=[],warnings=[];
const lineAt=(s,i)=>s.slice(0,i).split('\n').length;
for(const file of files){const source=readFileSync(file,'utf8');const template=source.match(/<template(?:\s[^>]*)?>([\s\S]*?)<\/template>/i)?.[1]||source;const name=relative(root,file);
  for(const m of template.matchAll(/<button\b[^>]*>/gi))if(!/\btype\s*=/.test(m[0]))errors.push(`${name}:${lineAt(source,source.indexOf(m[0]))} native <button> requires an explicit type`);
  for(const m of template.matchAll(/\btabindex\s*=\s*["']([1-9]\d*)["']/gi))errors.push(`${name}:${lineAt(source,source.indexOf(m[0]))} positive tabindex is not permitted`);
  for(const m of template.matchAll(/<(div|span|li|tr|td|th|g|path|svg)\b([^>]*(?:@click|v-on:click)[^>]*)>/gi)){
    const [tag,attrs]=[m[1].toLowerCase(),m[2]];const before=template.slice(Math.max(0,m.index-220),m.index);
    if(/interaction-policy:\s*allow-click-delegation/.test(before))continue;
    const role=attrs.match(/\brole\s*=\s*["']([^"']+)["']/i)?.[1]||'';
    const semantic=/^(button|link|tab|option|checkbox|radio|switch|menuitem|treeitem|row|gridcell)$/.test(role);
    const keyboard=/(?:@|v-on:)(?:key(?:down|up)|keydown|keyup)(?:\.[\w-]+)*\s*=/.test(attrs);
    const roving=/\btabindex\s*=|\baria-(?:selected|checked|expanded)\s*=/.test(attrs);
    if(!semantic)errors.push(`${name}:${lineAt(source,source.indexOf(m[0]))} <${tag}> has pointer activation without an interactive role`);
    else if(!keyboard&&!roving)errors.push(`${name}:${lineAt(source,source.indexOf(m[0]))} role=${role} click target needs keyboard or roving-focus semantics`);
  }
  // High-confidence nested native controls; component-level nesting is covered by rendered tests.
  const nativeStack=[];
  for(const m of template.matchAll(/<(\/?)(button|a)\b([^>]*)>/gi)){
    const closing=m[1]==='/'; const tag=m[2].toLowerCase(); const selfClosing=/\/\s*>$/.test(m[0]);
    if(closing){for(let i=nativeStack.length-1;i>=0;i--){if(nativeStack[i]===tag){nativeStack.splice(i,1);break}}continue}
    if(nativeStack.length)errors.push(`${name}:${lineAt(source,source.indexOf(m[0]))} nested native interactive controls are invalid`);
    if(!selfClosing)nativeStack.push(tag);
  }
}
if(warnings.length)console.warn(warnings.join('\n'));
if(errors.length){console.error(`Vue interaction policy failed with ${errors.length} issue(s):\n${errors.map(x=>`- ${x}`).join('\n')}`);process.exit(1)}
console.log(`Vue interaction policy OK: ${files.length} components`);
