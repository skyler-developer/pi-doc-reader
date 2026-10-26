import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { convertXlsx, DEFAULT_XLSX_LIMITS } from "../src/xlsx.ts";

async function buildSampleXlsx(): Promise<Buffer> {
	const workbook = new ExcelJS.Workbook();
	const sheet = workbook.addWorksheet("Summary");
	sheet.addRow(["Name", "Value", "Note"]);
	sheet.addRow(["alpha", 1, "first"]);
	sheet.addRow(["beta", 2, "second"]);
	sheet.getCell("B4").value = { formula: "SUM(B2:B3)", result: 6 };
	sheet.getCell("C4").value = { richText: [{ text: "total" }, { text: "!" }] };
	workbook.addWorksheet("Empty");
	return Buffer.from((await workbook.xlsx.writeBuffer()) as ArrayBuffer);
}

describe("convertXlsx", () => {
	it("converts sheets, values, formula results and rich text", async () => {
		const markdown = await convertXlsx(await buildSampleXlsx());
		expect(markdown).toContain('[XLSX: 2 sheets — "Summary" (4 rows × 3 cols), "Empty" (0 rows × 0 cols)]');
		expect(markdown).toContain("## Sheet: Summary");
		expect(markdown).toContain("| Name | Value | Note |");
		expect(markdown).toContain("| --- | --- | --- |");
		expect(markdown).toContain("| alpha | 1 | first |");
		expect(markdown).toContain("| total! |"); // rich text cell
		expect(markdown).toContain("| 6 |"); // formula result carried in the file
		expect(markdown).toContain("## Sheet: Empty");
		expect(markdown).toContain("(empty sheet)");
	});

	it("truncates rows and notes the truncation", async () => {
		const workbook = new ExcelJS.Workbook();
		const sheet = workbook.addWorksheet("Big");
		for (let i = 1; i <= 10; i++) {
			sheet.addRow([`row${i}`, i]);
		}
		const buffer = Buffer.from((await workbook.xlsx.writeBuffer()) as ArrayBuffer);
		const markdown = await convertXlsx(buffer, { maxRowsPerSheet: 5, maxColsPerSheet: 2 });
		expect(markdown).toContain("| row5 | 5 |");
		expect(markdown).toContain("| --- | --- |");
		expect(markdown).not.toContain("| row6");
		expect(markdown).toContain("first 5 of 10 rows");
	});
});
