import { describe, expect, it } from "vitest";
import { htmlToMarkdown } from "../src/html-md.ts";

describe("htmlToMarkdown", () => {
	it("converts paragraphs with inline formatting", () => {
		const md = htmlToMarkdown("<p>Hello <strong>world</strong> and <em>pi</em></p>");
		expect(md).toContain("Hello **world** and *pi*");
	});

	it("converts headings with levels", () => {
		const md = htmlToMarkdown("<h1>Title</h1><h2>Section</h2>");
		expect(md).toContain("# Title");
		expect(md).toContain("## Section");
	});

	it("converts unordered and ordered lists with nesting", () => {
		const md = htmlToMarkdown(
			"<ul><li>one</li><li>two<ol><li>two.one</li><li>two.two</li></ol></li></ul>",
		);
		expect(md).toContain("- one");
		expect(md).toContain("- two");
		expect(md).toContain("  1. two.one");
		expect(md).toContain("  2. two.two");
	});

	it("converts tables with separator after the first row", () => {
		const md = htmlToMarkdown("<table><tr><td>A</td><td>B</td></tr><tr><td>1</td><td>2</td></tr></table>");
		const lines = md.trim().split("\n");
		expect(lines[0]).toBe("| A | B |");
		expect(lines[1]).toMatch(/^\| --- \| --- \|$/);
		expect(lines[2]).toBe("| 1 | 2 |");
	});

	it("escapes pipes inside table cells", () => {
		const md = htmlToMarkdown("<table><tr><td>a|b</td></tr></table>");
		expect(md).toContain("| a\\|b |");
	});

	it("converts links and line breaks", () => {
		const md = htmlToMarkdown('<p>see <a href="https://example.com">docs</a><br/>next line</p>');
		expect(md).toContain("[docs](https://example.com)");
		expect(md).toContain("next line");
	});

	it("converts preformatted blocks", () => {
		const md = htmlToMarkdown("<pre>code\nline</pre>");
		expect(md).toContain("```\ncode\nline\n```");
	});

	it("ignores unknown inline wrappers", () => {
		const md = htmlToMarkdown("<p><span>kept</span> <u>text</u></p>");
		expect(md).toContain("kept text");
	});

	it("collapses inter-tag whitespace", () => {
		const md = htmlToMarkdown("<p>a</p>\n\n   <p>b</p>");
		expect(md.trim().split("\n\n")).toEqual(["a", "b"]);
	});
});
