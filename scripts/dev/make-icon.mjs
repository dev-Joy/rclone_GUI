/**
 * 앱 아이콘(build/icon.ico)을 만든다. 외부 이미지·폰트 없이 도형만 그린다.
 * 모티프·색은 트레이 아이콘(src/main/assets/tray.png)과 같다: 파란(#2563EB) 둥근 사각형 + 흰 양방향 화살표.
 * 크기마다 4×4 슈퍼샘플링으로 그려 PNG로 만들고(node:zlib), PNG 항목을 담은 ICO 하나로 묶는다.
 *
 * 실행: node scripts/dev/make-icon.mjs   (결과를 바꿨으면 build/icon.ico를 함께 커밋)
 *
 * @author dev-Joy 2026-10-29
 */

// ========== External imports ==========
import { writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { crc32, deflateSync } from "node:zlib";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const OUT = join(repoRoot, "build", "icon.ico");
const SIZES = [16, 24, 32, 48, 64, 128, 256];
const SS = 4;
const BLUE = [37, 99, 235];
const WHITE = [255, 255, 255];

// 도형은 32×32 격자 좌표(트레이 아이콘과 같은 배치)로 정의하고 크기에 맞춰 늘린다
const BG = { x0: 1, y0: 1, x1: 31, y1: 31, r: 8 };
const ARROWS = [
    // 위: 오른쪽 화살표 (몸통 + 머리)
    { shaft: [7, 10, 20, 13], tip: [26, 11.5], base: 19.5, half: 6 },
    // 아래: 왼쪽 화살표
    { shaft: [12, 19, 25, 22], tip: [6, 20.5], base: 12.5, half: 6 },
];

function f_InRoundRect(x, y) {
    if (x < BG.x0 || x >= BG.x1 || y < BG.y0 || y >= BG.y1) return false;
    const cx = Math.min(Math.max(x, BG.x0 + BG.r), BG.x1 - BG.r);
    const cy = Math.min(Math.max(y, BG.y0 + BG.r), BG.y1 - BG.r);
    return (x - cx) ** 2 + (y - cy) ** 2 <= BG.r ** 2;
}

function f_InArrow(x, y) {
    for (const a of ARROWS) {
        const [sx0, sy0, sx1, sy1] = a.shaft;
        if (x >= sx0 && x < sx1 && y >= sy0 && y < sy1) return true;
        // 머리: base(x)에서 tip까지 폭이 half → 0으로 줄어드는 삼각형
        const [tx, ty] = a.tip;
        const len = tx - a.base;
        const t = (x - a.base) / len;
        if (t >= 0 && t <= 1 && Math.abs(y - ty) <= a.half * (1 - t)) return true;
    }
    return false;
}

/** size×size RGBA 픽셀 */
function f_Render(size) {
    const px = Buffer.alloc(size * size * 4);
    const scale = 32 / size;
    for (let py = 0; py < size; py += 1) {
        for (let pxi = 0; pxi < size; pxi += 1) {
            let bg = 0;
            let fg = 0;
            for (let sy = 0; sy < SS; sy += 1) {
                for (let sx = 0; sx < SS; sx += 1) {
                    const x = (pxi + (sx + 0.5) / SS) * scale;
                    const y = (py + (sy + 0.5) / SS) * scale;
                    if (!f_InRoundRect(x, y)) continue;
                    bg += 1;
                    if (f_InArrow(x, y)) fg += 1;
                }
            }
            const n = SS * SS;
            const o = (py * size + pxi) * 4;
            if (bg === 0) continue;
            // 화살표는 배경 안에만 있으므로 색은 배경 대비 화살표 비율로 섞는다
            const k = fg / bg;
            for (let c = 0; c < 3; c += 1) px[o + c] = Math.round(BLUE[c] * (1 - k) + WHITE[c] * k);
            px[o + 3] = Math.round((255 * bg) / n);
        }
    }
    return px;
}

function f_Chunk(type, data) {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
}

function f_Png(size, rgba) {
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(size, 0);
    ihdr.writeUInt32BE(size, 4);
    ihdr[8] = 8; // 비트 깊이
    ihdr[9] = 6; // RGBA
    const raw = Buffer.alloc(size * (size * 4 + 1));
    for (let y = 0; y < size; y += 1) {
        raw[y * (size * 4 + 1)] = 0; // 필터 없음
        rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
    }
    return Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        f_Chunk("IHDR", ihdr),
        f_Chunk("IDAT", deflateSync(raw, { level: 9 })),
        f_Chunk("IEND", Buffer.alloc(0)),
    ]);
}

/** PNG 항목을 담은 ICO (Windows Vista 이상) */
function f_Ico(images) {
    const head = Buffer.alloc(6);
    head.writeUInt16LE(0, 0);
    head.writeUInt16LE(1, 2); // 아이콘
    head.writeUInt16LE(images.length, 4);
    const dir = Buffer.alloc(16 * images.length);
    let offset = 6 + dir.length;
    images.forEach(({ size, png }, i) => {
        const o = i * 16;
        dir[o] = size >= 256 ? 0 : size;
        dir[o + 1] = size >= 256 ? 0 : size;
        dir[o + 2] = 0; // 팔레트 없음
        dir[o + 3] = 0;
        dir.writeUInt16LE(1, o + 4); // 색 평면
        dir.writeUInt16LE(32, o + 6); // 비트 수
        dir.writeUInt32LE(png.length, o + 8);
        dir.writeUInt32LE(offset, o + 12);
        offset += png.length;
    });
    return Buffer.concat([head, dir, ...images.map((x) => x.png)]);
}

const images = SIZES.map((size) => ({ size, png: f_Png(size, f_Render(size)) }));
const ico = f_Ico(images);
writeFileSync(OUT, ico);
console.log(`build/icon.ico ${ico.length} bytes (${SIZES.join(", ")})`);
