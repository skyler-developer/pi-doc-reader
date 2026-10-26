import { describe, expect, it } from "vitest";
import { convertPptx } from "../src/pptx.ts";
import { buildPptx } from "./pptx-fixtures.ts";

describe("convertPptx", () => {
	it("extracts titles, body paragraphs, notes and slide count; sorts slides numerically", async () => {
		const markdown = await convertPptx(buildPptx());
		expect(markdown).toContain("[PPTX: 3 slides]");
		// Numeric sort: slide10 after slide2, not lexicographic.
		const s2 = markdown.indexOf("### Slide 2");
		const s10 = markdown.indexOf("### Slide 10");
		expect(s2).toBeGreaterThan(0);
		expect(s10).toBeGreaterThan(s2);

		expect(markdown).toContain("# Quarterly Review");
		expect(markdown).toContain("Revenue up 12%");
		expect(markdown).toContain("New market: APAC region"); // runs joined within a paragraph
		expect(markdown).toContain("(no text on this slide)");
		expect(markdown).toContain("# Roadmap");
		expect(markdown).toContain("Hiring & scaling"); // XML entity unescape
		expect(markdown).toContain("## Notes");
		expect(markdown).toContain("Slide 1: Remember to mention the APAC budget line.");
	});
});
