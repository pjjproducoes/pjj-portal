import type { Env } from './env';

export async function audit(env: Env, event: {
  requestId: string;
  actorType: 'system' | 'admin' | 'client' | 'grant' | 'embed';
  actorId?: string | null;
  action: string;
  targetType: string;
  targetId?: string | null;
  outcome?: 'success' | 'denied' | 'failure';
  ipHash?: string | null;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO audit_logs(request_id,actor_type,actor_id,action,target_type,target_id,outcome,ip_hash,metadata_json)
     VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9)`
  ).bind(
    event.requestId,
    event.actorType,
    event.actorId ?? null,
    event.action,
    event.targetType,
    event.targetId ?? null,
    event.outcome ?? 'success',
    event.ipHash ?? null,
    JSON.stringify(event.metadata ?? {})
  ).run();
}

