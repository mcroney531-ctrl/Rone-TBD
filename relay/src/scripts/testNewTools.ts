import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const RELAY_URL = process.env.RELAY_URL as string;
const TOKEN_A = process.env.TOKEN_A as string;
const TOKEN_B = process.env.TOKEN_B as string;

async function client(name: string, token: string): Promise<Client> {
  const transport = new StreamableHTTPClientTransport(new URL(RELAY_URL), {
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
  });
  const c = new Client({ name, version: "1.0.0" });
  await c.connect(transport);
  return c;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function unwrap(result: any) {
  const text = result.content?.[0]?.text;
  const parsed = JSON.parse(text);
  if (result.isError) throw new Error(`tool error: ${parsed.error}`);
  return parsed;
}

function ok(cond: boolean, label: string) {
  console.log(`${cond ? "ok  " : "FAIL"} ${label}`);
  if (!cond) process.exitCode = 1;
}

async function main() {
  const projectId = "new-tools-test";
  const a = await client("a", TOKEN_A);
  const b = await client("b", TOKEN_B);

  // repo_context patch round-trips through project_state
  const state1 = unwrap(await a.callTool({ name: "get_project_state", arguments: { project_id: projectId } }));
  const updated = unwrap(
    await a.callTool({
      name: "update_project_state",
      arguments: {
        project_id: projectId,
        expected_version: Number(state1.version),
        patch: {
          repo_context: {
            repo_url: "https://github.com/mcroney531-ctrl/parlay-helper",
            default_branch: "claude/new-session-zjwgof",
            working_branch: "claude/frontend-redesign-film-room",
            latest_known_commit: "f4b7384b74605dacc5f8f2b912e933075087a85b",
          },
        },
      },
    })
  );
  ok(updated.state.repo_context.working_branch === "claude/frontend-redesign-film-room", "repo_context round-trips through project_state");

  // send a message + leave its thread unresolved
  const msg = unwrap(
    await a.callTool({
      name: "send_message",
      arguments: {
        project_id: projectId,
        to_agent_id: "claude-b",
        body: { text: "context test" },
        idempotency_key: "context-test-1",
      },
    })
  );

  // get_project_context: should see the repo_context, the unresolved thread, and B's pending inbox item
  const ctxB = unwrap(await b.callTool({ name: "get_project_context", arguments: { project_id: projectId } }));
  ok(ctxB.project_state.repo_context.working_branch === "claude/frontend-redesign-film-room", "get_project_context surfaces repo_context");
  ok(ctxB.unresolved_threads.some((t: { thread_id: string }) => t.thread_id === msg.thread_id), "get_project_context lists the unresolved thread");
  ok(ctxB.your_inbox.some((m: { message_id: string }) => m.message_id === msg.message_id), "get_project_context includes the pending inbox item");
  ok(typeof ctxB.context_generated_at === "string" && !Number.isNaN(Date.parse(ctxB.context_generated_at)), "context_generated_at is a valid timestamp");
  ok(ctxB.project_state_version === Number(updated.version), "project_state_version matches the state just written");
  ok(ctxB.event_seq_high_watermark >= 1, "event_seq_high_watermark is a real number, not zero, after real events happened");

  // get_project_context must NOT mutate receipt state (pure read)
  const inboxAfter = unwrap(await b.callTool({ name: "get_inbox", arguments: { project_id: projectId } }));
  const receiptState = inboxAfter.messages.find((m: { message_id: string }) => m.message_id === msg.message_id)?.receipt_state;
  ok(receiptState === "pulled", "get_inbox still correctly flips pending -> pulled (get_project_context didn't consume it first)");

  // resolve_thread with structured decision_ref
  await b.callTool({
    name: "resolve_thread",
    arguments: {
      thread_id: msg.thread_id,
      decision_ref: { type: "project_state", ref: "repo_context", note: "set during context test" },
    },
  });
  const thread = unwrap(await a.callTool({ name: "get_thread", arguments: { thread_id: msg.thread_id } }));
  ok(thread.resolved?.decision_ref?.type === "project_state", "structured decision_ref round-trips through get_thread (type)");
  ok(thread.resolved?.decision_ref?.ref === "repo_context", "structured decision_ref round-trips through get_thread (ref)");

  // now resolved, should drop out of get_project_context's unresolved list
  const ctxAfter = unwrap(await a.callTool({ name: "get_project_context", arguments: { project_id: projectId } }));
  ok(!ctxAfter.unresolved_threads.some((t: { thread_id: string }) => t.thread_id === msg.thread_id), "resolved thread drops out of unresolved_threads");

  console.log(process.exitCode ? "\nFAIL" : "\nPASS");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
