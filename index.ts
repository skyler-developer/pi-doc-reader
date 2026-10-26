import type { AgentToolResult, ExtensionAPI, ExtensionToolContext } from "@earendil-works/pi-coding-agent";
import {
	createReadToolDefinition,
	DEFAULT_MAX_BYTES,
	DEFAULT_MAX_LINES,
	formatSize,
	getAgentDir,
	truncateHead,
} from "@earendil-works/pi-coding-agent";
import type { Api, ImageContent, Model, TextContent } from "@earendil-works/pi-ai";
import { readFile, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { Type } from "typebox";
import {
	cacheInfo,
	cacheKey,
	clearCache,
	pngCachePath,
	readCache,
	readCachePng,
	writeCache,
	writeCachePng,
} from "./src/cache.ts";
import { convertDocx } from "./src/docx.ts";
import { convertPptx } from "./src/pptx.ts";
import { detectDocumentFormat, type DetectedFormat } from "./src/detect.ts";
import { formatPageList, parsePageRange } from "./src/pages.ts";
import { analyzePdf, type PdfAnalysis, PdfPasswordError, renderPagePng } from "./src/pdf.ts";
import { sliceAndTruncateDocument } from "./src/truncate.ts";
import { convertXlsx, DEFAULT_XLSX_LIMITS, type XlsxLimits } from "./src/xlsx.ts";

const MAX_FILE_BYTES = 100 * 1024 * 1024;
/** Default PDF page window when no `pages` argument is given. */
const DEFAULT_PDF_PAGES = 20;
/** Maximum scanned pages rendered as images per call. */
const DEFAULT_PDF_MAX_IMAGES = 6;
/** Longest side of rendered page images, matching common vision-model budgets. */
const DEFAULT_PDF_PAGE_IMAGE_MAX_DIM = 1570;

const readParams = Type.Object({
	path: Type.String({ description: "Path to the file to read (relative or absolute)" }),
	offset: Type.Optional(
		Type.Number({ description: "Line number to start reading from (1-indexed). For documents, applies to the converted markdown." }),
	),
	limit: Type.Optional(Type.Number({ description: "Maximum number of lines to read" })),
	pages: Type.Optional(
		Type.String({
			description: 'For PDFs only: page range to read, e.g. "1-10", "5-", "3,7". Default: first 20 pages. Ignored for other formats.',
		}),
	),
});

export interface DocReaderDetails {
	format?: string;
	cached?: boolean;
	pagesShown?: number;
	totalPages?: number;
	imagesRendered?: number;
}

/**
 * The runtime wrapper behind createReadTool (wrapToolDefinition) accepts the
 * session context as an optional fifth execute argument, even though the
 * public AgentTool type omits it. Forwarding ctx keeps model-aware image
 * handling and cwd resolution identical to the built-in tool.
 */
type ReadToolWithCtx = {
	promptSnippet?: string;
	promptGuidelines?: readonly string[];
	execute: (
		toolCallId: string,
		params: { path: string; offset?: number; limit?: number; pages?: string },
		signal?: AbortSignal,
		onUpdate?: unknown,
		ctx?: ExtensionToolContext,
	) => Promise<AgentToolResult<unknown>>;
};

function envInt(name: string, fallback: number): number {
	const raw = process.env[name];
	if (raw === undefined) return fallback;
	const parsed = Number.parseInt(raw, 10);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function xlsxLimits(): XlsxLimits {
	return {
		maxRowsPerSheet: envInt("PI_DOC_READER_XLSX_ROWS", DEFAULT_XLSX_LIMITS.maxRowsPerSheet),
		maxColsPerSheet: envInt("PI_DOC_READER_XLSX_COLS", DEFAULT_XLSX_LIMITS.maxColsPerSheet),
	};
}

function cacheDir(): string {
	return process.env.PI_DOC_READER_CACHE_DIR ?? join(getAgentDir(), "cache", "pi-doc-reader");
}

function supportsImages(model: Model<Api> | undefined): boolean {
	return !model || model.input.includes("image");
}

function checkAborted(signal: AbortSignal | undefined): void {
	if (signal?.aborted) throw new Error("Operation aborted");
}

function textResult(text: string, details: DocReaderDetails, isError = false) {
	return { content: [{ type: "text" as const, text }], details, isError: isError || undefined };
}

/** Page window applied when the model gives no `pages` argument. */
function defaultPageRange(totalPages: number, window: number): number[] {
	const end = Math.min(totalPages, window);
	const pages: number[] = [];
	for (let p = 1; p <= end; p++) pages.push(p);
	return pages;
}

interface PdfReadParams {
	path: string;
	offset?: number;
	limit?: number;
	pages?: string;
}

async function readPdf(
	buffer: Buffer,
	params: PdfReadParams,
	signal: AbortSignal | undefined,
	ctx: ExtensionToolContext,
): Promise<AgentToolResult<DocReaderDetails>> {
	const dir = cacheDir();
	const key = cacheKey(buffer, "pdf");
	const maxImages = envInt("PI_DOC_READER_PDF_MAX_IMAGES", DEFAULT_PDF_MAX_IMAGES);

	let analysis: PdfAnalysis | null = null;
	let cached = false;
	const entry = await readCache(dir, key);
	if (entry?.format === "pdf" && entry.totalPages !== undefined && entry.pageTexts && entry.scannedPages) {
		analysis = { totalPages: entry.totalPages, pageTexts: entry.pageTexts, scannedPages: entry.scannedPages };
		cached = true;
	}
	if (!analysis) {
		try {
			analysis = await analyzePdf(buffer);
		} catch (error) {
			const message =
				error instanceof PdfPasswordError
					? error.message
					: `Could not parse this PDF (${error instanceof Error ? error.message : String(error)}). ` +
							"Fallback: extract text via bash, e.g. `pdftotext -layout <file> -` " +
							"(install with `brew install poppler` on macOS or `apt install poppler-utils` on Linux).";
			return textResult(message, { format: "pdf" }, true);
		}
		await writeCache(dir, key, {
			version: 1,
			format: "pdf",
			markdown: "",
			totalPages: analysis.totalPages,
			pageTexts: analysis.pageTexts,
			scannedPages: analysis.scannedPages,
		}).catch(() => {});
	}
	checkAborted(signal);

	const requested = parsePageRange(params.pages, analysis.totalPages);
	if (params.pages !== undefined && params.pages.trim() !== "" && requested === null) {
		return textResult(
			`Invalid pages expression: "${params.pages}". Use forms like "3", "1-10", "5-", "3,7-9".`,
			{ format: "pdf", totalPages: analysis.totalPages },
			true,
		);
	}
	const pages = requested ?? defaultPageRange(analysis.totalPages, DEFAULT_PDF_PAGES);

	const scannedSet = new Set(analysis.scannedPages);
	const scannedRequested = pages.filter((p) => scannedSet.has(p));
	const vision = supportsImages(ctx?.model);
	const toRender = vision ? scannedRequested.slice(0, maxImages) : [];
	const skippedScanned = scannedRequested.length - toRender.length;

	const summaryLine = `[PDF: ${analysis.totalPages} page${analysis.totalPages === 1 ? "" : "s"}${cached ? ", text layer from cache" : ""} — showing pages ${formatPageList(pages)}${scannedRequested.length > 0 ? `, ${scannedRequested.length} scanned/image-only page${scannedRequested.length === 1 ? "" : "s"}` : ""}]`;
	const bodyLines: string[] = [summaryLine, ""];
	for (const p of pages) {
		bodyLines.push(`### Page ${p}`);
		if (scannedSet.has(p)) {
			const rendered = toRender.includes(p);
			if (rendered) {
				bodyLines.push("(scanned page — rendered as image below)");
			} else if (!vision) {
				bodyLines.push("(scanned page — the current model does not support images, so it cannot be read)");
			} else {
				bodyLines.push("(scanned page — image not rendered in this call; read again with a narrower pages range)");
			}
		} else {
			const text = analysis.pageTexts[p - 1] ?? "";
			bodyLines.push(text === "" ? "(no extractable text)" : text);
		}
		bodyLines.push("");
	}
	if (skippedScanned > 0 && vision) {
		bodyLines.push(`[Only the first ${toRender.length} scanned page${toRender.length === 1 ? "" : "s"} were rendered as images (limit ${maxImages}). ${skippedScanned} more scanned page${skippedScanned === 1 ? "" : "s"} in this range — read them with a narrower pages range.]`);
		bodyLines.push("");
	}

	const images: ImageContent[] = [];
	for (const p of toRender) {
		const pngPath = pngCachePath(dir, key, p, DEFAULT_PDF_PAGE_IMAGE_MAX_DIM);
		let png = await readCachePng(pngPath);
		if (png === null) {
			png = await renderPagePng(buffer, p, DEFAULT_PDF_PAGE_IMAGE_MAX_DIM);
			await writeCachePng(pngPath, png).catch(() => {});
		}
		images.push({ type: "image", data: png.toString("base64"), mimeType: "image/png" });
		checkAborted(signal);
	}

	let text = bodyLines.join("\n");
	if (scannedRequested.length > 0 && !vision && analysis.pageTexts.filter((t) => t.length > 0).length === 0) {
		text +=
			"\n[This PDF has no text layer and the current model does not support images. " +
			"OCR it via bash first, e.g. \`ocrmypdf input.pdf ocr.pdf\`, then read ocr.pdf.]\n";
	}
	const truncation = truncateHead(text);
	if (truncation.truncated) {
		const endLine = truncation.outputLines;
		const limit =
			truncation.truncatedBy === "lines"
				? `${DEFAULT_MAX_LINES} lines`
				: formatSize(DEFAULT_MAX_BYTES);
		text =
			truncation.content +
			`\n\n[Output truncated at line ${endLine} of ${text.split("\n").length} (${limit} limit). ` +
			`Use the pages parameter with a narrower range, e.g. pages="${pages[pages.length - 1] ?? 1}-", to continue.]`;
	}

	const content: (TextContent | ImageContent)[] = [{ type: "text", text }, ...images];
	return {
		content,
		details: {
			format: "pdf",
			cached,
			pagesShown: pages.length,
			totalPages: analysis.totalPages,
			imagesRendered: images.length,
		},
	};
}

export default function docReaderExtension(pi: ExtensionAPI) {
	const mode = process.env.PI_DOC_READER_MODE === "standalone" ? "standalone" : "override";
	const isOverride = mode === "override";

	// Read the built-in read tool's system-prompt contribution from the host
	// package (createReadToolDefinition comes from the peer dependency, so the
	// values always match the pi version actually running) instead of hardcoding.
	// Unlike createReadTool, the unwrapped definition keeps promptSnippet/promptGuidelines.
	const builtinRead = createReadToolDefinition(process.cwd()) as unknown as ReadToolWithCtx;
	const promptGuidelines = [
		...(builtinRead.promptGuidelines ?? []),
		"Office documents (PDF/DOCX/XLSX/PPTX) are read directly with read — PDFs support the pages parameter, scanned pages are rendered as images.",
	];

	pi.registerTool({
		name: isOverride ? "read" : "read_doc",
		label: isOverride ? "read (doc-reader)" : "read_doc",
		// Same-name registration replaces the whole built-in definition, so the
		// system-prompt contribution must be forwarded explicitly. Standalone
		// mode contributes nothing (read still exists alongside read_doc).
		...(isOverride ? { promptSnippet: builtinRead.promptSnippet, promptGuidelines } : {}),
		description:
			"Read the contents of a file. Supports text files and images (jpg, png, gif, webp, bmp). " +
			"Documents are converted: DOCX and PPTX (slides, titles, notes) to markdown, XLSX to markdown tables, " +
			"and PDF (text per page, scanned pages as images for vision models, page through with pages=\"5-\"). " +
			"Text output is truncated to 2000 lines or 50KB (whichever is hit first). Use offset/limit for large files.",
		parameters: readParams,
		async execute(toolCallId, params, signal, onUpdate, ctx) {
			const absolutePath = resolve(ctx.cwd, params.path);

			let format: DetectedFormat | null = null;
			try {
				format = await detectDocumentFormat(absolutePath);
			} catch {
				// Missing or unreadable: fall through so the built-in read produces its own error.
				format = null;
			}

			if (format === null) {
				return builtinRead.execute(toolCallId, params, signal, onUpdate, ctx);
			}

			const info = await stat(absolutePath);
			if (info.size > MAX_FILE_BYTES) {
				return textResult(
					`File is ${formatSize(info.size)}, exceeds the ${formatSize(MAX_FILE_BYTES)} limit for document conversion.`,
					{ format },
					true,
				);
			}

			const buffer = await readFile(absolutePath);
			checkAborted(signal);

			if (format === "pdf") {
				return await readPdf(buffer, params, signal, ctx);
			}
			if (format === "ole") {
				return textResult(
					`Legacy binary office format (.doc/.xls/.ppt) is not supported. Convert first, then read again:\n` +
						`- macOS: \`textutil -convert docx ${params.path}\`\n` +
						`- Linux: \`libreoffice --headless --convert-to docx ${params.path}\``,
					{ format },
					true,
				);
			}

			const limits = xlsxLimits();
			const settingsSuffix =
				format === "xlsx" ? `xlsx:${limits.maxRowsPerSheet}:${limits.maxColsPerSheet}` : format;
			const key = cacheKey(buffer, settingsSuffix);

			let markdown: string;
			let cached = false;
			const entry = await readCache(cacheDir(), key);
			if (entry && entry.format === format) {
				markdown = entry.markdown;
				cached = true;
			} else {
				if (format === "docx") {
					markdown = await convertDocx(buffer);
				} else if (format === "pptx") {
					markdown = await convertPptx(buffer);
				} else {
					markdown = await convertXlsx(buffer, limits);
				}
				await writeCache(cacheDir(), key, { version: 1, format, markdown }).catch(() => {});
			}

			if (signal?.aborted) throw new Error("Operation aborted");

			const label =
				format === "xlsx"
					? `XLSX sheet data (max ${limits.maxRowsPerSheet} rows/sheet)`
					: `${format.toUpperCase()} (converted markdown)`;
			const body = sliceAndTruncateDocument(markdown, { offset: params.offset, limit: params.limit, label });
			const header =
				format === "xlsx" ? "" : `[${format.toUpperCase()}: converted to markdown${cached ? ", from cache" : ""}]\n\n`;
			return { content: [{ type: "text" as const, text: header + body }], details: { format, cached } };
		},
	});

	pi.registerCommand("doc-reader", {
		description: "pi-doc-reader status: mode and cache usage. `/doc-reader clear` empties the cache.",
		handler: async (args, ctx) => {
			if (args.trim() === "clear") {
				await clearCache(cacheDir());
				ctx.ui.notify("pi-doc-reader: cache cleared", "info");
				return;
			}
			const info = await cacheInfo(cacheDir());
			ctx.ui.notify(
				`pi-doc-reader: ${mode} mode · ${info.fileCount} cached document${info.fileCount === 1 ? "" : "s"} (${formatSize(info.totalBytes)})`,
				"info",
			);
		},
	});
}
