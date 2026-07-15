# Implementation Plan: SendKit — A Multi-Adapter AI Tool

**One shared core. Four adapters: CLI, Local MCP Server, Remote MCP Server, Skill.**

This plan turns the transcript's walkthrough into a concrete, sequenced engineering plan for building a tool (example: sending a Telegram message) that works identically from a terminal, from a local coding agent, from a web-based AI assistant, and from any agent that has the skill installed — all powered by one implementation.

---

## 1. Goals & Non-Goals

**Goals**

- Implement the business logic (parameter validation + the Telegram Bot API call) exactly once.
- Expose that logic through four adapters without duplicating logic in any of them.
- Ship the CLI and MCP packages to npm so they're installable without the source repo.
- Deploy the remote MCP server so any HTTP-capable AI client can use it.
- Publish a skill so agents that have no MCP connection can still discover and use the tool via CLI fallback.

**Non-goals**

- The specific "send a Telegram message" operation is a placeholder — swap in any operation.
- No auth/multi-tenant system is designed here beyond a single bot token stored locally or as an env var.

---

## 2. Repository Structure (Monorepo)

Use a monorepo so the core and all adapters version and release together.

```
sendkit/
├── package.json                # workspace root
├── turbo.json / pnpm-workspace.yaml   # (or npm/yarn workspaces)
├── packages/
│   ├── core/                   # shared core — the source of truth
│   │   ├── src/
│   │   │   ├── validate.ts
│   │   │   ├── telegram.ts     # calls the Telegram Bot API
│   │   │   ├── config.ts       # reads/writes local token config
│   │   │   └── index.ts
│   │   └── package.json
│   │
│   ├── cli/                    # human-facing terminal adapter
│   │   ├── src/index.ts
│   │   └── package.json
│   │
│   ├── mcp-local/               # stdio MCP server for coding agents
│   │   ├── src/server.ts
│   │   └── package.json
│   │
│   └── mcp-remote/              # HTTP MCP server for web AI clients
│       ├── src/server.ts
│       ├── Dockerfile / railway.json
│       └── package.json
│
└── skills/
    └── sendkit/
        └── SKILL.md             # agent instructions, distributed separately
```

Each adapter package depends on `core` as a workspace dependency (e.g. `"@sendkit/core": "workspace:*"`), so a change to validation or the API call in `core` propagates to all adapters on next build — no copy-pasted logic.

---

## 3. Phase 1 — Shared Core

The core owns two responsibilities: **validating inputs** and **calling the external API**. Nothing else should know how a Telegram message is actually sent.

```ts
// packages/core/src/validate.ts
export interface SendMessageInput {
  chatId: string;
  message: string;
}

export function validateSendMessageInput(input: Partial<SendMessageInput>): SendMessageInput {
  if (!input.chatId || input.chatId.trim() === "") {
    throw new Error("chatId is required and cannot be empty");
  }
  if (!input.message || input.message.trim() === "") {
    throw new Error("message is required and cannot be empty");
  }
  return { chatId: input.chatId, message: input.message };
}
```

```ts
// packages/core/src/telegram.ts
import { SendMessageInput } from "./validate";

export async function sendTelegramMessage(
  token: string,
  input: SendMessageInput,
): Promise<{ ok: boolean; messageId?: number }> {
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: input.chatId, text: input.message }),
  });
  const data = await res.json();
  if (!data.ok) throw new Error(`Telegram API error: ${data.description}`);
  return { ok: true, messageId: data.result.message_id };
}
```

```ts
// packages/core/src/config.ts
// Local token storage so CLI/skill usage doesn't require re-entering a token each time.
import { homedir } from "os";
import { join } from "path";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";

const CONFIG_PATH = join(homedir(), ".config", "sendkit", "config.json");

export function saveToken(token: string) {
  mkdirSync(join(homedir(), ".config", "sendkit"), { recursive: true });
  writeFileSync(CONFIG_PATH, JSON.stringify({ telegramToken: token }));
}

export function loadToken(): string {
  if (!existsSync(CONFIG_PATH)) {
    throw new Error("No token configured. Run: sendkit init --telegram-token <token>");
  }
  return JSON.parse(readFileSync(CONFIG_PATH, "utf-8")).telegramToken;
}
```

```ts
// packages/core/src/index.ts
export * from "./validate";
export * from "./telegram";
export * from "./config";
```

**Milestone check:** `core` has unit tests for `validateSendMessageInput` (empty/whitespace chatId, empty message) and an integration test for `sendTelegramMessage` against a mocked fetch.

---

## 4. Phase 2 — CLI Adapter

