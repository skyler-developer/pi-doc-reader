import { extractText, getDocumentProxy, renderPageAsImage } from "unpdf";

/** Pages with fewer extracted characters than this are treated as scanned/image-only. */
const SCANNED_TEXT_THRESHOLD = 32;
/** Rendered pages are capped at this many pixels on their longest side. */
const DEFAULT_MAX_PAGE_DIMENSION = 1570;

export interface PdfAnalysis {
	totalPages: number;
	/** 1-indexed parallel array: extracted text per page, trimmed. */
	pageTexts: string[];
	/** 1-indexed page numbers that look scanned (no meaningful text layer). */
	scannedPages: number[];
}

/** Thrown when the PDF requires a password. */
export class PdfPasswordError extends Error {
	constructor() {
		super("The PDF is password-protected. Convert or decrypt it first (e.g. `qpdf --decrypt input.pdf output.pdf`), then read again.");
		this.name = "PdfPasswordError";
	}
}

type PdfDocument = Awaited<ReturnType<typeof getDocumentProxy>>;

function isPasswordError(error: unknown): boolean {
	return (
		error instanceof Error &&
		(error.name === "PasswordException" || /password/i.test(error.message))
	);
}

async function openPdf(buffer: Buffer): Promise<PdfDocument> {
	try {
		return await getDocumentProxy(new Uint8Array(buffer));
	} catch (error) {
		if (isPasswordError(error)) throw new PdfPasswordError();
		throw error;
	}
}

/** Extracts the text layer and flags scanned pages, without rendering anything. */
export async function analyzePdf(buffer: Buffer): Promise<PdfAnalysis> {
	const pdf = await openPdf(buffer);
	const { totalPages, text } = await extractText(pdf, { mergePages: false });
	const pageTexts: string[] = [];
	const scannedPages: number[] = [];
	for (let i = 0; i < totalPages; i++) {
		const pageText = (text[i] ?? "").replace(/\s+/g, " ").trim();
		pageTexts.push(pageText);
		if (pageText.length < SCANNED_TEXT_THRESHOLD) {
			scannedPages.push(i + 1);
		}
	}
	return { totalPages, pageTexts, scannedPages };
}

/** Renders one page to a PNG buffer, sized to fit within maxDimension on its longest side. */
export async function renderPagePng(
	buffer: Buffer,
	pageNumber: number,
	maxDimension: number = DEFAULT_MAX_PAGE_DIMENSION,
): Promise<Buffer> {
	const pdf = await openPdf(buffer);
	const page = await pdf.getPage(pageNumber);
	const base = page.getViewport({ scale: 1 });
	// Downscale large pages to the vision budget; upscale tiny pages at most 2x for legibility.
	const scale = Math.min(maxDimension / base.width, maxDimension / base.height, 2);
	// unpdf requires an explicit canvas loader in Node; the dynamic import keeps the
	// native binding lazy so a missing binding only breaks PDF page rendering.
	const png = await renderPageAsImage(pdf, pageNumber, {
		scale,
		canvasImport: () => import("@napi-rs/canvas"),
	});
	return Buffer.from(png);
}
