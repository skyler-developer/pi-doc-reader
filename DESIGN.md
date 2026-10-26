# pi-doc-reader 技术方案

让 pi 的 `read` 工具直接读 PDF / DOCX / XLSX / PPTX，输出 markdown；扫描版 PDF 渲染成页图走 vision 通道。纯 TypeScript，零 Python、零系统依赖。

## 1. 核心设计决策：覆写 `read`，而非新增工具

**方案**：`pi.registerTool({ name: "read", ... })` 同名注册覆写内置 read（pi 官方 `tool-override.ts` 示例确认支持）。执行时按扩展名分流：

```
execute(path):
  if ext ∈ {pdf, docx, xlsx, pptx} → 文档管线
  else → 委托 createReadTool(cwd) 原实现（从 @earendil-works/pi-coding-agent 导入）
```

**为什么不是新工具 `read_doc`**：模型已被系统提示训练成"读文件就用 read"，给它一个 `.pdf` 路径时零提示成本自然工作；新工具需要额外的 promptSnippet 引导且模型仍可能先调 read 失败一次。覆写时把 description 改写为包含文档格式列表即可让模型感知新能力。

**为什么是委托而非复制**：pi 上游 read 持续演进（truncation 策略、图像 resize、SSH 远程化），委托保证非文档路径始终走最新内置实现。覆写只在文档分流处引入维护面。

**冲突缓解**：提供 standalone 模式（注册 `read_doc` 不覆写），供与其他 read 覆写扩展（如 ssh 模式）共存，通过 settings 切换。

## 2. 文档管线

### 2.1 PDF（双通道混合）

- **文本层**：`unpdf`（pdfjs 的 serverless 封装，纯 JS、无 worker 配置问题）逐页提取文本。
- **扫描页判定**：单页提取字符数 < 32 判为扫描/图像页。
- **页图渲染**：`pdfjs-dist` legacy build + `@napi-rs/canvas`（预编译二进制，覆盖 macOS arm64 / Linux x64+arm64 / Windows，无需系统 cairo）。2x 缩放渲染 PNG，复用 pi 的 `processImage` 按 `ctx.model.inputLimits.images.resize` 自适应缩放。
- **输出**：`content: [TextContent(分页 markdown), ImageContent(扫描页图)...]` 混合块——pi 工具协议原生支持（`ImageContent = {type:"image", data: base64, mimeType}`），read.ts 读图片就是这个形态。
- **非 vision 模型**：复用 read.ts 的处理模式（`ctx.model.input.includes("image")` 判断），图像块省略并加 note 说明；若扫描页过多且文本层近空，直接提示"当前模型不支持图像，扫描版 PDF 无法读取"，并给 bash fallback（`ocrmypdf`）。
- **加密 PDF**：尝试空密码，失败则报错提示密码文档不支持。
- **分页续读**：新增 `pages` 参数（如 `"1-10"`、`"5-"`），默认读前 20 页，超限时输出 `[Showing pages 1-20 of 87. Use pages="21-" to continue.]`——交互模式对齐 read 的 offset/limit 续读语义。

### 2.2 DOCX — `mammoth`

`mammoth.convertToHtml` → 自写 HTML→markdown 转换器（只处理标题/段落/列表/表格/粗斜体/代码块/链接，未识别标签降级为纯文本）。mammoth 输出的 HTML 结构可控，不需要通用 HTML 解析器。

### 2.3 XLSX — `exceljs`

逐 sheet 转 markdown 表格：默认每 sheet 前 50 行；单元格取公式计算值；超宽表格截断列并标注 `[3 more columns]`；空 sheet 跳过。sheet 间用 `## Sheet: 名称` 分隔，开头给每个 sheet 的行列总数摘要。

### 2.4 PPTX — 零依赖

unzip（`fflate` 单头文件库）→ 逐 `ppt/slides/slideN.xml` 抽 `<a:t>` 文本 → 每页标题 + 要点列表。PPTX 文本结构简单，不值得引重库。

### 2.5 旧格式 DOC/XLS：MVP 不做

错误信息里给 macOS `textutil -convert docx` / Linux `libreoffice --headless --convert-to docx` 的 bash 命令建议，让模型自己转换后再读。

## 3. 缓存

