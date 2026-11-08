# Minimal zipalign: align stored entries to 4 bytes (.so to 4096), as targetSdk 30+ requires for resources.arsc
import sys, zipfile
src, dst = sys.argv[1], sys.argv[2]
zin = zipfile.ZipFile(src)
with zipfile.ZipFile(dst, 'w') as zout:
    for info in zin.infolist():
        data = zin.read(info.filename)
        ni = zipfile.ZipInfo(info.filename, date_time=info.date_time)
        ni.compress_type = info.compress_type
        ni.external_attr = info.external_attr
        if info.filename == 'resources.arsc' or info.filename.endswith(('.png',)) and info.compress_type == zipfile.ZIP_STORED:
            ni.compress_type = zipfile.ZIP_STORED
        if ni.compress_type == zipfile.ZIP_STORED:
            align = 4096 if info.filename.endswith('.so') else 4
            off = zout.fp.tell() + 30 + len(info.filename.encode())
            pad = (-off) % align
            ni.extra = b'\x00' * pad
        zout.writestr(ni, data)
