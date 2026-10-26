import mammoth from "mammoth";
import { htmlToMarkdown } from "./html-md.ts";

/** Converts a DOCX buffer to markdown via mammoth's HTML output. */
export async function convertDocx(buffer: Buffer): Promise<string> {
	const { value: html } = await mammoth.convertToHtml({ buffer });
	return htmlToMarkdown(html);
}
