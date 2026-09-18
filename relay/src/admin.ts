import { Router } from "express";
import { timingSafeEqual } from "node:crypto";
import { generateToken, hashToken, type AuthenticatedAgent } from "./auth.js";
import { pool } from "./db.js";
import { sendMessage } from "./tools/sendMessage.js";
import { getInbox } from "./tools/getInbox.js";
import { ackMessage } from "./tools/ackMessage.js";
import { getThread } from "./tools/getThread.js";

/**
 * One-time bootstrap surface, gated by ADMIN_SECRET. Delete the
 * ADMIN_SECRET variable in Railway once agents are seeded and this
 * whole router fails closed (no secret configured => 503 on every route).
 */
export const adminRouter = Router();

function secretMatches(provided: string | undefined): boolean {
  const expected = process.env.ADMIN_SECRET;
  if (!expected || !provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

adminRouter.use((req, res, next) => {
  if (!process.env.ADMIN_SECRET) {
    res.status(503).json({ error: "admin_routes_disabled" });
    return;
  }
  if (!secretMatches(req.header("x-admin-secret"))) {
    res.status(401).json({ error: "invalid_admin_secret" });
    return;
  }
  next();
});

adminRouter.post("/agents", async (req, res) => {
  const { agent_id, display_name, kind, label } = req.body ?? {};
  if (!agent_id || !display_name || !kind) {
    res.status(400).json({ error: "agent_id, display_name, kind are required" });
    return;
  }

  await pool.query(
    `insert into agents (agent_id, display_name, kind)
     values ($1, $2, $3)
     on conflict (agent_id) do update set display_name = excluded.display_name`,
    [agent_id, display_name, kind]
  );

  const token = generateToken();
  await pool.query(
    `insert into agent_credentials (agent_id, token_hash, label)
     values ($1, $2, $3)`,
    [agent_id, hashToken(token), label ?? `${agent_id}-bootstrap`]
  );

  res.json({ agent_id, token });
});

/**
 * Runs the same seven-step vertical slice as scripts/acceptanceTest.ts,
 * but in-process against the tool functions directly rather than over
 * an MCP transport hop -- lets you verify the deployed contract with one
 * authenticated HTTP call instead of installing the MCP SDK locally.
 * Requires claude-a, claude-b, and codex-gpt to already exist (POST /agents first).
 */
adminRouter.post("/self-test", async (_req, res) => {
  const results: Array<{ ok: boolean; label: string; detail?: string }> = [];
  const check = (ok: boolean, label: string, detail?: string) => {
    results.push({ ok, label, detail });
  };

  const asCaller = (agentId: string): AuthenticatedAgent => ({
    agentId,
    displayName: agentId,
    kind: "test",
    credentialId: "admin-self-test",
  });

  try {
    const projectId = `self-test-${Date.now()}`;
    const a = asCaller("claude-a");
    const b = asCaller("claude-b");

    const ping = await sendMessage(a, {
      project_id: projectId,
      to_agent_id: "claude-b",
      body: { text: "ping" },
      idempotency_key: `self-test-ping-${projectId}`,
    });
    check(Boolean(ping.message_id), "A sent ping");

    const inboxB = await getInbox(b, { project_id: projectId });
    const seen = inboxB.messages.find((m) => m.message_id === ping.message_id);
    check(Boolean(seen), "B sees ping in inbox");
    check(seen?.receipt_state === "pulled", "receipt flipped pending -> pulled");

    const pong = await sendMessage(b, {
      project_id: projectId,
      to_agent_id: "claude-a",
      reply_to: ping.message_id,
      body: { text: "pong" },
      idempotency_key: `self-test-pong-${projectId}`,
    });
    check(pong.thread_id === ping.thread_id, "pong inherits ping's thread_id");

    await ackMessage(b, { message_id: ping.message_id, state: "acknowledged" });

    const thread = await getThread({ thread_id: ping.thread_id });
    check(thread.messages.length === 2, "thread has both messages");
    const pingInThread = thread.messages.find((m) => m.message_id === ping.message_id);
    const bReceipt = pingInThread?.receipts.find((r: { agent_id: string; state: string }) => r.agent_id === "claude-b");
    check(bReceipt?.state === "acknowledged", "B's receipt shows acknowledged");

    const replay = await sendMessage(a, {
      project_id: projectId,
      to_agent_id: "claude-b",
      body: { text: "ping" },
      idempotency_key: `self-test-ping-${projectId}`,
    });
    check(replay.message_id === ping.message_id && replay.replayed === true, "idempotent replay returns same message, flagged replayed");

    let conflictOk = false;
    try {
      await sendMessage(a, {
        project_id: projectId,
        to_agent_id: "claude-b",
        body: { text: "different" },
        idempotency_key: `self-test-ping-${projectId}`,
      });
    } catch (err) {
      conflictOk = err instanceof Error && err.message === "idempotency_conflict";
    }
    check(conflictOk, "same key + different payload rejected");

    const codexInbox = await getInbox(asCaller("codex-gpt"), { project_id: projectId });
    check(Array.isArray(codexInbox.messages), "codex-gpt reads inbox through identical contract");

    const allPass = results.every((r) => r.ok);
    res.status(allPass ? 200 : 500).json({ pass: allPass, results });
  } catch (err) {
    res.status(500).json({
      pass: false,
      results,
      error: err instanceof Error ? err.message : String(err),
      hint: "did you POST /admin/agents for claude-a, claude-b, and codex-gpt first?",
    });
  }
});
