import { z } from "zod";
import { pool } from "../db.js";

export const listEventsSchema = z.object({
  project_id: z.string().min(1),
  since_seq: z.number().int().nonnegative().optional(),
  limit: z.number().int().positive().max(500).optional(),
});

export async function listEvents(input: z.infer<typeof listEventsSchema>) {
  const limit = input.limit ?? 100;
  const params: unknown[] = [input.project_id, input.since_seq ?? 0, limit];

  const result = await pool.query(
    `select event_id, seq, project_id, actor_agent_id, kind, payload, created_at
       from events
      where project_id = $1 and seq > $2
      order by seq asc
      limit $3`,
    params
  );

  return {
    events: result.rows.map((r) => ({ ...r, seq: Number(r.seq) })),
  };
}
