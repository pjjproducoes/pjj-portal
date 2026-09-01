import type { Env } from './env';
import type { Principal } from './auth';
import { ensureFolder } from './drive';
import { audit } from './audit';
import { error, json, readJson } from './http';

function clean(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const result = value.trim().replace(/[\u0000-\u001f\u007f]/g, '');
  return result && result.length <= max ? result : null;
}

function slug(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 72) || crypto.randomUUID().slice(0, 8);
}

function page(url: URL): { limit: number; offset: number } {
  const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit') || 25)));
  const offset = Math.max(0, Number(url.searchParams.get('offset') || 0));
  return { limit: Number.isFinite(limit) ? limit : 25, offset: Number.isFinite(offset) ? offset : 0 };
}

export async function listClients(env: Env, url: URL): Promise<Response> {
  const { limit, offset } = page(url);
  const result = await env.DB.prepare(
    `SELECT id,name,legal_name,primary_contact_name,email,phone,notes,branding_json,status,logo_drive_file_id IS NOT NULL has_logo,created_at,updated_at
     FROM clients WHERE status!='trashed' ORDER BY name LIMIT ?1 OFFSET ?2`
  ).bind(limit, offset).all();
  return json({ items: result.results, limit, offset });
}

export async function createClient(request: Request, env: Env, actor: Principal, rid: string): Promise<Response> {
  let input: Record<string, unknown>;
  try { input = await readJson(request); } catch { return error(400, 'invalid_json', 'Dados inválidos.', rid); }
  const name = clean(input.name, 160);
  if (!name) return error(400, 'invalid_name', 'Informe o nome do cliente.', rid);
  const id = crypto.randomUUID();
  let clientFolder: string;
  try {
    const clientsRoot = await ensureFolder(env, { parentId: env.DRIVE_ROOT_FOLDER_ID, entityType: 'clients_root', entityId: 'clients', name: 'Clientes' });
    clientFolder = await ensureFolder(env, { parentId: clientsRoot, entityType: 'client', entityId: id, name: `${id} — ${name}` });
    await ensureFolder(env, { parentId: clientFolder, entityType: 'projects_root', entityId: id, name: 'Projetos' });
  } catch {
    return error(502, 'drive_unavailable', 'O Drive não criou a estrutura do cliente.', rid);
  }
  await env.DB.prepare(
    `INSERT INTO clients(id,name,legal_name,primary_contact_name,email,phone,notes,drive_folder_id)
     VALUES(?1,?2,?3,?4,?5,?6,?7,?8)`
  ).bind(
    id, name, clean(input.legalName, 200), clean(input.primaryContactName, 120),
    clean(input.email, 254)?.toLowerCase() ?? null, clean(input.phone, 40) ?? null, clean(input.notes, 4000) ?? null, clientFolder
  ).run();
  await audit(env, { requestId: rid, actorType: 'admin', actorId: actor.userId, action: 'client.created', targetType: 'client', targetId: id });
  return json({ client: { id, name, status: 'active', driveFolderReady: true } }, 201);
}

export async function listProjects(env: Env, url: URL): Promise<Response> {
  const { limit, offset } = page(url);
  const clientId = url.searchParams.get('clientId');
  const result = await env.DB.prepare(
    `SELECT p.id,p.client_id,p.name,p.slug,p.description,p.location_text,p.latitude,p.longitude,p.cover_asset_id,p.status,p.visibility,p.settings_json,p.created_at,p.updated_at,c.name client_name
     FROM projects p JOIN clients c ON c.id=p.client_id
     WHERE p.status!='trashed' AND (?1 IS NULL OR p.client_id=?1)
     ORDER BY p.updated_at DESC LIMIT ?2 OFFSET ?3`
  ).bind(clientId, limit, offset).all();
  return json({ items: result.results, limit, offset });
}

