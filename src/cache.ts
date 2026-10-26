import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

const CACHE_VERSION = 1;
const MAX_CACHE_BYTES = 500 * 1024 * 1024;

export interface CacheEntry {
	version: number;
	format: string;
	/** Converted markdown (docx/xlsx). */
	markdown: string;
	/** PDF analysis: total page count. */
	totalPages?: number;
	/** PDF analysis: extracted text per page (1-indexed parallel array). */
	pageTexts?: string[];
	/** PDF analysis: 1-indexed page numbers that look scanned. */
	scannedPages?: number[];
}

export interface CacheInfo {
	fileCount: number;
	totalBytes: number;
}

/** Cache key derived from the file content plus conversion settings. */
export function cacheKey(buffer: Buffer, settingsSuffix: string): string {
	return createHash("sha256").update(buffer).update("\u0000" + settingsSuffix).digest("hex").slice(0, 24);
}

export async function readCache(dir: string, key: string): Promise<CacheEntry | null> {
	try {
		const raw = await readFile(join(dir, key + ".json"), "utf8");
		const entry = JSON.parse(raw) as CacheEntry;
		if (typeof entry?.markdown !== "string" || typeof entry?.format !== "string" || entry.version !== CACHE_VERSION) {
			return null;
		}
		if (entry.format === "pdf") {
			if (
				typeof entry.totalPages !== "number" ||
				!Array.isArray(entry.pageTexts) ||
				!Array.isArray(entry.scannedPages)
			) {
				return null;
			}
		}
		return entry;
	} catch {
		return null;
	}
}

export async function writeCache(dir: string, key: string, entry: CacheEntry): Promise<void> {
	await mkdir(dir, { recursive: true });
	const file = join(dir, key + ".json");
	const tmp = file + ".tmp-" + process.pid;
	await writeFile(tmp, JSON.stringify(entry), "utf8");
	await rename(tmp, file);
	await pruneCache(dir).catch(() => {});
}

/** Path of the cached PNG rendering of one PDF page. */
export function pngCachePath(dir: string, key: string, pageNumber: number, maxDimension: number): string {
	return join(dir, `${key}-p${pageNumber}-${maxDimension}.png`);
}

export async function readCachePng(path: string): Promise<Buffer | null> {
	try {
		return await readFile(path);
	} catch {
		return null;
	}
}

export async function writeCachePng(path: string, png: Buffer): Promise<void> {
	const tmp = path + ".tmp-" + process.pid;
	await writeFile(tmp, png);
	await rename(tmp, path);
}

export async function clearCache(dir: string): Promise<void> {
	try {
		const files = await readdir(dir);
		await Promise.all(
			files.filter((f) => f.endsWith(".json") || f.endsWith(".png")).map((f) => unlink(join(dir, f)).catch(() => {})),
		);
	} catch {
		// Cache dir may not exist yet.
	}
}

export async function cacheInfo(dir: string): Promise<CacheInfo> {
	try {
		const files = (await readdir(dir)).filter((f) => f.endsWith(".json") || f.endsWith(".png"));
		let totalBytes = 0;
		for (const f of files) {
			const info = await stat(join(dir, f));
			totalBytes += info.size;
		}
		return { fileCount: files.length, totalBytes };
	} catch {
		return { fileCount: 0, totalBytes: 0 };
	}
}

/** Keeps the cache under MAX_CACHE_BYTES by deleting the oldest entries first. */
async function pruneCache(dir: string): Promise<void> {
	const files = await readdir(dir);
	const entries: { file: string; size: number; mtimeMs: number }[] = [];
	let total = 0;
	for (const f of files) {
		if (!f.endsWith(".json") && !f.endsWith(".png")) continue;
		try {
			const info = await stat(join(dir, f));
			entries.push({ file: f, size: info.size, mtimeMs: info.mtimeMs });
			total += info.size;
		} catch {
			// File vanished between readdir and stat.
		}
	}
	if (total <= MAX_CACHE_BYTES) return;
	entries.sort((a, b) => a.mtimeMs - b.mtimeMs);
	for (const entry of entries) {
		if (total <= MAX_CACHE_BYTES) break;
		await unlink(join(dir, entry.file)).catch(() => {});
		total -= entry.size;
	}
}
