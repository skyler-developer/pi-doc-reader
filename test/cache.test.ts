import { mkdtemp, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { cacheInfo, cacheKey, clearCache, readCache, writeCache } from "../src/cache.ts";

describe("cache", () => {
	it("round-trips entries keyed by content and settings", async () => {
		const dir = await mkdtemp(join(tmpdir(), "pi-doc-reader-"));
		const buffer = Buffer.from("document-bytes");
		const key = cacheKey(buffer, "docx");

		expect(await readCache(dir, key)).toBeNull();
		await writeCache(dir, key, { version: 1, format: "docx", markdown: "# hi" });
		expect(await readCache(dir, key)).toMatchObject({ format: "docx", markdown: "# hi" });

		// Different settings suffix → different key.
		const otherKey = cacheKey(buffer, "xlsx:50:30");
		expect(otherKey).not.toBe(key);
		expect(await readCache(dir, otherKey)).toBeNull();
	});

	it("rejects entries with a wrong version", async () => {
		const dir = await mkdtemp(join(tmpdir(), "pi-doc-reader-"));
		const key = cacheKey(Buffer.from("x"), "docx");
		const file = join(dir, key + ".json");
		await writeFile(file, JSON.stringify({ version: 999, format: "docx", markdown: "stale" }));
		expect(await readCache(dir, key)).toBeNull();
	});

	it("clears all entries and reports info", async () => {
		const dir = await mkdtemp(join(tmpdir(), "pi-doc-reader-"));
		await writeCache(dir, cacheKey(Buffer.from("a"), "docx"), { version: 1, format: "docx", markdown: "a" });
		await writeCache(dir, cacheKey(Buffer.from("b"), "docx"), { version: 1, format: "docx", markdown: "b" });

		const info = await cacheInfo(dir);
		expect(info.fileCount).toBe(2);
		expect(info.totalBytes).toBeGreaterThan(0);

		await clearCache(dir);
		expect((await readdir(dir)).filter((f) => f.endsWith(".json"))).toHaveLength(0);
	});
});
