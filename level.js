// Copyright (C) 2026 Katsute <https://github.com/Katsute>

const {readFileSync, writeFileSync} = require("fs");
const {join} = require("path");

const [input, output = "levels.xml"] = process.argv.slice(2);
const data = JSON.parse(readFileSync(input, "utf8"));
const schema = JSON.parse(readFileSync(join(__dirname, "data.schema.json"), "utf8"));

// validate (supports the keywords used by data.schema.json)

const typeOf = (v) =>
    Array.isArray(v) ? "array" :
    v === null ? "null" :
    Number.isInteger(v) ? "integer" :
    typeof v;

const validate = (s, v, at, errors) => {
    if(s.$ref)
        return validate(s.$ref.slice(2).split("/").reduce((o, k) => o[k], schema), v, at, errors);

    const type = typeOf(v);
    if(s.type && s.type !== type && !(s.type === "number" && type === "integer"))
        return errors.push(`${at}: expected ${s.type}, got ${type}`);
    if(s.enum && !s.enum.includes(v))
        errors.push(`${at}: ${JSON.stringify(v)} is not one of ${s.enum.join(", ")}`);
    if(s.minimum !== undefined && v < s.minimum)
        errors.push(`${at}: ${v} is less than ${s.minimum}`);
    if(s.minLength !== undefined && v.length < s.minLength)
        errors.push(`${at}: shorter than ${s.minLength} characters`);

    if(type === "object"){
        for(const k of s.required ?? [])
            if(!(k in v))
                errors.push(`${at}: missing ${k}`);
        for(const [k, val] of Object.entries(v))
            if(s.properties?.[k])
                validate(s.properties[k], val, `${at}.${k}`, errors);
            else if(s.additionalProperties === false)
                errors.push(`${at}: unexpected property ${k}`);
    }

    if(type === "array"){
        if(s.minItems !== undefined && v.length < s.minItems)
            errors.push(`${at}: fewer than ${s.minItems} items`);
        if(s.maxItems !== undefined && v.length > s.maxItems)
            errors.push(`${at}: more than ${s.maxItems} items`);
        if(s.uniqueItems && new Set(v.map((e) => JSON.stringify(e))).size !== v.length)
            errors.push(`${at}: items are not unique`);
        if(s.items)
            v.forEach((e, i) => validate(s.items, e, `${at}[${i}]`, errors));
    }

    if(s.oneOf && s.oneOf.filter((o) => { const e = []; validate(o, v, at, e); return !e.length; }).length !== 1)
        errors.push(`${at}: must match exactly one of ${s.oneOf.map((o) => JSON.stringify(o)).join(", ")}`);
};

const errors = [];
validate(schema, data, "$", errors);
if(errors.length){
    console.error(errors.join("\n"));
    process.exit(1);
}

// game constants not stored in the json

const customerIndex = {biznesman: 1, bizneswoman: 2, chudak: 3, fatman: 4, gangster: 5, glamour: 6, hippi: 7, sportsman: 11, stroitel: 12, tourist: 13};
const sliceIndex = ["BreadBottom", "BreadTop", "BeefPatty", "Bacon", "Chicken", "FishCake", "Pickles", "Tomato", "Lettuce", "Cheese", "Onion", "Egg"];
const deviceIndex = ["Coffee Machine", "Plate", "Conditioner", "Heater", "Packing", "Jukebox", "Ketchup", "Curry", "Tartar Sauce", "Mayonnaise", "Tabasco", "Secret Spices"];

