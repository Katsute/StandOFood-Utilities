// Copyright (C) 2026 Katsute <https://github.com/Katsute>

// parser for the data subset of decompiled Squirrel: top-level `Name <- expr;` and class members
// every node keeps its source span ({file, start, end}) so values can be edited in place

const TOKEN = /\s+|\/\/[^\n]*|\/\*[\s\S]*?\*\/|("(?:\\.|[^"\\])*")|(\d+\.\d*(?:e[+-]?\d+)?|\d+(?:e[+-]?\d+)?)|([A-Za-z_@$][A-Za-z0-9_@$]*)|(::|<-|<<|>>>|>>|<=|>=|==|!=|&&|\|\||[{}\[\]();,.=+\-*\/%<>|&^!~?:])/gy;

const unescape = (s) => s.slice(1, -1).replace(/\\(.)/g, (_, c) => ({n: "\n", r: "\r", t: "\t"})[c] ?? c);

const tokenize = (src) => {
    const toks = [];
    TOKEN.lastIndex = 0;
    while(TOKEN.lastIndex < src.length){
        const start = TOKEN.lastIndex;
        const m = TOKEN.exec(src);
        if(!m)
            throw new Error(`unexpected ${JSON.stringify(src.slice(start, start + 20))}`);
        const end = TOKEN.lastIndex;
        if(m[1] !== undefined) toks.push({t: "str", v: unescape(m[1]), start, end});
        else if(m[2] !== undefined) toks.push({t: "num", v: Number(m[2]), raw: m[2], start, end});
        else if(m[3] !== undefined) toks.push({t: "id", v: m[3], start, end});
        else if(m[4] !== undefined) toks.push({t: "op", v: m[4], start, end});
    }
    toks.push({t: "eof", v: "", start: src.length, end: src.length});
    return toks;
};

const BINARY = [["||"], ["&&"], ["|"], ["^"], ["&"], ["==", "!="], ["<", "<=", ">", ">="], ["<<", ">>", ">>>"], ["+", "-"], ["*", "/", "%"]];

// AST nodes: lit {v, raw}, ref {path, root}, call {fn, args}, table {entries: [{key, value, start, end}]}, array {items},
// bin {op, a, b}, un {op, a}, tern {c, a, b}; all with {file, start, end}
class Parser {
    constructor(src, file){
        this.src = src;
        this.file = file;
        this.toks = tokenize(src);
        this.i = 0;
    }

    peek(o = 0){
        return this.toks[this.i + o];
    }

    next(){
        return this.toks[this.i++];
    }

    is(v, o = 0){
        const t = this.peek(o);
        return t.t !== "str" && t.v === v;
    }

    eat(v){
        const t = this.next();
        if(t.t === "str" || t.v !== v)
            throw new Error(`${this.file}: expected ${v}, got ${t.v} at ${t.start}`);
        return t;
    }

    node(k, start, props){
        return {k, file: this.file, start, end: this.toks[this.i - 1].end, ...props};
    }

    expr(level = 0){
        const start = this.peek().start;
        if(level === BINARY.length)
            return this.unary();
        let a = this.expr(level + 1);
        while(this.peek().t === "op" && BINARY[level].includes(this.peek().v)){
            const op = this.next().v;
            const b = this.expr(level + 1);
            a = this.node("bin", start, {op, a, b});
        }
        if(level === 0 && this.is("?")){
            this.next();
            const a2 = this.expr();
            this.eat(":");
            const b = this.expr();
            a = this.node("tern", start, {c: a, a: a2, b});
        }
        return a;
    }

    unary(){
        const start = this.peek().start;
        if(this.is("-") || this.is("!") || this.is("~")){
            const op = this.next().v;
            const a = this.unary();
            return this.node("un", start, {op, a});
        }
        return this.postfix(this.primary(), start);
    }

