import { readFile,writeFile,mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { spawn,execFileSync } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const P=import.meta.dirname,S='D:/VSCode Projects/node-platform/.worktrees/project-consolidation-20260904',C='C:/Users/hshum/AppData/Local/Temp/nodekit-factory-acceptance-zswER5/measured-journey/domain-blank-base',out=path.join(P,'E3e-nodekit-factory-independent-browser');
await mkdir(out,{recursive:true});
const {chromium}=createRequire(path.join(C,'package.json'))('playwright');
const {computeNodeKitSourceHash}=await import(pathToFileURL(path.join(S,'src/lib/source-hash.mjs')).href);
const sha=b=>createHash('sha256').update(b).digest('hex');
const canonical=x=>Array.isArray(x)?`[${x.map(canonical).join(',')}]`:x&&typeof x==='object'?`{${Object.keys(x).sort().map(k=>`${JSON.stringify(k)}:${canonical(x[k])}`).join(',')}}`:JSON.stringify(x);
const hash=x=>sha(canonical(x));
const git=(root,...args)=>execFileSync('git',['--no-optional-locks','-C',root,...args]);
const snapshot=()=>({sourceHead:git(S,'rev-parse','HEAD').toString().trim(),sourceIndex:sha(git(S,'ls-files','--stage','-z')),sourceStatus:sha(git(S,'status','--porcelain=v1','--untracked-files=all')),consumerHead:git(C,'rev-parse','HEAD').toString().trim(),consumerIndex:sha(git(C,'ls-files','--stage','-z')),consumerStatus:sha(git(C,'status','--porcelain=v1','--untracked-files=all'))});
const report={proof:'NODEKIT-GOVERNANCE-CURRENT-PACKAGE-INDEPENDENT-DOWNLOAD',startedAt:new Date().toISOString(),checks:[],captures:[],consoleErrors:[],pageErrors:[],failedRequests:[],blocked:[],before:snapshot(),passed:false};
const check=(ok,name)=>{report.checks.push({name,passed:!!ok});if(!ok)throw Error(name);};
let server,browser,serverOutput='';const base='http://127.0.0.1:4977';
const safe=new Set(['PATH','SYSTEMROOT','WINDIR','COMSPEC','PATHEXT','PROGRAMFILES','PROGRAMFILES(X86)','PROGRAMW6432','SYSTEMDRIVE','USERPROFILE','APPDATA','LOCALAPPDATA','ALLUSERSPROFILE','HOMEDRIVE','HOMEPATH','NUMBER_OF_PROCESSORS','PROCESSOR_ARCHITECTURE','TEMP','TMP']);
const env=Object.fromEntries(Object.entries(process.env).filter(([k])=>safe.has(k.toUpperCase())));env.PORT='4977';env.HOST='127.0.0.1';
async function capture(page,name){const html=await page.content();const state=await page.evaluate(()=>({url:location.href,scenario:document.body.dataset.scenario,width:innerWidth,height:innerHeight,overflow:document.documentElement.scrollWidth-innerWidth,focused:document.activeElement.id}));check(state.overflow<=1,name+' has no page overflow');await page.screenshot({path:path.join(out,name+'.png'),caret:'initial'});check(await page.content()===html,name+' capture DOM preserved');await writeFile(path.join(out,name+'.html'),html);await writeFile(path.join(out,name+'.json'),JSON.stringify(state,null,2));report.captures.push({name,state,pngSha256:sha(await readFile(path.join(out,name+'.png')))});}
async function makeContext(){const ctx=await browser.newContext({viewport:{width:390,height:844},colorScheme:'light',acceptDownloads:true});await ctx.route('**/*',route=>{if(new URL(route.request().url()).origin!==base){report.blocked.push(route.request().url());return route.abort();}return route.continue();});const page=await ctx.newPage();page.setDefaultTimeout(10000);page.on('console',m=>{if(m.type()==='error')report.consoleErrors.push(m.text());});page.on('pageerror',e=>report.pageErrors.push(e.message));page.on('requestfailed',r=>report.failedRequests.push({url:r.url(),failure:r.failure()}));return {ctx,page};}
async function verify(bundle,page,outcome){
 check(bundle.schemaVersion==='nodekit.portable-proof-bundle/v1'&&bundle.receipt.schemaVersion==='nodekit.receipt/v2','download uses current portable receipt schemas');
 check(bundle.case.caseId===bundle.run.caseId&&bundle.run.runId===bundle.receipt.runId,'case/run/receipt IDs agree');
 const a=bundle.artifact,v=a.versions.find(v=>v.version===a.canonicalVersion),b=bundle.receipt.artifactBindings.find(v=>v.artifactId===a.artifactId);
 check(v.contentHash===hash(v.content)&&v.content.outcome===outcome,'actual downloaded canonical content hash and exact entered outcome agree');
 check(b.canonicalVersion===a.canonicalVersion&&b.contentHash===v.contentHash,'receipt binds actual canonical version and hash');
 const {receiptId,receiptHash,...body}=bundle.receipt;
 check(receiptId&&receiptHash===hash(body)&&bundle.receipt.caseHash===hash(bundle.case)&&bundle.receipt.runHash===hash(bundle.run),'independent receipt/case/run hashes agree');
 const attrs=await page.locator('#artifact').evaluate(e=>['type','id','version','content-sha256'].map(k=>e.getAttribute('data-nodekit-artifact-'+k)));
 check(JSON.stringify(attrs)===JSON.stringify([a.kind,a.artifactId,String(a.canonicalVersion),v.contentHash]),'rendered artifact identity equals downloaded actual owner');
 check(await page.locator('[data-nodekit-confirmed-outcome]').textContent()===outcome,'rendered confirmed outcome equals downloaded raw text');
}
try{
 report.nodekitSourceHash=await computeNodeKitSourceHash(S);check(report.nodekitSourceHash==='cbd062964a7ada1774848f31408f2ffa3fc2953cfa28a096d398cb116810bf64','actual current package source hash recomputed');
 server=spawn(process.execPath,['apps/web/server.mjs'],{cwd:C,env,windowsHide:true,stdio:['ignore','pipe','pipe']});server.stdout.on('data',b=>serverOutput+=b);server.stderr.on('data',b=>serverOutput+=b);
 let ready=false;for(let i=0;i<50;i++){try{if((await fetch(base+'/api/state')).ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,100));}check(ready,'own installed consumer server ready');
 browser=await chromium.launch({headless:true});report.browser=browser.version();let {ctx,page}=await makeContext();await page.goto(base);await page.locator('#case-title').waitFor();await capture(page,'arrival-390');
 const outcome='  Review supplier “茶” <sample> & preserve €42.50 in the handoff.  ';await page.locator('#outcome').fill(outcome);await page.locator('#primary-input button').click();await page.locator('body[data-scenario="running"]').waitFor();
 const initial=await (await fetch(base+'/api/state')).json();await page.locator('#propose').click();await page.locator('body[data-scenario="proposal_pending"]').waitFor();await page.locator('#reject').click();await page.locator('body[data-scenario="proposal_rejected"]').waitFor();const rejected=await (await fetch(base+'/api/state')).json();check(hash(initial.artifact)===hash(rejected.artifact)&&rejected.receipt===null,'real reject preserves accepted artifact and creates no receipt');
 await page.locator('#propose').click();await page.locator('#approve').click();await page.locator('#completion').waitFor({state:'visible'});await capture(page,'accepted-390');
 const downloadPromise=page.waitForEvent('download');await page.locator('#download-proof').click();const download=await downloadPromise;await download.saveAs(path.join(out,'actual-downloaded-proof.json'));check(download.suggestedFilename()==='nodekit-proof.json','actual browser download uses portable proof filename');const bundle=JSON.parse(await readFile(path.join(out,'actual-downloaded-proof.json'),'utf8'));await verify(bundle,page,outcome);
 await page.reload();await page.locator('#receipt-id').waitFor();await verify(bundle,page,outcome);await ctx.close();({ctx,page}=await makeContext());await page.goto(base);await page.locator('#receipt-id').waitFor();await verify(bundle,page,outcome);await capture(page,'fresh-context-390');await ctx.close();
 check(report.consoleErrors.length===0&&report.pageErrors.length===0&&report.failedRequests.length===0&&report.blocked.length===0,'no console/page/network errors or external requests');
 report.after=snapshot();check(JSON.stringify(report.before)===JSON.stringify(report.after),'source and actual consumer Git/index/status preserved');check(await computeNodeKitSourceHash(S)===report.nodekitSourceHash,'current package source hash unchanged after browser proof');report.passed=true;
}catch(e){report.failure={message:e.message,stack:e.stack};process.exitCode=1;}
finally{if(browser)await browser.close();if(server&&!server.killed){server.kill();await new Promise(r=>server.once('exit',r));}await writeFile(path.join(out,'server.log'),serverOutput);report.finishedAt=new Date().toISOString();await writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({passed:report.passed,checks:report.checks.length,captures:report.captures.length,failure:report.failure?.message}));}
