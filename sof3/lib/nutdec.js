// Copyright (C) 2026 Katsute <https://github.com/Katsute>

// Squirrel 2.2 bytecode decompiler (best-effort, readable output); see DECOMPILE_NOTES.md §4

const {SqFloat, load} = require("./nut");

const [
    OP_LINE, OP_LOAD, OP_LOADINT, OP_LOADFLOAT, OP_DLOAD, OP_TAILCALL, OP_CALL, OP_PREPCALL, OP_PREPCALLK,
    OP_GETK, OP_MOVE, OP_NEWSLOT, OP_DELETE, OP_SET, OP_GET, OP_EQ, OP_NE, OP_ARITH, OP_BITW, OP_RETURN,
    OP_LOADNULLS, OP_LOADROOTTABLE, OP_LOADBOOL, OP_DMOVE, OP_JMP, OP_JNZ, OP_JZ, OP_LOADFREEVAR, OP_VARGC,
    OP_GETVARGV, OP_NEWTABLE, OP_NEWARRAY, OP_APPENDARRAY, OP_GETPARENT, OP_COMPARITH, OP_COMPARITHL, OP_INC,
    OP_INCL, OP_PINC, OP_PINCL, OP_CMP, OP_EXISTS, OP_INSTANCEOF, OP_AND, OP_OR, OP_NEG, OP_NOT, OP_BWNOT,
    OP_CLOSURE, OP_YIELD, OP_RESUME, OP_FOREACH, OP_POSTFOREACH, OP_DELEGATE, OP_CLONE, OP_TYPEOF,
    OP_PUSHTRAP, OP_POPTRAP, OP_THROW, OP_CLASS, OP_NEWSLOTA
] = Array.from({length: 61}, (_, i) => i);

const BW = {0: "&", 2: "|", 3: "^", 4: "<<", 5: ">>", 6: ">>>"};
const CMP = {0: ">", 2: ">=", 3: "<", 4: "<="};
const KEYWORDS = new Set([
    "while", "do", "if", "else", "break", "continue", "return", "null", "function", "local", "for",
    "foreach", "in", "typeof", "delegate", "delete", "try", "catch", "throw", "clone", "yield",
    "resume", "switch", "case", "default", "this", "parent", "class", "extends", "constructor",
    "instanceof", "vargc", "vargv", "true", "false", "static", "enum", "const"
]);
const IND = "    ";

const isIdent = (s) => typeof s === "string" && /^[A-Za-z_][A-Za-z0-9_]*$/.test(s) && !KEYWORDS.has(s);

const f32 = new DataView(new ArrayBuffer(4));
const intToFloat = (i) => {
    f32.setInt32(0, i, true);
    return f32.getFloat32(0, true);
};

// shortest decimal that reads back as the same 32-bit float
const fmtFloat = (v) => {
    let s;
    for(let p = 1; p < 10; p++){
        s = v.toPrecision(p);
        if(Math.fround(Number(s)) === v)
            break;
    }
    s = String(Number(s)); // 1.2e+2 -> 120
    if(!/[e.n]/i.test(s))
        s += ".0";
    return s;
};

const fmtConst = (v) => {
    if(v === null)
        return "null";
    if(typeof v === "boolean")
        return v ? "true" : "false";
    if(typeof v === "number")
        return String(v);
    if(v instanceof SqFloat)
        return fmtFloat(v.value);
    return "\"" + v
        .replace(/\\/g, "\\\\")
        .replace(/"/g, "\\\"")
        .replace(/\n/g, "\\n")
        .replace(/\r/g, "\\r")
        .replace(/\t/g, "\\t") + "\"";
};

const indent = (text) => text.split("\n").map((l) => l ? IND + l : l).join("\n");

const block = (head, body) => `${head}\n{\n${indent(body.join("\n"))}\n}`;

class Expr {
    constructor(text, atomic = true, side = false, constant = null, hasConst = false){
        this.text = text;
        this.atomic = atomic;
        this.side = side;
        this.const = constant;
        this.hasConst = hasConst;
    }

    toString(){
        return this.text;
    }

    wrap(){
        const s = String(this);
        return this.atomic ? s : `(${s})`;
    }
}

const C = (v) => new Expr(fmtConst(v), true, false, v, true);

class TableExpr extends Expr {
    constructor(){
        super("");
        this.entries = [];
    }

