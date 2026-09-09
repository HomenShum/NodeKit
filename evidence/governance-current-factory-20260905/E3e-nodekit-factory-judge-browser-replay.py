from pathlib import Path
P=Path(__file__).parent
s=(P/'E3e-nodekit-factory-judge-browser.mjs').read_text(encoding='utf-8')
s=s.replace("E3e-nodekit-factory-independent-browser'","E3e-nodekit-factory-independent-browser-02'")
# The actual 390px product uses its visible mobile decision bar. The earlier
# desktop-only locator failure remains in the original script/report directory.
s=s.replace("page.locator('#propose')","page.locator('#mobile-propose')").replace("page.locator('#reject')","page.locator('#mobile-reject')").replace("page.locator('#approve')","page.locator('#mobile-approve')")
s=s.replace("const initial=await (await fetch(base+'/api/state')).json();","await capture(page,'running-mobile-controls-390'); const initial=await (await fetch(base+'/api/state')).json();")
(P/'E3e-nodekit-factory-judge-browser-02.mjs').write_text(s,encoding='utf-8')
