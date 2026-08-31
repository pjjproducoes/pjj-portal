import type { Env } from './env';

interface ServiceAccount {
  client_email: string;
  private_key: string;
  token_uri: string;
}

interface TokenCache { token: string; expiresAt: number }
let cachedToken: TokenCache | null = null;

function base64Url(input: string | Uint8Array): string {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : input;
  let value = '';
  for (const byte of bytes) value += String.fromCharCode(byte);
  return btoa(value).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

async function accessToken(env: Env): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.token;
  const account = JSON.parse(env.DRIVE_SERVICE_ACCOUNT_JSON) as ServiceAccount;
  const now = Math.floor(Date.now() / 1000);
  const header = base64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = base64Url(JSON.stringify({
    iss: account.client_email,
    scope: 'https://www.googleapis.com/auth/drive',
    aud: account.token_uri,
    iat: now,
    exp: now + 3600
  }));
  const der = account.private_key.replace(/-----(BEGIN|END) PRIVATE KEY-----|\s/g, '');
  const key = await crypto.subtle.importKey(
    'pkcs8',
    Uint8Array.from(atob(der), char => char.charCodeAt(0)),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(`${header}.${claims}`));
  const response = await fetch(account.token_uri, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${header}.${claims}.${base64Url(new Uint8Array(signature))}`
    })
  });
  if (!response.ok) throw new Error(`drive_auth_${response.status}`);
  const result = await response.json<{ access_token: string; expires_in: number }>();
  cachedToken = { token: result.access_token, expiresAt: Date.now() + result.expires_in * 1000 };
  return result.access_token;
}

export async function driveAccessToken(env: Env): Promise<string> { return accessToken(env); }

export async function createResumableUpload(env: Env, input: {
  name: string; mimeType: string; size: number; parentId: string; assetId: string; projectId: string;
}): Promise<string> {
  const token = await accessToken(env);
  const response = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,name,size,mimeType,md5Checksum', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json; charset=UTF-8',
      'x-upload-content-type': input.mimeType,
      'x-upload-content-length': String(input.size)
    },
    body: JSON.stringify({
      name: input.name,
      mimeType: input.mimeType,
      parents: [input.parentId],
      appProperties: { pjjManaged: 'true', assetId: input.assetId, projectId: input.projectId }
    })
  });
  const location = response.headers.get('location');
  if (!response.ok || !location) throw new Error(`drive_upload_init_${response.status}`);
  return location;
}

export async function uploadChunk(env: Env, sessionUrl: string, body: ReadableStream, contentRange: string, contentType: string): Promise<Response> {
  const token = await accessToken(env);
  const match = contentRange.match(/^bytes (\d+)-(\d+)\/(\d+)$/);
  if (!match) throw new Error('invalid_content_range');
  const length = Number(match[2]) - Number(match[1]) + 1;
  return fetch(sessionUrl, {
    method: 'PUT',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': contentType,
      'content-length': String(length),
      'content-range': contentRange
    },
    body
  });
}

export async function streamFile(env: Env, fileId: string, range: string | null): Promise<Response> {
  const token = await accessToken(env);
  const headers = new Headers({ authorization: `Bearer ${token}` });
  if (range) headers.set('range', range);
  return fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`, { headers });
}

export async function trashDriveFile(env:Env,fileId:string):Promise<void>{
  const token=await accessToken(env);const response=await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?fields=id,trashed`,{method:'PATCH',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify({trashed:true})});
  if(!response.ok)throw new Error(`drive_trash_${response.status}`);
}

function driveQueryValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

export async function ensureFolder(env: Env, input: {
  parentId: string;
  entityType: 'clients_root' | 'client' | 'projects_root' | 'project' | 'captures_root' | 'capture' | 'original' | 'processed' | 'previews' | 'documents';
  entityId: string;
  name: string;
}): Promise<string> {
  const token = await accessToken(env);
  const query = [
    `'${driveQueryValue(input.parentId)}' in parents`,
    "mimeType='application/vnd.google-apps.folder'",
    'trashed=false',
    `appProperties has { key='pjjEntityType' and value='${driveQueryValue(input.entityType)}' }`,
    `appProperties has { key='pjjEntityId' and value='${driveQueryValue(input.entityId)}' }`
  ].join(' and ');
  const found = await fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&fields=files(id,name)&pageSize=2`, {
    headers: { authorization: `Bearer ${token}` }
  });
  if (!found.ok) throw new Error(`drive_folder_search_${found.status}`);
  const matches = await found.json<{ files: Array<{ id: string }> }>();
  if (matches.files[0]?.id) return matches.files[0].id;
  const created = await fetch('https://www.googleapis.com/drive/v3/files?fields=id', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json; charset=UTF-8' },
    body: JSON.stringify({
      name: input.name.slice(0, 200),
      mimeType: 'application/vnd.google-apps.folder',
      parents: [input.parentId],
      appProperties: { pjjManaged: 'true', pjjEntityType: input.entityType, pjjEntityId: input.entityId }
    })
  });
  if (!created.ok) throw new Error(`drive_folder_create_${created.status}`);
  return (await created.json<{ id: string }>()).id;
}
