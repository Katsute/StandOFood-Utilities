// Copyright (C) 2026 Katsute <https://github.com/Katsute>

const {readFileSync, writeFileSync, existsSync} = require("fs");
const {parse, join} = require("path");

const [input, output] = process.argv.slice(2);
const {dir, name, ext} = parse(input);
const alphaPath = join(dir, `${name}.alpha${ext}`);

const color = readFileSync(input);
const alpha = existsSync(alphaPath) ? readFileSync(alphaPath) : Buffer.alloc(0);

const buf = Buffer.alloc(8 + color.length + alpha.length);
buf.writeUInt32LE(color.length, 0);
color.copy(buf, 4);
buf.writeUInt32LE(alpha.length, 4 + color.length);
alpha.copy(buf, 8 + color.length);

writeFileSync(output ?? join(dir, `${name}.mjp`), buf);