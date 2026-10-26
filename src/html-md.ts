/**
 * Converts the limited HTML subset emitted by mammoth.convertToHtml to markdown.
 *
 * mammoth output only contains: h1-h6, p, ul, ol, li, table, tr, td, th,
 * strong, em, a, br, and (rarely) ignored styling elements. Rather than pulling
 * in a general HTML parser, this is a small tolerant stack parser plus renderer.
 */

type Element = { tag: string; attrs: Record<string, string>; children: HtmlNode[] };
export type HtmlNode = string | Element;

const TAG_RE = /<\/?([a-zA-Z][a-zA-Z0-9]*)((?:\s+[a-zA-Z-]+="[^"]*")*)\s*(\/?)>/g;

const BLOCK_TAGS = new Set(["p", "h1", "h2", "h3", "h4", "h5", "h6", "ul", "ol", "table", "pre", "blockquote"]);
const TRANSPARENT_TAGS = new Set(["span", "u", "s", "sub", "sup", "ins", "del", "font"]);

export function parseHtml(html: string): HtmlNode[] {
	const root: HtmlNode[] = [];
	const elements: Element[] = [];
	let children: HtmlNode[][] = [root];

	TAG_RE.lastIndex = 0;
	let last = 0;
	let match: RegExpExecArray | null;
	while ((match = TAG_RE.exec(html)) !== null) {
		const text = html.slice(last, match.index);
		if (text) children[children.length - 1]?.push(text);
		last = match.index + match[0].length;

		const tag = match[1]!.toLowerCase();
		const closing = match[0]!.startsWith("</");
		const selfClosing = match[3] === "/";

		if (closing) {
			// Pop until the matching open tag; tolerate unmatched closes.
			for (let i = elements.length - 1; i >= 0; i--) {
				if (elements[i]!.tag === tag) {
					elements.length = i;
					children.length = i + 1;
					break;
				}
			}
			continue;
		}

		const attrs: Record<string, string> = {};
		const attrRe = /([a-zA-Z-]+)="([^"]*)"/g;
		let attrMatch: RegExpExecArray | null;
		while ((attrMatch = attrRe.exec(match[2] ?? "")) !== null) {
			attrs[attrMatch[1]!.toLowerCase()] = attrMatch[2]!;
		}

		if (selfClosing || tag === "br") {
			if (tag === "br") {
				children[children.length - 1]?.push({ tag: "br", attrs: {}, children: [] });
			}
			continue;
		}

		const element: Element = { tag, attrs, children: [] };
		children[children.length - 1]?.push(element);
		elements.push(element);
		children.push(element.children);
	}
	const trailing = html.slice(last);
	if (trailing) children[children.length - 1]?.push(trailing);
	return root;
}

export function htmlToMarkdown(html: string): string {
	const renderer = new MarkdownRenderer();
	renderer.render(parseHtml(html));
	return renderer.finish();
}

interface ListFrame {
	ordered: boolean;
	index: number;
}

class MarkdownRenderer {
	private out: string[] = [];
	private paragraph: string[] = [];
	private listStack: ListFrame[] = [];

	render(nodes: HtmlNode[]): void {
		for (const node of nodes) {
			this.renderNode(node);
		}
	}

	finish(): string {
		this.flushParagraph();
		return this.out.join("").replace(/\n{3,}/g, "\n\n").trim() + "\n";
	}

