import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
const root=resolve(import.meta.dirname,'../..');
const manifest=JSON.parse(readFileSync(resolve(root,'tests/visual-regression/routes.json'),'utf8'));
function scope(files){const d=mkdtempSync(join(tmpdir(),'tracepilot-routes-')),input=join(d,'changed.txt'),output=join(d,'out.json');writeFileSync(input,files.join('\n')+'\n');execFileSync('node',['scripts/visual-regression/affected-routes.mjs','--files',input,'--output',output],{cwd:root});return JSON.parse(readFileSync(output,'utf8'));}
test('documentation-only changes do not launch browser captures',()=>{const x=scope(['docs/quality/readme.md']);assert.equal(x.scope,'none');assert.equal(x.routes.length,0)});
test('global style changes capture every routed view',()=>{const x=scope(['apps/desktop/src/styles/global.css']);assert.equal(x.scope,'all');assert.equal(x.routes.length,manifest.routes.length)});
test('unknown feature changes fail safe to every routed view',()=>{const x=scope(['apps/desktop/src/features/new-feature/logic.ts']);assert.equal(x.scope,'all');assert.equal(x.routes.length,manifest.routes.length)});
test('route component changes are scoped when the component is statically known',()=>{const route=manifest.routes.find(r=>r.component&&r.component.includes('/'));if(!route)return;const x=scope([`apps/desktop/src/${route.component.replace(/^@\//,'').replace(/^\.\//,'')}.vue`]);assert.ok(x.routes.some(r=>r.id===route.id));});