The CLI is a thin wrapper: parse argv → call core → print result.

```ts
// packages/cli/src/index.ts
#!/usr/bin/env node
import { Command } from 'commander';
import { validateSendMessageInput, sendTelegramMessage, loadToken, saveToken } from '@sendkit/core';

const program = new Command('sendkit');

program
  .command('init')
  .requiredOption('--telegram-token <token>', 'Telegram bot token')
  .action((opts) => {
    saveToken(opts.telegramToken);
    console.log('Token saved.');
  });

program
  .command('telegram <chatId> <message>')
  .action(async (chatId, message) => {
    const input = validateSendMessageInput({ chatId, message });
    const token = loadToken();
    const result = await sendTelegramMessage(token, input);
    console.log(result.ok ? 'Message sent successfully.' : 'Failed to send.');
  });

program.parse();
```

Usage once published:

```bash
npx @your-org/sendkit init --telegram-token <token>
npx @your-org/sendkit telegram 8886767563 "hello from the CLI"
```

**Milestone check:** running the CLI locally with `bun run dev` (or `ts-node`) round-trips a real message to a test Telegram chat.

---

## 5. Phase 3 — Local MCP Server (stdio)

Wrap the same core in an MCP server speaking the MCP protocol over stdio, so coding agents (Claude Code, OpenCode, Codex) can call it as a structured tool rather than a shell command.

```ts
// packages/mcp-local/src/server.ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { validateSendMessageInput, sendTelegramMessage, loadToken } from "@sendkit/core";

const server = new McpServer({ name: "sendkit", version: "1.0.0" });

server.tool(
  "telegram",
  { chatId: z.string(), message: z.string() },
  async ({ chatId, message }) => {
    const input = validateSendMessageInput({ chatId, message });
    const token = loadToken();
    const result = await sendTelegramMessage(token, input);
    return { content: [{ type: "text", text: `Message sent: ${result.messageId}` }] };
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
```

Register it with a coding agent via each agent's MCP config (shape differs slightly per agent, but all point at the same executable):

```json
{
  "mcpServers": {
    "sendkit": {
      "command": "npx",
      "args": ["-y", "@your-org/sendkit-mcp-local"]
    }
  }
}
```

**Milestone check:** with the config installed, ask the agent in natural language ("use the SendKit MCP to send a Telegram message to chat X saying Y") and confirm the tool call fires and a message arrives.

---

## 6. Phase 4 — Remote MCP Server (HTTP)

Same tool definition, different transport: an HTTP server instead of stdio, so browser-based clients with no local process access (chatgpt.com, claude.ai) can reach it.

```ts
// packages/mcp-remote/src/server.ts
import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { validateSendMessageInput, sendTelegramMessage } from "@sendkit/core";

const app = express();
app.use(express.json());

const server = new McpServer({ name: "sendkit-remote", version: "1.0.0" });

server.tool(
  "telegram",
  { chatId: z.string(), message: z.string() },
  async ({ chatId, message }) => {
    const input = validateSendMessageInput({ chatId, message });
    const token = process.env.TELEGRAM_BOT_TOKEN!; // env var, not local config
    const result = await sendTelegramMessage(token, input);
    return { content: [{ type: "text", text: `Message sent: ${result.messageId}` }] };
  },
);

app.post("/mcp", async (req, res) => {
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
});

app.listen(process.env.PORT || 3000, () => console.log("SendKit remote MCP listening"));
```

**Deployment steps (Railway or equivalent):**

