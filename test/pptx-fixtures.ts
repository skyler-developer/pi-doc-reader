import { strToU8, zipSync } from "fflate";

function slideXml(title: string | null, bodyParagraphs: string[][]): string {
	const titleShape =
		title === null
			? ""
			: `<p:sp><p:nvSpPr><p:cNvPr id="2" name="Title"/><p:cNvSpPr/><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:spPr/>` +
				`<p:txBody><a:bodyPr/><a:p><a:r><a:t>${title}</a:t></a:r></a:p></p:txBody></p:sp>`;
	const bodyShape =
		bodyParagraphs.length === 0
			? ""
			: `<p:sp><p:nvSpPr><p:cNvPr id="3" name="Content"/><p:cNvSpPr/><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr><p:spPr/>` +
				`<p:txBody><a:bodyPr/>${bodyParagraphs
					.map(
						(paragraph) =>
							`<a:p>${paragraph.map((run) => `<a:r><a:t>${run}</a:t></a:r>`).join("")}</a:p>`,
					)
					.join("")}</p:txBody></p:sp>`;
	return (
		`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
		`<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ` +
		`xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">` +
		`<p:cSld>${titleShape}${bodyShape}</p:cSld></p:sld>`
	);
}

function notesXml(text: string): string {
	return (
		`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
		`<p:notes xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ` +
		`xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">` +
		`<p:sp><p:nvSpPr><p:cNvPr id="2" name="Notes"/><p:cNvSpPr/><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr>` +
		`<p:txBody><a:p><a:r><a:t>${text}</a:t></a:r></a:p></p:txBody></p:sp></p:notes>`
	);
}

/** Two slides with titles, bodies, one empty slide, and notes for slide 1. */
export function buildPptx(): Buffer {
	return Buffer.from(
		zipSync({
			"ppt/slides/slide1.xml": strToU8(
				slideXml("Quarterly Review", [
					["Revenue up 12%"],
					["New market: ", "APAC region"],
				]),
			),
			"ppt/slides/slide2.xml": strToU8(slideXml(null, [])),
		"ppt/slides/slide10.xml": strToU8(
			slideXml("Roadmap", [["Next quarter plans"], ["Hiring &amp; scaling"]]),
		),
		"ppt/notesSlides/notesSlide1.xml": strToU8(notesXml("Remember to mention the APAC budget line.")),
			"ppt/presentation.xml": strToU8(`<?xml version="1.0"?><p:presentation/>`),
		}),
	);
}
