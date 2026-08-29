#!/usr/bin/env python3
import argparse, hashlib, struct
from pathlib import Path
from collections import namedtuple

# Steelplay Adventure / JieLi BR23 (AC63) firmware tool.
# Patches are build-specific; decryption/JLFS discovery is structural.
STOCK_ENC="c48d8aef2dd147b77bed0418ff915f9ba6e00d17ef8e371c2260443741929e36"
STOCK_DEC="a5f561638fc99efa4bcc33f851b2be72548f911c99c7ebfd07cc18ca0633a64d"
EXPECTED={
 "patch1":("1a19279c538eb1eca7fd415954cabca3941ce576dabd055cdfb7d9f134e9af0f","db107232531ed7db8c1d6c894e8451fd4421c063dd87fbc43794d0132e702ba5"),
 "patch2":("1fcd6f1a81f6477d22c58df1bec187462292782ad8778a2c5278066625c07988","ae2b854bdff13f4333872e5882be4d70b80d8d2f7a080493a4c0928b41318923"),
 "patch3":("b7b3c58d627f367a62d5a9c06ca1bd5bfbeeca0148be1404f84629d06cc5da0e","c864d74b3d07720e9b890da73f9b1b63484849c7514d6f121376ac1a32558482")}
E=namedtuple("Entry","hdr crc off size flags reserved index name data data_size")

PNP,PNP_SZ,HID,HID_SZ=0x23671,0x8f,0x23baa,0x180
WPNP,WHID,AGG=0x243c3,0x24455,0x2466e
BASE=[
 ("UUID selector",0xe926,"00 ff 12 20 34 01 43 e0 11 24 83 e8 05 20","02 f8 05 24 43 e0 11 24 83 e8 06 20 94 90"),
 ("PnP redirect",0xe934,"64 2f 92 17 13 e1 c1 be","64 32 42 e0 13 2c 94 90"),
 ("HID redirect",0xeb94,"44 e0 80 01 42 e0 fa 23","44 e0 83 01 42 e0 a5 2c")]
STUB=("aggregate stubs",0xe90c,
 "02 f8 ee 02 43 e0 11 24 03 e8 ea 20 82 f8 11 24 5c 2e 92 17 13 e1 4e bd 94 9e",
 "44 22 92 17 03 e1 0c 80 a4 86 00 00 00 00 00 00 44 e0 12 02 42 e0 be 2e 94 9b")
SEL2=("UUID 0x1002 selector",0xe93e,"44 22 92 17 03 e1 0c 80 94 8d","43 e0 10 02 03 e8 eb 21 f7 82")
SEL3=("UUID 0x0100 selector",0xe93e,"44 22 92 17 03 e1 0c 80 94 8d","02 f8 ed 03 f7 84 00 00 00 00")

def sha(x): return hashlib.sha256(x).hexdigest()
def align(x,a=32): return (x+a-1)//a*a
def sstr(x): return x.split(b"\0",1)[0].decode("ascii","replace")
def crc16(x):
    c=0
    for b in x:
        c^=b<<8
        for _ in range(8): c=(((c<<1)^0x1021) if c&0x8000 else c<<1)&0xffff
    return c
def enc(b,o,n,k=0xffff):
    for i in range(n):
        b[o+i]^=k&0xff; k=((k<<1)^(0x1021 if k&0x8000 else 0))&0xffff
def sfc(b,o,n,base,key):
    for i in range(0,n,32): enc(b,o+i,min(32,n-i),key^(((o+i)-base)>>2))
def chipkey(x):
    t=sum(x[:16])&0xff; t=0xaa if t>=0xe0 else 0x55 if t<=0x10 else t; k=0
    for i in range(16):
        if (x[16+i]^x[15-i])<t: k|=1<<i
    return k

def flash_header(raw):
    for o in (0,0x1000,0x10000,0x80000,0x100000,0x180000):
        if o+32>len(raw): continue
        h=bytearray(raw[o:o+32]); enc(h,0,32)
        if int.from_bytes(h[:2],"little") and crc16(h[2:])==int.from_bytes(h[:2],"little"):
            h=h[:4]+raw[o+4:o+8]+h[8:16]+raw[o+16:o+32]
            _,burn,ver,sz,fsv,al,_,_,prod=struct.unpack("<HH4sIBBBB16s",h)
            return o,burn,sstr(ver),sz,fsv,al,sstr(prod.rstrip(b"\xff"))
    raise RuntimeError("no valid JieLi flash header")