    primary(){
        const t = this.next();
        const start = t.start;
        if(t.t === "num")
            return this.node("lit", start, {v: t.v, raw: t.raw});
        if(t.t === "str")
            return this.node("lit", start, {v: t.v});
        if(t.t === "id"){
            if(t.v === "true" || t.v === "false")
                return this.node("lit", start, {v: t.v === "true"});
            if(t.v === "null")
                return this.node("lit", start, {v: null});
            if(t.v === "function" || t.v === "class")
                throw new Error(`${this.file}: not data`);
            return this.node("ref", start, {path: [t.v], root: false});
        }
        if(t.v === "::"){
            const id = this.next();
            return this.node("ref", start, {path: [id.v], root: true});
        }
        if(t.v === "("){
            const e = this.expr();
            this.eat(")");
            return e;
        }
        if(t.v === "{"){
            const entries = [];
            while(!this.is("}")){
                const s = this.peek().start;
                let key;
                if(this.is("[")){
                    this.next();
                    key = this.expr();
                    this.eat("]");
                }else
                    key = this.next().v;
                this.eat("=");
                const value = this.expr();
                entries.push({key, value, start: s, end: value.end});
                if(this.is(",") || this.is(";"))
                    this.next();
            }
            this.eat("}");
            return this.node("table", start, {entries});
        }
        if(t.v === "["){
            const items = [];
            while(!this.is("]")){
                items.push(this.expr());
                if(this.is(","))
                    this.next();
            }
            this.eat("]");
            return this.node("array", start, {items});
        }
        throw new Error(`${this.file}: unexpected ${t.v} at ${t.start}`);
    }

    postfix(e, start){
        for(;;){
            if(this.is(".") && e.k === "ref"){
                this.next();
                e.path.push(this.next().v);
                e.end = this.toks[this.i - 1].end;
            }else if(this.is("(")){
                this.next();
                const args = [];
                while(!this.is(")")){
                    args.push(this.expr());
                    if(this.is(","))
                        this.next();
                }
                this.eat(")");
                e = this.node("call", start, {fn: e, args});
            }else
                return e;
        }
    }

    // skips to the end of the next balanced {...}
    skipBlock(){
        while(!this.is("{"))
            this.next();
        let depth = 0;
        do{
            const t = this.next();
            if(t.t === "op" && t.v === "{") depth++;
            if(t.t === "op" && t.v === "}") depth--;
        }while(depth > 0);
    }

    skipStatement(){
        let depth = 0;
        for(;;){
            const t = this.next();
            if(t.t === "eof")
                return;
            if(t.t !== "op")
                continue;
            if("{[(".includes(t.v)) depth++;
            if("}])".includes(t.v)) depth--;
            if(depth <= 0 && (t.v === ";" || t.v === "}"))
                return;
        }
    }

    parseFile(){
        const globals = {}, classes = {};
        while(this.peek().t !== "eof"){
            if(this.is("class")){
                this.next();
                const name = this.next().v;
                let base = null;
                if(this.is("extends")){
                    this.next();
                    base = this.next().v;
                }
                classes[name] = {name, base, file: this.file, ...this.classBody()};
                continue;
            }
            if(this.is("function")){
                this.skipBlock();
                continue;
            }
            const start = this.i;
            if(this.is("::"))
                this.next();
            if(this.peek().t === "id" && this.is("<-", 1)){
                const name = this.next().v;
                this.next();
                try{
                    globals[name] = this.expr();
                    if(this.is(";"))
                        this.next();
                    continue;
                }catch{
                    this.i = start;
                }
            }
            this.skipStatement();
        }
        return {globals, classes};
    }

    // members: name -> {node, isStatic, start, end (whole statement, including ';')}
    classBody(){
        const members = {};
        const open = this.eat("{");
        while(!this.is("}")){
            if(this.is("function") || this.is("constructor")){
                this.skipBlock();
                continue;
            }
            if(this.is(";")){
                this.next();
                continue;
            }
            if(this.is("[")){
                this.skipStatement();
                continue;
            }
            const start = this.peek().start;
            const isStatic = this.is("static");
            if(isStatic)
                this.next();
            const name = this.next().v;
            this.eat("=");
            const at = this.i;
            try{
                const node = this.expr();
                if(this.is(";"))
                    this.next();
                members[name] = {node, isStatic, start, end: this.toks[this.i - 1].end};
            }catch{
                this.i = at;
                this.skipStatement();
            }
        }
        const close = this.eat("}");
        return {members, open: open.start, close: close.start};
    }
}

const parse = (src, file) => new Parser(src, file).parseFile();

module.exports = {parse};