`~/.pi/agent/cache/pi-doc-reader/<sha256(文件内容)[:16]>.json`，存转换结果（markdown + 页图路径）。页图单独落盘存 PNG，缓存 JSON 只存路径，避免重读大 JSON。命中直接返回——百页 PDF 只转换一次。缓存大小上限 500MB，LRU 清理。

## 4. 包结构

```
pi-doc-reader/
├── index.ts              # 入口：registerTool("read") 覆写 + 委托 + standalone 模式切换
├── src/
│   ├── pdf.ts            # unpdf 文本层 + pdfjs/canvas 渲染
│   ├── docx.ts           # mammoth 管线
│   ├── xlsx.ts           # exceljs 管线
│   ├── pptx.ts           # zip + XML 抽取
│   ├── html-md.ts        # HTML→markdown
│   ├── cache.ts          # 内容哈希缓存
│   └── settings.ts       # 模式/页数/行数开关
├── test/                 # vitest + fixtures（真实小文档）
├── package.json          # keywords: ["pi-package"], pi: {extensions: ["./index.ts"]}
└── tsconfig.json
```

**依赖**：`unpdf`、`pdfjs-dist`、`@napi-rs/canvas`、`mammoth`、`exceljs`、`fflate`（全部 pinned 精确版本）；peerDependencies: `@earendil-works/pi-coding-agent: "*"`。

**TypeScript 约束**：pi 以 Node strip-only 模式直接跑 TS，只用可擦除语法——无 enum、namespace、`import =`、参数属性。

**发布**：`pi install npm:pi-doc-reader`；README 标注 `@napi-rs/canvas` 含预编译原生二进制（三平台无系统依赖，但不是纯 JS）。

## 5. 渲染与 UX

- 不提供自定义 `renderCall/renderResult` → 自动复用内置 read 渲染器（tool-override.ts 注释确认此行为，含语法高亮和截断警告）；图片块的渲染走 read.ts 现有 image renderer 路径，需在 M1 验证。
- 文档输出头部摘要：`[PDF: 87 pages, 231KB text extracted, pages 3,7 rendered as images]`。
- `/doc-reader` 命令：显示缓存占用、清缓存、切换 override/standalone 模式。

## 6. 边界情况

| 情况 | 处理 |
|---|---|
| 文件 > 100MB | 拒绝，提示用 `pages` 分段或先拆分 |
| 非 vision 模型 + 扫描 PDF | 文本照出，图像省略 + note；全扫描则提示 bash OCR fallback |
| 篡改扩展名（.pdf 实为文本） | magic bytes 探测（`%PDF`、PK zip 头）优先于扩展名 |
| 输出超限 | markdown 部分对齐 read 的 truncateHead 限制（行数/字节数），续读提示 |
| 加密/损坏文件 | 明确报错 + 可行 fallback 命令 |

## 7. 里程碑

- **M1（约 1 周）**：覆写骨架 + 委托 + DOCX/XLSX 管线 + 缓存 + 单测 → 发布 v0.1（这两个管线无原生依赖，风险最低，先验证覆写-委托架构）
- **M2（约 1 周）**：PDF 文本层 + pages 参数 + 扫描页渲染管线 → v0.2
- **M3**：PPTX、standalone 模式、渲染打磨、提交 pi.dev/packages 官方目录（pi-memory 先例：进目录后显著提升曝光）

## 8. 测试策略

- vitest + fixtures：每格式准备含表格/多页/扫描页的真实小文档，断言 markdown 关键片段。
- 集成验证：本地 `pi --extension ./index.ts` 手测典型工作流（读需求 PDF 提要点、读 XLSX 汇总数据）。
- 覆写回归：确认非文档路径与内置 read 输出逐字节一致（委托路径测试）。

## 9. 与竞品的差异化

- Claude Code 官方 pdf skill 是"教模型写 Python 脚本调 pdfplumber"——每次现场生成代码、需要 Python 环境；本扩展是原生工具，一次调用直接出结果，且纯 TS 无 Python。
- pi-ai 的 ImageContent 只有 image 类型、无 Anthropic 原生 document block——本扩展转 markdown+图方案对所有 provider 通用（含不支持 PDF 的模型），反而是优势。
