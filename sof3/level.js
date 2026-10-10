// Copyright (C) 2026 Katsute <https://github.com/Katsute>

// writes data.json back into the decompiled scripts of a folder made by decompile.js
//
// only values that differ from what's in the scripts are rewritten, in place; unchanged files are left untouched
// so compile.js keeps their original bytecode

const {readFileSync, writeFileSync} = require("fs");
const {join} = require("path");
const {extract, plain, unsnake} = require("./lib/dataset");
const {validate, resolveRef} = require("./lib/schema");

const [input, dir = join(__dirname, "temp")] = process.argv.slice(2);
if(!input){
    console.error("usage: node level.js <data.json> [decompiled dir]");
    process.exit(1);
}

const schema = JSON.parse(readFileSync(join(__dirname, "data.schema.json"), "utf8"));
const data = JSON.parse(readFileSync(input, "utf8"));

const fail = (errors) => {
    console.error(errors.join("\n"));
    process.exit(1);
};

// validate

const schemaErrors = validate(schema, schema, data);
if(schemaErrors.length)
    fail(schemaErrors);

const {root, files} = extract(dir);
const current = plain(root);
const errors = [];

// game rules a schema can't express

for(const name of Object.keys(current.recipes))
    if(!(name in data.recipes))
        errors.push(`recipes.${name}: existing recipes can't be removed, the game's scripts refer to them`);

const levelType = (l, bases) => l.type ?? (bases[l.base] && levelType(bases[l.base], bases));
const isTapper = (l, bases) => l.base === "LevelTapper" || (bases[l.base] && isTapper(bases[l.base], bases));

for(const [cafe, {levels}] of Object.entries(data.cafes)){
    const ids = levels.map((l) => l.id);
    const was = current.cafes[cafe].levels.map((l) => l.id);
    if(ids.join() !== was.join())
        errors.push(`cafes.${cafe}.levels: level ids and order are read-only (expected ${was.join(", ")})`);

    levels.forEach((l, i) => {
        const at = `cafes.${cafe}.levels[${i}]`;
        const type = (isTapper(l, data.level_bases) ? "Tapper" : "") + levelType(l, data.level_bases);
        const recipes = [
            ...(l.recipes_params ?? []).map((p) => p.recipe),
            ...(l.bonus_recipes_params ?? []),
            ...(l.recipes ?? []),
            ...(l.tutorial_customers ?? []).map((c) => c.recipe),
            ...[l.tutorial_customer_recipe, l.tutorial_customer_recipe_hard].filter(Boolean),
            ...Object.values(l.objects_params ?? {}).map((o) => o.recipe).filter(Boolean)
        ];
        for(const r of new Set(recipes))
            if(!data.recipes[r])
                errors.push(`${at}: recipe ${r} doesn't exist`);
            else if(data.recipes[r].type !== type)
                errors.push(`${at}: recipe ${r} is a ${data.recipes[r].type} recipe, this is a ${type} level`);
    });
}

if(errors.length)
    fail(errors);

// diff data.json against the scripts and collect source edits

const edits = [];
let order = 0;

const src = (node) => files[node.file].slice(node.start, node.end);
const nodeKey = (node) => `${node.file}:${node.start}:${node.end}`;

const resolve = (s, v) => {
    if(!s)
        return {};
    let r = s;
    if(s.$ref){
        const {$ref, ...rest} = s;
        r = {...resolve(resolveRef(schema, $ref), v), ...rest};
    }
    if(r.oneOf){
        const match = r.oneOf.find((o) => !validate(schema, o, v).length) ?? r.oneOf[0];
        const {oneOf, ...rest} = r;
        r = {...rest, ...resolve(match, v)};
    }
    return r;
};
const refName = (s) => s?.$ref?.split("/").pop();

const childSchema = (s, v, key) => {
    const r = resolve(s, v);
    if(Array.isArray(v))
        return r.items;
    return r.properties?.[key] ?? (typeof r.additionalProperties === "object" ? r.additionalProperties : undefined);
};

