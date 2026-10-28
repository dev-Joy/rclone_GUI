/**
 * tests/fixtures/rclone/ 의 실제 rclone 출력을 읽는 도우미.
 *
 * @author dev-Joy 2026-10-28
 */

// ========== External imports ==========
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const DIR = resolve(import.meta.dirname, "..", "fixtures", "rclone");

export function readFixture(name: string, stream: "stdout" | "stderr" | "exit"): string {
    return readFileSync(join(DIR, `${name}.${stream}.txt`), "utf8");
}

export function fixtureLines(name: string): string[] {
    return readFixture(name, "stderr")
        .split(/\r?\n/)
        .filter((l) => l.trim() !== "");
}
