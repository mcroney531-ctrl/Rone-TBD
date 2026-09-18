import express from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { authenticate, AuthError } from "./auth.js";
import { buildMcpServer } from "./mcpServer.js";
import { pool } from "./db.js";
import { adminRouter } from "./admin.js";

const app = express();
app.use(express.json());
app.use("/admin", adminRouter);

app.get("/healthz", async (_req, res) => {
  try {
    await pool.query("select 1");
    res.status(200).json({ ok: true });
  } catch {
    res.status(503).json({ ok: false });
  }
});

app.post("/mcp", async (req, res) => {
  let caller;
  try {
    caller = await authenticate(req.header("authorization"));
  } catch (err) {
    const code = err instanceof AuthError ? err.message : "auth_failed";
    res.status(401).json({ error: code });
    return;
  }

  const server = buildMcpServer(caller);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });

  res.on("close", () => {
    transport.close();
    server.close();
  });

  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    if (!res.headersSent) {
      res.status(500).json({ error: err instanceof Error ? err.message : "internal_error" });
    }
  }
});

const port = Number(process.env.PORT ?? 3000);
app.listen(port, () => {
  console.log(`agent-relay listening on :${port}`);
});
