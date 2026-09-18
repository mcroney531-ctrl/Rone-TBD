import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const RELAY_URL = process.env.RELAY_URL;
const TOKEN_A = process.env.TOKEN_A;
const TOKEN_B = process.env.TOKEN_B;
const TOKEN_CODEX = process.env.TOKEN_CODEX;

if (!RELAY_URL || !TOKEN_A || !TOKEN_B || !TOKEN_CODEX) {
  console.error("usage: RELAY_URL=... TOKEN_A=... TOKEN_B=... TOKEN_CODEX=... node dist/scripts/acceptanceTest.js");
  process.exit(1);
}

async function client(name: string, token: string): Promise<Client> {
  const transport = new StreamableHTTPClientTransport(new URL(RELAY_URL as string), {
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
  });
  const c = new Client({ name, version: "1.0.0" });
  await c.connect(transport);
  return c;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function unwrap(result: any) {
  const text = result.content?.[0]?.text;
  if (!text) throw new Error("empty tool result");
  const parsed = JSON.parse(text);
  if (result.isError) throw new Error(`tool error: ${parsed.error}`);
  return parsed;
}

function assertEqual(actual: unknown, expected: unknown, label: string) {
  if (actual !== expected) {
    throw new Error(`FAIL ${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
  console.log(`ok   ${label}`);
}

function assertTrue(cond: boolean, label: string) {
  if (!cond) throw new Error(`FAIL ${label}`);
  console.log(`ok   ${label}`);
}

async function main() {
  const projectId = "vertical-slice-test";
  const a = await client("claude-a-test-client", TOKEN_A as string);
  const b = await client("claude-b-test-client", TOKEN_B as string);

  // 1. A sends ping to B
  const ping = unwrap(
    await a.callTool({
      name: "send_message",
      arguments: {
        project_id: projectId,
        to_agent_id: "claude-b",
        body: { text: "ping" },
        idempotency_key: "vslice-ping-1",
      },
    })
  );
  assertTrue(Boolean(ping.message_id), "A sent ping, got message_id");

  // 2. B sees it in inbox, pending -> pulled
  const inboxB = unwrap(await b.callTool({ name: "get_inbox", arguments: { project_id: projectId } }));
  const seen = inboxB.messages.find((m: { message_id: string }) => m.message_id === ping.message_id);
  assertTrue(Boolean(seen), "B's inbox contains the ping");
  assertEqual(seen.receipt_state, "pulled", "ping receipt flipped to pulled on pull");

  // 3. B replies pong, then acknowledges the original ping
  const pong = unwrap(
    await b.callTool({
      name: "send_message",
      arguments: {
        project_id: projectId,
        to_agent_id: "claude-a",
        reply_to: ping.message_id,
        body: { text: "pong" },
        idempotency_key: "vslice-pong-1",
      },
    })
  );
  assertEqual(pong.thread_id, ping.thread_id, "pong inherits ping's thread_id");

  await b.callTool({
    name: "ack_message",
    arguments: { message_id: ping.message_id, state: "acknowledged" },
  });

  // 4. A verifies via get_thread — not get_inbox, since A can't see receipts on its
  //    own outgoing message through an inbox call.
  const thread = unwrap(await a.callTool({ name: "get_thread", arguments: { thread_id: ping.thread_id } }));
  assertEqual(thread.messages.length, 2, "thread has ping + pong");
  const pingInThread = thread.messages.find((m: { message_id: string }) => m.message_id === ping.message_id);
  const bReceipt = pingInThread.receipts.find((r: { agent_id: string }) => r.agent_id === "claude-b");
  assertEqual(bReceipt.state, "acknowledged", "B's receipt on the ping shows acknowledged");

  // 5. Idempotency: replay the exact same send_message call
  const replay = unwrap(
    await a.callTool({
      name: "send_message",
      arguments: {
        project_id: projectId,
        to_agent_id: "claude-b",
        body: { text: "ping" },
        idempotency_key: "vslice-ping-1",
      },
    })
  );
  assertEqual(replay.message_id, ping.message_id, "idempotent replay returns the same message_id");
  assertEqual(replay.replayed, true, "idempotent replay flagged as replayed");

  // 6. Conflicting payload under the same idempotency_key must 409/conflict, not silently succeed
  let conflictDetected = false;
  const conflictResult = await a.callTool({
    name: "send_message",
    arguments: {
      project_id: projectId,
      to_agent_id: "claude-b",
      body: { text: "different payload" },
      idempotency_key: "vslice-ping-1",
    },
  });
  const conflictParsed = JSON.parse((conflictResult.content as Array<{ text: string }>)[0].text);
  conflictDetected = conflictResult.isError === true && conflictParsed.error === "idempotency_conflict";
  assertTrue(conflictDetected, "same key + different payload rejected as idempotency_conflict");

  // 7. Codex joins through the identical MCP contract, no special-casing
  const codex = await client("codex-test-client", TOKEN_CODEX as string);
  const codexInbox = unwrap(await codex.callTool({ name: "get_inbox", arguments: { project_id: projectId } }));
  assertTrue(Array.isArray(codexInbox.messages), "codex-gpt can call get_inbox through the same contract");

  console.log("\nvertical slice: PASS");
}

main().catch((err) => {
  console.error("\nvertical slice: FAIL");
  console.error(err);
  process.exit(1);
});