    toString(){
        if(!this.entries.length)
            return "{}";
        const items = this.entries.map(([k, v]) => renderMember(k, v, "=", ""));
        const one = `{ ${items.join(", ")} }`;
        if(one.length < 90 && !one.includes("\n"))
            return one;
        return `{\n${items.map(indent).join(",\n")}\n}`;
    }
}

class ArrayExpr extends Expr {
    constructor(){
        super("");
        this.items = [];
    }

    toString(){
        const items = this.items.map(String);
        const one = `[${items.join(", ")}]`;
        if(one.length < 100 && !one.includes("\n"))
            return one;
        return `[\n${items.map(indent).join(",\n")}\n]`;
    }
}

class ClassExpr extends Expr {
    constructor(base){
        super("");
        this.base = base;
        this.entries = [];
        this.name = null;
    }

    toString(){
        const head = "class" + (this.name ? " " + this.name : "") + (this.base ? " extends " + this.base : "");
        if(!this.entries.length)
            return head + " {}";
        return block(head, this.entries.map(([k, v, isStatic]) => renderMember(k, v, "=", ";", isStatic)));
    }
}

class FuncExpr extends Expr {
    constructor(func, defaults){
        super("");
        this.func = func;
        this.defaults = defaults;
        this.name = null;
        this.body = null;
    }

    toString(){
        const f = this.func;
        const params = f.params.slice(1);
        const nd = this.defaults.length;
        const ps = params.map((p, i) => nd && i >= params.length - nd ? `${p} = ${this.defaults[i - (params.length - nd)]}` : String(p));
        if(f.varparams)
            ps.push("...");
        const name = this.name ?? "";
        const head = (name === "constructor" ? "constructor" : "function" + (name ? " " + name : "")) + `(${ps.join(", ")})`;
        this.body ??= new Decompiler(f).decompile();
        if(!this.body.trim())
            return head + " {}";
        return block(head, [this.body]);
    }
}

const renderMember = (k, v, eq, term, isStatic = false) => {
    const pre = isStatic ? "static " : "";
    const key = k.hasConst && isIdent(k.const) ? k.const : null;
    if(key && (v instanceof FuncExpr || v instanceof ClassExpr)){
        v.name = key;
        return pre + v;
    }
    return `${pre}${key ?? `[${k}]`} ${eq} ${v}${term}`;
};

class State {
    constructor(){
        this.regs = new Map();
        this.pending = []; // regs holding unconsumed side-effect exprs
        this.lastWrite = null;
    }

    copy(){
        const s = new State();
        s.regs = new Map(this.regs);
        s.pending = [...this.pending];
        return s;
    }

    unpend(reg){
        const i = this.pending.indexOf(reg);
        if(i === -1)
            return false;
        this.pending.splice(i, 1);
        return true;
    }
}

class Ctx {
    constructor(brk = null, cont = null){
        this.brk = brk;
        this.cont = cont;
    }
}

class Decompiler {
    constructor(f){
        this.f = f;
        this.code = f.code;
        this.n = f.code.length;
        this.gotos = new Set();
        this.labels = new Set();
        this.activeLoops = new Set();
        this.loopEnd = new Map(); // header -> last back-jump pc
        this.doWhile = new Map(); // start -> jnz pc
        this.code.forEach(([op, , a1], pc) => {
            const t = pc + 1 + a1;
            if(t > pc)
                return;
            if(op === OP_JMP && this.code[t][0] !== OP_FOREACH)
                this.loopEnd.set(t, Math.max(this.loopEnd.get(t) ?? -1, pc));
            if(op === OP_JNZ)
                this.doWhile.set(t, Math.max(this.doWhile.get(t) ?? -1, pc));
        });
    }

    // ---- locals ----

    // compiler-internal locals (@ITERATOR@, @INDEX@) aren't valid names and are never declared in source
    localAt(reg, pc){
        let best = null;
        for(const l of this.f.locals)
            if(l.pos === reg && l.start <= pc && pc <= l.end && (best === null || l.start > best.start))
                best = l;
        return best && !best.name.startsWith("@") ? best.name : null;
    }

    localDecl(reg, pc){
        const name = this.f.locals.find((l) => l.pos === reg && l.start === pc + 1)?.name ?? null;
        return name?.startsWith("@") ? null : name;
    }

    // ---- registers ----

    read(st, reg, pc){
        const name = this.localAt(reg, pc);
        if(name !== null)
            return new Expr(name);
        const e = st.regs.get(reg);
        st.unpend(reg);
        return e ?? new Expr(`$r${reg}`);
    }

