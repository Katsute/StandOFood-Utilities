// Copyright (C) 2026 Katsute <https://github.com/Katsute>

// PowerVR v2 (.pvr) and uncompressed .tga textures to RGBA; see DECOMPILE_NOTES.md §5

const {PNG} = require("pngjs");

const OGL_RGBA_4444 = 0x10, OGL_BGRA_8888 = 0x1A, D3D_DXT5 = 0x24;
const VERTICAL_FLIP = 0x10000;

const flip = (data, width, height) => {
    const row = width * 4;
    const out = Buffer.alloc(data.length);
    for(let y = 0; y < height; y++)
        data.copy(out, (height - 1 - y) * row, y * row, (y + 1) * row);
    return out;
};

const rgb565 = (v) => {
    const r = v >>> 11 & 31, g = v >>> 5 & 63, b = v & 31;
    return [r << 3 | r >>> 2, g << 2 | g >>> 4, b << 3 | b >>> 2];
};

// BC3: per 4x4 block, 8 bytes interpolated alpha then 8 bytes DXT1 color
const decodeDXT5 = (px, width, height) => {
    const out = Buffer.alloc(width * height * 4);
    let p = 0;
    for(let by = 0; by < height; by += 4)
        for(let bx = 0; bx < width; bx += 4, p += 16){
            const a0 = px[p], a1 = px[p + 1];
            const alpha = [a0, a1];
            if(a0 > a1)
                for(let i = 1; i < 7; i++)
                    alpha.push(((7 - i) * a0 + i * a1) / 7 | 0);
            else{
                for(let i = 1; i < 5; i++)
                    alpha.push(((5 - i) * a0 + i * a1) / 5 | 0);
                alpha.push(0, 255);
            }
            const alphaBits = px.readUIntLE(p + 2, 6);

            const c0 = rgb565(px.readUInt16LE(p + 8)), c1 = rgb565(px.readUInt16LE(p + 10));
            const color = [c0, c1,
                c0.map((v, i) => (2 * v + c1[i]) / 3 | 0),
                c0.map((v, i) => (v + 2 * c1[i]) / 3 | 0)];
            const colorBits = px.readUInt32LE(p + 12);

            for(let i = 0; i < 16; i++){
                const x = bx + (i & 3), y = by + (i >> 2);
                if(x >= width || y >= height)
                    continue;
                const o = (y * width + x) * 4;
                const [r, g, b] = color[colorBits >>> 2 * i & 3];
                out[o] = r;
                out[o + 1] = g;
                out[o + 2] = b;
                out[o + 3] = alpha[Math.floor(alphaBits / 2 ** (3 * i)) & 7];
            }
        }
    return out;
};

const decodePVR = (buf) => {
    const headerSize = buf.readUInt32LE(0);
    const height = buf.readUInt32LE(4);
    const width = buf.readUInt32LE(8);
    const flags = buf.readUInt32LE(16);
    if(buf.toString("latin1", 44, 48) !== "PVR!")
        throw new Error("not a PVR v2 file");
    const px = buf.subarray(headerSize);
    const n = width * height;
    let data;
    switch(flags & 0xFF){
        case OGL_BGRA_8888:
            data = Buffer.alloc(n * 4);
            for(let i = 0; i < n * 4; i += 4){
                data[i] = px[i + 2];
                data[i + 1] = px[i + 1];
                data[i + 2] = px[i];
                data[i + 3] = px[i + 3];
            }
            break;
        case OGL_RGBA_4444:
            // little-endian u16, R in the high nibble down to A in the low nibble
            data = Buffer.alloc(n * 4);
            for(let i = 0; i < n; i++){
                const v = px.readUInt16LE(i * 2);
                for(let c = 0; c < 4; c++)
                    data[i * 4 + c] = (v >>> 12 - 4 * c & 0xF) * 17;
            }
            break;
        case D3D_DXT5:
            data = decodeDXT5(px, width, height);
            break;
        default:
            throw new Error(`unsupported PVR pixel format 0x${(flags & 0xFF).toString(16)}`);
    }
    return {width, height, data: flags & VERTICAL_FLIP ? flip(data, width, height) : data};
};

const decodeTGA = (buf) => {
    const idLength = buf[0], colorMapType = buf[1], type = buf[2];
    const width = buf.readUInt16LE(12), height = buf.readUInt16LE(14);
    const bpp = buf[16], descriptor = buf[17];
    if(colorMapType !== 0 || type !== 2 || (bpp !== 24 && bpp !== 32))
        throw new Error(`unsupported TGA (type ${type}, ${bpp} bpp)`);
    const bytes = bpp / 8;
    const px = buf.subarray(18 + idLength);
    const n = width * height;
    const data = Buffer.alloc(n * 4);
    for(let i = 0; i < n; i++){
        const s = i * bytes, o = i * 4;
        data[o] = px[s + 2];
        data[o + 1] = px[s + 1];
        data[o + 2] = px[s];
        data[o + 3] = bytes === 4 ? px[s + 3] : 255;
    }
    // bit 5 set = rows stored top to bottom, otherwise bottom to top
    return {width, height, data: descriptor & 0x20 ? data : flip(data, width, height)};
};

const toPNG = (image) => PNG.sync.write(image);

const fromPNG = (buf) => {
    const {width, height, data} = PNG.sync.read(buf);
    return {width, height, data};
};

