import { strFromU8, unzipSync } from "fflate";

interface SlideXml {
	titlePlaceholders: Set<string>;
	paragraphs: { text: string; isTitle: boolean }[];
}

/**
 * Converts a PPTX buffer to markdown by extracting text runs from each slide.
 * Notes slides are included as a trailing section; media and layout masters are ignored.
 */
export async function convertPptx(buffer: Buffer): Promise<string> {
	const files = unzipSync(new Uint8Array(buffer));
	const slideEntries = Object.keys(files)
		.filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
		.sort((a, b) => slideNumber(a) - slideNumber(b));
	const notesEntries = Object.keys(files)
		.filter((name) => /^ppt\/notesSlides\/notesSlide\d+\.xml$/.test(name))
		.sort((a, b) => slideNumber(a) - slideNumber(b));

	const slideCount = slideEntries.length;
	if (slideCount === 0) {
		return "[PPTX: no slides found]\n";
	}

	const lines: string[] = [`[PPTX: ${slideCount} slide${slideCount === 1 ? "" : "s"}]`, ""];
	for (const entry of slideEntries) {
		const slide = parseSlideXml(strFromU8(files[entry]!));
		lines.push(`### Slide ${slideNumber(entry)}`);
		if (slide.titlePlaceholders.size === 0 && slide.paragraphs.length === 0) {
			lines.push("(no text on this slide)");
		}
		const title = [...slide.titlePlaceholders].join(" ").trim();
		if (title) {
			lines.push(`# ${title}`);
		}
		for (const paragraph of slide.paragraphs) {
			if (paragraph.text.trim()) {
				lines.push(paragraph.text.trim());
			}
		}
		lines.push("");
	}

	if (notesEntries.length > 0) {
		lines.push("## Notes");
		lines.push("");
		for (const entry of notesEntries) {
			const notes = extractTextRuns(strFromU8(files[entry]!));
			const text = notes.join(" ").replace(/\s+/g, " ").trim();
			if (text) {
				lines.push(`Slide ${slideNumber(entry)}: ${text}`);
			}
		}
		lines.push("");
	}

	return lines.join("\n");
}

function slideNumber(entry: string): number {
	const match = /(\d+)\.xml$/.exec(entry);
	return match ? Number.parseInt(match[1]!, 10) : 0;
}

/** Extracts paragraphs from slide XML, separating title-placeholder paragraphs from body text. */
function parseSlideXml(xml: string): SlideXml {
	const titlePlaceholders = new Set<string>();
	const shapeRe = /<p:sp>([\s\S]*?)<\/p:sp>/g;
	let shapeMatch: RegExpExecArray | null;
	while ((shapeMatch = shapeRe.exec(xml)) !== null) {
		const shapeXml = shapeMatch[1]!;
		const typeMatch = /<p:ph type="([^"]+)"/.exec(shapeXml);
		if (typeMatch && (typeMatch[1] === "title" || typeMatch[1] === "ctrTitle")) {
			const runs = extractTextRuns(shapeXml);
			if (runs.length > 0) {
				titlePlaceholders.add(runs.join("").trim());
			}
		}
	}


	// Body paragraphs: every <a:p> outside the title shapes.
	const paragraphs: { text: string; isTitle: boolean }[] = [];
	const bodyShapeRe = /<p:sp>([\s\S]*?)<\/p:sp>/g;
	let bodyMatch: RegExpExecArray | null;
	while ((bodyMatch = bodyShapeRe.exec(xml)) !== null) {
		const shapeXml = bodyMatch[1]!;
		const typeMatch = /<p:ph type="([^"]+)"/.exec(shapeXml);
		if (typeMatch && (typeMatch[1] === "title" || typeMatch[1] === "ctrTitle")) {
			continue; // title handled above
		}
		for (const paragraph of extractParagraphs(shapeXml)) {
			paragraphs.push({ text: paragraph, isTitle: false });
		}
	}
	return { titlePlaceholders, paragraphs };
}

/** Splits shape XML into paragraphs, joining each paragraph's text runs. */
function extractParagraphs(shapeXml: string): string[] {
	const paragraphs: string[] = [];
	const paragraphRe = /<a:p>([\s\S]*?)<\/a:p>/g;
	let match: RegExpExecArray | null;
	while ((match = paragraphRe.exec(shapeXml)) !== null) {
		const runs = extractTextRuns(match[1]!);
		const text = runs.join("").trim();
		if (text) paragraphs.push(text);
	}
	return paragraphs;
}

/** Extracts <a:t> text runs from an XML fragment. */
function extractTextRuns(xml: string): string[] {
	const runs: string[] = [];
	const runRe = /<a:t>([\s\S]*?)<\/a:t>/g;
	let match: RegExpExecArray | null;
	while ((match = runRe.exec(xml)) !== null) {
		runs.push(unescapeXml(match[1]!));
	}
	return runs;
}

function unescapeXml(text: string): string {
	return text
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"')
		.replace(/&apos;/g, "'")
		.replace(/&amp;/g, "&");
}