export async function createProject(request: Request, env: Env, actor: Principal, rid: string): Promise<Response> {
  let input: Record<string, unknown>;
  try { input = await readJson(request); } catch { return error(400, 'invalid_json', 'Dados inválidos.', rid); }
  const name = clean(input.name, 180);
  const clientId = clean(input.clientId, 50);
  const visibility=['private','shared','public_demo'].includes(String(input.visibility||''))?String(input.visibility):'private';
  if (!name || !clientId) return error(400, 'invalid_project', 'Cliente e nome do projeto são obrigatórios.', rid);
  const client = await env.DB.prepare("SELECT id,drive_folder_id FROM clients WHERE id=?1 AND status='active'").bind(clientId).first<{ id:string; drive_folder_id:string }>();
  if (!client) return error(404, 'client_not_found', 'Cliente não encontrado.', rid);
  const id = crypto.randomUUID();
  let projectFolder: string;
  try {
    const projectsRoot = await ensureFolder(env, { parentId: client.drive_folder_id, entityType: 'projects_root', entityId: client.id, name: 'Projetos' });
    projectFolder = await ensureFolder(env, { parentId: projectsRoot, entityType: 'project', entityId: id, name: `${id} — ${name}` });
    await ensureFolder(env, { parentId: projectFolder, entityType: 'captures_root', entityId: id, name: 'Captacoes' });
  } catch {
    return error(502, 'drive_unavailable', 'O Drive não criou a estrutura do projeto.', rid);
  }
  let projectSlug = slug(name);
  const duplicate = await env.DB.prepare('SELECT 1 found FROM projects WHERE client_id=?1 AND slug=?2').bind(clientId, projectSlug).first();
  if (duplicate) projectSlug += '-' + id.slice(0, 8);
  await env.DB.prepare(
    `INSERT INTO projects(id,client_id,name,slug,description,location_text,visibility,drive_folder_id)
     VALUES(?1,?2,?3,?4,?5,?6,?7,?8)`
  ).bind(id, clientId, name, projectSlug, clean(input.description, 5000) ?? null, clean(input.location, 300) ?? null, visibility, projectFolder).run();
  await audit(env, { requestId: rid, actorType: 'admin', actorId: actor.userId, action: 'project.created', targetType: 'project', targetId: id });
  return json({ project: { id, clientId, name, slug: projectSlug, status: 'draft', visibility, driveFolderReady: true } }, 201);
}

export async function listCaptures(env: Env, projectId: string): Promise<Response> {
  const result = await env.DB.prepare(
    `SELECT id,project_id,captured_at,title,description,status,metrics_json,published_at,created_at,updated_at
     FROM captures WHERE project_id=?1 AND status!='trashed' ORDER BY captured_at DESC`
  ).bind(projectId).all();
  return json({ items: result.results });
}

export async function createCapture(request: Request, env: Env, actor: Principal, projectId: string, rid: string): Promise<Response> {
  let input: Record<string, unknown>;
  try { input = await readJson(request); } catch { return error(400, 'invalid_json', 'Dados inválidos.', rid); }
  const capturedAt = clean(input.capturedAt, 40);
  if (!capturedAt || Number.isNaN(Date.parse(capturedAt))) return error(400, 'invalid_capture_date', 'Informe uma data de captação válida.', rid);
  const project = await env.DB.prepare("SELECT id,drive_folder_id FROM projects WHERE id=?1 AND status!='trashed'").bind(projectId).first<{ id:string; drive_folder_id:string }>();
  if (!project) return error(404, 'project_not_found', 'Projeto não encontrado.', rid);
  const id = crypto.randomUUID();
  const rawMetrics=input.metrics && typeof input.metrics==='object'&&!Array.isArray(input.metrics)?input.metrics as Record<string,unknown>:{};
  const metrics:Record<string,string|number>={};
  for(const key of ['area','imageCount','gsd','flightAltitude']){
    const value=rawMetrics[key];
    if(typeof value==='string'&&value.trim()&&value.trim().length<=80)metrics[key]=value.trim();
    else if(typeof value==='number'&&Number.isFinite(value))metrics[key]=value;
  }
  let captureFolder: string;
  try {
    const capturesRoot = await ensureFolder(env, { parentId: project.drive_folder_id, entityType: 'captures_root', entityId: project.id, name: 'Captacoes' });
    captureFolder = await ensureFolder(env, { parentId: capturesRoot, entityType: 'capture', entityId: id, name: `${id} — ${capturedAt.slice(0,10)}` });
    await Promise.all([
      ensureFolder(env, { parentId: captureFolder, entityType: 'original', entityId: id, name: 'Original' }),
      ensureFolder(env, { parentId: captureFolder, entityType: 'processed', entityId: id, name: 'Processados' }),
      ensureFolder(env, { parentId: captureFolder, entityType: 'previews', entityId: id, name: 'Previews' }),
      ensureFolder(env, { parentId: captureFolder, entityType: 'documents', entityId: id, name: 'Documentos' })
    ]);
  } catch {
    return error(502, 'drive_unavailable', 'O Drive não criou a estrutura da captação.', rid);
  }
  await env.DB.prepare(
    'INSERT INTO captures(id,project_id,captured_at,title,description,metrics_json,drive_folder_id) VALUES(?1,?2,?3,?4,?5,?6,?7)'
  ).bind(id, projectId, new Date(capturedAt).toISOString(), clean(input.title, 180), clean(input.description, 4000), JSON.stringify(metrics), captureFolder).run();
  await audit(env, { requestId: rid, actorType: 'admin', actorId: actor.userId, action: 'capture.created', targetType: 'capture', targetId: id });
  return json({ capture: { id, projectId, capturedAt: new Date(capturedAt).toISOString(), status: 'draft', driveFolderReady: true } }, 201);
}