    write(st, reg, e, pc, out){
        const decl = this.localDecl(reg, pc);
        const name = decl ?? this.localAt(reg, pc);
        if(name !== null){
            if(decl && e instanceof FuncExpr){
                this.flush(st, out);
                e.name = decl;
                out.push("local " + e);
                return;
            }
            if(decl && e instanceof ClassExpr){
                this.flush(st, out);
                out.push(`local ${decl} = ${e};`);
                return;
            }
            if(String(e) === name)
                return;
            this.flush(st, out);
            if(decl)
                out.push(String(e) === "null" ? `local ${decl};` : `local ${decl} = ${e};`);
            else
                out.push(`${name} = ${e};`);
            return;
        }
        if(st.unpend(reg))
            out.push(`${st.regs.get(reg)};`);
        st.regs.set(reg, e);
        st.lastWrite = reg;
        if(e.side)
            st.pending.push(reg);
    }

    flush(st, out){
        for(const reg of st.pending)
            out.push(`${st.regs.get(reg)};`);
        st.pending = [];
    }

    emit(st, out, text){
        this.flush(st, out);
        out.push(text);
    }

    // ---- helpers ----

    member(obj, key){
        if(key.hasConst && isIdent(key.const)){
            if(String(obj) === "this")
                return new Expr(key.const);
            if(String(obj) === "::")
                return new Expr("::" + key.const);
            return new Expr(`${obj.wrap()}.${key.const}`);
        }
        return new Expr(`${obj.wrap()}[${key}]`);
    }

    target(pc){
        return pc + 1 + this.code[pc][2];
    }

    // ---- main ----

    decompile(){
        let out = [];
        this.block(0, this.n, new State(), new Ctx(), out);
        if(this.gotos.size){
            this.labels = new Set(this.gotos);
            this.activeLoops = new Set();
            out = [];
            this.block(0, this.n, new State(), new Ctx(), out);
        }
        return out.join("\n");
    }

    sub(start, end, st, ctx){
        const out = [];
        this.block(start, end, st, ctx, out);
        return out;
    }

