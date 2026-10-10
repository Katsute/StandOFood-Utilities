// Copyright (C) 2026 Katsute <https://github.com/Katsute>

// reads the game data out of a decompiled folder (see decompile.js) into the shape of data.json
//
// every value is a bound value (BV) that remembers which source node it came from, so level.js can write changes back:
//   {v, node}                        leaf: v is a primitive
//   {v: [BV], node}                  array
//   {v: {key: BV}, node, kind, ...}  object; kind "table" (a table literal), "class" (class members) or null (made up here)
// node is null for values that don't exist in the source (they are read-only)

const {readFileSync, readdirSync} = require("fs");
const {join, sep} = require("path");
const {parse} = require("./squirrel");

const leaf = (v, node = null) => ({v, node});
const array = (v, node = null) => ({v, node});
const object = (v, node = null, extra = {}) => ({v, node, kind: null, ...extra});

const plain = (bv) => Array.isArray(bv.v) ? bv.v.map(plain) :
    bv.v !== null && typeof bv.v === "object" ? Object.fromEntries(Object.entries(bv.v).map(([k, v]) => [k, plain(v)])) :
    bv.v;

// snake_case <-> source names; the reverse map is filled as keys are converted
const original = {};
const snake = (s) => {
    const k = s.replace(/([a-z0-9])([A-Z])/g, "$1_$2").replace(/([A-Z])([A-Z][a-z])/g, "$1_$2").toLowerCase();
    original[k] ??= s;
    return k;
};
const unsnake = (k) => original[k] ?? k.replace(/(^|_)([a-z])/g, (_, __, c) => c.toUpperCase());

const short = (name) => name.replace(/^C(?=(Ingredient|Customer|Consumable)[A-Z])/, "").replace(/^(Ingredient|Customer|Consumable)(?=[A-Z])/, "");

// maps whose keys are names, not field names
const NAMED = new Set(["objects_params", "preferred_snacks", "bonus", "tutorial_ingredients", "tutorial_ingredients_hard"]);

// not gameplay: presentation, and engine wiring
const PRESENTATION = /Animation|Tile|Icon|Music|Sound|Transition|Menu|Comics|String$|Arrow|Offset|Popup|Notification|Reflection|Effect|Hud|HUD|Cook(Direction|RouteName)|ShowingTime|Delay|Scale|PassMask|Selection|SELECTION|RANK_|Turning/;
const ENGINE = /^(m_|RECIPE_COMPARE|WAITING_PHASE|TRAY_STATE)|ObjectName$|Names?$|Idx$|^(CanSaveState|CameraCID|UpgradeShopMessage|DirectionAccuracy|Layer|Name)$/;
const isGameplay = (k) => !PRESENTATION.test(k) && !ENGINE.test(k);

const ENUMS = new Set(["LevelTypes", "RecipeTypes", "UpgradeTypes", "Recipes", "TilesetGroups"]);

