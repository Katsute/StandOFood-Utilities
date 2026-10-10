// Copyright (C) 2026 Katsute <https://github.com/Katsute>

// packs a folder made by decompile.js back into a .bar file (a non-solid 7z archive)
//
// unedited scripts and images are restored from the originals in <input>/.sof3; edited ones are re-encoded:
//   .nut -> plain-text Squirrel source (latin-1), which the engine compiles on load
//   .png -> the original .pvr / .tga pixel format

const {readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync, readdirSync, copyFileSync, existsSync} = require("fs");
const {join, resolve, relative, dirname, extname, sep} = require("path");
const {tmpdir} = require("os");
const {createHash} = require("crypto");
const {cmd} = require("7zip-min");
const {encodePVR, encodeTGA, fromPNG} = require("./lib/image");

const [input, output] = process.argv.slice(2);
if(!input || !output){
    console.error("usage: node compile.js <decompiled dir> <output.bar>");
    process.exit(1);
}
const root = resolve(input);
const meta = join(root, ".sof3");
const target = resolve(output);

if(!existsSync(join(meta, "manifest.json"))){
    console.error(`${join(meta, "manifest.json")} not found, run decompile.js first`);
    process.exit(1);
}
const manifest = JSON.parse(readFileSync(join(meta, "manifest.json"), "utf8"));

const encode = (file, name, data, original) => {
    switch(extname(name).toLowerCase()){
        case ".nut": {
            const text = data.toString("utf8");
            if(/[^\x00-\xFF]/.test(text))
                throw new Error("contains characters that are not latin-1");
            return Buffer.from(text, "latin1");
        }
        case ".pvr": return encodePVR(original, fromPNG(data));
        case ".tga": return encodeTGA(original, fromPNG(data));
        default: throw new Error(`don't know how to encode ${file}`);
    }
};

(async () => {
    const stage = mkdtempSync(join(tmpdir(), "sof3-"));
    const edited = [], failed = [];
    let files = 0;

    try{
        for(const entry of readdirSync(root, {recursive: true, withFileTypes: true})){
            if(!entry.isFile() || entry.parentPath.startsWith(meta))
                continue;
            const path = join(entry.parentPath, entry.name);
            const file = relative(root, path).split(sep).join("/");
            const converted = manifest[file];
            const name = converted ? converted.name : file;
            const to = join(stage, name);
            mkdirSync(dirname(to), {recursive: true});
            files++;

            if(!converted){
                copyFileSync(path, to);
                continue;
            }
            const data = readFileSync(path);
            const original = readFileSync(join(meta, "original", name));
            if(createHash("sha1").update(data).digest("hex") === converted.sha1){
                writeFileSync(to, original);
                continue;
            }
            try{
                writeFileSync(to, encode(file, name, data, original));
                edited.push(file);
            }catch(e){
                writeFileSync(to, original);
                failed.push(`${file}: ${e.message}`);
            }
        }

        // 7z stores names relative to the working directory, with forward slashes
        rmSync(target, {force: true});
        mkdirSync(dirname(target), {recursive: true});
        const cwd = process.cwd();
        process.chdir(stage);
        try{
            await cmd(["a", "-t7z", "-ms=off", "-m0=LZMA:d=768k:lc=3:lp=0:pb=2", "-mtm=off", "-y", target, "*"]);
        }finally{
            process.chdir(cwd);
        }
    }finally{
        rmSync(stage, {recursive: true, force: true});
    }

    console.log(`${files} files packed into ${target}, ${edited.length} edited files re-encoded`);
    for(const file of edited)
        console.log(`  ${file}`);
    if(failed.length){
        console.error(`${failed.length} edited files could not be encoded (original used instead):\n  ${failed.join("\n  ")}`);
        process.exitCode = 1;
    }
})();
