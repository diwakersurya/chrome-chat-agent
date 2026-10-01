# Local Chat Agent

**[Open the web app](https://diwakersurya.github.io/chrome-chat-agent/)** · [Download the extension](https://github.com/diwakersurya/chrome-chat-agent/releases/latest)

A private chat agent that runs entirely on **Chrome's built-in AI**: Gemini Nano, or Gemma 4 on Chrome 154+ with `#gemma4-for-built-in-ai`. There is no server, no API key and no network call. Your messages, attachments and history stay in your browser.

It ships two ways from one React codebase:

- **Web app**: open the page in Chrome 148+ (desktop).
- **Chrome extension**: a side panel next to any tab (Chrome 138+). Adds "Use this tab", a `read_tab` agent tool, and a right-click "Ask about selection" menu.

## Features

- Streaming replies with a stop button, plus Markdown, tables and syntax-highlighted code with a copy button
- Multiple chats: date-grouped sidebar, full-text search (SQLite FTS5), rename, and delete with undo
- Edit and resend any message, and regenerate any reply
- Image and voice input, when the Prompt API supports multimodal input on your device
- An agent loop with local tools: read the current tab, search chat history, calculator, date/time, and Summarizer/Translator/Rewriter/Proofreader
- A one-click transform menu on every message: summarize, key points, translate, rewrite, proofread
- Long chats are summarized automatically when they approach the model's context window
- System prompt, sampling (temperature/top-K in the extension), per-tool toggles, and light/dark/system theme
- Export as JSON or Markdown, import JSON, and delete everything
- **Skills:** import `SKILL.md` files (Agent Skills format, the same one Claude and Codex use), one at a time or a whole folder. Use one by typing `/` in the message box. The app suggests a matching skill as you type.
- **MCP tools:** remote servers (Streamable HTTP or SSE), local stdio servers through a bridge, and WebMCP tools of the current tab (extension only). Add them to a chat by typing `@`. Tools not marked read-only ask before they run.
- **What works here:** every feature and its limits are listed upfront (Settings → What works here, shown on first run). Anything the current build or device can't do stays visible but disabled, and hovering it shows why.

## Install

### Web app

1. Use desktop Chrome 148 or newer.
2. Open [diwakersurya.github.io/chrome-chat-agent](https://diwakersurya.github.io/chrome-chat-agent/). When prompted, click **Download Gemini Nano** once.

### Extension

1. Download `local-chat-agent-vX.Y.Z.zip` from [Releases](../../releases) and unzip it.
2. Go to `chrome://extensions`, turn on **Developer mode** and click **Load unpacked**. Choose the unzipped folder.
3. Click the toolbar icon to open the side panel.

### If the model isn't available

- **Hardware:** Gemini Nano needs about 22 GB of free disk space, and either a GPU with more than 4 GB of VRAM or 16 GB of RAM.
- **Older Chrome:** enable these flags, then restart Chrome:
  - `chrome://flags/#optimization-guide-on-device-model`
  - `chrome://flags/#prompt-api-for-gemini-nano`
- **Status:** `chrome://on-device-internals` shows the model's state.
- **Optional task APIs:** Writer, Rewriter and Proofreader may still need their own flags (`#writer-api`, `#rewriter-api`, `#proofreader-api`). Any task API that is missing or failing falls back to the Prompt API.

### Chrome 154+ with Gemma 4

`chrome://flags/#gemma4-for-built-in-ai` switches the built-in APIs to Gemma 4. It needs a GPU. Gemma 4 runs with speculative decoding (MTP), which changes three things; the app detects these and adapts automatically:

- The model reports `unavailable` unless requests ask for `samplingMode: 'most-predictable'`, so temperature and top-K are fixed.
- `responseConstraint` (JSON-schema output) is rejected, so tool routing uses a plain JSON prompt and a lenient parser.
- Summarizer, Writer and Rewriter fail with "Failed to count tokens". A failing Summarizer also resets the model service and kills open chat sessions. So these tasks run on the Prompt API instead, and a chat session that dies is rebuilt from history and retried once.

## Skills and MCP

| | Web | Extension | Limits |
|---|---|---|---|
| Skills | ✅ | ✅ | Instructions only; bundled scripts don't run. Each skill you use takes model memory. |
| Remote MCP | ✅ | ✅ | Web: the server must allow browser requests (CORS). Static auth headers only, no OAuth yet. |
| Local MCP | ✅ | ✅ | Browsers can't start programs. Run the bridge command the app shows you: `npx -y supergateway --stdio "<your server command>" --port 8931 --cors` |
| WebMCP (page tools) | — | ✅ | Only on sites that expose WebMCP tools. |

- **Tool limit:** up to 12 external tools per chat. The small on-device model picks tools less reliably from long lists, and every tool description uses model memory; the chat shows how much.
- **Where your data lives:** auth headers stay in this browser's local database and are never exported.
- **Untrusted results:** tool results are treated as untrusted content.

To try MCP locally, run the dev test server with `bun run mcp:test`, then add `http://localhost:8940/mcp` in Settings → Tools.

## Develop

```sh
bun install
bun run dev:web      # web app with HMR
bun run dev:ext      # extension with HMR: load dist/ext as unpacked
bun run test         # vitest: adapter, tool loop, compaction, SQLite repo, skills, MCP, feature gating
bun run build        # dist/web and dist/ext
```

## How it works

```
useChat ─▶ stream() ─▶ chat() ─▶ ChromeTextAdapter ─▶ LanguageModel (Gemini Nano)
                          │              │
                          │              ├─ SessionCache: one session per chat, only the new tail is appended
                          │              └─ tool routing: JSON-schema constrained "answer | tool" decision
                          └─ runs tools in the page (read_tab, search_history, calculate, …)

SQLite WASM (OPFS, worker) ◀─ typed RPC ◀─ useDbQuery (re-runs on table change events)
```

- **Model layer:** [TanStack AI](https://tanstack.com/ai) runs fully in the browser. A custom `ChromeTextAdapter` maps its AG-UI stream events onto the Prompt API.
- **Tool calls:** the built-in model has no native function calling. Before each reply, the adapter asks a cloned session to choose between "answer" and "tool", using `responseConstraint` when the model supports it and a plain JSON prompt otherwise. When the model picks a tool, the adapter emits TanStack tool-call events, and TanStack runs the tool.
- **Storage:** chats are stored with the official [`@sqlite.org/sqlite-wasm`](https://sqlite.org/wasm) using the `opfs-sahpool` VFS. That VFS needs no COOP/COEP headers, so it works on GitHub Pages and in extension pages. Search uses FTS5.
- **Styling:** [StyleX](https://stylexjs.com) with typed design tokens and system fonts. Nothing is loaded from a CDN.

## Privacy

- Nothing is sent anywhere. The app has no analytics and makes no network requests after it loads, except to MCP servers you add yourself.
- Model output can't leak your chat through images: Markdown images are shown as links and never loaded, and a Content Security Policy blocks remote images and media in both builds.
- The local MCP bridge command only accepts requests from this app's origin, so other websites can't drive your local servers.
- Page tools (WebMCP) only run on the tab and site that offered them.
- The extension reads a tab only when you click **Use this tab**, pick "Ask about selection", or when the agent calls `read_tab`, which you can turn off in Settings.
- Chats live in the browser's origin-private file system (OPFS) for this site or extension. **Delete everything** in Settings removes them.

## License

MIT