const quote = (s) => "\"" + s.replace(/\\/g, "\\\\").replace(/"/g, "\\\"").replace(/\n/g, "\\n").replace(/\r/g, "\\r").replace(/\t/g, "\\t") + "\"";
const number = (v, float) => float ? (Number.isInteger(v) ? v.toFixed(1) : String(v)) : String(v);

// renders a value as Squirrel source, using the schema to know what kind of name a string is
// ind is the indentation of the line the value starts on; long values wrap one item per line like the decompiler's
const render = (v, s, ind = "") => {
    const wrap = (open, items, close) => {
        const pad = open === "{" ? " " : "";
        const one = items.length ? open + pad + items.join(", ") + pad + close : open + close;
        if(ind.length + one.length < 100 && !one.includes("\n"))
            return one;
        return `${open}\n${items.map((i) => `${ind}    ${i}`).join(",\n")}\n${ind}${close}`;
    };
    if(v === null || typeof v === "boolean")
        return String(v);
    const name = refName(s);
    const r = resolve(s, v);
    if(typeof v === "string"){
        if(/ngredient$/.test(name)) return `CIngredient${v}`;
        if(name === "customer" || name === "recipeCustomer") return `CCustomer${v}`;
        if(name === "recipeName") return `Recipes.${v}`;
        if(name === "bonusRecipe") return `{ Recipe = Recipes.${v} }`;
        if(name === "levelType") return `::LevelTypes.${v}`;
        if(name === "recipeType") return `::RecipeTypes.${v}`;
        if(name === "upgradeType") return `::UpgradeTypes.${v}`;
        if(name === "snack") return quote(v && `Consumable${v}`);
        return quote(v);
    }
    if(typeof v === "number")
        return number(v, r.type !== "integer");
    if(Array.isArray(v))
        return wrap("[", v.map((x) => render(x, r.items, ind + "    ")), "]");
    const keys = refName(r.propertyNames);
    const items = Object.entries(v).map(([k, x]) => {
        const key = keys === "levelType" ? `[::LevelTypes.${k}]` : /ngredient$/.test(keys) ? `Ingredient${k}` : unsnake(k);
        return `${key} = ${render(x, childSchema(s, v, k), ind + "    ")}`;
    });
    if(name === "recipe")
        items.unshift("Name = ::Strings.MENU_YES");
    return wrap("{", items, "}");
};

// a changed primitive, written in the style of the value it replaces
const renderLeaf = (v, bv, s) => {
    const node = bv.node;
    const old = bv.v;
    if(typeof v === "string" && typeof old === "string" && old){
        if(node.k === "ref" && src(node).endsWith(old))
            return src(node).slice(0, -old.length) + v;
        if(node.k === "lit" && typeof node.v === "string" && node.v.endsWith(old))
            return quote(node.v.slice(0, -old.length) + v);
    }
    if(typeof v === "number"){
        const lit = node.k === "un" ? node.a : node;
        if(lit.k === "lit" && lit.raw)
            return number(v, /[.e]/.test(lit.raw) || !Number.isInteger(v));
    }
    return render(v, s, lineIndent(node));
};

const edit = (node, text, path) => edits.push({file: node.file, start: node.start, end: node.end, text, path, order: order++});
const insert = (file, at, text, path) => edits.push({file, start: at, end: at, text, path, order: order++});

const lineStart = (file, at) => files[file].lastIndexOf("\n", at - 1) + 1;
const indentOf = (file, at) => files[file].slice(lineStart(file, at), at).match(/^\s*/)[0];
const lineIndent = (node) => indentOf(node.file, node.start);

const keyText = (bv, key) => {
    if(bv.keys === "levelType") return `[::LevelTypes.${key}]`;
    if(bv.keys === "ingredient") return `Ingredient${key}`;
    if(bv.keys === "raw") return /^[A-Za-z_][A-Za-z0-9_]*$/.test(key) ? key : `[${quote(key)}]`;
    return unsnake(key);
};