1. Push `packages/mcp-remote` as a deployable service (Dockerfile or Railway's native Node build).
2. Set `TELEGRAM_BOT_TOKEN` as an environment variable/secret in the hosting dashboard — never commit it.
3. Deploy; note the resulting base URL (e.g. `https://sendkit-production.up.railway.app`).
4. The MCP route is the base URL plus the `/mcp` suffix.

**Connect it to web clients:**

- **ChatGPT:** Settings → Connectors/Custom Apps → add the deployed `/mcp` URL.
- **Claude.ai:** Settings → Connectors → add a custom connector pointing at the same `/mcp` URL.

**Milestone check:** from both chatgpt.com and claude.ai, ask the assistant to "use the SendKit MCP to send a Telegram message," confirm the permission prompt, and verify the message arrives.

---

## 7. Phase 5 — Skill (Discovery & Fallback Layer)

A skill is not executable code — it's an instructions document (`SKILL.md`) that tells an agent what the tool does and how to invoke it, with a fallback order: prefer a connected MCP tool if one exists, otherwise shell out to the CLI.

```
skills/sendkit/
└── SKILL.md
```

**Authoring guidance (critical pitfall from the transcript):** if an agent helps write `SKILL.md` while working inside the SendKit source repo, it will tend to describe usage via the repo's own dev scripts (e.g. `bun run dev sendkit ...`). That's wrong for anyone who installs the skill without the source repo. Explicitly instruct the writing agent to describe **published-package usage only**:

```
# Bad — assumes access to this repository
bun run dev sendkit telegram <chat_id> "<message>"

# Good — works for anyone with only the published package
bunx @your-org/sendkit telegram <chat_id> "<message>"
# or
npx @your-org/sendkit telegram <chat_id> "<message>"
```

`SKILL.md` should describe:

1. What SendKit does (sends a Telegram message given a chat ID and text).
2. How to check whether a `sendkit`/`telegram` MCP tool is already connected — if so, call it directly.
3. If not connected, fall back to `bunx @your-org/sendkit telegram <chatId> "<message>"`.
4. How to initialize the Telegram token if the CLI reports it's missing (`sendkit init --telegram-token <token>`).
5. Explicitly exclude any local-development-only scripts or file paths from the instructions.

**Testing in isolation:** before trusting a skill, remove all MCP configuration (local `mcp.json`/agent configs and any remote connectors added to claude.ai/chatgpt.com) and confirm the agent is genuinely confused about "SendKit" with no skill installed — this validates the skill is what's providing the knowledge, not a lingering MCP connection.

---

## 8. Phase 6 — Distribution

**Publish npm packages** (`core`, `cli`, `mcp-local`, `mcp-remote` build artifacts as needed):

```bash
npm publish --access public --workspace packages/core
npm publish --access public --workspace packages/cli
npm publish --access public --workspace packages/mcp-local
```

**Publish the skill** to a public registry (skills.sh in the transcript):

1. Push the repo (or a subfolder) publicly to GitHub, with `SKILL.md` inside a folder named exactly `sendkit`.
2. Copy the GitHub folder URL, e.g. `https://github.com/<org>/sendkit/tree/main/skills/sendkit`.
3. From any machine:

```bash
npx skills add https://github.com/<org>/sendkit/tree/main/skills/sendkit
# choose: install globally, symbolic link
```

4. Verify the skill now appears in each target agent (OpenCode, Claude Code) skill list, in a directory outside the SendKit repo.

**Deploy the remote MCP server** (see Phase 4) and register it as a connector on both ChatGPT and Claude.ai.

---

## 9. End-to-End Verification Matrix

| Environment                    | No MCP, No Skill                          | MCP Connected                            | Skill Installed, No MCP                                                   |
| ------------------------------ | ----------------------------------------- | ---------------------------------------- | ------------------------------------------------------------------------- |
| Terminal (human)               | CLI works directly                        | N/A                                      | N/A                                                                       |
| Claude Code / OpenCode / Codex | Agent is confused, asks for clarification | Tool call via local MCP server succeeds  | Agent uses skill instructions → falls back to `bunx` CLI call, succeeds   |
| chatgpt.com / claude.ai        | No access to any tool                     | Tool call via remote MCP server succeeds | N/A (skills are installed into local agent environments, not web clients) |

Run through every populated cell above before considering the release done.

---

## 10. Suggested Build Order (Sprint Plan)

1. **Sprint 1:** `core` package + unit tests (validation, Telegram API call, token config).
2. **Sprint 2:** `cli` package; manual end-to-end test sending a real message.
3. **Sprint 3:** `mcp-local` package; register with one coding agent, verify tool call.
4. **Sprint 4:** `mcp-remote` package; deploy to Railway (or equivalent); connect to one web client.
5. **Sprint 5:** Write and test `SKILL.md`, explicitly scrubbing dev-only instructions; test in an MCP-free environment.
6. **Sprint 6:** Publish all npm packages, publish the skill to the registry, run the full verification matrix (Section 9) across every agent and client.

---

## 11. Risks & Mitigations

- **Skill drift from reality:** if `core`'s CLI flags change, `SKILL.md` can silently go stale. Mitigation: add a CI check that greps the skill for CLI subcommands and diffs against the CLI's own `--help` output.
- **Token leakage in remote deployment:** the remote server takes the Telegram token from an environment variable, never from source or a request body — mitigation is a secret-scanning CI step plus `.env` in `.gitignore`.
- **Divergent validation logic:** any adapter that reimplements validation instead of importing from `core` becomes a source of bugs — mitigation is a lint rule/code-review checklist item requiring all adapters to import `validateSendMessageInput` from `@sendkit/core` rather than re-checking inputs inline.
