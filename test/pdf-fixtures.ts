/**
 * Hand-crafted minimal PDFs with correct xref offsets, so tests do not depend
 * on external PDF tooling. Each page either has a text layer or is empty
 * (an empty page is what the scanned-page detection looks like).
 */

interface PdfPage {
	text?: string;
}

export function buildPdf(pages: PdfPage[]): Buffer {
	const objects: string[] = [];
	const pageIds: number[] = [];
	// Object numbering: 1 catalog, 2 pages tree, then per page: page obj + content obj, then font last.
	let nextId = 3;
	for (const _page of pages) {
		pageIds.push(nextId);
		nextId += 2;
	}
	const fontId = nextId;

	objects[1] = `<< /Type /Catalog /Pages 2 0 R >>`;
	objects[2] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pages.length} >>`;
	for (let i = 0; i < pages.length; i++) {
		const pageId = pageIds[i]!;
		const contentId = pageId + 1;
		const text = pages[i]!.text;
		const stream = text ? `BT /F1 12 Tf 72 720 Td (${escapePdfText(text)}) Tj ET` : "";
		objects[pageId] =
			`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${contentId} 0 R ` +
			`/Resources << /Font << /F1 ${fontId} 0 R >> >> >>`;
		objects[contentId] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
	}
	objects[fontId] = `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>`;

	let out = "%PDF-1.4\n";
	const offsets: number[] = [];
	for (let id = 1; id < objects.length; id++) {
		const obj = objects[id];
		if (obj === undefined) continue;
		offsets[id] = out.length;
		out += `${id} 0 obj\n${obj}\nendobj\n`;
	}
	const xrefStart = out.length;
	const maxId = objects.length;
	out += `xref\n0 ${maxId}\n`;
	out += "0000000000 65535 f \n";
	for (let id = 1; id < maxId; id++) {
		const offset = offsets[id] ?? 0;
		out += `${String(offset).padStart(10, "0")} 00000 n \n`;
	}
	out += `trailer\n<< /Size ${maxId} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;
	return Buffer.from(out, "latin1");
}

function escapePdfText(text: string): string {
	return text.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}
