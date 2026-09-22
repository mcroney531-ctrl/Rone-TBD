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

/**
 * Replaces a staged manual two-agent race: two independently authenticated
 * clients read the same project_state version, then fire concurrent
 * update_project_state calls against that same expected_version. Exactly
 * one must win; the other must get a real conflict, not a silent
 * overwrite or a second silent success.
 */
async function main() {
  const projectId = "concurrency-test";
  const a = await client("a", TOKEN_A);
  const b = await client("b", TOKEN_B);

  const state = unwrap(await a.callTool({ name: "get_project_state", arguments: { project_id: projectId } }));
  const expectedVersion = Number(state.version);

  const [resultA, resultB] = await Promise.all([
    a.callTool({
      name: "update_project_state",
      arguments: { project_id: projectId, expected_version: expectedVersion, patch: { objective: "written by A" } },
    }),
    b.callTool({
      name: "update_project_state",
      arguments: { project_id: projectId, expected_version: expectedVersion, patch: { objective: "written by B" } },
    }),
  ]);

  const parsedA = unwrap(resultA);
  const parsedB = unwrap(resultB);

  const successes = [parsedA, parsedB].filter((r) => r.conflict === false);
  const conflicts = [parsedA, parsedB].filter((r) => r.conflict === true);

  ok(successes.length === 1, "exactly one of the two concurrent writers succeeded");
  ok(conflicts.length === 1, "exactly one of the two concurrent writers got a real conflict");
  if (conflicts.length === 1) {
    ok(conflicts[0].current_version === successes[0]?.version, "the conflict response's current_version matches the winner's new version");
  }

  const finalState = unwrap(await a.callTool({ name: "get_project_state", arguments: { project_id: projectId } }));
  ok(
    finalState.objective === "written by A" || finalState.objective === "written by B",
    "final state reflects exactly one writer's patch, not a blend of both"
  );
  ok(Number(finalState.version) === expectedVersion + 1, "version advanced by exactly one, not two");

  console.log(process.exitCode ? "\nFAIL" : "\nPASS");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
