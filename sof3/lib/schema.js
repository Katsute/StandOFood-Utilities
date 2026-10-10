// Copyright (C) 2026 Katsute <https://github.com/Katsute>

// JSON schema validation for the keywords used by data.schema.json

const typeOf = (v) =>
    Array.isArray(v) ? "array" :
    v === null ? "null" :
    Number.isInteger(v) ? "integer" :
    typeof v;

const resolveRef = (root, ref) => ref.slice(2).split("/").reduce((o, k) => o[k], root);

const validate = (root, s, v, at = "$", errors = []) => {
    if(s.$ref)
        validate(root, resolveRef(root, s.$ref), v, at, errors);

    const type = typeOf(v);
    if(s.type && s.type !== type && !(s.type === "number" && type === "integer")){
        errors.push(`${at}: expected ${s.type}, got ${type}`);
        return errors;
    }
    if("const" in s && v !== s.const)
        errors.push(`${at}: must be ${JSON.stringify(s.const)}`);
    if(s.enum && !s.enum.includes(v))
        errors.push(`${at}: ${JSON.stringify(v)} is not one of ${s.enum.join(", ")}`);
    if(s.minimum !== undefined && v < s.minimum)
        errors.push(`${at}: ${v} is less than ${s.minimum}`);
    if(s.maximum !== undefined && v > s.maximum)
        errors.push(`${at}: ${v} is more than ${s.maximum}`);
    if(s.minLength !== undefined && v.length < s.minLength)
        errors.push(`${at}: shorter than ${s.minLength} characters`);
    if(s.pattern && typeof v === "string" && !new RegExp(s.pattern).test(v))
        errors.push(`${at}: ${JSON.stringify(v)} doesn't match ${s.pattern}`);

    if(type === "object"){
        for(const k of s.required ?? [])
            if(!(k in v))
                errors.push(`${at}: missing ${k}`);
        for(const [k, val] of Object.entries(v)){
            if(s.propertyNames)
                validate(root, s.propertyNames, k, `${at} key ${JSON.stringify(k)}`, errors);
            if(s.properties?.[k])
                validate(root, s.properties[k], val, `${at}.${k}`, errors);
            else if(s.additionalProperties === false)
                errors.push(`${at}: unexpected property ${k}`);
            else if(typeof s.additionalProperties === "object")
                validate(root, s.additionalProperties, val, `${at}.${k}`, errors);
        }
    }

    if(type === "array"){
        if(s.minItems !== undefined && v.length < s.minItems)
            errors.push(`${at}: fewer than ${s.minItems} items`);
        if(s.maxItems !== undefined && v.length > s.maxItems)
            errors.push(`${at}: more than ${s.maxItems} items`);
        if(s.uniqueItems && new Set(v.map((e) => JSON.stringify(e))).size !== v.length)
            errors.push(`${at}: items are not unique`);
        if(s.items)
            v.forEach((e, i) => validate(root, s.items, e, `${at}[${i}]`, errors));
    }

    if(s.oneOf){
        const results = s.oneOf.map((o) => validate(root, o, v, at, []));
        const passed = results.filter((e) => !e.length).length;
        if(passed !== 1){
            // report the errors of the closest alternative of the right type
            const typed = results.filter((e) => !e.some((m) => m.startsWith(`${at}: expected `)));
            const closest = (typed.length ? typed : results).reduce((a, b) => b.length < a.length ? b : a);
            errors.push(...(passed ? [`${at}: matches more than one option`] : closest));
        }
    }
    return errors;
};

module.exports = {validate, resolveRef};