// simple range-fit BC3 encoder: endpoints are each block's min / max
const encodeDXT5 = (data, width, height) => {
    const out = Buffer.alloc(Math.ceil(width / 4) * Math.ceil(height / 4) * 16);
    const to565 = ([r, g, b]) => (r >>> 3) << 11 | (g >>> 2) << 5 | b >>> 3;
    let p = 0;
    for(let by = 0; by < height; by += 4)
        for(let bx = 0; bx < width; bx += 4, p += 16){
            const px = [];
            for(let i = 0; i < 16; i++){
                const x = Math.min(bx + (i & 3), width - 1), y = Math.min(by + (i >> 2), height - 1);
                const o = (y * width + x) * 4;
                px.push([data[o], data[o + 1], data[o + 2], data[o + 3]]);
            }

            const as = px.map((c) => c[3]);
            const a0 = Math.max(...as), a1 = Math.min(...as);
            out[p] = a0;
            out[p + 1] = a1;
            let alphaBits = 0;
            if(a0 > a1){
                // palette index for evenly spaced steps from a0 (0) to a1 (1): 0, 2, 3, 4, 5, 6, 7, 1
                const order = [0, 2, 3, 4, 5, 6, 7, 1];
                px.forEach((c, i) => alphaBits += order[Math.round((a0 - c[3]) / (a0 - a1) * 7)] * 2 ** (3 * i));
            }
            out.writeUIntLE(alphaBits, p + 2, 6);

            // pick the two most distant colors by luminance, then snap each pixel to the nearest palette entry
            const lum = (c) => c[0] * 2 + c[1] * 4 + c[2];
            let hi = px[0], lo = px[0];
            for(const c of px){
                if(lum(c) > lum(hi))
                    hi = c;
                if(lum(c) < lum(lo))
                    lo = c;
            }
            let c0 = to565(hi), c1 = to565(lo);
            if(c0 < c1)
                [c0, c1] = [c1, c0];
            out.writeUInt16LE(c0, p + 8);
            out.writeUInt16LE(c1, p + 10);
            const e0 = rgb565(c0), e1 = rgb565(c1);
            const palette = [e0, e1, e0.map((v, i) => (2 * v + e1[i]) / 3 | 0), e0.map((v, i) => (v + 2 * e1[i]) / 3 | 0)];
            let colorBits = 0;
            px.forEach((c, i) => {
                let best = 0, bestD = Infinity;
                palette.forEach((q, k) => {
                    const d = (c[0] - q[0]) ** 2 + (c[1] - q[1]) ** 2 + (c[2] - q[2]) ** 2;
                    if(d < bestD){
                        bestD = d;
                        best = k;
                    }
                });
                colorBits |= best << 2 * i;
            });
            out.writeUInt32LE(colorBits >>> 0, p + 12);
        }
    return out;
};

// re-encodes an image using the pixel format of the original file's header
const encodePVR = (original, {width, height, data}) => {
    const headerSize = original.readUInt32LE(0);
    const flags = original.readUInt32LE(16);
    if(flags & VERTICAL_FLIP)
        data = flip(data, width, height);
    const n = width * height;
    let px;
    switch(flags & 0xFF){
        case OGL_BGRA_8888:
            px = Buffer.alloc(n * 4);
            for(let i = 0; i < n * 4; i += 4){
                px[i] = data[i + 2];
                px[i + 1] = data[i + 1];
                px[i + 2] = data[i];
                px[i + 3] = data[i + 3];
            }
            break;
        case OGL_RGBA_4444:
            px = Buffer.alloc(n * 2);
            for(let i = 0; i < n; i++){
                let v = 0;
                for(let c = 0; c < 4; c++)
                    v = v << 4 | Math.round(data[i * 4 + c] / 17);
                px.writeUInt16LE(v, i * 2);
            }
            break;
        case D3D_DXT5:
            px = encodeDXT5(data, width, height);
            break;
        default:
            throw new Error(`unsupported PVR pixel format 0x${(flags & 0xFF).toString(16)}`);
    }
    const header = Buffer.from(original.subarray(0, headerSize));
    header.writeUInt32LE(height, 4);
    header.writeUInt32LE(width, 8);
    header.writeUInt32LE(px.length, 20);
    return Buffer.concat([header, px]);
};

const encodeTGA = (original, {width, height, data}) => {
    const header = Buffer.from(original.subarray(0, 18 + original[0]));
    const bytes = header[16] / 8;
    // TGA 2.0 footer after the pixels ("TRUEVISION-XFILE")
    const footer = original.subarray(header.length + original.readUInt16LE(12) * original.readUInt16LE(14) * bytes);
    if(!(header[17] & 0x20))
        data = flip(data, width, height);
    header.writeUInt16LE(width, 12);
    header.writeUInt16LE(height, 14);
    const n = width * height;
    const px = Buffer.alloc(n * bytes);
    for(let i = 0; i < n; i++){
        const s = i * 4, o = i * bytes;
        px[o] = data[s + 2];
        px[o + 1] = data[s + 1];
        px[o + 2] = data[s];
        if(bytes === 4)
            px[o + 3] = data[s + 3];
    }
    return Buffer.concat([header, px, footer]);
};

module.exports = {decodePVR, decodeTGA, encodePVR, encodeTGA, toPNG, fromPNG};
