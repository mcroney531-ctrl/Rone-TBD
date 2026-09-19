import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AuthenticatedAgent } from "./auth.js";
import { sendMessage, sendMessageSchema } from "./tools/sendMessage.js";
import { getInbox, getInboxSchema } from "./tools/getInbox.js";
import { ackMessage, ackMessageSchema } from "./tools/ackMessage.js";
import {
  getThread,
  getThreadSchema,
  getMessage,
  getMessageSchema,
  resolveThread,
  resolveThreadSchema,
} from "./tools/getThread.js";
import {
  getProjectState,
  getProjectStateSchema,
  updateProjectState,
  updateProjectStateSchema,
} from "./tools/projectState.js";
import {
  publishHandoff,
  publishHandoffSchema,
  getHandoff,
  getHandoffSchema,
  listHandoffs,
  listHandoffsSchema,
} from "./tools/handoffs.js";
import { listEvents, listEventsSchema } from "./tools/events.js";
import { getProjectContext, getProjectContextSchema } from "./tools/projectContext.js";

function json(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data) }] };
}

function errorResult(err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  return { content: [{ type: "text" as const, text: JSON.stringify({ error: message }) }], isError: true };
}

/**
 * Builds a fresh McpServer bound to one already-authenticated agent.
 * Called once per stateless HTTP request (see index.ts) — cheap, and
 * keeps "who is calling" out of every tool's argument list.
 */
export function buildMcpServer(caller: AuthenticatedAgent): McpServer {
  const server = new McpServer({ name: "agent-relay", version: "1.0.0" });

  server.registerTool(
    "send_message",
    {
      description:
        "Send a message to one agent (to_agent_id) or broadcast to every other registered agent (broadcast: true). Reply threading via reply_to. idempotency_key must be unique per-agent per-logical-send; retrying the same key+payload replays the original result.",
      inputSchema: sendMessageSchema,
    },
    async (args) => {
      try {
        return json(await sendMessage(caller, args));
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.registerTool(
    "get_inbox",
    {
      description:
        "Pull-based: returns this agent's pending/pulled messages (not yet acknowledged), optionally filtered to one project. Calling this flips pending -> pulled.",
      inputSchema: getInboxSchema,
    },
    async (args) => {
      try {
        return json(await getInbox(caller, args));
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.registerTool(
    "ack_message",
    {
      description: "Mark one message's receipt state for this agent as pulled or acknowledged.",
      inputSchema: ackMessageSchema,
    },
    async (args) => {
      try {
        return json(await ackMessage(caller, args));
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.registerTool(
    "get_thread",
    {
      description:
        "Fetch every message in a thread plus each recipient's receipt state. Flips this agent's own pending receipts on those messages to pulled, same as get_inbox -- reading a message via get_thread instead of get_inbox still counts as having seen it.",
      inputSchema: getThreadSchema,
    },
    async (args) => {
      try {
        return json(await getThread(caller, args));
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.registerTool(
    "get_message",
    {
      description:
        "Fetch one message plus its recipients' receipt states. Flips this agent's own pending receipt on it to pulled, same as get_inbox.",
      inputSchema: getMessageSchema,
    },
    async (args) => {
      try {
        return json(await getMessage(caller, args));
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.registerTool(
    "resolve_thread",
    {
      description:
        "Mark a whole thread resolved (thread-level, not per-message). Optional decision_ref is a structured pointer to where the outcome actually landed: {type: 'project_state'|'handoff'|'message'|'external', ref: string, note?: string} -- not enforced, just makes the trace queryable later instead of free text decaying into 'see state'.",
      inputSchema: resolveThreadSchema,
    },
    async (args) => {
      try {
        return json(await resolveThread(caller.agentId, args));
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.registerTool(
    "get_project_state",
    {
      description: "Fetch a project's canonical current state and its version.",
      inputSchema: getProjectStateSchema,
    },
    async (args) => {
      try {
        return json(await getProjectState(args));
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.registerTool(
    "update_project_state",
    {
      description:
        "Update a project's state with optimistic concurrency: expected_version must match the current version or the call returns {conflict: true, current_version, current_state}. patch fields replace those top-level fields; no deep merge.",
      inputSchema: updateProjectStateSchema,
    },
    async (args) => {
      try {
        return json(await updateProjectState(caller, args));
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.registerTool(
    "publish_handoff",
    {
      description:
        "Publish a structured, immutable work-handoff snapshot for a project. Optional supersedes (a prior handoff_id) links this one as the update to an earlier proposal -- handoffs are immutable, so without this a superseded proposal just sits there with no forward pointer.",
      inputSchema: publishHandoffSchema,
    },
    async (args) => {
      try {
        return json(await publishHandoff(caller, args));
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.registerTool(
    "get_handoff",
    { description: "Fetch one handoff by id.", inputSchema: getHandoffSchema },
    async (args) => {
      try {
        return json(await getHandoff(args));
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.registerTool(
    "list_handoffs",
    { description: "List handoffs for a project, newest first.", inputSchema: listHandoffsSchema },
    async (args) => {
      try {
        return json(await listHandoffs(args));
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.registerTool(
    "get_project_context",
    {
      description:
        "One-call orientation packet for a fresh session: current project_state (including repo_context), the 5 most recent handoffs, every unresolved thread in the project, and this agent's own pending/pulled inbox. Includes context_generated_at, project_state_version, and event_seq_high_watermark so the packet's freshness is auditable later -- best-effort markers, not a serializable snapshot. Read-only -- does not flip inbox receipt states, unlike get_inbox.",
      inputSchema: getProjectContextSchema,
    },
    async (args) => {
      try {
        return json(await getProjectContext(caller, args));
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.registerTool(
    "list_events",
    {
      description: "Append-only audit/change feed for a project, for Cockpit/debugging use.",
      inputSchema: listEventsSchema,
    },
    async (args) => {
      try {
        return json(await listEvents(args));
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  return server;
}
