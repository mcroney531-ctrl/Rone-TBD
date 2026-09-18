import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const RELAY_URL = process.env.RELAY_URL as string;
const TOKEN = process.env.TOKEN_A as string;

async function main() {
  const transport = new StreamableHTTPClientTransport(new URL(RELAY_URL), {
    requestInit: { headers: { Authorization: `Bearer ${TOKEN}` } },
  });
  const c = new Client({ name: "schema-inspector", version: "1.0.0" });
  await c.connect(transport);
  const { tools } = await c.listTools();
  const sendMessage = tools.find((t) => t.name === "send_message");
  console.log(JSON.stringify(sendMessage?.inputSchema, null, 2));
}

main();
