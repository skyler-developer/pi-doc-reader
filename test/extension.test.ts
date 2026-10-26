import { createReadTool, type ExtensionAPI, type ExtensionToolContext } from "@earendil-works/pi-coding-agent";
import { mkdtemp, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import docReaderExtension from "../index.ts";
import { buildDocx, SAMPLE_DOCX_XML } from "./fixtures.ts";
import { buildPdf } from "./pdf-fixtures.ts";

interface CapturedTool {
	name: string;
	description: string;
	execute: (
		toolCallId: string,
		params: { path: string; offset?: number; limit?: number; pages?: string },
		signal?: AbortSignal,
		onUpdate?: undefined,
		ctx?: ExtensionToolContext,
	) => Promise<{ content: { type: string; text?: string }[]; details?: Record<string, unknown>; isError?: boolean }>;
}

interface CapturedCommand {
	description: string;
	handler: (args: string, ctx: { ui: { notify: (message: string, level: string) => void } }) => Promise<void>;
}

function loadExtension(): { tools: CapturedTool[]; commands: { name: string }[] } {
	const tools: CapturedTool[] = [];
	const commands: { name: string }[] = [];
	const fakePi = {
		registerTool: (tool: CapturedTool) => tools.push(tool),
		registerCommand: (name: string, def: CapturedCommand) => commands.push({ name }),
	};
	docReaderExtension(fakePi as unknown as ExtensionAPI);
	return { tools, commands };
}

let cacheDir: string;
let workDir: string;

beforeAll(async () => {
	cacheDir = await mkdtemp(join(tmpdir(), "pi-doc-reader-cache-"));
	workDir = await mkdtemp(join(tmpdir(), "pi-doc-reader-work-"));
	process.env.PI_DOC_READER_CACHE_DIR = cacheDir;
});

afterAll(() => {
	delete process.env.PI_DOC_READER_CACHE_DIR;
	delete process.env.PI_DOC_READER_MODE;
});

function ctx(): ExtensionToolContext {
	return { cwd: workDir } as unknown as ExtensionToolContext;
}

async function writeWorkFile(name: string, content: string | Buffer): Promise<string> {
	const path = join(workDir, name);
	await writeFile(path, content);
	return name;
}

describe("extension registration", () => {
	it("overrides the built-in read tool by default", () => {
		const { tools } = loadExtension();
		expect(tools).toHaveLength(1);
		expect(tools[0]!.name).toBe("read");
		expect(tools[0]!.description).toContain("DOCX");
		expect(tools[0]!.description).toContain("XLSX");
	});

	it("registers read_doc in standalone mode", () => {
		process.env.PI_DOC_READER_MODE = "standalone";
		try {
			const { tools } = loadExtension();
			expect(tools[0]!.name).toBe("read_doc");
		} finally {
			delete process.env.PI_DOC_READER_MODE;
		}
	});

	it("registers the /doc-reader command", () => {
		const { commands } = loadExtension();
		expect(commands.map((c) => c.name)).toEqual(["doc-reader"]);
	});
});

describe("delegation to the built-in read", () => {
	it("returns byte-identical text output for plain files", async () => {
		const name = await writeWorkFile("notes.txt", "alpha\nbeta\ngamma\n");
		const { tools } = loadExtension();
		const params = { path: name };

		const ours = await tools[0]!.execute("t1", params, undefined, undefined, ctx());
		const builtinReadTool = createReadTool(workDir) as unknown as {
			execute: (
				toolCallId: string,
				params: { path: string },
				signal?: AbortSignal,
				onUpdate?: undefined,
				ctx?: ExtensionToolContext,
			) => Promise<{ content: unknown }>;
		};
		const builtin = await builtinReadTool.execute("t2", params, undefined, undefined, ctx());

		expect(ours.content).toEqual(builtin.content);
	});

	it("delegates missing files so the built-in read raises its own error", async () => {
		const { tools } = loadExtension();
		await expect(tools[0]!.execute("t1", { path: "nope.txt" }, undefined, undefined, ctx())).rejects.toThrow();
	});
});

describe("PDF through the tool", () => {
	const pdf = () =>
		buildPdf([
			{ text: "First page introduction to the document" },
			{}, // scanned (no text)
			{ text: "Third page with the final conclusion text" },
		]);

	it("returns per-page text plus a rendered image for the scanned page", async () => {
		const name = await writeWorkFile("doc.pdf", pdf());
		const { tools } = loadExtension();
		// No model in ctx → treated as vision-capable, like read.ts's fallback.
		const result = await tools[0]!.execute("t1", { path: name }, undefined, undefined, ctx());

		expect(result.details).toMatchObject({ format: "pdf", pagesShown: 3, totalPages: 3, imagesRendered: 1 });
		const text = result.content[0]?.text ?? "";
		expect(text).toContain("[PDF: 3 pages — showing pages 1-3, 1 scanned/image-only page]");
		expect(text).toContain("### Page 1");
		expect(text).toContain("First page introduction");
		expect(text).toContain("### Page 2");
		expect(text).toContain("(scanned page — rendered as image below)");
		expect(text).toContain("Third page with the final conclusion");

		expect(result.content).toHaveLength(2);
		expect(result.content[1]?.type).toBe("image");
	});

	it("honors the pages parameter and caches the analysis", async () => {
		// Distinct content from the previous test: the cache is content-addressed.
		const name = await writeWorkFile(
			"doc2.pdf",
			buildPdf([
				{ text: "Different first page content for cache isolation" },
				{ text: "Second page also has its own text layer here" },
				{},
				{ text: "Final page wraps up this distinct document" },
			]),
		);
		const { tools } = loadExtension();

		const first = await tools[0]!.execute("t1", { path: name, pages: "3-" }, undefined, undefined, ctx());
		expect(first.details).toMatchObject({ pagesShown: 2, cached: false, imagesRendered: 1 });
		expect(first.content[0]?.text).toContain("showing pages 3-4");

		const second = await tools[0]!.execute("t2", { path: name }, undefined, undefined, ctx());
		expect(second.details).toMatchObject({ cached: true, pagesShown: 4, imagesRendered: 1 });
	});

	it("rejects invalid pages expressions with an actionable error", async () => {
		const name = await writeWorkFile("doc3.pdf", pdf());
		const { tools } = loadExtension();
		const result = await tools[0]!.execute("t1", { path: name, pages: "abc" }, undefined, undefined, ctx());
		expect(result.isError).toBe(true);
		expect(result.content[0]?.text).toContain('Invalid pages expression: "abc"');
	});
});

describe("document conversion through the tool", () => {
	it("reads DOCX as markdown and caches the conversion", async () => {
		const name = await writeWorkFile("spec.docx", buildDocx(SAMPLE_DOCX_XML));
		const { tools } = loadExtension();

		const before = (await readdir(cacheDir)).filter((f) => f.endsWith(".json")).length;

		const first = await tools[0]!.execute("t1", { path: name }, undefined, undefined, ctx());
		const text = first.content[0]?.text ?? "";
		expect(text).toContain("[DOCX: converted to markdown]");
		expect(text).toContain("# Release Notes");
		expect(text).toContain("| DOCX | done |");
		expect(first.details).toMatchObject({ format: "docx", cached: false });

		const second = await tools[0]!.execute("t2", { path: name }, undefined, undefined, ctx());
		expect(second.details).toMatchObject({ format: "docx", cached: true });
		expect((second.content[0]?.text ?? "").replace(", from cache", "")).toContain("[DOCX: converted to markdown]");

		const files = (await readdir(cacheDir)).filter((f) => f.endsWith(".json"));
		expect(files.length).toBe(before + 1);
	});

	it("applies offset/limit to converted markdown", async () => {
		const name = await writeWorkFile("spec2.docx", buildDocx(SAMPLE_DOCX_XML));
		const { tools } = loadExtension();

		const limited = await tools[0]!.execute("t1", { path: name, limit: 3 }, undefined, undefined, ctx());
		expect(limited.content[0]?.text).toContain("more lines. Use offset=4 to continue.");
	});

	it("returns a fallback suggestion for unparseable PDFs", async () => {
		const name = await writeWorkFile("broken.pdf", "%PDF-1.7 fake not really a pdf");
		const { tools } = loadExtension();
		const result = await tools[0]!.execute("t1", { path: name }, undefined, undefined, ctx());
		expect(result.isError).toBe(true);
		expect(result.content[0]?.text).toContain("Could not parse this PDF");
		expect(result.content[0]?.text).toContain("pdftotext");
	});
	it("suggests conversion for legacy OLE documents", async () => {
		const name = await writeWorkFile("legacy.doc", Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0, 0, 0, 0, 0, 0]));
		const { tools } = loadExtension();
		const result = await tools[0]!.execute("t1", { path: name }, undefined, undefined, ctx());
		expect(result.isError).toBe(true);
		expect(result.content[0]?.text).toContain("textutil");
	});
});
