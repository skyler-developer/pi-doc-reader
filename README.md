# pi-doc-reader

A [pi](https://github.com/earendil-works/pi) extension that lets the built-in `read` tool open office documents.

The extension overrides `read` (same-name tool registration, an officially supported mechanism). Files that are not office documents are delegated unchanged to the built-in implementation, so text and image behavior is byte-identical to stock pi.

## Supported formats

| Format | Behavior |
|---|---|
| PDF | Text layer extracted per page; pages with no text layer (scans) are rendered as PNG images for vision models (capped at 6 per call, longest side ≤ 1570px). Page through with the `pages` parameter (`"1-10"`, `"5-"`, `"3,7"`); default is the first 20 pages. Password-protected and unparseable PDFs get actionable fallback suggestions. |
| DOCX | Converted to markdown: headings, lists, tables, inline formatting |
| XLSX | Converted to markdown tables, one per sheet (formula results, rich text); rows/columns capped |
| PPTX | Slides converted to markdown (title + body paragraphs, notes as a trailing section); media and layouts ignored |
| DOC/XLS/PPT | Legacy OLE: suggests `textutil` / `libreoffice` conversion |

Detection is content-based (magic bytes + zip central directory), so a DOCX renamed to `.pdf` still converts, and a text file renamed to `.pdf` still reads as text.

Conversions are cached by content hash under `~/.pi/agent/cache/pi-doc-reader/` (500MB, LRU-pruned): DOCX/XLSX markdown, PDF text-layer analysis, and rendered page PNGs. `offset`/`limit` apply to converted markdown for office documents; PDFs page with the `pages` parameter. On models without image input, scanned pages are skipped with a note and an OCR fallback suggestion.

## Install

```bash
pi install npm:pi-doc-reader
```

Or from a checkout:

```bash
pi install /path/to/pi-doc-reader
# or one-off:
pi --extension /path/to/pi-doc-reader/index.ts
```

## Configuration

Environment variables (all optional):

| Variable | Default | Meaning |
|---|---|---|
| `PI_DOC_READER_MODE` | `override` | `standalone` registers `read_doc` instead of overriding `read` |
| `PI_DOC_READER_XLSX_ROWS` | `50` | Max rows rendered per sheet |
| `PI_DOC_READER_XLSX_COLS` | `30` | Max columns rendered per sheet |
| `PI_DOC_READER_PDF_MAX_IMAGES` | `6` | Max scanned pages rendered as images per call |
| `PI_DOC_READER_CACHE_DIR` | `~/.pi/agent/cache/pi-doc-reader` | Cache location |

PDF page rendering uses [`@napi-rs/canvas`](https://github.com/Brooooooklyn/canvas) prebuilt native binaries (macOS/Linux/Windows). If `npm` hits its optional-dependencies bug ([npm/cli#4828](https://github.com/npm/cli/issues/4828)) and the binding is missing, reinstall after removing `node_modules` and `package-lock.json`.

`/doc-reader` shows mode and cache usage; `/doc-reader clear` empties the cache.

## Development

```bash
npm install --ignore-scripts
npm run typecheck
npm run test
```

TypeScript follows pi's erasable-syntax constraint (Node strip-only mode): no enums, namespaces, parameter properties, or `import =`.

## License

MIT
