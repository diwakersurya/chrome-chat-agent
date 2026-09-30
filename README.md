# Local Chat Agent

A private chat agent that runs entirely on **Chrome's built-in AI** (Gemini Nano). There is no server, no API key and no network call. Your messages, attachments and history stay in your browser.

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

## Install

### Web app

1. Use desktop Chrome 148 or newer.
2. Open the GitHub Pages site. When prompted, click **Download Gemini Nano** once.

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
- **Optional task APIs:** Writer, Rewriter and Proofreader may still need their own flags (`#writer-api`, `#rewriter-api`, `#proofreader-api`). The app hides whatever isn't available.

## Develop

```sh
bun install
bun run dev:web      # web app with HMR
bun run dev:ext      # extension with HMR: load dist/ext as unpacked
bun run test         # vitest: adapter, tool loop, compaction, SQLite repo, calculator
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
- **Tool calls:** Gemini Nano has no native function calling. Before each reply, the adapter asks a cloned session to choose between "answer" and "tool" using `responseConstraint`. When the model picks a tool, the adapter emits TanStack tool-call events, and TanStack runs the tool.
- **Storage:** chats are stored with the official [`@sqlite.org/sqlite-wasm`](https://sqlite.org/wasm) using the `opfs-sahpool` VFS. That VFS needs no COOP/COEP headers, so it works on GitHub Pages and in extension pages. Search uses FTS5.
- **Styling:** [StyleX](https://stylexjs.com) with typed design tokens and system fonts. Nothing is loaded from a CDN.

## Privacy

- Nothing is sent anywhere. The app makes no network requests after it loads, and it has no analytics.
- The extension reads a tab only when you click **Use this tab**, pick "Ask about selection", or when the agent calls `read_tab`, which you can turn off in Settings.
- Chats live in the browser's origin-private file system (OPFS) for this site or extension. **Delete everything** in Settings removes them.

## License

MIT
