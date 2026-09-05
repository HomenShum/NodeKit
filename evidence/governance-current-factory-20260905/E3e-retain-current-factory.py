from pathlib import Path
import os,json,shutil,hashlib,tarfile
source=Path('D:/VSCode Projects/node-platform/.worktrees/project-consolidation-20260904')
original=Path('C:/Users/hshum/AppData/Local/Temp/nodekit-factory-acceptance-zswER5')
output=Path('D:/ProjectRecovery/nodekit-governance-reviewed-factory-20260905')
packet=Path(__file__).resolve().parent
assert not output.exists()
receipt=json.loads((source/'proof/factory-acceptance.json').read_text())
assert receipt['nodekitCommit']=='0d2223815ef73b80eeed8ce3dc6b96d16b3a2825'
assert receipt['nodekitSourceHash']=='cbd062964a7ada1774848f31408f2ffa3fc2953cfa28a096d398cb116810bf64'
assert receipt['passed'] and all(receipt['base']['checks'].values())
sha=lambda b:hashlib.sha256(b).hexdigest()
manifest={}
def retain(path,relative):
    assert not path.is_symlink()
    dest=output/relative
    dest.parent.mkdir(parents=True,exist_ok=True)
    shutil.copyfile(path,dest)
    data=path.read_bytes()
    assert data==dest.read_bytes()
    manifest[relative.as_posix()]={'sha256':sha(data),'bytes':len(data)}
for folder in ['candidate-package','measured-journey/launcher','measured-journey/domain-blank-base']:
    for current,dirs,files in os.walk(original/folder):
        dirs[:]=[d for d in dirs if d not in ['node_modules','.git']]
        for name in files:
            assert name not in ['.env','.env.local'], 'Unexpected credential config in no-key factory'
            path=Path(current)/name
            retain(path,Path('original')/path.relative_to(original))
tarball=next((original/'candidate-package').glob('*.tgz'))
assert sha(tarball.read_bytes())==receipt['nodekitTarballSha256']
bindings={}
with tarfile.open(tarball,'r:gz') as archive:
    for member in archive.getmembers():
        if not member.isfile(): continue
        rel=Path(member.name).relative_to('package')
        assert '..' not in rel.parts
        data=archive.extractfile(member).read()
        assert (source/rel).read_bytes()==data,rel
        for name in ['launcher','domain-blank-base']:
            path=original/'measured-journey'/name/'node_modules/@homenshum/nodekit'/rel
            assert path.read_bytes()==data,(name,rel)
            retain(path,Path('original/measured-journey')/name/'node_modules/@homenshum/nodekit'/rel)
        bindings[rel.as_posix()]=sha(data)
for current,dirs,files in os.walk(source/'proof/ease/latest'):
    for name in files:
        path=Path(current)/name
        retain(path,Path('source')/path.relative_to(source))
retain(source/'proof/factory-acceptance.json',Path('source/proof/factory-acceptance.json'))
result={'proof':'NODEKIT-GOVERNANCE-CURRENT-PACKAGE-FACTORY-01','original':str(original),'retained':str(output),'sourceCommit':receipt['nodekitCommit'],'sourceHash':receipt['nodekitSourceHash'],'tarballSha256':receipt['nodekitTarballSha256'],'sourcePackageAndTwoInstallationsExact':bindings,'factoryReceipt':receipt,'files':manifest,'exclusions':['other dependency trees','npm/browser caches','.git metadata; generated Git commit and candidate archive remain bound'],'originalWorkspaceRetained':original.exists(),'independentJudge':'PENDING','releaseCertification':'EASE_NOT_CERTIFIED'}
for destination in [output/'manifest.json',packet/'E3e_NODEKIT_CURRENT_FACTORY_RECEIPT.json']:
    destination.write_text(json.dumps(result,indent=2)+'\n',encoding='utf-8',newline='\n')
print(json.dumps({'retained':str(output),'files':len(manifest),'bytes':sum(v['bytes'] for v in manifest.values()),'packedBindings':len(bindings),'sourceHash':result['sourceHash']}))
