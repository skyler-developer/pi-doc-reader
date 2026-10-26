import { describe, expect, it } from "vitest";
import { analyzePdf, renderPagePng } from "../src/pdf.ts";
import { buildPdf } from "./pdf-fixtures.ts";

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

describe("analyzePdf", () => {
	it("extracts per-page text and flags textless pages as scanned", async () => {
		const buffer = buildPdf([
			{ text: "Quarterly revenue report for Q3 with details" },
			{}, // no text layer
			{ text: "Conclusion and outlook for the next quarter" },
		]);
		const analysis = await analyzePdf(buffer);
		expect(analysis.totalPages).toBe(3);
		expect(analysis.pageTexts[0]).toContain("Quarterly revenue report");
		expect(analysis.pageTexts[1]).toBe("");
		expect(analysis.pageTexts[2]).toContain("Conclusion and outlook");
		expect(analysis.scannedPages).toEqual([2]);
	});

	it("handles single-page text PDFs", async () => {
		const buffer = buildPdf([{ text: "A single page of extractable text content" }]);
		const analysis = await analyzePdf(buffer);
		expect(analysis.totalPages).toBe(1);
		expect(analysis.scannedPages).toEqual([]);
	});
});

describe("renderPagePng", () => {
	it("renders a page to a PNG buffer", async () => {
		const buffer = buildPdf([{ text: "render me" }, {}]);
		const png = await renderPagePng(buffer, 2, 300);
		expect(png.subarray(0, 4).equals(PNG_MAGIC)).toBe(true);
	});

	it("caps the longest side at the requested dimension", async () => {
		const buffer = buildPdf([{ text: "big page" }]);
		const png = await renderPagePng(buffer, 1, 200);
		expect(png.subarray(0, 4).equals(PNG_MAGIC)).toBe(true);
		// 612x792pt page at scale ≤ 200/792 — the PNG header encodes width/height
		// in bytes 16-23 (big-endian); verify height ≤ 200.
		const height = png.readUInt32BE(20);
		expect(height).toBeLessThanOrEqual(200);
	});
});