const addKey = (bv, key, v, s, path) => {
    if(bv.kind === "class"){
        const {file, close} = bv.cls;
        insert(file, lineStart(file, close), `    static ${unsnake(key)} = ${render(v, s, "    ")};\n`, path);
        return;
    }
    if(bv.kind !== "table")
        return errors.push(`${path}: can't be added here`);
    const node = bv.node;
    const last = node.entries.at(-1);
    const multiline = last && files[node.file].slice(node.start, node.entries[0].start).includes("\n");
    const entry = `${keyText(bv, key)} = ${render(v, s, multiline ? indentOf(node.file, last.start) : lineIndent(node))}`;
    if(!last)
        return edit(node, `{ ${entry} }`, path);
    insert(node.file, last.end, multiline ? `,\n${indentOf(node.file, last.start)}${entry}` : `, ${entry}`, path);
};

const removeKey = (bv, key, path) => {
    const child = bv.v[key];
    if(bv.kind === "class" && child.member && child.own !== false){
        const {file} = bv.cls;
        const {start, end} = child.member;
        const ls = lineStart(file, start);
        const whole = !files[file].slice(ls, start).trim() && files[file][end] === "\n";
        edits.push({file, start: whole ? ls : start, end: whole ? end + 1 : end, text: "", path, order: order++});
        return;
    }
    if(bv.kind === "table" && child.entry){
        const entries = bv.node.entries;
        const i = entries.indexOf(child.entry);
        const [start, end] = i < entries.length - 1 ? [entries[i].start, entries[i + 1].start] :
            i > 0 ? [entries[i - 1].end, entries[i].end] : [entries[i].start, entries[i].end];
        edits.push({file: bv.node.file, start, end, text: "", path, order: order++});
        return;
    }
    errors.push(`${path}: can't be removed${child.own === false ? " (inherited, not set on this class)" : ""}`);
};

const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const apply = (v, bv, s, path, skip = []) => {
    if(same(v, plain(bv)))
        return;
    if(isObject(v) && isObject(bv.v)){
        for(const key of new Set([...Object.keys(bv.v), ...Object.keys(v)])){
            if(skip.includes(key))
                continue;
            const at = `${path}.${key}`;
            const child = bv.v[key];
            const cs = childSchema(s, v, key);
            if(!(key in v))
                removeKey(bv, key, at);
            else if(!child)
                addKey(bv, key, v[key], cs, at);
            else if(bv.kind === "class" && child.own === false){
                if(!same(v[key], plain(child)))
                    addKey(bv, key, v[key], cs, at); // override the inherited value on this class
            }else
                apply(v[key], child, cs, at);
        }
        return;
    }
    if(!bv.node)
        return errors.push(`${path}: is read-only`);
    if(Array.isArray(v) && Array.isArray(bv.v) && v.length === bv.v.length && bv.node.k === "array"){
        v.forEach((x, i) => apply(x, bv.v[i], childSchema(s, v, i), `${path}[${i}]`));
        return;
    }
    const primitive = (x) => x === null || typeof x !== "object";
    if(primitive(v) && primitive(bv.v))
        edit(bv.node, renderLeaf(v, bv, s), path);
    else
        edit(bv.node, render(v, s, lineIndent(bv.node)), path);
};

const props = schema.properties;
for(const section of ["customers", "ingredients", "sauces", "snacks", "upgrades", "recipes", "difficulties", "consts"])
    apply(data[section], root.v[section], props[section], section);
for(const [name, bv] of Object.entries(root.v.level_bases.v))
    apply(data.level_bases[name], bv, props.level_bases.properties[name], `level_bases.${name}`);

const levelSchema = schema.$defs.level;
for(const [cafe, {levels}] of Object.entries(data.cafes))
    levels.forEach((l, i) => {
        const bv = root.v.cafes.v[cafe].v.levels.v[i];
        const at = `cafes.${cafe}.levels[${i}]`;
        if(l.base !== bv.v.base.v)
            errors.push(`${at}.base: is read-only`);
        apply(l, bv, levelSchema, at, ["id", "base", "next"]);

        // next lives in scripts/levels/LevelList.nut
        const entry = bv.list;
        if(!same(l.next, plain(bv).next)){
            if(!entry)
                errors.push(`${at}.next: ${l.id} isn't in LevelList.nut`);
            else{
                const {Next, ...rest} = plain(entry);
                apply(l.next ? {...rest, Next: l.next} : rest, entry,
                    {type: "object", properties: {Next: levelSchema.properties.next}}, `${at}.next`);
            }
        }
    });

