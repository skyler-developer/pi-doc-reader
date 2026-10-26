import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { detectDocumentFormat } from "../src/detect.ts";
import { buildDocx, buildNonOfficeZip, SAMPLE_DOCX_XML } from "./fixtures.ts";

async function tempFile(name: string, content: string | Buffer): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), "pi-doc-reader-"));
	const path = join(dir, name);
	await writeFile(path, content);
	return path;
}

describe("detectDocumentFormat", () => {
	it("returns null for plain text", async () => {
		const path = await tempFile("notes.txt", "hello world\nline two\n");
		expect(await detectDocumentFormat(path)).toBeNull();
	});

	it("returns null for an empty file", async () => {
		const path = await tempFile("empty.txt", "");
		expect(await detectDocumentFormat(path)).toBeNull();
	});

	it("detects PDF by magic bytes regardless of extension", async () => {
		const path = await tempFile("report.bin", "%PDF-1.7\nfake pdf body");
		expect(await detectDocumentFormat(path)).toBe("pdf");
	});

	it("returns null for text renamed to .pdf", async () => {
		const path = await tempFile("fake.pdf", "just text, no pdf header");
		expect(await detectDocumentFormat(path)).toBeNull();
	});

	it("detects legacy OLE containers", async () => {
		const path = await tempFile("old.doc", Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0, 0, 0]));
		expect(await detectDocumentFormat(path)).toBe("ole");
	});

	it("detects DOCX by zip contents, not extension", async () => {
		const docx = buildDocx(SAMPLE_DOCX_XML);
		const renamed = await tempFile("report.pdf", docx); // docx bytes with wrong extension
		const plain = await tempFile("report.docx", docx);
		expect(await detectDocumentFormat(renamed)).toBe("docx");
		expect(await detectDocumentFormat(plain)).toBe("docx");
	});

	it("returns null for a zip that is not an office document", async () => {
		const path = await tempFile("archive.zip", buildNonOfficeZip());
		expect(await detectDocumentFormat(path)).toBeNull();
	});
});
