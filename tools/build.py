import sys,hashlib,re
import os
base=os.path.join(os.path.dirname(os.path.abspath(__file__)),'..')+os.sep
mods=sys.argv[2:]   # extra js modules in load order
ver=sys.argv[1]
sh=open(base+'shell.html',encoding='utf-8').read()
scripts='\n'.join('<script src="/js/%s.js?v=%s"></script>'%(m,ver) for m in ['core']+mods)
scripts+='\n<script type="module" src="/wp/main.js?v=%s"></script>'%ver  # modern Work projects section: iOS 9 ignores type=module
out=sh.replace('@@V@@',ver).replace('@@SCRIPTS@@',scripts)
import shutil
os.makedirs(base+'public/wp',exist_ok=True)
shutil.copyfile(base+'api/_wlinks.js',base+'public/wp/wlinks.js')  # same link parser as the server
open(base+'public/index.html','w',encoding='utf-8').write(out)
print(len(out))
