import {
	DEFAULT_MAX_BYTES,
	DEFAULT_MAX_LINES,
	formatSize,
	truncateHead,
} from "@earendil-works/pi-coding-agent";

/**
 * Applies the built-in read tool's offset/limit/truncation semantics to converted
 * document markdown, so large documents continue with offset just like text files.
 */
export function sliceAndTruncateDocument(
	markdown: string,
	options: { offset?: number; limit?: number; label: string },
): string {
	const { offset, limit, label } = options;
	const allLines = markdown.split("\n");
	const totalLines = allLines.length;

	const startLine = offset ? Math.max(0, offset - 1) : 0;
	if (startLine >= totalLines) {
		throw new Error(`Offset ${offset} is beyond end of document (${totalLines} lines total)`);
	}

	let selected: string;
	if (limit !== undefined) {
		const endLine = Math.min(startLine + limit, totalLines);
		selected = allLines.slice(startLine, endLine).join("\n");
		if (endLine < totalLines) {
			selected += `\n\n[${totalLines - endLine} more lines. Use offset=${endLine + 1} to continue.]`;
		}
	} else {
		selected = allLines.slice(startLine).join("\n");
	}

	const truncation = truncateHead(selected);
	if (truncation.truncated) {
		const endLineDisplay = startLine + truncation.outputLines;
		const by = truncation.truncatedBy === "lines" ? `${DEFAULT_MAX_LINES} lines` : formatSize(DEFAULT_MAX_BYTES);
		return (
			truncation.content +
			`\n\n[${label} truncated at line ${endLineDisplay} of ${totalLines} (${by} limit). Use offset=${endLineDisplay + 1} to continue.]`
		);
	}
	return truncation.content;
}
