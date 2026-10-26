/**
 * Parses a page range expression: "3", "1-10", "5-", "1-3,7,9-". Comma-separated
 * parts are combined and sorted. Out-of-range values are clamped; an empty or
 * invalid expression returns null (caller applies its default).
 */
export function parsePageRange(expression: string | undefined, totalPages: number): number[] | null {
	if (expression === undefined || expression.trim() === "") return null;
	const pages = new Set<number>();
	for (const part of expression.split(",")) {
		const trimmed = part.trim();
		if (trimmed === "") continue;
		const match = /^(\d+)(?:\s*-\s*(\d*))?$/.exec(trimmed);
		if (!match) return null;
		const start = Number.parseInt(match[1]!, 10);
		if (Number.isNaN(start) || start < 1) return null;
		if (match[2] === undefined) {
			pages.add(clamp(start, totalPages));
			continue;
		}
		const endText = match[2];
		const end = endText === "" ? totalPages : Number.parseInt(endText, 10);
		if (Number.isNaN(end) || end < start) return null;
		for (let p = start; p <= Math.min(end, totalPages); p++) {
			pages.add(p);
		}
	}
	if (pages.size === 0) return null;
	return [...pages].sort((a, b) => a - b);
}

function clamp(value: number, max: number): number {
	return Math.max(1, Math.min(value, max));
}

/** Formats a sorted page list compactly for summary lines: 1-3, 7. */
export function formatPageList(pages: number[]): string {
	if (pages.length === 0) return "";
	const parts: string[] = [];
	let runStart = pages[0]!;
	let prev = pages[0]!;
	for (const p of pages.slice(1)) {
		if (p === prev + 1) {
			prev = p;
			continue;
		}
		parts.push(runStart === prev ? `${runStart}` : `${runStart}-${prev}`);
		runStart = p;
		prev = p;
	}
	parts.push(runStart === prev ? `${runStart}` : `${runStart}-${prev}`);
	return parts.join(", ");
}
