import { describe, expect, it } from "vitest";
import { convertDocx } from "../src/docx.ts";
import { buildDocx, SAMPLE_DOCX_XML } from "./fixtures.ts";

describe("convertDocx", () => {
	it("converts headings, paragraphs and tables to markdown", async () => {
		const markdown = await convertDocx(buildDocx(SAMPLE_DOCX_XML));
		expect(markdown).toContain("# Release Notes");
		expect(markdown).toContain("## plain paragraph two");
		expect(markdown).toContain("| Feature | Status |");
		expect(markdown).toContain("| --- | --- |");
		expect(markdown).toContain("| DOCX | done |");
		expect(markdown).toContain("| XLSX | done |");
	});
});
