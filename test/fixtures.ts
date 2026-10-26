import { strToU8, zipSync } from "fflate";

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
</Types>`;

const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

const DOC_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="Heading 1"/></w:style>
<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="Heading 2"/></w:style>
</w:styles>`;

export function buildDocx(documentXml: string): Buffer {
	return Buffer.from(
		zipSync({
			"[Content_Types].xml": strToU8(CONTENT_TYPES),
			"_rels/.rels": strToU8(ROOT_RELS),
			"word/document.xml": strToU8(documentXml),
			"word/_rels/document.xml.rels": strToU8(DOC_RELS),
			"word/styles.xml": strToU8(STYLES),
		}),
	);
}

function paragraph(text: string, style?: string, bold = false): string {
	const pPr = style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : "";
	const rPr = bold ? "<w:rPr><w:b/></w:rPr>" : "";
	return `<w:p>${pPr}<w:r>${rPr}<w:t>${text}</w:t></w:r></w:p>`;
}

function table(rows: string[][]): string {
	const cells = rows.map((row) => row.map((text) => `<w:tc><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:tc>`).join(""));
	return `<w:tbl>${cells.map((row) => `<w:tr>${row}</w:tr>`).join("")}</w:tbl>`;
}

/** Heading, bold run, two-paragraph table, mixed text. */
export const SAMPLE_DOCX_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:body>
${paragraph("Release Notes", "Heading1")}
${paragraph("Hello plain and ", undefined, false)}
${paragraph("plain paragraph two", "Heading2")}
${table([
	["Feature", "Status"],
	["DOCX", "done"],
	["XLSX", "done"],
])}
</w:body>
</w:document>`;

export function buildNonOfficeZip(): Buffer {
	return Buffer.from(zipSync({ "foo.txt": strToU8("hello") }));
}