	private renderNode(node: HtmlNode): void {
		if (typeof node === "string") {
			this.appendInline(node);
			return;
		}
		switch (node.tag) {
			case "h1":
			case "h2":
			case "h3":
			case "h4":
			case "h5":
			case "h6": {
				const level = Number(node.tag[1]);
				this.flushParagraph();
				const text = this.renderInlineChildren(node).trim();
				if (text) this.out.push("#".repeat(level) + " " + text + "\n\n");
				break;
			}
			case "p": {
				this.flushParagraph();
				const text = this.renderInlineChildren(node).trim();
				if (text) this.out.push(text + "\n\n");
				break;
			}
			case "pre": {
				this.flushParagraph();
				const text = collectText(node).trim();
				if (text) this.out.push("```\n" + text + "\n```\n\n");
				break;
			}
			case "blockquote": {
				this.flushParagraph();
				const inner = renderChildrenToMarkdown(node.children).trim();
				if (inner) {
					const quoted = inner
						.split("\n")
						.map((line) => "> " + line)
						.join("\n");
					this.out.push(quoted + "\n\n");
				}
				break;
			}
			case "ul":
			case "ol": {
				this.flushParagraph();
				this.listStack.push({ ordered: node.tag === "ol", index: 0 });
				this.render(node.children);
				this.listStack.pop();
				break;
			}
			case "li": {
				this.flushParagraph();
				const frame = this.listStack[this.listStack.length - 1];
				const depth = this.listStack.length - 1;
				const indent = "  ".repeat(Math.max(0, depth));
				const text = renderChildrenToMarkdown(node.children).trim().replace(/\n+/g, "\n" + indent + "  ");
				const marker = frame?.ordered ? `${++frame.index}. ` : "- ";
				if (text) this.out.push(indent + marker + text + "\n");
				break;
			}
			case "table": {
				this.flushParagraph();
				this.renderTable(node);
				break;
			}
			case "br": {
				this.paragraph.push("\n");
				break;
			}
			case "strong":
			case "b":
			case "em":
			case "i":
			case "code":
			case "a":
				this.appendInline(this.renderInlineElement(node));
				break;
			default:
				if (TRANSPARENT_TAGS.has(node.tag)) {
					this.render(node.children);
				} else {
					// Unknown block-ish element: render children in place.
					this.render(node.children);
				}
		}
	}

	private renderTable(table: Element): void {
		const rows: string[][] = [];
		collectRows(table, rows);
		if (rows.length === 0) return;

		const rendered = rows.map((row) => "| " + row.map(escapeCell).join(" | ") + " |");
		// The first row acts as the markdown header (a separator line is required
		// for a valid markdown table; structure is preserved either way).
		const separator = "|" + rows[0]!.map(() => " --- ").join("|") + "|";
		this.out.push([rendered[0], separator, ...rendered.slice(1)].join("\n") + "\n\n");
	}

	private appendInline(text: string): void {
		if (!text) return;
		this.paragraph.push(text);
	}

	private flushParagraph(): void {
		// Collapse horizontal whitespace but keep <br> line breaks; vertical
		// whitespace between blocks never reaches the paragraph buffer.
		const text = this.paragraph
			.join("")
			.replace(/[ \t]+/g, " ")
			.replace(/ *\n */g, "\n")
			.trim();
		this.paragraph = [];
		if (text) this.out.push(text + "\n\n");
	}

	private renderInlineChildren(element: Element): string {
		return renderChildrenToMarkdown(element.children);
	}

	private renderInlineElement(element: Element): string {
		const inner = renderChildrenToMarkdown(element.children).trim();
		if (!inner) return "";
		switch (element.tag) {
			case "strong":
			case "b":
				return `**${inner}**`;
			case "em":
			case "i":
				return `*${inner}*`;
			case "code":
				return "`" + inner.replace(/`/g, "'") + "`";
			case "a": {
				const href = element.attrs["href"];
				return href ? `[${inner}](${href})` : inner;
			}
			default:
				return inner;
		}
	}
}

function collectRows(element: Element, rows: string[][]): void {
	for (const child of element.children) {
		if (typeof child === "string") continue;
		if (child.tag === "tr") {
			const cells: string[] = [];
			for (const cellNode of child.children) {
				if (typeof cellNode === "string") continue;
				if (cellNode.tag === "td" || cellNode.tag === "th") {
					cells.push(renderChildrenToMarkdown(cellNode.children).trim());
				}
			}
			if (cells.length > 0) {
				rows.push(cells);
			}
		} else if (child.tag === "thead" || child.tag === "tbody" || child.tag === "tfoot" || child.tag === "table") {
			collectRows(child, rows);
		}
	}
}

function escapeCell(text: string): string {
	return text.replace(/\|/g, "\\|").replace(/\n+/g, " ").trim();
}

function renderChildrenToMarkdown(nodes: HtmlNode[]): string {
	const renderer = new MarkdownRenderer();
	// Inline context: render as running text without block breaks.
	renderer.render(nodes);
	return renderer.finish().replace(/\n+$/, "");
}

function collectText(node: HtmlNode): string {
	if (typeof node === "string") return node;
	return node.children.map(collectText).join("");
}
