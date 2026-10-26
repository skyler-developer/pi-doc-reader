import { open, type FileHandle } from "node:fs/promises";

/**
 * Office-container detection by magic bytes, so renamed files still route correctly
 * and plain files fall through to the built-in read unchanged.
 */
export type DetectedFormat = "pdf" | "docx" | "xlsx" | "pptx" | "ole";

const OLE_MAGIC = Buffer.from([0xd0, 0xcf, 0x11, 0xe0]);
const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_DIR_SIGNATURE = 0x02014b50;

/**
 * Detect whether a file is a document this extension handles.
 * Returns null for anything else (including zips that are not office documents),
 * which means "delegate to the built-in read".
 */
export async function detectDocumentFormat(absolutePath: string): Promise<DetectedFormat | null> {
	const handle = await open(absolutePath, "r");
	try {
		const header = Buffer.alloc(8);
		const { bytesRead } = await handle.read(header, 0, 8, 0);
		if (bytesRead >= 4 && header.subarray(0, 4).equals(Buffer.from("%PDF", "latin1"))) {
			return "pdf";
		}
		if (bytesRead >= 4 && header.subarray(0, 4).equals(OLE_MAGIC)) {
			return "ole";
		}
		if (bytesRead >= 4 && header[0] === 0x50 && header[1] === 0x4b) {
			const names = await readZipEntryNames(handle);
			if (names.includes("word/document.xml")) return "docx";
			if (names.includes("xl/workbook.xml")) return "xlsx";
			if (names.some((name) => name.startsWith("ppt/"))) return "pptx";
			return null;
		}
		return null;
	} finally {
		await handle.close();
	}
}

/** Lists entry names from a zip's central directory without decompressing anything. */
async function readZipEntryNames(handle: FileHandle): Promise<string[]> {
	const stat = await handle.stat();
	const size = stat.size;
	if (size < 22) return [];

	// EOCD is in the last 65557 bytes (22-byte record + up to 64KB comment).
	const tailLen = Math.min(size, 65557);
	const tail = Buffer.alloc(tailLen);
	await handle.read(tail, 0, tailLen, size - tailLen);

	let eocd = -1;
	for (let i = tailLen - 22; i >= 0; i--) {
		if (tail.readUInt32LE(i) === EOCD_SIGNATURE) {
			eocd = i;
			break;
		}
	}
	if (eocd < 0) return [];

	const entryCount = tail.readUInt16LE(eocd + 10);
	const cdOffset = tail.readUInt32LE(eocd + 16);
	const eocdAbs = size - tailLen + eocd;
	const cdLen = eocdAbs - cdOffset;
	if (cdOffset >= size || cdLen <= 0 || cdLen > size) return [];

	const cd = Buffer.alloc(cdLen);
	await handle.read(cd, 0, cdLen, cdOffset);

	const names: string[] = [];
	let pos = 0;
	for (let i = 0; i < entryCount && pos + 46 <= cdLen; i++) {
		if (cd.readUInt32LE(pos) !== CENTRAL_DIR_SIGNATURE) break;
		const nameLen = cd.readUInt16LE(pos + 28);
		const extraLen = cd.readUInt16LE(pos + 30);
		const commentLen = cd.readUInt16LE(pos + 32);
		if (pos + 46 + nameLen > cdLen) break;
		names.push(cd.toString("latin1", pos + 46, pos + 46 + nameLen));
		pos += 46 + nameLen + extraLen + commentLen;
	}
	return names;
}
