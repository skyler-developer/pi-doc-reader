import { describe, expect, it } from "vitest";
import { parsePageRange, formatPageList } from "../src/pages.ts";

describe("parsePageRange", () => {
	it("returns null for empty input", () => {
		expect(parsePageRange(undefined, 10)).toBeNull();
		expect(parsePageRange("", 10)).toBeNull();
		expect(parsePageRange("   ", 10)).toBeNull();
	});

	it("parses a single page", () => {
		expect(parsePageRange("3", 10)).toEqual([3]);
	});

	it("parses an inclusive range", () => {
		expect(parsePageRange("2-5", 10)).toEqual([2, 3, 4, 5]);
	});

	it("parses an open-ended range clamped to totalPages", () => {
		expect(parsePageRange("8-", 10)).toEqual([8, 9, 10]);
		expect(parsePageRange("8-", 9)).toEqual([8, 9]);
	});

	it("parses comma-separated parts, deduped and sorted", () => {
		expect(parsePageRange("3,1,2-3", 10)).toEqual([1, 2, 3]);
	});

	it("clamps out-of-range values", () => {
		expect(parsePageRange("99", 10)).toEqual([10]);
		expect(parsePageRange("1-99", 10)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
	});

	it("returns null for invalid expressions", () => {
		expect(parsePageRange("abc", 10)).toBeNull();
		expect(parsePageRange("0", 10)).toBeNull();
		expect(parsePageRange("5-2", 10)).toBeNull();
		expect(parsePageRange("1,,x", 10)).toBeNull();
	});
});

describe("formatPageList", () => {
	it("formats single pages", () => {
		expect(formatPageList([4])).toBe("4");
	});

	it("formats runs compactly", () => {
		expect(formatPageList([1, 2, 3, 7, 9, 10])).toBe("1-3, 7, 9-10");
	});

	it("formats empty lists", () => {
		expect(formatPageList([])).toBe("");
	});
});
