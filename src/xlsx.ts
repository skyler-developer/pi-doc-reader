import ExcelJS from "exceljs";

export interface XlsxLimits {
	/** Maximum rows rendered per sheet. */
	maxRowsPerSheet: number;
	/** Maximum columns rendered per sheet. */
	maxColsPerSheet: number;
}

export const DEFAULT_XLSX_LIMITS: XlsxLimits = { maxRowsPerSheet: 50, maxColsPerSheet: 30 };

/** Converts an XLSX buffer to markdown, one table per sheet. */
export async function convertXlsx(buffer: Buffer, limits: XlsxLimits = DEFAULT_XLSX_LIMITS): Promise<string> {
	const workbook = new ExcelJS.Workbook();
	await workbook.xlsx.load(buffer);

	const sections: string[] = [];
	const summary: string[] = [];
	for (const sheet of workbook.worksheets) {
		const totalRows = sheet.rowCount;
		const totalCols = sheet.columnCount;
		summary.push(`"${sheet.name}" (${totalRows} rows × ${totalCols} cols)`);

		const lines: string[] = [];
		lines.push(`## Sheet: ${sheet.name}`);
		lines.push("");

		const renderRows = Math.min(totalRows, limits.maxRowsPerSheet);
		const renderCols = Math.min(totalCols, limits.maxColsPerSheet);
		const rows: string[][] = [];
		for (let rowNum = 1; rowNum <= renderRows; rowNum++) {
			const row = sheet.getRow(rowNum);
			const cells: string[] = [];
			for (let colNum = 1; colNum <= renderCols; colNum++) {
				cells.push(cellToString(row.getCell(colNum).value));
			}
			if (cells.some((cell) => cell !== "")) {
				rows.push(cells);
			}
		}

		if (rows.length === 0) {
			lines.push("(empty sheet)");
			sections.push(lines.join("\n"));
			continue;
		}

		for (let i = 0; i < rows.length; i++) {
			lines.push("| " + rows[i]!.map(escapeCell).join(" | ") + " |");
			if (i === 0) {
				lines.push("|" + rows[0]!.map(() => " --- ").join("|") + "|");
			}
		}
		lines.push("");
		if (totalRows > limits.maxRowsPerSheet || totalCols > limits.maxColsPerSheet) {
			const notes: string[] = [];
			if (totalRows > limits.maxRowsPerSheet) {
				notes.push(`first ${renderRows} of ${totalRows} rows`);
			}
			if (totalCols > limits.maxColsPerSheet) {
				notes.push(`first ${renderCols} of ${totalCols} columns`);
			}
			lines.push(`[Truncated: showing ${notes.join(", ")}. Ask for specific cells via bash (e.g. python + openpyxl) if you need the rest.]`);
			lines.push("");
		}
		sections.push(lines.join("\n"));
	}

	const header = `[XLSX: ${workbook.worksheets.length} sheet${workbook.worksheets.length === 1 ? "" : "s"} — ${summary.join(", ")}]\n`;
	return header + "\n" + sections.join("\n");
}

function escapeCell(text: string): string {
	return text.replace(/\|/g, "\\|").replace(/\r?\n/g, " ").trim();
}

/** Formats an exceljs cell value (formula results, rich text, hyperlinks, dates) as a string. */
function cellToString(value: unknown): string {
	if (value === null || value === undefined) return "";
	if (value instanceof Date) return value.toISOString();
	if (typeof value !== "object") return String(value);
	const v = value as Record<string, unknown>;
	if (Array.isArray(v.richText)) {
		return (v.richText as { text: string }[]).map((part) => part.text).join("");
	}
	if (v.formula !== undefined || v.sharedFormula !== undefined) {
		return scalarToString(v.result);
	}
	if (typeof v.hyperlink === "string") {
		return typeof v.text === "string" ? v.text : v.hyperlink;
	}
	if (typeof v.error === "string") {
		return "#" + v.error.replace(/^#/, "");
	}
	if (typeof v.text === "string") return v.text;
	return scalarToString(v.result);
}

function scalarToString(value: unknown): string {
	if (value === null || value === undefined) return "";
	if (value instanceof Date) return value.toISOString();
	return String(value);
}
