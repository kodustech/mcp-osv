import { randomUUID } from "node:crypto";
import { createServer, IncomingMessage } from "node:http";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

const DEFAULT_OSV_BASE_URL = "https://api.osv.dev/v1/";
const HOST = process.env.HOST ?? "0.0.0.0";
const PORT = Number.parseInt(process.env.PORT ?? "3000", 10);
const OSV_API_BASE =
  process.env.OSV_API_URL?.replace(/\/+$/, "") || DEFAULT_OSV_BASE_URL.replace(/\/+$/, "");

const commitField = z
  .string()
  .trim()
  .min(1, "commit cannot be empty")
  .describe("Commit SHA to query. Use this OR version, not both.");

const versionField = z
  .string()
  .trim()
  .min(1, "version cannot be empty")
  .describe(
    "Version string to query (fuzzy matched). Requires package. Use this OR commit, not both. If package.purl is provided, omit @version there.",
  );

const pageTokenField = z
  .string()
  .trim()
  .describe("Optional pagination token returned by previous OSV response.");

const packageSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, "package.name cannot be empty")
      .describe("Package name (required with ecosystem when not using purl).")
      .optional(),
    ecosystem: z
      .string()
      .trim()
      .min(1, "package.ecosystem cannot be empty")
      .describe("Package ecosystem (required with name when not using purl).")
      .optional(),
    purl: z
      .string()
      .trim()
      .min(1, "package.purl cannot be empty")
      .describe("Package URL (purl). Either purl OR (name + ecosystem). For version queries, omit @version here.")
      .optional(),
  })
  .strict()
  .superRefine((pkg, ctx) => {
    const hasPurl = Boolean(pkg.purl);
    const hasName = Boolean(pkg.name);
    const hasEcosystem = Boolean(pkg.ecosystem);

    if (!hasPurl && !(hasName && hasEcosystem)) {
      ctx.addIssue({
        code: "custom",
        message: "Provide either package.purl or both package.name and package.ecosystem.",
      });
    }

    if ((hasName && !hasEcosystem) || (hasEcosystem && !hasName)) {
      ctx.addIssue({
        code: "custom",
        message: "package.name and package.ecosystem must be provided together.",
      });
    }
  });

const queryInputSchema = z
  .object({
    commit: commitField.optional(),
    version: versionField.optional(),
    package: packageSchema
      .describe(
        "Package info. Required when using version. Provide either purl OR both name and ecosystem.",
      )
      .optional(),
    pageToken: pageTokenField.optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    const hasCommit = Boolean(value.commit);
    const hasVersion = Boolean(value.version);

    if (hasCommit && hasVersion) {
      ctx.addIssue({
        code: "custom",
        message: "Choose either commit or version, not both.",
      });
    }

    if (!hasCommit && !hasVersion) {
      ctx.addIssue({
        code: "custom",
        message: "Provide commit or version to query OSV.",
      });
    }

    if (hasVersion && !value.package) {
      ctx.addIssue({
        code: "custom",
        message: "package is required when using version queries.",
      });
    }

    if (hasVersion && value.package?.purl && value.package.purl.includes("@")) {
      ctx.addIssue({
        code: "custom",
        message: "When using version, package.purl must omit the version component.",
      });
    }
  });

const queryBatchInputSchema = z
  .object({
    queries: z
      .array(queryInputSchema)
      .min(1, "Provide at least one query item.")
      .describe("Array of OSV queries. Each item follows the same rules as osv_query."),
  })
  .strict();

type QueryInput = z.infer<typeof queryInputSchema>;
type QueryBatchInput = z.infer<typeof queryBatchInputSchema>;

const mcpServer = new McpServer({
  name: "osv-scan",
  version: "0.1.0",
});

