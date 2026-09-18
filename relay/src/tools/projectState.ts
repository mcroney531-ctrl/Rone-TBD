import { z } from "zod";
import { withTransaction } from "../db.js";
import { ensureProject, recordEvent } from "../projects.js";
import type { AuthenticatedAgent } from "../auth.js";

const PATCHABLE_FIELDS = [
  "objective",
  "phase",
  "decisions_made",
  "decisions_rejected",
  "open_questions",
  "known_bugs",
  "repos",
  "next_actions",
] as const;

export const getProjectStateSchema = z.object({
  project_id: z.string().min(1),
});

export const updateProjectStateSchema = z.object({
  project_id: z.string().min(1),
  expected_version: z.number().int().positive(),
  patch: z
    .object({
      objective: z.string().optional(),
      phase: z.string().optional(),
      decisions_made: z.array(z.unknown()).optional(),
      decisions_rejected: z.array(z.unknown()).optional(),
      open_questions: z.array(z.unknown()).optional(),
      known_bugs: z.array(z.unknown()).optional(),
      repos: z.array(z.unknown()).optional(),
      next_actions: z.array(z.unknown()).optional(),
    })
    .refine((p) => Object.keys(p).length > 0, "patch must set at least one field"),
});

export async function getProjectState(input: z.infer<typeof getProjectStateSchema>) {
  return withTransaction(async (client) => {
    await ensureProject(client, input.project_id);
    const result = await client.query(
      `select * from project_state where project_id = $1`,
      [input.project_id]
    );
    return result.rows[0];
  });
}

export async function updateProjectState(
  caller: AuthenticatedAgent,
  input: z.infer<typeof updateProjectStateSchema>
) {
  return withTransaction(async (client) => {
    await ensureProject(client, input.project_id);

    const current = await client.query(
      `select version, * from project_state where project_id = $1 for update`,
      [input.project_id]
    );
    const currentRow = current.rows[0];

    if (Number(currentRow.version) !== input.expected_version) {
      return {
        conflict: true,
        current_version: Number(currentRow.version),
        current_state: currentRow,
      };
    }

    // Flat top-level replace: only fields present in the patch change.
    // No recursive merge — ambiguity there is exactly what we're avoiding.
    const TEXT_FIELDS = new Set(["objective", "phase"]);
    const setClauses: string[] = [];
    const params: unknown[] = [];

    for (const field of PATCHABLE_FIELDS) {
      if (!(field in input.patch)) continue;
      const value = (input.patch as Record<string, unknown>)[field];
      if (TEXT_FIELDS.has(field)) {
        params.push(value);
        setClauses.push(`${field} = $${params.length}`);
      } else {
        params.push(JSON.stringify(value));
        setClauses.push(`${field} = $${params.length}::jsonb`);
      }
    }

    params.push(caller.agentId);
    const agentIdParamIndex = params.length;
    params.push(input.project_id);
    const projectIdParamIndex = params.length;

    setClauses.push("version = version + 1", "updated_at = now()", `updated_by_agent_id = $${agentIdParamIndex}`);

    const updated = await client.query(
      `update project_state
          set ${setClauses.join(", ")}
        where project_id = $${projectIdParamIndex}
      returning *`,
      params
    );

    await recordEvent(client, input.project_id, caller.agentId, "project_state.updated", {
      new_version: Number(updated.rows[0].version),
      patched_fields: Object.keys(input.patch),
    });

    return { conflict: false, state: updated.rows[0], version: Number(updated.rows[0].version) };
  });
}