def parse_entry(b,o,base,after=False):
    hc,h=struct.unpack_from("<H30s",b,o)
    if crc16(h)!=hc: raise RuntimeError(f"JLFS header CRC error @ 0x{o:x}")
    dc,eo,sz,fl,rs,idx,n=struct.unpack("<HIIBBH16s",h)
    data=o+32 if after else base+eo; ds=o+sz-data if after else sz
    return E(o,dc,eo,sz,fl,rs,idx,sstr(n),data,ds)

def top_entries(b,base,crypt=False):
    out=[]; o=base+32
    while True:
        if crypt: enc(b,o,32)
        e=parse_entry(b,o,base); out.append(e)
        if e.index: return out
        o+=32

def sfc_entries(b,base,key=None):
    out=[]; rel=0; done=base
    while True:
        o=base+rel
        if key is not None:
            t=align(o+32)
            if done<t: sfc(b,done,t-done,base,key); done=t
        e=parse_entry(b,o,base,True); out.append(e); rel+=e.size; nxt=base+rel
        if key is not None:
            t=nxt if e.index else align(nxt+32)
            if done<t: sfc(b,done,t-done,base,key); done=t
        if e.index: return out,nxt

def nested_entries(b,area):
    out=[]; o=area.hdr+32
    while True:
        e=parse_entry(b,o,area.hdr); out.append(e)
        if e.index: return out
        o+=32

def locate_decrypted(b,top=None,sents=None):
    base=flash_header(bytes(b))[0]
    top=top or top_entries(b,base)
    isd=next(e for e in top if e.name=="isd_config.ini")
    blob=bytes(b[isd.data:isd.data+32]); stored=int.from_bytes(b[isd.data+32:isd.data+34],"little")
    if crc16(blob)!=stored: raise RuntimeError("isd_config chip-key CRC mismatch")
    key=chipkey(blob); appdir=next(e for e in top if e.name=="app_dir_head")
    sents,end=sents or sfc_entries(b,appdir.data,None)
    area=next((e for e in sents if e.name=="app_area_head"),sents[0])
    app=next(e for e in nested_entries(b,area) if e.name=="app.bin")
    return dict(base=base,top=top,key=key,sfc_base=appdir.data,sfc_end=end,area=area,app=app)

def decrypt(raw):
    base,*hdr=flash_header(raw); b=bytearray(raw); top=top_entries(b,base,True)
    isd=next(e for e in top if e.name=="isd_config.ini"); blob=bytes(b[isd.data:isd.data+32])
    if crc16(blob)!=int.from_bytes(b[isd.data+32:isd.data+34],"little"): raise RuntimeError("isd_config CRC mismatch")
    key=chipkey(blob); appdir=next(e for e in top if e.name=="app_dir_head"); sents,end=sfc_entries(b,appdir.data,key)
    info=locate_decrypted(b,top,(sents,end))
    print(f"header=0x{base:x}, version={hdr[1]}, product={hdr[-1]}, FS={hdr[3]}, chip_key=0x{key:04x}")
    print(f"SFC=0x{info['sfc_base']:x}..0x{end:x}, app.bin=0x{info['app'].data:x}+0x{info['app'].data_size:x}")
    return b,info

def fix_crcs(b,info):
    app,area=info["app"],info["area"]
    ac=crc16(b[app.data:app.data+app.data_size]); struct.pack_into("<H",b,app.hdr+2,ac)
    ah=crc16(b[app.hdr+2:app.hdr+32]); struct.pack_into("<H",b,app.hdr,ah)
    rc=crc16(b[area.data:area.hdr+area.size]); struct.pack_into("<H",b,area.hdr+2,rc)
    rh=crc16(b[area.hdr+2:area.hdr+32]); struct.pack_into("<H",b,area.hdr,rh)
    print(f"CRCs: app=0x{ac:04x}/0x{ah:04x}, app_area=0x{rc:04x}/0x{rh:04x}")

def reencrypt(dec):
    b=bytearray(dec); info=locate_decrypted(b); fix_crcs(b,info)
    sfc(b,info["sfc_base"],info["sfc_end"]-info["sfc_base"],info["sfc_base"],info["key"])
    for e in info["top"]: enc(b,e.hdr,32)
    return bytes(b),bytes(dec),info