    block(start, end, st, ctx, out){
        const code = this.code;
        let pc = start;
        while(pc < end){
            if(this.labels.has(pc)){
                this.flush(st, out);
                out.push(`L${pc}:`);
            }
            const [op, a0, a1, a2] = code[pc];

            // loops
            if(this.doWhile.has(pc) && !this.activeLoops.has(`d${pc}`)){
                const j = this.doWhile.get(pc);
                this.activeLoops.add(`d${pc}`);
                this.flush(st, out);
                const body = [];
                this.block(pc, j, st, new Ctx(j + 1, null), body);
                const cond = this.read(st, code[j][1], j);
                this.flush(st, body);
                out.push(block("do", body) + `\nwhile (${cond});`);
                pc = j + 1;
                continue;
            }
            if(this.loopEnd.has(pc) && !this.activeLoops.has(`w${pc}`)){
                const j = this.loopEnd.get(pc);
                this.activeLoops.add(`w${pc}`);
                this.flush(st, out);
                let c = null;
                for(let k = pc; k < j; k++)
                    if(code[k][0] === OP_JZ && this.target(k) === j + 1){
                        c = k;
                        break;
                    }
                let cond, bstart;
                if(c !== null){
                    const pre = [];
                    this.block(pc, c, st, new Ctx(), pre);
                    cond = String(this.read(st, code[c][1], c));
                    this.flush(st, pre);
                    out.push(...pre);
                    bstart = c + 1;
                }else{
                    cond = "true";
                    bstart = pc;
                }
                const body = this.sub(bstart, j, st.copy(), new Ctx(j + 1, pc));
                out.push(block(`while (${cond})`, body));
                pc = j + 1;
                continue;
            }

            if(op === OP_FOREACH){
                const cont = this.read(st, a0, pc);
                const ex = pc + 1 + a1;
                const kname = this.localAt(a2, pc + 2) || "@INDEX@";
                const vname = this.localAt(a2 + 1, pc + 2) || "$v";
                this.flush(st, out);
                const bend = code[ex - 1][0] === OP_JMP ? ex - 1 : ex;
                const body = this.sub(pc + 2, bend, st.copy(), new Ctx(ex, pc));
                out.push(block(`foreach (${kname === "@INDEX@" ? vname : `${kname}, ${vname}`} in ${cont})`, body));
                pc = ex;
                continue;
            }

            if(op === OP_JZ || op === OP_JNZ){
                const t = this.target(pc);
                const c = this.read(st, a0, pc);
                const cond = op === OP_JZ ? String(c) : "!" + c.wrap();
                if(t <= pc || t > end){
                    if(t === ctx.brk)
                        this.emit(st, out, op === OP_JZ ? `if (!${new Expr(cond, false).wrap()}) break;` : `if (${c}) break;`);
                    else{
                        this.gotos.add(t);
                        this.emit(st, out, `if (!${new Expr(cond, op === OP_JNZ).wrap()}) goto L${t};`);
                    }
                    pc++;
                    continue;
                }
                let hasElse = false;
                let e = t;
                if(t - 1 > pc && code[t - 1][0] === OP_JMP){
                    e = this.target(t - 1);
                    if(t < e && e <= end && e !== ctx.brk)
                        hasElse = true;
                }
                this.flush(st, out);
                const s1 = st.copy();
                const then = this.sub(pc + 1, hasElse ? t - 1 : t, s1, ctx);
                if(hasElse){
                    const s2 = st.copy();
                    const els = this.sub(t, e, s2, ctx);
                    if(!then.length && !els.length && s1.lastWrite !== null && s1.lastWrite === s2.lastWrite &&
                       this.localAt(s1.lastWrite, e) === null){
                        const r = s1.lastWrite;
                        const a = s1.regs.get(r);
                        const b = s2.regs.get(r);
                        const test = new Expr(cond, op === OP_JZ && c.atomic).wrap();
                        this.write(st, r, new Expr(`${test} ? ${a.wrap()} : ${b.wrap()}`, false, a.side || b.side), e - 1, out);
                        pc = e;
                        continue;
                    }
                    let text = block(`if (${cond})`, then) + "\nelse";
                    if(els.length === 1 && els[0].startsWith("if ("))
                        text += " " + els[0];
                    else
                        text += "\n" + block("", els).slice(1);
                    out.push(text);
                    pc = e;
                }else{
                    out.push(block(`if (${cond})`, then));
                    pc = t;
                }
                continue;
            }

            if(op === OP_JMP){
                const t = this.target(pc);
                if(t === ctx.brk)
                    this.emit(st, out, "break;");
                else if(t === ctx.cont)
                    this.emit(st, out, "continue;");
                else if(t !== pc + 1){
                    this.gotos.add(t);
                    this.emit(st, out, `goto L${t};`);
                }
                pc++;
                continue;
            }

            if(op === OP_AND || op === OP_OR){
                const first = this.read(st, a2, pc);
                const t = this.target(pc);
                const tmp = [];
                this.block(pc + 1, t, st, ctx, tmp);
                const second = this.read(st, a0, t - 1);
                out.push(...tmp);
                this.write(st, a0, new Expr(`${first.wrap()} ${op === OP_AND ? "&&" : "||"} ${second.wrap()}`, false), t - 1, out);
                pc = t;
                continue;
            }

            if(op === OP_PUSHTRAP){
                const catchPc = pc + 1 + a1;
                const exname = this.localAt(a0, catchPc) || "e";
                const tend = catchPc - 1;
                const e = code[tend][0] === OP_JMP ? this.target(tend) : catchPc;
                this.flush(st, out);
                const tb = this.sub(pc + 1, tend, st.copy(), ctx);
                const cb = this.sub(catchPc, e, st.copy(), ctx);
                out.push(block("try", tb) + "\n" + block(`catch (${exname})`, cb));
                pc = e;
                continue;
            }

            this.simple(pc, st, out);
            pc++;
        }
        this.flush(st, out);
    }