// shop text lines, joined with a literal \\ in the xml
const shoptext = {
    "Coffee Machine": [
        ["The Basic Coffee Machine.", "It enables the cook", "to make sandwiches", "faster. You don't", "need to turn it on;", "it works automatically.", "Just buy it and run", "like the wind!"],
        ["The Enhanced Coffee Machine.", "It makes the cook", "run even faster!", "You don't need to", "turn it on; it", "works automatically."],
        ["The Professional Grade", "Coffee Machine.", "It allows you to make", "more sandwiches", "faster than", "the previous machines.", "You don't need to", "turn it on; it", "works automatically."]
    ],
    "Plate": [
        ["You can place any", "ingredient on a plate.", "Each plate can hold", "one ingredient.", "The more plates you", "buy, the more ingredients", "you can store for", "later use."]
    ],
    "Conditioner": [
        ["The Fan.", "Place it in the window", "to make the air in", "the restaurant fresher.", "This will make customers", "wait a little longer", "for their sandwiches."],
        ["The Air Conditioner.", "It replaces the fan.", "It makes the air", "even cooler and", "customers to wait", "even longer."],
        ["The Professional Grade", "Air Conditioner.", "It turns the", "restaurant into", "a cool oasis!", "Customers will be", "so happy to be", "inside, they'll wait", "a long time for", "their sandwich,", "even when you're", "stuck."]
    ],
    "Heater": [
        ["The Basic", "Sandwich Toaster.", "Toasted sandwiches cost", "more. It takes a", "second to warm the", "ingredients, so don't", "use it if the customer", "is about to leave."],
        ["The Enhanced", "Sandwich Toaster.", "It warms sandwiches", "even faster than", "the basic model!", "Sandwiches warmed", "with this unit also", "cost more."],
        ["The Professional Grade", "Sandwich Toaster.", "It makes sandwiches", "warm and tasty!"]
    ],
    "Packing": [
        ["The Paper Box.", "When you pack", "sandwich ingredients", "into a box, the", "customer will take", "it even if the", "ingredients are", "shuffled.", "Each box can hold", "one sandwich."]
    ],
    "Jukebox": [
        ["The LP Jukebox.", "When customers are", "close to leaving,", "click on this jukebox.", "Its selection of", "oldies but goodies", "will brighten their", "mood and encourage", "them to stay a", "little longer."],
        ["The CD Jukebox.", "Your customers will", "really perk up when", "they hear the hit songs", "this jukebox plays!", "They'll stay longer", "and tip better, too."],
        ["The Digital Jukebox.", "Your customers will", "start dancing when", "they hear the hip", "modern music that", "comes out of this jukebox!", "This will allow you", "to fill the most", "complicated orders", "with ease."]
    ],
    "Ketchup": [["Ketchup.", "Five portions.", "Goes best with beef.", "Don't place on", "sandwiches with", "tomato slices!"]],
    "Curry": [["Curry.", "Five portions.", "Goes best with", "chicken. Don't", "place on", "sandwiches with", "pickles!"]],
    "Tartar Sauce": [["Tartar sauce.", "Five portions.", "Best with Fishcake.", ""]],
    "Mayonnaise": [["Mayonaise.", "Five portions.", "Best with Bacon.", ""]],
    "Tabasco": [["Tabasco.", "Five portions.", "Use it with chicken,", "fish and beef.", "It costs more."]],
    "Secret Spices": [["Secret Spices.", "Five portions.", "Makes sandwiches", "tastier and more", "expensive."]]
};

// bistro -> level index -> bistros unlocked by clearing that level
const opens = {
    "Stand o' Breakfast": {0: ["Snack Shack"]},
    "Snack Shack": {3: ["Burger Bar"]},
    "Burger Bar": {2: ["Butch's"]},
    "Butch's": {0: ["Chicken House"]},
    "Chicken House": {0: ["Omelet Stand"], 1: ["Omelet Stand"]},
    "Omelet Stand": {0: ["Morning Cafe"]},
    "Morning Cafe": {1: ["Stand o' Cheese", "Cheese Heaven"]},
    "Stand o' Cheese": {1: ["Stand o' Beef"]},
    "Stand o' Beef": {1: ["Stand o' Leaf"]},
    "Stand o' Leaf": {1: ["Stand o' Veggies"]},
    "Stand o' Veggies": {1: ["Cafe Mix"]},
    "Cheese Heaven": {3: ["Vegetarian Paradise"]},
    "Vegetarian Paradise": {3: ["Cafe Mix"]},
    "Cafe Mix": {2: ["Big Breakfast"]},
    "Big Breakfast": {2: ["Fatty's", "Donald's", "Fairy's"]},
    "Fatty's": {2: ["Highway Stop"]},
    "Donald's": {0: ["Highway Stop"], 1: ["Highway Stop"]},
    "Fairy's": {2: ["Highway Stop"]},
    "Highway Stop": {6: ["Sunrise Stop"]},
    "Sunrise Stop": {2: ["Your Heart's Desire", "Egg and Chick"]},
    "Your Heart's Desire": {4: ["The Salad Princess"]},
    "Egg and Chick": {1: ["Beef and Cheese"]},
    "Beef and Cheese": {1: ["Veggie Buffet"]},
    "Veggie Buffet": {1: ["Variety Buffet"]},
    "The Salad Princess": {2: ["The Hen-House"]},
    "The Hen-House": {2: ["Double Trouble"]},
    "Variety Buffet": {2: ["Burger Joint"]},
    "Burger Joint": {2: ["Seafood Lover's Buffet"]},
    "Double Trouble": {2: ["Fast Buck's"]},
    "Fast Buck's": {0: ["Crossroads"]},
    "Seafood Lover's Buffet": {1: ["Rich and Greasy"]},
    "Rich and Greasy": {1: ["Crossroads"]},
    "Crossroads": {4: ["McMaster's"]},
    "McMaster's": {3: ["Complicated Burgers", "Strange but Tasty"]},
    "Complicated Burgers": {0: ["Easy Burgers"]},
    "Strange but Tasty": {1: ["Delicious Cafe"]},
    "Delicious Cafe": {3: ["Exotic Cuisine"]},
    "Exotic Cuisine": {1: ["Business Lunch"]},
    "Business Lunch": {4: ["Burger Megabar"]},
    "Burger Megabar": {6: ["The Only 24h"]},
    "The Only 24h": {6: ["City Shopping Mall"]},
    "City Shopping Mall": {4: ["Champion's"]}
};