def put(b,p):
    name,o,old,new=p; old,new=bytes.fromhex(old),bytes.fromhex(new)
    if bytes(b[o:o+len(old)])!=old: raise RuntimeError(f"{name}: stock bytes mismatch @ 0x{o:x}")
    if len(old)!=len(new): raise RuntimeError(f"{name}: size-changing code patch")
    b[o:o+len(new)]=new; print(f"patch: {name} @ 0x{o:x}")

def apply_patch(stock,kind):
    if sha(stock)!=STOCK_DEC: raise RuntimeError("patches only support the verified stock decrypted image")
    b=bytearray(stock); info=locate_decrypted(b)
    pnp,hid=bytes(b[PNP:PNP+PNP_SZ]),bytes(b[HID:HID+HID_SZ])
    if pnp[:3]!=bytes.fromhex("36 00 8c") or hid[:3]!=bytes.fromhex("36 01 7d"): raise RuntimeError("Nintendo SDP records mismatch")
    for p in BASE: put(b,p)
    wp=b"\x36"+len(pnp).to_bytes(2,"big")+pnp; wh=b"\x36"+len(hid).to_bytes(2,"big")+hid
    if len(wp)!=0x92 or len(wh)!=0x183 or WPNP+len(wp)!=WHID: raise RuntimeError("wrapper layout mismatch")
    b[WPNP:WPNP+len(wp)]=wp; b[WHID:WHID+len(wh)]=wh
    if kind!="patch1":
        put(b,STUB); put(b,SEL2 if kind=="patch2" else SEL3)
        agg=b"\x36"+(len(hid)+len(pnp)).to_bytes(2,"big")+hid+pnp
        if len(agg)!=0x212: raise RuntimeError("aggregate length mismatch")
        b[AGG:AGG+len(agg)]=agg
    fix_crcs(b,info); return bytes(b),info

def outname(inp,s): return inp.with_name(inp.stem+s+".bin")
def write(p,data,label): p.write_bytes(data); print(f"{label}: {p} ({len(data):#x}, sha256={sha(data)})")

def main():
    ap=argparse.ArgumentParser(description="Steelplay Adventure BR23 decrypt/patch/re-encrypt tool")
    sp=ap.add_subparsers(dest="cmd",required=True)
    d=sp.add_parser("decrypt"); d.add_argument("input",type=Path); d.add_argument("-o",type=Path); d.add_argument("--app-out",type=Path)
    e=sp.add_parser("encrypt"); e.add_argument("input",type=Path); e.add_argument("-o",type=Path)
    p=sp.add_parser("patch"); p.add_argument("input",type=Path); p.add_argument("patch",choices=("patch1","patch2","patch3")); p.add_argument("--decrypted-out",type=Path); p.add_argument("--app-out",type=Path); p.add_argument("--flash-out",type=Path)
    a=ap.parse_args(); raw=a.input.read_bytes()
    if a.cmd=="decrypt":
        dec,info=decrypt(raw); write(a.o or outname(a.input,"-decrypted"),dec,"decrypted")
        write(a.app_out or outname(a.input,"-app"),dec[info["app"].data:info["app"].data+info["app"].data_size],"app.bin")
        return
    if a.cmd=="encrypt":
        encfw,_,_=reencrypt(raw); write(a.o or outname(a.input,"-flash"),encfw,"flash"); return
    if sha(raw)==STOCK_ENC: dec,info=decrypt(raw)
    elif sha(raw)==STOCK_DEC: dec=raw; info=locate_decrypted(bytearray(dec))
    else: raise RuntimeError("patch input must be the verified stock encrypted or decrypted dump")
    patched,info=apply_patch(dec,a.patch)
    flash,_,_=reencrypt(patched)
    dexp,fexp=EXPECTED[a.patch]
    if sha(patched)!=dexp or sha(flash)!=fexp: raise RuntimeError(f"{a.patch}: output hash mismatch")
    base=a.input.with_suffix("")
    write(a.decrypted_out or Path(str(base)+f"-{a.patch}-decrypted.bin"),patched,"patched decrypted")
    write(a.app_out or Path(str(base)+f"-{a.patch}-app.bin"),patched[info["app"].data:info["app"].data+info["app"].data_size],"patched app.bin")
    write(a.flash_out or Path(str(base)+f"-{a.patch}-flash.bin"),flash,"patched flash")

if __name__=="__main__": main()
