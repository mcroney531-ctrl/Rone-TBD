import { z } from "zod";
import { withTransaction } from "../db.js";
import { ensureProject } from "../projects.js";
import type { AuthenticatedAgent } from "../auth.js";

export const getProjectContextSchema = z.object({
  project_id: z.string().min(1),
});

/**
 * Every fresh session was assembling its own pregame packet out of 3-4
 * separate calls (get_project_state, list_handoffs, get_inbox, and
 * manually noticing which threads were still open). This is that packet
 * in one call: current state, recent handoffs, unresolved threads in
 * this project, and this agent's own pending inbox.
 */
export async function getProjectContext(
  caller: AuthenticatedAgent,
  input: z.infer<typeof getProjectContextSchema>
) {
  return withTransaction(async (client) => {
    await ensureProject(client, input.project_id);

    const stateResult = await client.query(
      `select * from project_state where project_id = $1`,
      [input.project_id]
    );

    const handoffsResult = await client.query(
      `select handoff_id, from_agent_id, to_agent_id, objective, created_at
         from handoffs
        where project_id = $1
        order by created_at desc
        limit 5`,
      [input.project_id]
    );

    const unresolvedThreadsResult = await client.query(
      `select * from (
         select distinct on (m.thread_id)
                m.thread_id, m.body as latest_body, m.from_agent_id as latest_from,
                m.created_at as latest_at
           from messages m
           left join thread_resolutions tr on tr.thread_id = m.thread_id
          where m.project_id = $1 and tr.thread_id is null
          order by m.thread_id, m.created_at desc
       ) t
       order by latest_at desc
       limit 20`,
      [input.project_id]
    );

    const inboxResult = await client.query(
      `select m.message_id, m.thread_id, m.from_agent_id, m.body, m.created_at, r.state
         from message_receipts r
         join messages m on m.message_id = r.message_id
        where r.agent_id = $1 and m.project_id = $2
          and r.state in ('pending', 'pulled')
        order by m.created_at asc`,
      [caller.agentId, input.project_id]
    );

    const highWatermarkResult = await client.query(
      `select coalesce(max(seq), 0) as high_watermark from events where project_id = $1`,
      [input.project_id]
    );

    return {
      // Best-effort freshness markers, not a serializable snapshot -- each
      // query above sees latest-committed data as of when it ran, not one
      // consistent instant. Good enough to answer "how stale was this
      // packet when an agent started working," not for correctness logic.
      context_generated_at: new Date().toISOString(),
      // Surfaced here too, not just via whoami: a session pulling context
      // at the start of its work should see its own attributed identity
      // in the same call, not have to remember a separate check.
      caller_agent_id: caller.agentId,
      caller_display_name: caller.displayName,
      project_state_version: Number(stateResult.rows[0].version),
      event_seq_high_watermark: Number(highWatermarkResult.rows[0].high_watermark),
      project_state: stateResult.rows[0],
      recent_handoffs: handoffsResult.rows,
      unresolved_threads: unresolvedThreadsResult.rows,
      your_inbox: inboxResult.rows.map((r) => ({ ...r })),
    };
  });
}
