// Copyright (C) 2026 Katsute <https://github.com/Katsute>

// extracts a .bar file (a 7z archive), decompiles every compiled .nut to Squirrel source
// and converts every .pvr / .tga texture to .png
//
// the original bytes of every converted file are kept in <output>/.sof3 so compile.js can restore unedited files exactly

const {readFileSync, writeFileSync, mkdirSync, rmSync, readdirSync} = require("fs");
const {join, resolve, relative, extname, dirname, sep} = require("path");
const {createHash} = require("crypto");
const {unpack} = require("7zip-min");
const {isBytecode} = require("./lib/nut");
const {decompile} = require("./lib/nutdec");
const {decodePVR, decodeTGA, toPNG} = require("./lib/image");

const [input, output = join(__dirname, "temp")] = process.argv.slice(2);
if(!input){
    console.error("usage: node decompile.js <StandOFood3.bar> [output dir]");
    process.exit(1);
}
const root = resolve(output);
const meta = join(root, ".sof3");

(async () => {
    mkdirSync(root, {recursive: true});
    rmSync(meta, {recursive: true, force: true});
    await unpack(resolve(input), root);

    let files = 0, scripts = 0, images = 0;
    const failed = [];
    const manifest = {}; // converted file -> {name: archive name, sha1: of the converted file}

    // keeps the original next to the manifest and records what it was converted to
    const convert = (path, data, to, converted) => {
        const name = relative(root, path).split(sep).join("/");
        const original = join(meta, "original", name);
        mkdirSync(dirname(original), {recursive: true});
        writeFileSync(original, data);
        writeFileSync(to, converted);
        manifest[relative(root, to).split(sep).join("/")] = {name, sha1: createHash("sha1").update(converted).digest("hex")};
    };

    for(const entry of readdirSync(root, {recursive: true, withFileTypes: true})){
        if(!entry.isFile() || entry.parentPath.startsWith(meta))
            continue;
        files++;
        const path = join(entry.parentPath, entry.name);
        const ext = extname(entry.name).toLowerCase();
        try{
            if(ext === ".nut"){
                const data = readFileSync(path);
                if(isBytecode(data)){
                    convert(path, data, path, Buffer.from(decompile(data), "utf8"));
                    scripts++;
                }
            }else if(ext === ".pvr" || ext === ".tga"){
                const data = readFileSync(path);
                convert(path, data, path.slice(0, -ext.length) + ".png", toPNG(ext === ".pvr" ? decodePVR(data) : decodeTGA(data)));
                rmSync(path);
                images++;
            }
        }catch(e){
            failed.push(`${relative(root, path)}: ${e.message}`);
        }
    }

    writeFileSync(join(meta, "manifest.json"), JSON.stringify(manifest, null, 4));

    console.log(`${files} files extracted to ${root}, ${scripts} scripts decompiled, ${images} images converted`);
    if(failed.length){
        console.error(`${failed.length} files could not be converted (left as is):\n  ${failed.join("\n  ")}`);
        process.exitCode = 1;
    }
})();
