# Generate Java mirrors of the sherpa-onnx Kotlin data classes so its JNI library can read them (run against kotlin-api/*.kt from the matching sherpa-onnx release)
import re, os, sys
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '../app/src/com/k2fsa/sherpa/onnx/')
T={'String':'String','Int':'int','Float':'float','Boolean':'boolean','Long':'long','FloatArray':'float[]','IntArray':'int[]','Array<String>':'String[]'}
def jtype(t): return T.get(t, t)
def jdefault(t, d):
    if d is None: return None
    d=d.strip()
    if t in ('Float',): return re.sub(r'[fF]$','',d)+'f'
    if t=='String': return d
    if t in ('Int','Boolean','Long'): return d
    if d.endswith('()'): return 'new '+d
    if t=='IntArray' and d.startswith('IntArray(0)'): return 'new int[0]'
    return d
names=[]
for f in ['OfflineRecognizer.kt','FeatureConfig.kt','QnnConfig.kt','HomophoneReplacerConfig.kt','Vad.kt']:
    s=open(f).read()
    for m in re.finditer(r'data class (\w+)\((.*?)\n\)', s, re.S):
        name, body = m.group(1), m.group(2)
        fields=[]
        for line in body.split('\n'):
            line=re.sub(r'//.*','',line).strip().rstrip(',')
            if not line: continue
            mm=re.match(r'(?:var|val) (\w+): ([\w<>]+)\s*(?:=\s*(.+))?$', line)
            if not mm:
                # multi-line default
                if fields and not line.startswith(('var','val')): fields[-1]=(fields[-1][0],fields[-1][1],(fields[-1][2] or '')+line); continue
                print('??',name,line); continue
            fields.append((mm.group(1),mm.group(2),mm.group(3)))
        lines=[f'package com.k2fsa.sherpa.onnx;','',f'public class {name} {{']
        for n,t,d in fields:
            jd=jdefault(t,d)
            lines.append(f'  public {jtype(t)} {n}' + (f' = {jd};' if jd is not None else ';'))
        lines.append(f'  public {name}() {{}}')
        if all(d is None or name=='OfflineRecognizerResult' for _,_,d in fields) or name=='OfflineRecognizerResult':
            args=', '.join(f'{jtype(t)} {n}' for n,t,_ in fields)
            lines.append(f'  public {name}({args}) {{ ' + ' '.join(f'this.{n} = {n};' for n,_,_ in fields) + ' }')
        lines.append('}')
        open(OUT+name+'.java','w').write('\n'.join(lines)+'\n'); names.append(name)
print(len(names), names)