const tutorial = `<tutorial name="Tutorial"><level name="Tutorial" lines_count="2" minScore="+0" not_shuffle_sandwitches_order="+" tutorial="+"><sandwitch count="1" name="Eggburger" group="fat"/><sandwitch count="1" name="Fishburger" group="fat"/><sandwitch count="1" name="Sandwich" group="fat"/><sandwitch count="1" name="Chickburger" group="fat"/><sandwitch count="1" name="Hamburger" group="fat"/><line index="0" length="3" x="0" y="0" slices="1,3,2,5,1,2,1,12,2"/><line index="1" length="3" x="0" y="0" slices="6,2,1,4,2,1"/></level></tutorial>`;

// xml

const escape = (v) => String(v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");

const tag = (name, attrs, children = "") => {
    const a = Object.entries(attrs)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => ` ${k}="${escape(v)}"`)
        .join("");
    return children ? `<${name}${a}>${children}</${name}>` : `<${name}${a}/>`;
};

const each = (list, fn) => list.map(fn).join("");

const sandwiches = (list) => each(list, (s) => tag("sandwitch", {count: s.count, name: s.type, group: s.group, face: s.face}));

const bistros = Object.keys(data.levels);

const xml = tag("game", {}, [
    tag("customers", {}, each(Object.entries(data.customers), ([name, c]) =>
        tag("customer", {name, index: customerIndex[name], ...c}))),
    tag("groups", {}, each(data.groups, (g) =>
        tag("group", {name: g.name, customers: g.customers.map((c) => customerIndex[c]).join(", ")}))),
    tag("slices", {}, each(sliceIndex, (name, i) =>
        tag("slice", {index: i + 1, name, cost: data.slices[name]}))),
    tag("devices", {}, each(deviceIndex, (name, i) => {
        const device = data.devices[name];
        const ingredient = data.ingredients[name];
        const costs = device ? Object.values(device) : [ingredient.cost];
        return tag("device", {name, index: i + 1},
            each(costs, (cost, l) => tag("level", {cost, shoptext: shoptext[name][l]?.join("\\\\")})) +
            each(ingredient?.slices ?? [], (s) => tag("slice", s)));
    })),
    tag("library", {}, each(data.sandwiches, (s) =>
        tag("sandwitch_info", {name: s.name, cost: s.cost, group: s.group, slices: s.slices.join(", ")}))),
    tutorial,
    tag("rush", {name: "Lunch rush"}, each(data.rush_levels, (l) =>
        tag("level", {name: l.name, lines_count: l.lines, minScore: `+${l.score}`, chemodan: l.bonus}, sandwiches(l.sandwiches)))),
    each(bistros, (name) => {
        const b = data.levels[name];
        return tag("bistro", {name, cleared_bonus: b.score, chemodan: b.bonus}, each(b.levels, (l, i) =>
            tag("level", {name: l.name, lines_count: l.lines, minScore: `+${l.score}`},
                sandwiches(l.sandwiches) +
                each(opens[name]?.[i] ?? [], (o) => tag("opens", {bistro: bistros.indexOf(o) + 1})))));
    })
].join(""));

writeFileSync(output, xml);