    simple(pc, st, out){
        const [op, a0, a1, a2, a3] = this.code[pc];
        const lit = this.f.literals;
        const R = (r) => this.read(st, r, pc);
        const W = (r, e) => this.write(st, r, e, pc, out);
        const delta = (d) => d === 1 ? "++" : d === -1 ? "--" : ` += ${d}`;

        switch(op){
            case OP_LOAD:
                W(a0, C(lit[a1]));
                break;
            case OP_LOADINT:
                W(a0, C(a1));
                break;
            case OP_LOADFLOAT:
                W(a0, C(new SqFloat(intToFloat(a1))));
                break;
            case OP_DLOAD:
                W(a0, C(lit[a1]));
                W(a2, C(lit[a3]));
                break;
            case OP_CALL:
            case OP_TAILCALL: {
                const fn = R(a1);
                const args = [];
                for(let r = a2 + 1; r < a2 + a3; r++)
                    args.push(R(r));
                R(a2);
                const text = `${fn.wrap()}(${args.join(", ")})`;
                if(op === OP_TAILCALL)
                    this.emit(st, out, `return ${text};`);
                else
                    W(a0, new Expr(text, true, true));
                break;
            }
            case OP_PREPCALL:
            case OP_PREPCALLK: {
                const key = op === OP_PREPCALLK ? C(lit[a1]) : R(a1);
                const obj = R(a2);
                W(a0, this.member(obj, key));
                W(a3, new Expr(String(obj), obj.atomic));
                break;
            }
            case OP_GETK:
                W(a0, this.member(R(a2), C(lit[a1])));
                break;
            case OP_MOVE:
                W(a0, R(a1));
                break;
            case OP_NEWSLOT:
            case OP_SET: {
                const obj = this.localAt(a1, pc) === null ? st.regs.get(a1) : null;
                const key = R(a2);
                const val = R(a3);
                if(op === OP_NEWSLOT && obj instanceof TableExpr){
                    st.unpend(a1);
                    obj.entries.push([key, val]);
                }else{
                    const o = R(a1);
                    const tgt = this.member(o, key);
                    if(op === OP_NEWSLOT && String(o) === "this" && key.hasConst && isIdent(key.const) &&
                       (val instanceof FuncExpr || val instanceof ClassExpr)){
                        val.name = key.const;
                        this.emit(st, out, String(val));
                    }else
                        this.emit(st, out, `${tgt} ${op === OP_NEWSLOT ? "<-" : "="} ${val};`);
                }
                if(a0 !== a3)
                    W(a0, val);
                break;
            }
            case OP_NEWSLOTA: {
                const cls = st.regs.get(a1);
                const key = R(a2);
                const val = R(a3);
                if(cls instanceof ClassExpr)
                    cls.entries.push([key, val, (a0 & 2) !== 0]);
                else if(cls instanceof TableExpr){
                    st.unpend(a1);
                    cls.entries.push([key, val]);
                }else
                    this.emit(st, out, `${this.member(R(a1), key)} <- ${val};`);
                break;
            }
            case OP_DELETE:
                W(a0, new Expr("delete " + this.member(R(a1), R(a2)), false, true));
                break;
            case OP_GET:
                W(a0, this.member(R(a1), R(a2)));
                break;
            case OP_EQ:
            case OP_NE: {
                const rhs = a3 ? C(lit[a1]) : R(a1);
                W(a0, new Expr(`${R(a2).wrap()} ${op === OP_EQ ? "==" : "!="} ${rhs.wrap()}`, false));
                break;
            }
            case OP_ARITH: {
                const rhs = R(a1);
                const lhs = R(a2);
                W(a0, new Expr(`${lhs.wrap()} ${String.fromCharCode(a3)} ${rhs.wrap()}`, false));
                break;
            }
            case OP_BITW: {
                const lhs = R(a1);
                W(a0, new Expr(`${lhs.wrap()} ${BW[a3] ?? "?"} ${R(a2).wrap()}`, false));
                break;
            }
            case OP_RETURN:
                if(a0 === 0xFF){
                    if(pc !== this.n - 1)
                        this.emit(st, out, "return;");
                }else{
                    const v = R(a1);
                    this.emit(st, out, `return ${v};`);
                }
                break;
            case OP_LOADNULLS: {
                // a foreach's key / value / iterator registers are declared by the foreach itself
                const next = this.code[pc + 1];
                const loop = next && next[0] === OP_FOREACH ? [next[3], next[3] + 2] : null;
                for(let r = a0; r < a0 + a1; r++)
                    if(loop && r >= loop[0] && r <= loop[1])
                        st.regs.set(r, C(null));
                    else if(!this.f.locals.some((l) => l.pos === r && l.start === pc))
                        W(r, C(null));
                break;
            }
            case OP_LOADROOTTABLE:
                W(a0, new Expr("::"));
                break;
            case OP_LOADBOOL:
                W(a0, C(a1 !== 0));
                break;
            case OP_DMOVE:
                W(a0, R(a1));
                W(a2, R(a3));
                break;
            case OP_LOADFREEVAR:
                W(a0, new Expr(String(this.f.outers[a1].name)));
                break;
            case OP_VARGC:
                W(a0, new Expr("vargc"));
                break;
            case OP_GETVARGV:
                W(a0, new Expr(`vargv[${R(a1)}]`));
                break;
            case OP_NEWTABLE:
                W(a0, new TableExpr());
                break;
            case OP_NEWARRAY:
                W(a0, new ArrayExpr());
                break;
            case OP_APPENDARRAY: {
                const v = a3 ? C(lit[a1]) : R(a1);
                const arr = st.regs.get(a0);
                if(arr instanceof ArrayExpr && this.localAt(a0, pc) === null)
                    arr.items.push(v);
                else
                    this.emit(st, out, `${R(a0).wrap()}.append(${v});`);
                break;
            }
            case OP_GETPARENT:
                W(a0, new Expr(R(a1).wrap() + ".parent"));
                break;
            case OP_COMPARITH: {
                const obj = R(a1 >> 16);
                const val = R(a1 & 0xFFFF);
                const tgt = this.member(obj, R(a2));
                this.emit(st, out, `${tgt} ${String.fromCharCode(a3)}= ${val};`);
                W(a0, tgt);
                break;
            }
            case OP_COMPARITHL: {
                const v = R(a2);
                const loc = R(a1);
                this.emit(st, out, `${loc} ${String.fromCharCode(a3)}= ${v};`);
                if(a0 !== a1)
                    W(a0, loc);
                break;
            }
            case OP_INC:
            case OP_PINC: {
                const tgt = this.member(R(a1), R(a2));
                this.emit(st, out, `${tgt}${delta(a3 < 128 ? a3 : a3 - 256)};`);
                W(a0, tgt);
                break;
            }
            case OP_INCL:
            case OP_PINCL: {
                const loc = R(a1);
                this.emit(st, out, `${loc}${delta(a3 < 128 ? a3 : a3 - 256)};`);
                if(a0 !== a1)
                    W(a0, loc);
                break;
            }
            case OP_CMP:
                W(a0, new Expr(`${R(a2).wrap()} ${CMP[a3] ?? "?"} ${R(a1).wrap()}`, false));
                break;
            case OP_EXISTS: {
                const obj = R(a1);
                W(a0, new Expr(`${R(a2).wrap()} in ${obj.wrap()}`, false));
                break;
            }
            case OP_INSTANCEOF: {
                const cls = R(a1);
                W(a0, new Expr(`${R(a2).wrap()} instanceof ${cls.wrap()}`, false));
                break;
            }
            case OP_NEG:
                W(a0, new Expr("-" + R(a1).wrap()));
                break;
            case OP_NOT:
                W(a0, new Expr("!" + R(a1).wrap()));
                break;
            case OP_BWNOT:
                W(a0, new Expr("~" + R(a1).wrap()));
                break;
            case OP_CLOSURE: {
                const g = this.f.funcs[a1];
                W(a0, new FuncExpr(g, g.defparams.map((r) => R(r))));
                break;
            }
            case OP_YIELD:
                this.emit(st, out, a0 !== 0xFF ? `yield ${R(a1)};` : "yield;");
                break;
            case OP_RESUME:
                W(a0, new Expr("resume " + R(a1).wrap(), false, true));
                break;
            case OP_DELEGATE:
                W(a0, new Expr(`delegate ${R(a1).wrap()} : ${R(a2).wrap()}`, false));
                break;
            case OP_CLONE:
                W(a0, new Expr("clone " + R(a1).wrap(), false));
                break;
            case OP_TYPEOF:
                W(a0, new Expr("typeof " + R(a1).wrap(), false));
                break;
            case OP_THROW:
                this.emit(st, out, `throw ${R(a0)};`);
                break;
            case OP_CLASS: {
                const base = a1 !== -1 && a1 !== 0xFF ? R(a1) : null;
                if(a2 !== 0xFF)
                    R(a2);
                W(a0, new ClassExpr(base));
                break;
            }
            case OP_LINE:
            case OP_POSTFOREACH:
            case OP_POPTRAP:
                break;
            default:
                this.emit(st, out, `/* unknown op ${op} ${a0} ${a1} ${a2} ${a3} */`);
        }
    }
}

// compiled .nut buffer -> Squirrel source text
const decompile = (buf) => {
    const f = load(buf);
    return `// decompiled from ${f.source}\n\n${new Decompiler(f).decompile()}\n`;
};

module.exports = {decompile};