// every path bound to the same source value must agree (e.g. shared GameConsts)

const bound = {};
const walk = (bv, v, path) => {
    if(bv.node && (bv.v === null || typeof bv.v !== "object"))
        (bound[nodeKey(bv.node)] ??= []).push({path, v});
    if(Array.isArray(bv.v))
        bv.v.forEach((x, i) => walk(x, v?.[i], `${path}[${i}]`));
    else if(isObject(bv.v))
        for(const [k, x] of Object.entries(bv.v))
            walk(x, v?.[k], `${path}.${k}`);
};
walk(root, data, "");
for(const e of edits){
    const shared = bound[nodeKey(e)];
    if(shared && shared.length > 1 && new Set(shared.map((b) => JSON.stringify(b.v))).size > 1)
        errors.push(`${e.path}: shares one game value with ${shared.map((b) => b.path.slice(1)).filter((p) => p !== e.path).join(", ")}; set them all to the same value`);
}

// files that can't be safely rewritten

for(const file of new Set(edits.filter((e) => e.text || e.start !== e.end).map((e) => e.file))){
    if(file === "res/Strings.nut")
        errors.push(`${edits.find((e) => e.file === file).path}: text comes from res/Strings.nut and is read-only`);
    else if(/\bgoto\b|\$r\d/.test(files[file]))
        errors.push(`${edits.find((e) => e.file === file).path}: ${file} has code the decompiler couldn't fully restore (goto or unknown registers), so it can't be rewritten`);
}

if(errors.length)
    fail([...new Set(errors)]);

// apply edits, back to front

const changed = {};
const byFile = {};
for(const e of edits.filter((e) => e.text || e.start !== e.end)){
    const list = byFile[e.file] ??= [];
    if(!list.some((x) => x.start === e.start && x.end === e.end && x.text === e.text))
        list.push(e);
}
for(const [file, list] of Object.entries(byFile)){
    list.sort((a, b) => b.start - a.start || b.order - a.order);
    for(let i = 1; i < list.length; i++)
        if(list[i].end > list[i - 1].start && !(list[i].start === list[i].end && list[i - 1].start === list[i - 1].end))
            fail([`${list[i].path} and ${list[i - 1].path} change overlapping source in ${file}`]);
    let text = files[file];
    for(const e of list)
        text = text.slice(0, e.start) + e.text + text.slice(e.end);
    changed[file] = text;
}

const write = (contents) => {
    for(const [file, text] of Object.entries(contents))
        writeFileSync(join(dir, file), text, "utf8");
};
write(changed);

// read the scripts back and make sure they now say what data.json says

const after = plain(extract(dir).root);
const mismatch = [];
const compare = (a, b, path) => {
    if(same(a, b))
        return;
    if(isObject(a) && isObject(b) || Array.isArray(a) && Array.isArray(b) && a.length === b.length)
        for(const k of new Set([...Object.keys(a), ...Object.keys(b)]))
            compare(a[k], b[k], Array.isArray(a) ? `${path}[${k}]` : `${path}.${k}`);
    else
        mismatch.push(`${path}: wrote ${JSON.stringify(b)}, expected ${JSON.stringify(a)}`);
};
compare(data, after, "");
if(mismatch.length){
    write(Object.fromEntries(Object.keys(changed).map((f) => [f, files[f]])));
    fail(["the rewritten scripts don't read back as data.json; nothing was changed:", ...mismatch.map((m) => "  " + m.slice(1))]);
}

const count = Object.keys(changed).length;
console.log(count ? `${count} scripts updated in ${dir}:\n  ${Object.keys(changed).join("\n  ")}` : "no changes");
