import pathlib,json,hashlib,subprocess,tarfile,io,struct,datetime
P=pathlib.Path(__file__).parent;S=pathlib.Path('D:/VSCode Projects/node-platform/.worktrees/project-consolidation-20260904');q=json.loads((P/'E3e_NODEKIT_CURRENT_FACTORY_RECEIPT.json').read_text());R=pathlib.Path(q['retained']);O=pathlib.Path(q['original']);C=O/'measured-journey/domain-blank-base';F=R/'source/proof/ease/latest';f=q['factoryReceipt']
def h(b):return hashlib.sha256(b).hexdigest()
def sha(p):return h(p.read_bytes())
def j(p):return json.loads(p.read_text(encoding='utf-8-sig'))
def digest(v):return h(json.dumps(v,ensure_ascii=False,separators=(',',':')).encode())
def git(root,*args):return subprocess.check_output(['git','--no-optional-locks','-C',str(root),*args])
checks=[]
def check(name,ok,details=None):
 checks.append({'name':name,'passed':bool(ok),'details':details})
 if not ok:raise AssertionError(name)
check('source HEAD exact',git(S,'rev-parse','HEAD').decode().strip()==q['sourceCommit'])
check('current and durable receipt exact raw bytes',sha(P/'E3e_NODEKIT_CURRENT_FACTORY_RECEIPT.json')==sha(R/'manifest.json'))
check('1675 durable files exact hash and length',len(q['files'])==1675 and all(sha(R/p)==v['sha256'] and (R/p).stat().st_size==v['bytes'] for p,v in q['files'].items()),sum(v['bytes'] for v in q['files'].values()))
check('1675 originals still equal retained snapshot',all(sha((O/p.removeprefix('original/')) if p.startswith('original/') else (S/p.removeprefix('source/')))==v['sha256'] for p,v in q['files'].items()))
package=O/'candidate-package/homenshum-nodekit-0.2.1.tgz'
check('current tarball exact identity and size',sha(package)==q['tarballSha256']==f['nodekitTarballSha256'] and package.stat().st_size==834557)
packed={}
with tarfile.open(package,'r:gz') as a:
 for m in a.getmembers():
  if m.isdir():continue
  check('archive member regular owned path '+m.name,m.isfile() and m.name.startswith('package/') and '..' not in pathlib.PurePosixPath(m.name).parts)
  p=m.name.removeprefix('package/');b=a.extractfile(m).read();packed[p]=h(b)
  assert b==(S/p).read_bytes()==git(S,'show',q['sourceCommit']+':'+p)
  for lane in ['launcher','domain-blank-base']:
   assert b==(O/'measured-journey'/lane/'node_modules/@homenshum/nodekit'/p).read_bytes()==(R/'original/measured-journey'/lane/'node_modules/@homenshum/nodekit'/p).read_bytes()
check('421 package files match current committed source and both original/durable installations',packed==q['sourcePackageAndTwoInstallationsExact'] and len(packed)==421)
receipt=j(S/'proof/factory-acceptance.json');body=dict(receipt);rd=body.pop('receiptDigest')
check('factory receipt canonical insertion-order digest independently recomputed',digest(body)==rd==f['receiptDigest'])
check('factory raw receipt and copied manifest agree',receipt==f==j(F/'manifest.json') and sha(S/'proof/factory-acceptance.json')==sha(R/'source/proof/factory-acceptance.json'))
check('13 base checks, ordinary run limits honest',len(f['base']['checks'])==13 and all(f['base']['checks'].values()) and f['passed'] and not f['submissionReady'] and f['verdict']=='EASE_NOT_CERTIFIED' and f['cacheClass']=='warm-or-unknown' and not f['cacheIsolated'] and f['durationMs']==178511)
check('all spawned measured phase exits and packaging pass',all(p['exitCode']==0 and not p['failed'] for p in f['base']['phases'] if 'exitCode' in p) and f['packagingPhase']['exitCode']==0,sum('exitCode' in p for p in f['base']['phases']))
check('consumer actual Git commit bound',git(C,'rev-parse','HEAD').decode().strip()==f['base']['candidateCommit'])
archive=F/'candidate.tar.gz'
check('generated candidate archive exact hash and size',sha(archive)==f['generatedCandidateArchiveSha256'] and archive.stat().st_size==f['generatedCandidateArchiveBytes'])
archivePaths=[];generatedChanges=[]
with tarfile.open(archive,'r:gz') as a:
 for m in a.getmembers():
  if not m.isfile():continue
  assert '..' not in pathlib.PurePosixPath(m.name).parts
  b=a.extractfile(m).read();assert b==git(C,'show','HEAD:'+m.name);working=(C/m.name).read_bytes();archivePaths.append(m.name)
  if b!=working:
   generatedChanges.append({'path':m.name,'archiveSha256':h(b),'workingSha256':h(working),'archiveBytes':len(b),'workingBytes':len(working)})
   assert m.name=='proof/build-friction.json'
   priorFriction=json.loads(b);currentFriction=json.loads(working);priorEvents=priorFriction.pop('events');currentEvents=currentFriction.pop('events')
   assert priorFriction==currentFriction and currentEvents[:len(priorEvents)]==priorEvents
   assert [e['name'] for e in currentEvents[len(priorEvents):]]==['tests_passed','deterministic_demo_passed','eval_passed','browser_contract_completed','proof_passed']
