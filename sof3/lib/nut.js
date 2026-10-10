// Copyright (C) 2026 Katsute <https://github.com/Katsute>

// Squirrel 2.2 bytecode loader (32-bit SQInteger, 1-byte SQChar); see DECOMPILE_NOTES.md §3

const OT_NULL = 0x01000001, OT_INTEGER = 0x05000002, OT_FLOAT = 0x05000004, OT_BOOL = 0x01000008, OT_STRING = 0x08000010;

// floats are boxed so they stay distinct from integers (1.0 vs 1)
class SqFloat {
    constructor(value){
        this.value = value;
    }
}

const tag = (s) => Buffer.from(s.split("").reverse().join(""), "latin1").readUInt32LE(0);

class Reader {
    constructor(buf){
        this.buf = buf;
        this.p = 0;
    }

    i32(){
        const v = this.buf.readInt32LE(this.p);
        this.p += 4;
        return v;
    }

    u32(){
        const v = this.buf.readUInt32LE(this.p);
        this.p += 4;
        return v;
    }

    u8(){
        return this.buf[this.p++];
    }

    tag(name){
        const v = this.u32();
        if(v !== tag(name))
            throw new Error(`expected tag ${name} at 0x${(this.p - 4).toString(16)}, got 0x${v.toString(16)}`);
    }

    obj(){
        const t = this.u32();
        switch(t){
            case OT_STRING: {
                const n = this.i32();
                return this.buf.toString("latin1", this.p, this.p += n);
            }
            case OT_INTEGER: return this.i32();
            case OT_FLOAT: {
                const v = new SqFloat(this.buf.readFloatLE(this.p));
                this.p += 4;
                return v;
            }
            case OT_NULL: return null;
            case OT_BOOL: return this.i32() !== 0;
            default: throw new Error(`unknown object type 0x${t.toString(16)} at 0x${(this.p - 4).toString(16)}`);
        }
    }
}

const loadFunc = (r) => {
    const f = {};
    r.tag("PART");
    f.source = r.obj();
    f.name = r.obj();
    r.tag("PART");
    const [nlit, npar, nout, nloc, nline, ndef, ninst, nfun] = Array.from({length: 8}, () => r.i32());
    r.tag("PART");
    f.literals = Array.from({length: nlit}, () => r.obj());
    r.tag("PART");
    f.params = Array.from({length: npar}, () => r.obj());
    r.tag("PART");
    f.outers = Array.from({length: nout}, () => ({type: r.u32(), src: r.obj(), name: r.obj()}));
    r.tag("PART");
    f.locals = Array.from({length: nloc}, () => ({name: r.obj(), pos: r.u32(), start: r.u32(), end: r.u32()}));
    r.tag("PART");
    f.lines = Array.from({length: nline}, () => ({line: r.i32(), op: r.i32()}));
    r.tag("PART");
    f.defparams = Array.from({length: ndef}, () => r.i32());
    r.tag("PART");
    f.codeOffset = r.p;
    // [op, arg0, arg1, arg2, arg3]
    f.code = Array.from({length: ninst}, () => {
        const a1 = r.i32();
        return [r.u8(), r.u8(), a1, r.u8(), r.u8()];
    });
    r.tag("PART");
    f.funcs = Array.from({length: nfun}, () => loadFunc(r));
    f.stacksize = r.i32();
    f.generator = r.u8();
    f.varparams = r.u8();
    return f;
};

const isBytecode = (buf) => buf.length >= 2 && buf.readUInt16LE(0) === 0xFAFA;

const load = (buf) => {
    if(!isBytecode(buf))
        throw new Error("not squirrel bytecode");
    const r = new Reader(buf);
    r.p = 2;
    r.tag("SQIR");
    if(r.i32() !== 1)
        throw new Error("unexpected SQChar size");
    const f = loadFunc(r);
    r.tag("TAIL");
    return f;
};

module.exports = {SqFloat, isBytecode, load};