const extract = (dir) => {
    const files = {}, globals = {}, classes = {};
    const scripts = readdirSync(join(dir, "scripts"), {recursive: true}).map((f) => join("scripts", f));
    for(const f of [...scripts, join("res", "Strings.nut")]){
        if(!f.endsWith(".nut"))
            continue;
        const file = f.split(sep).join("/");
        const src = readFileSync(join(dir, f), "utf8");
        files[file] = src;
        let parsed;
        try{
            parsed = parse(src, file);
        }catch{
            continue; // not a data file
        }
        Object.assign(globals, parsed.globals);
        Object.assign(classes, parsed.classes);
    }

    const entries = (table) => Object.fromEntries(table.entries.filter((e) => typeof e.key === "string").map((e) => [e.key, e.value]));
    const strings = entries(globals.Strings);
    const consts = entries(globals.GameConsts);
    const used = new Set();

    const text = (e) => files[e.file].slice(e.start, e.end);

    const evaluate = (e) => {
        switch(e.k){
            case "lit":
                return leaf(e.v, e);
            case "array":
                return array(e.items.map(evaluate), e);
            case "table": {
                const v = {};
                let keys = "raw";
                for(const entry of e.entries){
                    let key = entry.key;
                    if(typeof key !== "string"){
                        key = String(evaluate(key).v);
                        keys = "levelType";
                    }
                    v[key] = {...evaluate(entry.value), entry};
                }
                return object(v, e, {kind: "table", keys});
            }
            case "ref": {
                const [head, key] = e.path;
                if(head === "GameConsts" && key in consts){
                    used.add(key);
                    return evaluate(consts[key]);
                }
                if(head === "Strings" && key in strings)
                    return leaf(strings[key].v, strings[key]);
                if(ENUMS.has(head) && key && e.path.length === 2)
                    return leaf(key, e);
                if(e.path.length === 1 && /^C(Ingredient|Customer|Consumable)[A-Z]/.test(head))
                    return leaf(short(head), e);
                return leaf(text(e), e);
            }
            case "call":
                if(e.fn.k === "ref" && e.fn.path.join(".") === "Vector2")
                    return array(e.args.map(evaluate), e);
                return leaf(text(e), e);
            case "un": {
                const a = evaluate(e.a);
                return leaf(typeof a.v === "number" && e.op === "-" ? -a.v : text(e), e);
            }
            case "bin": {
                const a = evaluate(e.a).v, b = evaluate(e.b).v;
                const r = typeof a === "number" && typeof b === "number" ? {"+": a + b, "-": a - b, "*": a * b, "/": a / b}[e.op] : undefined;
                return leaf(r === undefined ? text(e) : Math.round(r * 1e9) / 1e9, e);
            }
            default:
                return leaf(text(e), e);
        }
    };

    // deep snake_case of object keys, leaving name-keyed maps alone
    const snakeKeys = (bv, named = false) => {
        if(Array.isArray(bv.v))
            return {...bv, v: bv.v.map((x) => snakeKeys(x))};
        if(bv.v === null || typeof bv.v !== "object")
            return bv;
        const v = {};
        for(const [k, x] of Object.entries(bv.v)){
            const key = named ? k : snake(k);
            v[key] = named ? snakeKeys(x) : snakeKeys(x, NAMED.has(key));
        }
        return {...bv, v, keys: named ? bv.keys : "snake"};
    };

    // class members as an object; inherited members are included (marked own: false) when asked
    const members = (name, inherit, filter) => {
        const v = {};
        for(const cls of inherit ? chain(name).reverse() : [name])
            for(const [k, m] of Object.entries(classes[cls].members))
                if(filter(k, m))
                    v[k] = {...evaluate(m.node), member: m, own: cls === name};
        return object(v, null, {kind: "class", cls: classes[name]});
    };
    const chain = (name) => name && classes[name] ? [name, ...chain(classes[name].base)] : [];
    const levelMember = (k, m) => (m.isStatic || !k.startsWith("m_")) && (isGameplay(k) || k === "LevelData" || k === "ObjectsParams");

    // ---- sections ----

    const CUSTOMER = ["Name", "Speed", "WaitingTime", "GratuityPercent", "GratuityTimePercent", "AngryTimePercent", "SnackWaitingTimePrecent", "PreferredSnacks"];
    const customers = {};
    for(const name of Object.keys(classes).filter((n) => /^CCustomer[A-Z]/.test(n) && n !== "CCustomerBase").sort()){
        const c = members(name, true, (k) => CUSTOMER.includes(k));
        c.v = Object.fromEntries(CUSTOMER.filter((k) => k in c.v).map((k) => [k, c.v[k]]));
        const s = snakeKeys(c);
        if(s.v.preferred_snacks)
            for(const x of Object.values(s.v.preferred_snacks.v))
                x.v = short(x.v);
        customers[short(name)] = s;
    }

    const ingredients = {};
    for(const name of Object.keys(classes).filter((n) => /^CIngredient[A-Z]/.test(n) && n !== "CIngredientBase").sort()){
        const cost = chain(name).map((c) => classes[c].members.Cost).find(Boolean);
        if(cost && chain(name)[0] === name && classes[name].members.Cost)
            ingredients[short(name)] = evaluate(cost.node);
    }

    const sauces = {};
    for(const entry of globals.Sauces.entries){
        const name = entry.key;
        const fields = entries(entry.value);
        const bonus = evaluate(fields.Bonus);
        bonus.v = Object.fromEntries(Object.entries(bonus.v).map(([k, x]) => [short(k), x]));
        bonus.keys = "ingredient";
        used.add(name);
        used.add(`Sauce${name}_Cost`);
        sauces[name] = object({cost: evaluate(consts[`Sauce${name}_Cost`]), bonus});
    }

    const snacks = {};
    for(const name of ["FrenchFries", "SoftDrinks", "Icecream", "Coffe"]){
        used.add(`${name}_Cost`);
        used.add(`Snack${name}_Cost`);
        snacks[name] = object({cost: evaluate(consts[`${name}_Cost`]), snack_cost: evaluate(consts[`Snack${name}_Cost`])});
    }

    // upgrade cost, plus any GameConsts sharing the cost's prefix (e.g. JukeboxUp1_WaitingBonus)
    const upgrades = {};
    for(const entry of globals.UpgradesInfo.entries){
        const fields = entries(entry.value);
        const u = {type: evaluate(fields.Type)};
        const cost = fields.Cost;
        if(cost.k === "ref" && cost.path[0] === "GameConsts"){
            const prefix = cost.path[1].replace(/Cost$/, "");
            for(const k of Object.keys(consts).filter((k) => k.startsWith(prefix))){
                used.add(k);
                u[snake(k.slice(prefix.length))] = evaluate(consts[k]);
            }
        }else
            u.cost = evaluate(cost);
        upgrades[entry.key] = object(u);
    }

    const RECIPE = {Type: "type", Ingredients: "ingredients", Customers: "customers"};
    const recipesTable = evaluate(globals.Recipes);
    for(const r of Object.values(recipesTable.v)){
        r.v = Object.fromEntries(Object.entries(RECIPE).filter(([k]) => k in r.v).map(([k, key]) => [key, r.v[k]]));
        r.keys = "recipe";
    }

    const difficulties = snakeKeys(evaluate(globals.DifficultyLevels));

    // levels
    const BASES = ["CLevel", "CLevelRecipesDay", "CLevelNorecipes", "CLevelTapper", "CLevelBrokenConveyors", "CLevelCatchIngredients", "CLevel_Tutorial", "CLevel_ClawTutorial"];
    const level = (cls) => {
        const m = members(cls, false, levelMember);
        const {LevelData, ...rest} = m.v;
        m.v = rest;
        const s = snakeKeys(m);
        const v = {base: leaf(classes[cls].base.slice(1))};
        if(LevelData)
            v.layout = LevelData;
        Object.assign(v, s.v);
        const rp = v.recipes_params;
        if(rp && Array.isArray(rp.v))
            for(const p of rp.v)
                if(p.v && typeof p.v === "object" && !Array.isArray(p.v))
                    p.v = Object.fromEntries(["recipe", "count"].filter((k) => k in p.v).map((k) => [k, p.v[k]]));
        const brp = v.bonus_recipes_params;
        if(brp && Array.isArray(brp.v) && brp.v.every((p) => Object.keys(p.v).length === 1 && p.v.recipe))
            brp.v = brp.v.map((p) => ({...p.v.recipe, wrapped: p}));
        return {...s, v};
    };
    original.layout = "LevelData";

    const levelBases = {};
    for(const cls of BASES){
        const b = level(cls);
        for(const k of ["recipes_params", "bonus_recipes_params"])
            if(Array.isArray(b.v[k]?.v) && !b.v[k].v.length)
                delete b.v[k];
        levelBases[cls.slice(1)] = b;
    }

    const levelList = evaluate(globals.LevelList);
    const listEntry = Object.fromEntries(levelList.v.map((e) => [e.v.Name.v, e]));
    const cafes = {};
    for(const entry of globals.LevelGroups.entries){
        const refs = entries(entry.value).Levels;
        const levels = refs.items.map((ref) => {
            const cls = ref.path[0];
            const id = cls.slice(1);
            const l = level(cls);
            l.v = {id: leaf(id), ...l.v};
            const next = listEntry[id]?.v.Next;
            if(next)
                l.v.next = next;
            l.list = listEntry[id];
            return l;
        });
        cafes[entry.key] = object({levels: array(levels)});
    }

    const rest = {};
    for(const k of Object.keys(consts).filter((k) => !used.has(k)))
        rest[snake(k)] = evaluate(consts[k]);

    const root = object({
        customers: object(customers),
        ingredients: object(ingredients),
        sauces: object(sauces),
        snacks: object(snacks),
        upgrades: object(upgrades),
        recipes: recipesTable,
        difficulties,
        level_bases: object(levelBases),
        cafes: object(cafes),
        consts: object(rest)
    });
    return {root, files, layouts: readdirSync(join(dir, "res")).filter((f) => f.endsWith(".lvl")).map((f) => f.slice(0, -4))};
};

module.exports = {extract, plain, unsnake};