check('all 77 generated Git archive files exact to commit; 76 current bytes identical, one expected appended friction receipt',len(generatedChanges)==1,generatedChanges)
check('consumer tracked delta only known normal generated friction receipt',git(C,'diff','--name-only').decode().splitlines()==['proof/build-friction.json'] and not git(C,'diff','--cached','--name-only').strip())
proof=j(C/'proof/release-proof.json');identity=j(C/'.nodeagent/application-identity.json');cert=j(C/'proof/browser-certification.json');mb=dict(cert);md=mb.pop('manifestSha256')
check('browser certificate raw equals consumer run and primary/durable latest',cert==j(F/'browser/screenshot-manifest.json')==j(C/'proof/ease'/f['runId']/'browser/screenshot-manifest.json'))
check('browser manifest digest independently recomputed',digest(mb)==md==f['base']['browserManifestDigest'])
check('release proof digest and current identity bound',digest(proof)==f['base']['proofDigest'] and proof['applicationHash']==identity['applicationHash']==cert['applicationHash']==f['base']['applicationHash'] and proof['configHash']==identity['configHash']==cert['configHash'] and proof['passed'] and not proof['releaseReady'])
check('certificate 15 states by six viewports by two themes',len(cert['screenshots'])==180 and set(cert['requiredStates'])==set(cert['coveredStates']) and len(cert['requiredStates'])==15 and cert['missingStates']==[] and cert['consoleErrors']==[] and cert['networkFailures']==[] and all(cert['journeyAssertions'].values()))
cells=[]
for s in cert['screenshots']:
 png=F/s['path'];side=F/s['sidecarPath'];sc=j(side)
 assert sha(png)==s['pngSha256'] and png.stat().st_size==s['pngBytes']
 assert sha(side)==s['sidecarSha256'] and side.stat().st_size==s['sidecarBytes']
 assert sc=={k:v for k,v in s.items() if k not in ['path','pngBytes','sidecarPath','sidecarBytes','sidecarSha256']}
 assert struct.unpack('>II',png.read_bytes()[16:24])==(s['viewport']['width'],s['viewport']['height'])
 assert s['nodekitCommit']==q['sourceCommit'] and s['nodekitSourceHash']==q['sourceHash'] and s['nodekitTarballSha256']==q['tarballSha256'] and s['nodekitSourceBound'] and s['nodekitTarballBound'] and s['generatedCandidateCommit']==f['base']['candidateCommit'] and s['runId']==f['runId']
 assert s['horizontalOverflowPx']==0 and s['consoleErrors']==0 and s['failedRequests']==0 and not s['mojibakeDetected']
 cells.append((s['state'],s['viewportId'],s['theme']))
check('all 180 PNG/sidecar byte bindings, viewport dimensions and current identity exact',len(set(cells))==180)
check('six browser artifacts hash and size exact',all(sha(F/v['path'])==v['sha256'] and (F/v['path']).stat().st_size==v['byteSize'] for v in cert['evidenceArtifacts']))
prior=j(P/'E3e-prior-factory-preservation.json');B=pathlib.Path(prior['backup'])
check('all 372 earlier factory artifacts preserved',len(prior['files'])==372 and all(sha(B/v['path'])==v['sha256'] and (B/v['path']).stat().st_size==v['bytes'] for v in prior['files']))
paths=git(S,'diff','--name-only').decode().splitlines()+git(S,'ls-files','--others','--exclude-standard').decode().splitlines()
check('only expected primary generated factory outputs changed',all(p=='proof/factory-acceptance.json' or p.startswith('proof/ease/latest/') for p in paths),len(paths))
out={'status':'PASS','at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'sourceCommit':q['sourceCommit'],'sourceHashClaim':q['sourceHash'],'checks':checks,'counts':{'durableFiles':1675,'bytes':sum(v['bytes'] for v in q['files'].values()),'packedFiles':421,'screenshots':180,'priorPreserved':372,'consumerArchiveFiles':len(archivePaths)},'primaryStatusSha256':h(git(S,'status','--porcelain=v1','--untracked-files=all')),'primaryIndexSha256':h(git(S,'ls-files','--stage','-z')),'consumerStatusSha256':h(git(C,'status','--porcelain=v1','--untracked-files=all')),'consumerIndexSha256':h(git(C,'ls-files','--stage','-z'))}
(P/'E3e_NODEKIT_FACTORY_JUDGE_BINDINGS.json').write_text(json.dumps(out,indent=2)+'\n',encoding='utf-8')
print(json.dumps({'status':'PASS','checks':len(checks),'counts':out['counts']},indent=2))
