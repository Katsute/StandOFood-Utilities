// Copyright (C) 2026 Katsute <https://github.com/Katsute>

const {readFileSync, writeFileSync} = require("fs");
const {parse, join} = require("path");

const [input, output] = process.argv.slice(2);
const { dir, name } = parse(output ?? input);

const buf = readFileSync(input);
const length = buf.readUInt32LE(0);
const alpha = buf.subarray(8 + length);

writeFileSync(join(dir, `${name}.jpg`), buf.subarray(4, 4 + length));
if(alpha.length)
    writeFileSync(join(dir, `${name}.alpha.jpg`), alpha);