mcpServer.registerTool("osv_query", {
  title: "OSV POST /v1/query",
  description:
    "Fetch vulnerabilities for one target via OSV /v1/query. Rules: supply exactly one of commit OR version; if version is used, package is required; package must be purl or (name + ecosystem); when version is present and purl is provided, omit @version from the purl; optionally pass pageToken from previous response.",
  inputSchema: queryInputSchema,
}, async (input) => {
  const payload = buildQueryPayload(input);
  const response = await callOsv("query", payload);

  return {
    content: [
      {
        type: "text",
        text: formatToolOutput("OSV query", payload, response),
      },
    ],
  };
});

mcpServer.registerTool("osv_query_batch", {
  title: "OSV POST /v1/querybatch",
  description:
    "Fetch vulnerabilities for multiple targets via OSV /v1/querybatch. Each query follows the same rules as osv_query (commit XOR version; package required when using version; purl must omit @version when version is present).",
  inputSchema: queryBatchInputSchema,
}, async ({ queries }: QueryBatchInput) => {
  const payload = {
    queries: queries.map(buildQueryPayload),
  };

  const response = await callOsv("querybatch", payload);

  return {
    content: [
      {
        type: "text",
        text: formatToolOutput("OSV querybatch", payload, response),
      },
    ],
  };
});

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? HOST}`);

  if (url.pathname !== "/mcp") {
    res.statusCode = 404;
    res.setHeader("Content-Type", "text/plain");
    res.end("Not Found");
    return;
  }

  let parsedBody: unknown;

  if (req.method === "POST") {
    try {
      const body = await readRequestBody(req);
      parsedBody = body.length > 0 ? JSON.parse(body) : undefined;
    } catch (error) {
      res.statusCode = 400;
      res.setHeader("Content-Type", "text/plain");
      res.end("Invalid JSON body");
      return;
    }
  }

  const transport = new StreamableHTTPServerTransport({
    // Stateless mode keeps things simple for MCP clients (no session header required).
    sessionIdGenerator: undefined,
    // Return JSON bodies instead of SSE streams so clients that don't keep streams open still work.
    enableJsonResponse: true,
  });

  res.on("close", () => {
    void transport.close();
  });

  try {
    await mcpServer.connect(transport);
    await transport.handleRequest(
      req,
      res,
      parsedBody,
    );
  } catch (error) {
    console.error("Unhandled server error:", error);

    if (!res.headersSent) {
      res.statusCode = 500;
      res.setHeader("Content-Type", "text/plain");
      res.end("Internal server error");
    }
  }
});

server.listen(PORT, HOST, () => {
  console.log(
    `OSV MCP server listening on http://${HOST}:${PORT}/mcp (base API ${OSV_API_BASE})`,
  );
});

function ensureTrailingSlash(url: string): string {
  return url.endsWith("/") ? url : `${url}/`;
}

function buildQueryPayload(input: QueryInput): Record<string, unknown> {
  const packageBody = input.package ? buildPackageBody(input.package) : undefined;

  const payload: Record<string, unknown> = {};

  if (input.commit) payload.commit = input.commit;
  if (input.version) payload.version = input.version;
  if (packageBody) payload.package = packageBody;
  if (input.pageToken) payload.page_token = input.pageToken;

  return payload;
}

function buildPackageBody(pkg: z.infer<typeof packageSchema>): Record<string, string> {
  if (pkg.purl) {
    return { purl: pkg.purl };
  }

  return {
    name: pkg.name?.trim() ?? "",
    ecosystem: pkg.ecosystem?.trim() ?? "",
  };
}

async function callOsv(
  path: "query" | "querybatch",
  body: Record<string, unknown>,
): Promise<unknown> {
  const url = new URL(path, ensureTrailingSlash(OSV_API_BASE));

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OSV ${path} failed: ${response.status} ${response.statusText} - ${errorText}`);
  }

  return response.json();
}

function formatToolOutput(
  label: string,
  payload: Record<string, unknown>,
  response: unknown,
): string {
  return [
    `${label} request payload:`,
    JSON.stringify(payload, null, 2),
    "",
    `${label} response:`,
    JSON.stringify(response, null, 2),
  ].join("\n");
}

async function readRequestBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];

  for await (const chunk of req) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }

  return Buffer.concat(chunks).toString("utf8");
}
