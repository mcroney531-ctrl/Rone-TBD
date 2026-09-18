import type { PoolClient } from "pg";

export async function ensureProject(
  client: PoolClient,
  projectId: string
): Promise<void> {
  await client.query(
    `insert into projects (project_id) values ($1)
     on conflict (project_id) do nothing`,
    [projectId]
  );
  await client.query(
    `insert into project_state (project_id) values ($1)
     on conflict (project_id) do nothing`,
    [projectId]
  );
}

export async function recordEvent(
  client: PoolClient,
  projectId: string,
  actorAgentId: string,
  kind: string,
  payload: Record<string, unknown>
): Promise<void> {
  await client.query(
    `insert into events (project_id, actor_agent_id, kind, payload)
     values ($1, $2, $3, $4)`,
    [projectId, actorAgentId, kind, JSON.stringify(payload)]
  );
}
