import json,hashlib,shutil,subprocess
from pathlib import Path
from datetime import datetime,timezone
repo=Path('D:/VSCode Projects/node-platform/.worktrees/project-consolidation-20260904').resolve()
packet=Path(__file__).resolve().parent
backup=Path('D:/ProjectRecovery/nodekit-pre-governance-factory-20260905')
assert not backup.exists()
replacement=(repo/'proof/ease/latest').resolve()
assert replacement.is_relative_to(repo) and replacement==repo/'proof/ease/latest' and not replacement.is_symlink()
assert subprocess.check_output(['git','rev-parse','HEAD'],cwd=repo).decode().strip()=='0d2223815ef73b80eeed8ce3dc6b96d16b3a2825'
assert not subprocess.check_output(['git','status','--porcelain'],cwd=repo).strip()
backup.mkdir()
paths=[repo/'proof/factory-acceptance.json',*sorted(replacement.rglob('*'))]
rows=[]
for source in paths:
    assert not source.is_symlink()
    if not source.is_file(): continue
    relative=source.relative_to(repo).as_posix()
    destination=backup/relative
    destination.parent.mkdir(parents=True,exist_ok=True)
    shutil.copyfile(source,destination)
    data=source.read_bytes()
    assert data==destination.read_bytes()
    rows.append({'path':relative,'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest()})
record={'at':datetime.now(timezone.utc).isoformat(),'status':'EXACT_PRIOR_FACTORY_PRESERVED_BEFORE_NORMAL_REPLACEMENT','repo':str(repo),'backup':str(backup),'verifiedReplacementPath':str(replacement),'files':rows,'count':len(rows),'bytes':sum(row['bytes'] for row in rows),'sourceFactoryCommit':json.loads((repo/'proof/factory-acceptance.json').read_text())['nodekitCommit'],'currentCommit':'0d2223815ef73b80eeed8ce3dc6b96d16b3a2825','factoryCommand':'node src/factory-acceptance.mjs','keepAcceptance':True,'actualFactoryNotStartedYet':True}
(packet/'E3e-prior-factory-preservation.json').write_text(json.dumps(record,indent=2)+'\n',encoding='utf-8',newline='\n')
print(json.dumps({key:record[key] for key in ['status','count','bytes','sourceFactoryCommit','currentCommit']}))
