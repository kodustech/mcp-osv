# Kodus OSV MCP server (Bun)

Free remote MCP HTTP server by [Kodus](https://kodus.io) exposing the OSV v1 API for open-source vulnerability lookup (e.g. [OSV npm search](https://osv.dev/list?q=%40NESTJS%2FCORE&ecosystem=npm)). Add it as a custom MCP server so your LLM can call OSV via tools.

## What it does

- `osv_query` (`POST /v1/query`): query a single commit or package version.
- `osv_query_batch` (`POST /v1/querybatch`): query multiple items at once.
- Configurable OSV base URL via `OSV_API_URL` (default `https://api.osv.dev/v1`).

## Install & run locally

Requirements: Bun.

```bash
bun install
PORT=3000 HOST=0.0.0.0 OSV_API_URL=https://api.osv.dev/v1 bun run index.ts
```

MCP endpoint: `http://<host>:<port>/mcp`

Env vars:
- `PORT` / `HOST`: HTTP transport bind (default `3000` / `0.0.0.0`).
- `OSV_API_URL`: override the OSV endpoint if needed.

## Connect from MCP clients

- Claude Code CLI: `claude mcp add --transport http mcp-osv http://localhost:3000/mcp`
- VS Code: `code --add-mcp "{\"name\":\"mcp-osv\",\"type\":\"http\",\"url\":\"http://localhost:3000/mcp\"}"`
- MCP Inspector: `npx @modelcontextprotocol/inspector` -> connect to `http://localhost:3000/mcp`

Replace `localhost` with your host/port if running remotely.

## Tool parameters (clear for LLMs)

`osv_query`
```json
{
  "commit": "sha OR",
  "version": "version string OR",
  "package": {
    "name": "required with ecosystem if not using purl",
    "ecosystem": "required with name if not using purl",
    "purl": "pkg:pypi/jinja2 // purl OR name+ecosystem; if version is present, omit @version here"
  },
  "pageToken": "optional pagination token from previous OSV response"
}
```
Rules:
- Use **commit** XOR **version** (one or the other, never both).
- If `version` is present, `package` is required.
- `package` must be either `purl` **or** (`name` + `ecosystem`).
- If `version` exists and `package.purl` is used, omit `@version` in the purl.

`osv_query_batch`
```json
{
  "queries": [
    {
      "commit": "sha OR",
      "version": "version string OR",
      "package": {
        "name": "pkg name",
        "ecosystem": "ecosystem",
        "purl": "pkg:ecosys/name"
      },
      "pageToken": "optional"
    }
  ]
}
```
Rules: each item follows the same rules as `osv_query`.

## Quick examples

- PyPI version: `{"package":{"purl":"pkg:pypi/jinja2"},"version":"3.1.4"}`
- npm with name+ecosystem: `{"package":{"name":"@nestjs/core","ecosystem":"npm"},"version":"10.2.10"}`
- Commit lookup: `{"commit":"<sha>","package":{"ecosystem":"Go","name":"github.com/foo/bar"}}`

## Minimal debug

- Server logs: `OSV MCP server listening on http://<host>:<port>/mcp`
- Curl init: `curl -H "content-type: application/json" -H "accept: application/json, text/event-stream" -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","clientInfo":{"name":"curl","version":"0.0.0"},"capabilities":{}}}' http://localhost:3000/mcp`
- List tools: same endpoint with `{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}`
