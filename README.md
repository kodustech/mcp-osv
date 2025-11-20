# OSV MCP Server (Bun)

Remote Model Context Protocol (MCP) HTTP server that wraps the OSV v1 API for on-demand open-source vulnerability lookups (example feed: https://osv.dev/list?q=%40NESTJS%2FCORE&ecosystem=npm). Exported as MCP tools so agents can query OSV directly.

## Features
- Streamable HTTP MCP endpoint at `/mcp`.
- Tools: `osv_query` (single target) and `osv_query_batch` (multiple).
- Configurable base URL (`OSV_API_URL`, defaults to `https://api.osv.dev/v1`).
- Clear schemas and validation to guide LLMs (commit XOR version, purl rules, pagination).

## Quick start
Requirements: Bun.
```bash
bun install
PORT=3000 HOST=0.0.0.0 OSV_API_URL=https://api.osv.dev/v1 bun run index.ts
```
MCP endpoint: `http://<host>:<port>/mcp`.

Env vars:
- `PORT` / `HOST`: HTTP bind (default `3000` / `0.0.0.0`).
- `OSV_API_URL`: override OSV base URL.

## MCP client setup
- Claude Code CLI: `claude mcp add --transport http mcp-osv http://localhost:3000/mcp`
- VS Code: `code --add-mcp "{\"name\":\"mcp-osv\",\"type\":\"http\",\"url\":\"http://localhost:3000/mcp\"}"`
- MCP Inspector: `npx @modelcontextprotocol/inspector` -> connect to `http://localhost:3000/mcp`
Replace `localhost` with your host/port if remote.

## Tools and parameters

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

## Example calls
- PyPI version: `{"package":{"purl":"pkg:pypi/jinja2"},"version":"3.1.4"}`
- npm with name+ecosystem: `{"package":{"name":"@nestjs/core","ecosystem":"npm"},"version":"10.2.10"}`
- Commit lookup: `{"commit":"<sha>","package":{"ecosystem":"Go","name":"github.com/foo/bar"}}`

## Debugging
- Server log: `OSV MCP server listening on http://<host>:<port>/mcp`
- Curl init: `curl -H "content-type: application/json" -H "accept: application/json, text/event-stream" -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","clientInfo":{"name":"curl","version":"0.0.0"},"capabilities":{}}}' http://localhost:3000/mcp`
- List tools: same endpoint with `{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}`

## License
MIT License. See [LICENSE](LICENSE).
