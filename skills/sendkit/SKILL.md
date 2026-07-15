---
name: sendkit
description: Use Sendkit to send Telegram messages from agents through the SendKit MCP tool or CLI fallback. Use when a user asks to send a Telegram message, use Sendkit, interact with the Sendkit toolset, verify SendKit manually, or choose between SendKit MCP and CLI workflows.
---

# SendKit Skill

This skill enables the agent to send Telegram messages using the SendKit toolset.

## Usage

The agent can use either the SendKit MCP tool or fall back to the CLI if the MCP tool is unavailable.

### Sending a Message
When a user requests to send a Telegram message, the agent should:
1. Identify the recipient (`chatId`).
2. Formulate the message content.
3. Use the `mcp__sendkit__telegram` tool.

### CLI Fallback
If the MCP tool fails or is not available, use the `sendkit` CLI command via the Bash tool.
