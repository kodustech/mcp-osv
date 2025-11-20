# OSV MCP server (Bun)

Remote Model Context Protocol server that wraps the OSV `v1` API with two tools:

- `osv_query` (`POST /v1/query`): query a single commit or package version.
- `osv_query_batch` (`POST /v1/querybatch`): run multiple queries in one call.

## Run it

```bash
bun install
PORT=3000 HOST=0.0.0.0 OSV_API_URL=https://api.osv.dev/v1 bun run index.ts
```

Environment knobs:

- `PORT` / `HOST`: where the HTTP transport listens (default `3000` / `0.0.0.0`).
- `OSV_API_URL`: override the OSV base URL (default `https://api.osv.dev/v1`).

The MCP endpoint is available at `http://<host>:<port>/mcp`.

## Tool inputs

`osv_query`

```json
{
  "commit": "optional sha (use commit XOR version)",
  "version": "optional version string",
  "package": {
    "name": "jinja2", // required with ecosystem if not using purl
    "ecosystem": "PyPI", // required with name if not using purl
    "purl": "pkg:pypi/jinja2" // use purl OR name+ecosystem. If version is present, omit @version here.
  },
  "pageToken": "optional pagination token from previous OSV response"
}
```

Rules enforced:

- Provide **either** `commit` or `version` (not both).
- When using `version`, `package` is required.
- `package` must be either `purl` **or** both `name` and `ecosystem`.
- If `version` is present and you use `package.purl`, omit the `@version` part in the purl.

`osv_query_batch`

```json
{
  "queries": [
    {
      "version": "3.1.4",
      "package": {
        "purl": "pkg:pypi/jinja2"
      }
    }
  ]
}
```

## Connect from a client

- Claude Code CLI: `claude mcp add --transport http osv-scan http://localhost:3000/mcp`
- VS Code: `code --add-mcp "{\"name\":\"osv-scan\",\"type\":\"http\",\"url\":\"http://localhost:3000/mcp\"}"`
- MCP Inspector: `npx @modelcontextprotocol/inspector` → connect to the same URL.
