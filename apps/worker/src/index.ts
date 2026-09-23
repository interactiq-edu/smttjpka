import type { ApiErrorCode, ApiResponse, HealthData, LiveParticipant, StorageInventory } from '@interactiq/contracts';
import { AuthError, AuthService, type AuthEnvironment } from './auth/service';
import { PasswordResetService } from './auth/password-reset';
import { requirePermission, toTenantContext } from './auth/authorization';
import type { D1Database } from './db/types';
import { ResourceRepository } from './resources/repository';
import { ResourceService } from './resources/service';
import { QuestionRepository } from './questions/repository';
import { QuestionService } from './questions/service';
import { AttemptService } from './attempts/service';

export interface Env extends AuthEnvironment {
  APP_ENV: 'development' | 'staging' | 'production';
  DB: D1Database;
  ALLOWED_ORIGIN?: string;
  ADMIN_RECOVERY_EMAILS?: string;
  RESEND_API_KEY?: string;
  PASSWORD_RESET_FROM_EMAIL?: string;
  PASSWORD_RESET_APP_URL?: string;
  MEDIA?: R2Bucket;
  AI?: { run(model: string, input: Record<string, unknown>): Promise<unknown> };
}

interface R2ObjectBody {
  body: ReadableStream<Uint8Array>;
  size?: number;
  httpMetadata?: { contentType?: string };
}

interface WorkerExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
}

interface R2Bucket {
  get(key: string): Promise<R2ObjectBody | null>;
  put(key: string, value: ArrayBuffer, options?: { httpMetadata?: { contentType?: string } }): Promise<unknown>;
  delete(keys: string | string[]): Promise<void>;
  list(options?: { prefix?: string; cursor?: string; limit?: number }): Promise<{ objects: Array<{ key: string; size: number; uploaded?: Date }>; truncated: boolean; cursor?: string }>;
}

const mediaObjectKey = (value: string | null | undefined): string | null => {
  if (!value) return null;
  const match = /\/api\/v1\/media\/([^?#]+)/i.exec(value);
  return match?.[1] ? decodeURIComponent(match[1]) : null;
};
const mediaObjectKeysInText = (value: string | null | undefined): string[] => value ? [...value.matchAll(/\/api\/v1\/media\/([^"'?#\\\s]+)/gi)].map((match)=>decodeURIComponent(match[1]!)) : [];
type PublishedJoinContext = Awaited<ReturnType<ResourceRepository['findPublishedContextByShareCode']>>;
const publicJoinCache = new Map<string,{ expires:number; value:Promise<PublishedJoinContext> }>();

const cookieName = (env: Env): string => (env.APP_ENV === 'production' ? '__Host-interactiq_session' : 'interactiq_session');
const parseCookies = (request: Request): Record<string, string> => Object.fromEntries((request.headers.get('cookie') ?? '').split(';').map((value) => value.trim().split(/=(.*)/s, 2)).filter(([key, value]) => Boolean(key && value)));

const corsHeaders = (request: Request, env: Env): Headers => {
  const headers = new Headers();
  headers.set('x-content-type-options', 'nosniff');
  headers.set('referrer-policy', 'no-referrer');
  headers.set('permissions-policy', 'camera=(), microphone=(), geolocation=()');
  const origin = request.headers.get('origin');
  const allowedOrigins = (env.ALLOWED_ORIGIN ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  if (origin && allowedOrigins.includes(origin)) {
    headers.set('access-control-allow-origin', origin);
    headers.set('access-control-allow-credentials', 'true');
    headers.set('access-control-allow-headers', 'authorization, content-type, x-csrf-token');
    headers.set('access-control-allow-methods', 'GET, POST, PATCH, DELETE, OPTIONS');
    headers.set('vary', 'Origin');
  }
  return headers;
};

const requireAllowedBrowserOrigin = (request: Request, env: Env): void => {
  const origin = request.headers.get('origin');
  const allowedOrigins = (env.ALLOWED_ORIGIN ?? '').split(',').map((value) => value.trim()).filter(Boolean);
  if (!origin || !allowedOrigins.includes(origin)) throw new AuthError(403, 'FORBIDDEN', 'Origin is not allowed.');
};

const json = <T>(request: Request, env: Env, data: ApiResponse<T>, init: ResponseInit = {}): Response => {
  const headers = corsHeaders(request, env);
  headers.set('cache-control', 'no-store');
  headers.set('content-type', 'application/json; charset=utf-8');
  headers.set('content-security-policy', "default-src 'none'; frame-ancestors 'none'; base-uri 'none'");
  headers.set('x-frame-options', 'DENY');
  new Headers(init.headers).forEach((value, key) => headers.set(key, value));
  return new Response(JSON.stringify(data), { ...init, headers });
};

const errorResponse = (request: Request, env: Env, status: number, code: ApiErrorCode, message: string): Response => json(
  request,
  env,
  { success: false, error: { code, message } },
  { status, headers: status === 429 ? { 'retry-after': '900' } : undefined },
);
const sessionCookie = (env: Env, token: string, maxAge: number): string => `${cookieName(env)}=${token}; Path=/; HttpOnly; SameSite=${env.APP_ENV === 'production' ? 'None' : 'Lax'}; Max-Age=${maxAge}${env.APP_ENV === 'production' ? '; Secure' : ''}`;
const clearSessionCookie = (env: Env): string => `${cookieName(env)}=; Path=/; HttpOnly; SameSite=${env.APP_ENV === 'production' ? 'None' : 'Lax'}; Max-Age=0${env.APP_ENV === 'production' ? '; Secure' : ''}`;

const parseJson = async (request: Request): Promise<unknown> => {
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) throw new AuthError(415, 'VALIDATION_ERROR', 'Content-Type must be application/json.');
  try { return await request.json(); } catch { throw new AuthError(400, 'VALIDATION_ERROR', 'Request body is not valid JSON.'); }
};

const beginsWith = (bytes: Uint8Array, signature: number[]): boolean => signature.every((value, index) => bytes[index] === value);
const hasTrustedSignature = async (file: File, extension: string): Promise<boolean> => {
  const bytes = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  if (extension === 'png') return beginsWith(bytes, [0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]);
  if (extension === 'jpg' || extension === 'jpeg') return beginsWith(bytes, [0xff,0xd8,0xff]);
  if (extension === 'gif') return new TextDecoder().decode(bytes.slice(0,6)) === 'GIF87a' || new TextDecoder().decode(bytes.slice(0,6)) === 'GIF89a';
  if (extension === 'webp') return new TextDecoder().decode(bytes.slice(0,4)) === 'RIFF' && new TextDecoder().decode(bytes.slice(8,12)) === 'WEBP';
  if (extension === 'pdf') return new TextDecoder().decode(bytes.slice(0,5)) === '%PDF-';
  if (['docx','docm','xlsx','xlsm','pptx','pptm'].includes(extension)) return beginsWith(bytes,[0x50,0x4b,0x03,0x04]) || beginsWith(bytes,[0x50,0x4b,0x05,0x06]);
  if (['doc','xls','ppt','pub','vsd','mdb'].includes(extension)) return beginsWith(bytes,[0xd0,0xcf,0x11,0xe0,0xa1,0xb1,0x1a,0xe1]);
  if (extension === 'rtf') return new TextDecoder().decode(bytes.slice(0,5)) === '{\\rtf';
  if (extension === 'dwg') return /^AC10/.test(new TextDecoder().decode(bytes.slice(0,6)));
  return true;
};

const sessionTtl = (env: Env): number => Number.parseInt(env.SESSION_TTL_SECONDS ?? '28800', 10);
const clientIp = (request: Request): string => request.headers.get('cf-connecting-ip') ?? 'unknown';

const authenticatedSession = async (request: Request, env: Env, auth: AuthService) => {
  const bearerToken = /^Bearer\s+(.+)$/i.exec(request.headers.get('authorization') ?? '')?.[1];
  const token = bearerToken ?? parseCookies(request)[cookieName(env)];
  if (!token) throw new AuthError(401, 'UNAUTHENTICATED', 'Authentication is required.');
  return { token, data: await auth.getSession(token) };
};

export const app = {
  async fetch(request: Request, env: Env, context?: WorkerExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const cors = corsHeaders(request, env);
    if (request.method === 'OPTIONS') {
      if (request.headers.get('origin') && !cors.has('access-control-allow-origin')) return errorResponse(request, env, 403, 'FORBIDDEN', 'Origin is not allowed.');
      return new Response(null, { status: 204, headers: cors });
    }
    if (request.method === 'GET' && url.pathname === '/api/v1/health') {
      const data: HealthData = { service: 'interactiq-api', environment: env.APP_ENV };
      return json(request, env, { success: true, data });
    }
    const mediaRoute = /^\/api\/v1\/media\/([a-z0-9/_-]+\.(?:png|jpg|jpeg|webp|gif|ppt|pptx|pptm|doc|docx|docm|rtf|xls|xlsx|xlsm|csv|pub|vsd|vsdx|mdb|accdb|one|pdf|dwg))$/i.exec(url.pathname);
    if ((request.method === 'GET' || request.method === 'HEAD') && mediaRoute) {
      if (!env.MEDIA) return errorResponse(request, env, 503, 'CONFIGURATION_ERROR', 'Image storage is not configured.');
      const key=mediaRoute[1]!;
      const assignmentKey=/^tenants\/([0-9a-f-]{36})\/assignments\/([0-9a-f-]{36})\//i.exec(key);
      if(assignmentKey){
        try {
          const auth=new AuthService(env);const session=await authenticatedSession(request,env,auth);
          if(session.data.tenant.id!==assignmentKey[1])return errorResponse(request,env,403,'FORBIDDEN','This file belongs to another tenant.');
          const attempt=await env.DB.prepare('SELECT user_id AS userId FROM attempts WHERE id=? AND tenant_id=? LIMIT 1').bind(assignmentKey[2]!,session.data.tenant.id).first<{userId:string}>();
          const canReview=session.data.roles.some((role)=>role==='SUPER_ADMIN'||role==='TENANT_ADMIN'||role==='TEACHER');
          if(!attempt||(attempt.userId!==session.data.user.id&&!canReview))return errorResponse(request,env,403,'FORBIDDEN','You do not have access to this submitted file.');
        } catch(error) {
          if(error instanceof AuthError)return errorResponse(request,env,error.status,error.code,error.message);
          throw error;
        }
      }
      const object = await env.MEDIA.get(key);
      if (!object) return errorResponse(request, env, 404, 'NOT_FOUND', 'The requested image does not exist.');
      const headers = corsHeaders(request, env);
      headers.set('cache-control', assignmentKey ? 'private, no-store' : 'public, max-age=31536000, immutable');
      headers.set('content-type', object.httpMetadata?.contentType ?? 'application/octet-stream');
      if(typeof object.size==='number')headers.set('content-length', String(object.size));
      headers.set('accept-ranges', 'bytes');
      headers.set('content-disposition', 'inline');
      if (url.searchParams.get('download') === '1') {
        const requestedName = (url.searchParams.get('name') ?? key.split('/').pop() ?? 'download').replace(/[\r\n"\\]/g, '_').slice(0, 180);
        headers.set('content-disposition', `attachment; filename="${requestedName}"`);
      }
      return new Response(request.method === 'HEAD' ? null : object.body, { headers });
    }
    const auth = new AuthService(env);
    const resourceRepository = new ResourceRepository(env.DB);
    const questionRepository = new QuestionRepository(env.DB);
    const resources = new ResourceService(resourceRepository, questionRepository);
    const questions = new QuestionService(resourceRepository, questionRepository);
    const attempts = new AttemptService(env.DB, env.AI);
    try {
      if (request.method === 'GET' && url.pathname === '/api/v1/storage/usage') {
        const session = await authenticatedSession(request, env, auth);
        requirePermission(toTenantContext(session.data), 'report.read');
        if (!env.MEDIA) return json(request, env, { success: true, data: { bytes: 0, objects: 0 } });
        let cursor: string | undefined; let bytes = 0; let objects = 0;
        do {
          const page = await env.MEDIA.list({ prefix: `tenants/${session.data.tenant.id}/`, cursor, limit: 1000 });
          for (const object of page.objects) { bytes += object.size; objects += 1; }
          cursor = page.truncated ? page.cursor : undefined;
        } while (cursor);
        return json(request, env, { success: true, data: { bytes, objects } });
      }
      if (request.method === 'GET' && url.pathname === '/api/v1/storage/inventory') {
        const session = await authenticatedSession(request, env, auth); requirePermission(toTenantContext(session.data), 'resource.delete');
        const tenantId=session.data.tenant.id;
        // Memory control deliberately focuses on R2. Query each reference source
        // separately because D1 limits the number of terms in a compound SELECT.
        const referenceGroups=await Promise.all([
          env.DB.prepare('SELECT asset_url AS value FROM learning_resources WHERE tenant_id = ? AND asset_url IS NOT NULL').bind(tenantId).all<{value:string|null}>(),
          env.DB.prepare('SELECT content_json AS value FROM learning_resources WHERE tenant_id = ?').bind(tenantId).all<{value:string|null}>(),
          env.DB.prepare('SELECT prompt_json AS value FROM questions WHERE tenant_id = ?').bind(tenantId).all<{value:string|null}>(),
          env.DB.prepare('SELECT front_json AS value FROM flashcards WHERE tenant_id = ?').bind(tenantId).all<{value:string|null}>(),
          env.DB.prepare('SELECT back_json AS value FROM flashcards WHERE tenant_id = ?').bind(tenantId).all<{value:string|null}>(),
          env.DB.prepare('SELECT submission_file_url AS value FROM attempts WHERE tenant_id = ? AND submission_file_url IS NOT NULL').bind(tenantId).all<{value:string|null}>(),
        ]);
        const referenceCounts=new Map<string,number>();
        for(const group of referenceGroups)for(const row of group.results)for(const key of mediaObjectKeysInText(row.value))referenceCounts.set(key,(referenceCounts.get(key)??0)+1);
        const r2:StorageInventory['r2']=[];
        if(env.MEDIA){let cursor:string|undefined;do{const page=await env.MEDIA.list({prefix:`tenants/${tenantId}/`,cursor,limit:1000});for(const object of page.objects){const uploaded:unknown=object.uploaded;const uploadedAt=uploaded instanceof Date?uploaded.toISOString():typeof uploaded==='string'?new Date(uploaded).toISOString():null;r2.push({key:object.key,size:object.size,uploadedAt,referenceCount:referenceCounts.get(object.key)??0});}cursor=page.truncated?page.cursor:undefined;}while(cursor);}
        return json(request,env,{success:true,data:{d1:[],r2:r2.sort((a,b)=>b.size-a.size),totals:{d1Rows:0,r2Bytes:r2.reduce((sum,item)=>sum+item.size,0),r2Objects:r2.length}} satisfies StorageInventory});
      }
      if (request.method === 'POST' && url.pathname === '/api/v1/storage/cleanup') {
        const session=await authenticatedSession(request,env,auth);requirePermission(toTenantContext(session.data),'resource.delete');const csrfToken=request.headers.get('x-csrf-token');if(!csrfToken)throw new AuthError(403,'FORBIDDEN','CSRF validation failed.');await auth.requireCsrf(session.token,csrfToken);
        const input=await parseJson(request) as {target?:unknown}; const target=String(input?.target??''); const tenantId=session.data.tenant.id;
        const queries:Record<string,string>={EXPIRED_SESSIONS:"DELETE FROM sessions WHERE tenant_id = ? AND (expires_at <= CURRENT_TIMESTAMP OR revoked_at IS NOT NULL)",ABANDONED_ATTEMPTS:"DELETE FROM attempts WHERE tenant_id = ? AND status = 'IN_PROGRESS' AND updated_at < datetime('now', '-1 day')",OLD_AUDIT_LOGS:"DELETE FROM audit_logs WHERE tenant_id = ? AND created_at < datetime('now', '-90 days')"};
        const query=queries[target];if(!query)throw new AuthError(400,'VALIDATION_ERROR','Unknown cleanup target.');const result=await env.DB.prepare(query).bind(tenantId).run();
        return json(request,env,{success:true,data:{deleted:Number((result.meta as {changes?:number}).changes??0)}});
      }
      if (request.method === 'POST' && url.pathname === '/api/v1/storage/objects/delete') {
        if(!env.MEDIA)throw new AuthError(503,'CONFIGURATION_ERROR','File storage is not configured.');const session=await authenticatedSession(request,env,auth);requirePermission(toTenantContext(session.data),'resource.delete');const csrfToken=request.headers.get('x-csrf-token');if(!csrfToken)throw new AuthError(403,'FORBIDDEN','CSRF validation failed.');await auth.requireCsrf(session.token,csrfToken);
        const input=await parseJson(request) as {key?:unknown};const key=String(input?.key??'');const tenantPrefix=`tenants/${session.data.tenant.id}/`;if(!key.startsWith(tenantPrefix)||key.includes('..'))throw new AuthError(400,'VALIDATION_ERROR','Invalid storage object.');
        const tenantId=session.data.tenant.id;
        const mediaUrl=`/api/v1/media/${key}`;
        // Do not use LIKE for storage URLs. D1 limits LIKE pattern complexity and
        // long tenant/object keys can fail before the R2 object is deleted.
        await env.DB.batch([
          env.DB.prepare("UPDATE learning_resources SET asset_url = NULL, updated_at = CURRENT_TIMESTAMP WHERE tenant_id = ? AND (asset_url = ? OR instr(asset_url, ? || '?') = 1)").bind(tenantId,mediaUrl,mediaUrl),
          env.DB.prepare("UPDATE attempts SET submission_file_url = NULL, submission_file_name = NULL, submission_mime_type = NULL, submission_file_size = NULL, updated_at = CURRENT_TIMESTAMP WHERE tenant_id = ? AND (submission_file_url = ? OR instr(submission_file_url, ? || '?') = 1)").bind(tenantId,mediaUrl,mediaUrl),
          env.DB.prepare('UPDATE learning_resources SET content_json = replace(content_json, ?, ?), updated_at = CURRENT_TIMESTAMP WHERE tenant_id = ? AND instr(content_json, ?) > 0').bind(mediaUrl,'',tenantId,mediaUrl),
          env.DB.prepare('UPDATE questions SET prompt_json = replace(prompt_json, ?, ?), updated_at = CURRENT_TIMESTAMP WHERE tenant_id = ? AND instr(prompt_json, ?) > 0').bind(mediaUrl,'',tenantId,mediaUrl),
          env.DB.prepare('UPDATE flashcards SET front_json = replace(front_json, ?, ?), back_json = replace(back_json, ?, ?), updated_at = CURRENT_TIMESTAMP WHERE tenant_id = ? AND (instr(front_json, ?) > 0 OR instr(back_json, ?) > 0)').bind(mediaUrl,'',mediaUrl,'',tenantId,mediaUrl,mediaUrl),
        ]);
        await env.MEDIA.delete(key);
        return json(request,env,{success:true,data:{deleted:true}});
      }
      const publicJoinRoute = /^\/api\/v1\/join\/([A-Z0-9]{8})\/info$/i.exec(url.pathname);
      if (request.method === 'GET' && publicJoinRoute) {
        const code=publicJoinRoute[1]!.toUpperCase(); const now=Date.now(); let cached=publicJoinCache.get(code);
        if(!cached||cached.expires<=now){cached={expires:now+10000,value:resourceRepository.findPublishedContextByShareCode(code)};publicJoinCache.set(code,cached);}
        const resource = await cached.value;
        if (!resource) return errorResponse(request, env, 404, 'NOT_FOUND', 'This activity is unavailable or no longer published.');
        return json(request, env, { success: true, data: { title: resource.title, description: resource.description, themeId: resource.themeId,
          tenantSlug: resource.tenantSlug, tenantName: resource.tenantName, accessStartsAt: resource.accessStartsAt, attemptPolicy: resource.attemptPolicy, resultReleasePolicy: resource.resultReleasePolicy } }, { headers:{'cache-control':'public, max-age=10, s-maxage=10, stale-while-revalidate=60'} });
      }
      if (request.method === 'POST' && url.pathname === '/api/v1/auth/admin/login') {
        const session = await auth.loginAdmin(await parseJson(request), clientIp(request));
        const response = json(request, env, { success: true, data: { ...session.data, csrfToken: session.csrfToken, sessionToken: session.sessionToken } });
        response.headers.append('set-cookie', sessionCookie(env, session.sessionToken, sessionTtl(env)));
        return response;
      }
      if (request.method === 'POST' && url.pathname === '/api/v1/auth/password-reset/request') {
        requireAllowedBrowserOrigin(request, env);
        const result = await new PasswordResetService(env).requestReset(await parseJson(request), clientIp(request));
        if (result.delivery) {
          if (context) context.waitUntil(result.delivery);
          else await result.delivery;
        }
        return json(request, env, { success: true, data: { message: result.message } }, { status: 202 });
      }
      if (request.method === 'POST' && url.pathname === '/api/v1/auth/password-reset/confirm') {
        requireAllowedBrowserOrigin(request, env);
        const result = await new PasswordResetService(env).confirmReset(await parseJson(request), clientIp(request));
        const response = json(request, env, { success: true, data: result });
        response.headers.append('set-cookie', clearSessionCookie(env));
        return response;
      }
      if (request.method === 'POST' && url.pathname === '/api/v1/media/images') {
        if (!env.MEDIA) throw new AuthError(503, 'CONFIGURATION_ERROR', 'Image storage is not configured.');
        const session = await authenticatedSession(request, env, auth);
        requirePermission(toTenantContext(session.data), 'resource.update');
        const csrfToken = request.headers.get('x-csrf-token');
        if (!csrfToken) throw new AuthError(403, 'FORBIDDEN', 'CSRF validation failed.');
        await auth.requireCsrf(session.token, csrfToken);
        if (!request.headers.get('content-type')?.toLowerCase().startsWith('multipart/form-data')) throw new AuthError(415, 'VALIDATION_ERROR', 'Upload a multipart image file.');
        const form = await request.formData();
        const file = form.get('file');
        if (!(file instanceof File) || !['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(file.type) || file.size < 1 || file.size > 5_000_000) {
          throw new AuthError(400, 'VALIDATION_ERROR', 'Use a PNG, JPG, WebP, or GIF image smaller than 5 MB.');
        }
        const extension = file.type === 'image/png' ? 'png' : file.type === 'image/jpeg' ? 'jpg' : file.type === 'image/webp' ? 'webp' : 'gif';
        if (!await hasTrustedSignature(file, extension)) throw new AuthError(400, 'VALIDATION_ERROR', 'The uploaded image content does not match its file type.');
        const key = `tenants/${session.data.tenant.id}/${crypto.randomUUID()}.${extension}`;
        await env.MEDIA.put(key, await file.arrayBuffer(), { httpMetadata: { contentType: file.type } });
        return json(request, env, { success: true, data: { key, url: `/api/v1/media/${key}` } }, { status: 201 });
      }
      if (request.method === 'POST' && url.pathname === '/api/v1/media/files') {
        if (!env.MEDIA) throw new AuthError(503, 'CONFIGURATION_ERROR', 'File storage is not configured.');
        const session = await authenticatedSession(request, env, auth);
        requirePermission(toTenantContext(session.data), 'resource.update');
        const csrfToken = request.headers.get('x-csrf-token');
        if (!csrfToken) throw new AuthError(403, 'FORBIDDEN', 'CSRF validation failed.');
        await auth.requireCsrf(session.token, csrfToken);
        if (!request.headers.get('content-type')?.toLowerCase().startsWith('multipart/form-data')) throw new AuthError(415, 'VALIDATION_ERROR', 'Upload a multipart presentation file.');
        const form = await request.formData(); const file = form.get('file');
        const allowed = new Map([['application/vnd.openxmlformats-officedocument.presentationml.presentation','pptx'],['application/vnd.ms-powerpoint','ppt'],['application/pdf','pdf'],['application/msword','doc'],['application/vnd.openxmlformats-officedocument.wordprocessingml.document','docx'],['application/vnd.ms-excel','xls'],['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','xlsx']]);
        const filenameExtension = file instanceof File ? /\.(pptx?|pdf|docx?|xlsx?)$/i.exec(file.name)?.[1]?.toLowerCase() : undefined;
        const extension = file instanceof File ? allowed.get(file.type) ?? filenameExtension : undefined;
        if (!(file instanceof File) || !extension || file.size < 1 || file.size > 50_000_000) throw new AuthError(400, 'VALIDATION_ERROR', 'Use a PowerPoint, PDF, Word, or Excel file smaller than 50 MB.');
        if (!await hasTrustedSignature(file, extension)) throw new AuthError(400, 'VALIDATION_ERROR', 'The uploaded presentation content does not match its file type.');
        const contentTypes:Record<string,string>={pdf:'application/pdf',ppt:'application/vnd.ms-powerpoint',pptx:'application/vnd.openxmlformats-officedocument.presentationml.presentation',doc:'application/msword',docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',xls:'application/vnd.ms-excel',xlsx:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'};
        const contentType = contentTypes[extension]!;
        const key = `tenants/${session.data.tenant.id}/presentations/${crypto.randomUUID()}.${extension}`;
        await env.MEDIA.put(key, await file.arrayBuffer(), { httpMetadata: { contentType } });
        return json(request, env, { success: true, data: { key, url: `/api/v1/media/${key}?name=${encodeURIComponent(file.name)}`, name: file.name, size: file.size, contentType } }, { status: 201 });
      }
      if (request.method === 'POST' && url.pathname === '/api/v1/auth/google/login') {
        const session = await auth.loginGoogle(await parseJson(request), clientIp(request));
        const response = json(request, env, { success: true, data: { ...session.data, csrfToken: session.csrfToken, sessionToken: session.sessionToken } });
        response.headers.append('set-cookie', sessionCookie(env, session.sessionToken, sessionTtl(env)));
        return response;
      }
      if (request.method === 'POST' && url.pathname === '/api/v1/auth/session/renew') {
        // This is the only state-changing endpoint that intentionally does not
        // require an existing CSRF token: it issues a fresh per-tab session when
        // an HttpOnly login cookie survives but sessionStorage does not. Restrict
        // it to configured first-party browser origins before trusting the cookie.
        requireAllowedBrowserOrigin(request, env);
        const token = parseCookies(request)[cookieName(env)];
        if (!token) throw new AuthError(401, 'UNAUTHENTICATED', 'Authentication is required.');
        const session = await auth.renewSession(token);
        const response = json(request, env, { success: true, data: { ...session.data, csrfToken: session.csrfToken, sessionToken: session.sessionToken } });
        response.headers.append('set-cookie', sessionCookie(env, session.sessionToken, sessionTtl(env)));
        return response;
      }
      if (request.method === 'GET' && url.pathname === '/api/v1/auth/session') {
        const session = await authenticatedSession(request, env, auth);
        return json(request, env, { success: true, data: session.data });
      }
      if (request.method === 'POST' && url.pathname === '/api/v1/auth/logout') {
        const bearerToken = /^Bearer\s+(.+)$/i.exec(request.headers.get('authorization') ?? '')?.[1];
        const token = bearerToken ?? parseCookies(request)[cookieName(env)];
        const csrfToken = request.headers.get('x-csrf-token');
        if (token && csrfToken) {
          try { await auth.logout(token, csrfToken); } catch (caught) { if (!(caught instanceof AuthError)) throw caught; }
        }
        const response = json(request, env, { success: true, data: {} });
        response.headers.append('set-cookie', clearSessionCookie(env));
        return response;
      }
      if (request.method === 'GET' && url.pathname === '/api/v1/dashboard') {
        const session = await authenticatedSession(request, env, auth);
        requirePermission(toTenantContext(session.data), 'resource.read');
        return json(request, env, { success: true, data: await new ResourceRepository(env.DB).dashboard(session.data.tenant.id) });
      }
      if (request.method === 'POST' && url.pathname === '/api/v1/classes/delete') {
        const session=await authenticatedSession(request,env,auth);requirePermission(toTenantContext(session.data),'resource.delete');
        const csrfToken=request.headers.get('x-csrf-token');if(!csrfToken)throw new AuthError(403,'FORBIDDEN','CSRF validation failed.');await auth.requireCsrf(session.token,csrfToken);
        return json(request,env,{success:true,data:await resources.deleteClassData(session.data.tenant.id,await parseJson(request))});
      }
      if (url.pathname === '/api/v1/settings/theme' && (request.method === 'GET' || request.method === 'PATCH')) {
        const session = await authenticatedSession(request, env, auth);
        requirePermission(toTenantContext(session.data), request.method === 'GET' ? 'resource.read' : 'tenant.manage');
        if (request.method === 'GET') return json(request, env, { success: true, data: await resources.getThemeSettings(session.data.tenant.id) });
        const csrfToken = request.headers.get('x-csrf-token');
        if (!csrfToken) throw new AuthError(403, 'FORBIDDEN', 'CSRF validation failed.');
        await auth.requireCsrf(session.token, csrfToken);
        return json(request, env, { success: true, data: await resources.updateThemeSettings(session.data.tenant.id, await parseJson(request)) });
      }
      if (request.method === 'GET' && url.pathname === '/api/v1/reports') {
        const session = await authenticatedSession(request, env, auth);
        requirePermission(toTenantContext(session.data), 'report.read');
        return json(request, env, { success: true, data: await attempts.reports(session.data.tenant.id) });
      }
      const reviewRoute = /^\/api\/v1\/reports\/attempts\/([0-9a-f-]{36})$/i.exec(url.pathname);
      if (request.method === 'GET' && reviewRoute) {
        const session = await authenticatedSession(request, env, auth);
        requirePermission(toTenantContext(session.data), 'report.read');
        return json(request, env, { success: true, data: await attempts.review(session.data.tenant.id, reviewRoute[1]!) });
      }
      const gradeRoute = /^\/api\/v1\/reports\/attempts\/([0-9a-f-]{36})\/answers\/([0-9a-f-]{36})$/i.exec(url.pathname);
      if (request.method === 'PATCH' && gradeRoute) {
        const session = await authenticatedSession(request, env, auth);
        requirePermission(toTenantContext(session.data), 'report.read');
        const csrfToken = request.headers.get('x-csrf-token');
        if (!csrfToken) throw new AuthError(403, 'FORBIDDEN', 'CSRF validation failed.');
        await auth.requireCsrf(session.token, csrfToken);
        return json(request, env, { success: true, data: await attempts.grade(session.data.tenant.id, session.data.user.id, gradeRoute[1]!, gradeRoute[2]!, await parseJson(request)) });
      }
      const finalizeReviewRoute = /^\/api\/v1\/reports\/attempts\/([0-9a-f-]{36})\/finalize$/i.exec(url.pathname);
      if (request.method === 'POST' && finalizeReviewRoute) {
        const session = await authenticatedSession(request, env, auth);
        requirePermission(toTenantContext(session.data), 'report.read');
        const csrfToken = request.headers.get('x-csrf-token');
        if (!csrfToken) throw new AuthError(403, 'FORBIDDEN', 'CSRF validation failed.');
        await auth.requireCsrf(session.token, csrfToken);
        return json(request, env, { success: true, data: await attempts.finalizeReview(session.data.tenant.id, session.data.user.id, finalizeReviewRoute[1]!) });
      }
      const assignmentReviewRoute = /^\/api\/v1\/reports\/attempts\/([0-9a-f-]{36})\/assignment-review$/i.exec(url.pathname);
      if (request.method === 'PATCH' && assignmentReviewRoute) {
        const session = await authenticatedSession(request, env, auth);
        requirePermission(toTenantContext(session.data), 'report.read');
        const csrfToken = request.headers.get('x-csrf-token');
        if (!csrfToken) throw new AuthError(403, 'FORBIDDEN', 'CSRF validation failed.');
        await auth.requireCsrf(session.token, csrfToken);
        return json(request, env, { success: true, data: await attempts.updateAssignmentReview(session.data.tenant.id, session.data.user.id, assignmentReviewRoute[1]!, await parseJson(request)) });
      }
      const joinRoute = /^\/api\/v1\/join\/([A-Z0-9]{8})$/i.exec(url.pathname);
      if (request.method === 'GET' && joinRoute) {
        const session = await authenticatedSession(request, env, auth);
        requirePermission(toTenantContext(session.data), 'resource.read');
        const resource = await resourceRepository.findPublishedByShareCode(session.data.tenant.id, joinRoute[1]!.toUpperCase());
        if (!resource) return errorResponse(request, env, 404, 'NOT_FOUND', 'This join code is invalid or the resource is no longer published.');
        return json(request, env, { success: true, data: resource });
      }
      if (request.method === 'GET' && url.pathname === '/api/v1/resources') {
        const session = await authenticatedSession(request, env, auth);
        requirePermission(toTenantContext(session.data), 'resource.read');
        return json(request, env, { success: true, data: await resources.list(session.data.tenant.id) });
      }
      if (request.method === 'POST' && url.pathname === '/api/v1/resources') {
        const session = await authenticatedSession(request, env, auth);
        requirePermission(toTenantContext(session.data), 'resource.create');
        const csrfToken = request.headers.get('x-csrf-token');
        if (!csrfToken) throw new AuthError(403, 'FORBIDDEN', 'CSRF validation failed.');
        await auth.requireCsrf(session.token, csrfToken);
        return json(request, env, { success: true, data: await resources.create(session.data.tenant.id, session.data.user.id, await parseJson(request)) }, { status: 201 });
      }
      const questionRoute = /^\/api\/v1\/resources\/([0-9a-f-]{36})\/questions$/i.exec(url.pathname);
      if (questionRoute && (request.method === 'GET' || request.method === 'POST')) {
        const resourceId = questionRoute[1]!;
        const session = await authenticatedSession(request, env, auth);
        if (request.method === 'GET') {
          requirePermission(toTenantContext(session.data), 'resource.read');
          const data = await questions.list(session.data.tenant.id, resourceId);
          const canSeeAnswers = session.data.roles.some((role) => ['SUPER_ADMIN', 'TENANT_ADMIN', 'TEACHER', 'EDITOR'].includes(role));
          return json(request, env, { success: true, data: canSeeAnswers ? data : data.map((question) => ({ ...question, options: question.options.map((option) => ({ ...option, isCorrect: false })), acceptedAnswers: [] })) });
        }
        requirePermission(toTenantContext(session.data), 'resource.update');
        const csrfToken = request.headers.get('x-csrf-token');
        if (!csrfToken) throw new AuthError(403, 'FORBIDDEN', 'CSRF validation failed.');
        await auth.requireCsrf(session.token, csrfToken);
        return json(request, env, { success: true, data: await questions.create(session.data.tenant.id, session.data.user.id, resourceId, await parseJson(request)) }, { status: 201 });
      }
      const flashcardRoute = /^\/api\/v1\/resources\/([0-9a-f-]{36})\/flashcards(?:\/([0-9a-f-]{36}))?$/i.exec(url.pathname);
      if (flashcardRoute && ['GET','POST','PATCH','DELETE'].includes(request.method)) {
        const session = await authenticatedSession(request, env, auth); const resourceId = flashcardRoute[1]!; const cardId = flashcardRoute[2] ?? null;
        requirePermission(toTenantContext(session.data), request.method === 'GET' ? 'resource.read' : 'resource.update');
        if (request.method === 'GET') return json(request, env, { success: true, data: await resources.listFlashcards(session.data.tenant.id, resourceId) });
        const csrfToken = request.headers.get('x-csrf-token'); if (!csrfToken) throw new AuthError(403, 'FORBIDDEN', 'CSRF validation failed.'); await auth.requireCsrf(session.token, csrfToken);
        if (request.method === 'DELETE') { if (!cardId) throw new AuthError(400, 'VALIDATION_ERROR', 'Select a flashcard.'); await resources.deleteFlashcard(session.data.tenant.id, resourceId, cardId); return json(request, env, { success: true, data: {} }); }
        return json(request, env, { success: true, data: await resources.saveFlashcard(session.data.tenant.id, resourceId, cardId, await parseJson(request)) }, { status: request.method === 'POST' ? 201 : 200 });
      }
      const deliveryRoute = /^\/api\/v1\/resources\/([0-9a-f-]{36})\/delivery$/i.exec(url.pathname);
      if (request.method === 'PATCH' && deliveryRoute) {
        const session = await authenticatedSession(request, env, auth); requirePermission(toTenantContext(session.data), 'resource.update');
        const csrfToken = request.headers.get('x-csrf-token'); if (!csrfToken) throw new AuthError(403, 'FORBIDDEN', 'CSRF validation failed.'); await auth.requireCsrf(session.token, csrfToken);
        return json(request, env, { success: true, data: await resources.updateDelivery(session.data.tenant.id, deliveryRoute[1]!, await parseJson(request)) });
      }
      const classRoute = /^\/api\/v1\/resources\/([0-9a-f-]{36})\/assigned-class$/i.exec(url.pathname);
      if (request.method === 'PATCH' && classRoute) {
        const session = await authenticatedSession(request, env, auth); requirePermission(toTenantContext(session.data), 'resource.update');
        const csrfToken = request.headers.get('x-csrf-token'); if (!csrfToken) throw new AuthError(403, 'FORBIDDEN', 'CSRF validation failed.'); await auth.requireCsrf(session.token, csrfToken);
        return json(request, env, { success: true, data: await resources.updateAssignedClass(session.data.tenant.id, classRoute[1]!, await parseJson(request)) });
      }
      const assignmentSettingsRoute = /^\/api\/v1\/resources\/([0-9a-f-]{36})\/assignment-settings$/i.exec(url.pathname);
      if (request.method === 'PATCH' && assignmentSettingsRoute) {
        const session = await authenticatedSession(request, env, auth); requirePermission(toTenantContext(session.data), 'resource.update');
        const csrfToken = request.headers.get('x-csrf-token'); if (!csrfToken) throw new AuthError(403, 'FORBIDDEN', 'CSRF validation failed.'); await auth.requireCsrf(session.token, csrfToken);
        return json(request, env, { success: true, data: await resources.updateAssignmentSettings(session.data.tenant.id, assignmentSettingsRoute[1]!, await parseJson(request)) });
      }
      const duplicateRoute = /^\/api\/v1\/resources\/([0-9a-f-]{36})\/duplicate$/i.exec(url.pathname);
      if (request.method === 'POST' && duplicateRoute) {
        const session = await authenticatedSession(request, env, auth); requirePermission(toTenantContext(session.data), 'resource.create');
        const csrfToken = request.headers.get('x-csrf-token'); if (!csrfToken) throw new AuthError(403, 'FORBIDDEN', 'CSRF validation failed.'); await auth.requireCsrf(session.token, csrfToken);
        return json(request, env, { success: true, data: await resources.duplicate(session.data.tenant.id, session.data.user.id, duplicateRoute[1]!) }, { status: 201 });
      }
      const liveRoute = /^\/api\/v1\/resources\/([0-9a-f-]{36})\/live$/i.exec(url.pathname);
      if (liveRoute && (request.method === 'GET' || request.method === 'PATCH')) {
        const session = await authenticatedSession(request, env, auth); requirePermission(toTenantContext(session.data), request.method === 'GET' ? 'resource.read' : 'resource.update');
        if (request.method === 'GET') {
          const state=await resources.getLiveState(session.data.tenant.id, liveRoute[1]!);
          if(session.data.roles.includes('STUDENT')){
            const active=await env.DB.prepare(`SELECT a.id FROM attempts a JOIN learning_resources r ON r.id=a.resource_id AND r.tenant_id=a.tenant_id
              WHERE a.tenant_id=? AND a.resource_id=? AND a.user_id=? AND a.status='IN_PROGRESS' AND a.kicked_at IS NULL AND r.status='PUBLISHED' LIMIT 1`)
              .bind(session.data.tenant.id,liveRoute[1]!,session.data.user.id).first<{id:string}>();
            if(!active)throw new AuthError(403,'FORBIDDEN','This live session has ended. Re-enter the shared link when your teacher publishes again.');
            await env.DB.prepare("UPDATE attempts SET updated_at = CURRENT_TIMESTAMP WHERE id = ? AND updated_at < datetime('now', '-15 seconds')").bind(active.id).run();
            const permission=await env.DB.prepare(`SELECT p.attempt_id AS attemptId FROM live_drawing_permissions p JOIN attempts a ON a.id=p.attempt_id
              WHERE p.tenant_id=? AND p.resource_id=? AND p.attempt_id=? AND a.kicked_at IS NULL LIMIT 1`).bind(session.data.tenant.id,liveRoute[1]!,active.id).first<{attemptId:string}>();
            return json(request,env,{success:true,data:{...state,allowStudentDraw:Boolean(permission)}});
          }
          return json(request, env, { success: true, data: state });
        }
        const csrfToken = request.headers.get('x-csrf-token'); if (!csrfToken) throw new AuthError(403, 'FORBIDDEN', 'CSRF validation failed.'); await auth.requireCsrf(session.token, csrfToken);
        return json(request, env, { success: true, data: await resources.updateLiveState(session.data.tenant.id, liveRoute[1]!, await parseJson(request)) });
      }
      const participantsRoute=/^\/api\/v1\/resources\/([0-9a-f-]{36})\/live\/participants$/i.exec(url.pathname);
      if(request.method==='GET'&&participantsRoute){const session=await authenticatedSession(request,env,auth);requirePermission(toTenantContext(session.data),'live.manage');const result=await env.DB.prepare(`SELECT a.id AS attemptId, COALESCE(a.student_full_name,u.display_name,u.email,'Student') AS displayName,
        u.email, a.student_class_name AS className, a.status, a.updated_at AS lastSeenAt, CASE WHEN a.updated_at >= datetime('now','-20 seconds') THEN 1 ELSE 0 END AS isOnline, CASE WHEN p.attempt_id IS NULL THEN 0 ELSE 1 END AS canDraw
        FROM attempts a JOIN users u ON u.id=a.user_id LEFT JOIN live_drawing_permissions p ON p.attempt_id=a.id AND p.resource_id=a.resource_id
        WHERE a.tenant_id=? AND a.resource_id=? AND a.status='IN_PROGRESS' AND a.kicked_at IS NULL ORDER BY a.updated_at DESC LIMIT 300`).bind(session.data.tenant.id,participantsRoute[1]!).all<Omit<LiveParticipant,'canDraw'|'isOnline'> & {canDraw:number;isOnline:number}>();return json(request,env,{success:true,data:result.results.map((participant)=>({...participant,canDraw:Boolean(participant.canDraw),isOnline:Boolean(participant.isOnline)}))});}
      const participantDrawingRoute=/^\/api\/v1\/resources\/([0-9a-f-]{36})\/live\/participants\/([0-9a-f-]{36})\/drawing$/i.exec(url.pathname);
      if(request.method==='PATCH'&&participantDrawingRoute){
        const session=await authenticatedSession(request,env,auth);requirePermission(toTenantContext(session.data),'live.manage');const csrfToken=request.headers.get('x-csrf-token');if(!csrfToken)throw new AuthError(403,'FORBIDDEN','CSRF validation failed.');await auth.requireCsrf(session.token,csrfToken);
        const input=await parseJson(request) as {enabled?:unknown};const enabled=input.enabled===true;const resourceId=participantDrawingRoute[1]!,attemptId=participantDrawingRoute[2]!;
        const participant=await env.DB.prepare("SELECT id FROM attempts WHERE id=? AND resource_id=? AND tenant_id=? AND status='IN_PROGRESS' AND kicked_at IS NULL LIMIT 1").bind(attemptId,resourceId,session.data.tenant.id).first<{id:string}>();
        if(!participant)throw new AuthError(404,'VALIDATION_ERROR','This live participant is no longer active.');
        if(enabled)await env.DB.prepare('INSERT INTO live_drawing_permissions (resource_id,attempt_id,tenant_id) VALUES (?,?,?) ON CONFLICT(resource_id,attempt_id) DO UPDATE SET granted_at=CURRENT_TIMESTAMP').bind(resourceId,attemptId,session.data.tenant.id).run();
        else await env.DB.prepare('DELETE FROM live_drawing_permissions WHERE resource_id=? AND attempt_id=? AND tenant_id=?').bind(resourceId,attemptId,session.data.tenant.id).run();
        return json(request,env,{success:true,data:{attemptId,canDraw:enabled}});
      }
      const participantKickRoute=/^\/api\/v1\/resources\/([0-9a-f-]{36})\/live\/participants\/([0-9a-f-]{36})$/i.exec(url.pathname);
      if(request.method==='DELETE'&&participantKickRoute){
        const session=await authenticatedSession(request,env,auth);requirePermission(toTenantContext(session.data),'live.manage');const csrfToken=request.headers.get('x-csrf-token');if(!csrfToken)throw new AuthError(403,'FORBIDDEN','CSRF validation failed.');await auth.requireCsrf(session.token,csrfToken);
        await resources.kickParticipant(session.data.tenant.id,participantKickRoute[1]!,participantKickRoute[2]!);return json(request,env,{success:true,data:{}});
      }
      const questionItemRoute = /^\/api\/v1\/resources\/([0-9a-f-]{36})\/questions\/([0-9a-f-]{36})$/i.exec(url.pathname);
      if (questionItemRoute && (request.method === 'PATCH' || request.method === 'DELETE')) {
        const session = await authenticatedSession(request, env, auth);
        requirePermission(toTenantContext(session.data), 'resource.update');
        const csrfToken = request.headers.get('x-csrf-token');
        if (!csrfToken) throw new AuthError(403, 'FORBIDDEN', 'CSRF validation failed.');
        await auth.requireCsrf(session.token, csrfToken);
        if (request.method === 'DELETE') {
          await questions.delete(session.data.tenant.id, questionItemRoute[1]!, questionItemRoute[2]!);
          return json(request, env, { success: true, data: {} });
        }
        return json(request, env, { success: true, data: await questions.update(session.data.tenant.id, questionItemRoute[1]!, questionItemRoute[2]!, await parseJson(request)) });
      }
      const startAttemptRoute = /^\/api\/v1\/resources\/([0-9a-f-]{36})\/attempts$/i.exec(url.pathname);
      if (request.method === 'POST' && startAttemptRoute) {
        const session = await authenticatedSession(request, env, auth);
        requirePermission(toTenantContext(session.data), 'resource.read');
        const csrfToken = request.headers.get('x-csrf-token');
        if (!csrfToken) throw new AuthError(403, 'FORBIDDEN', 'CSRF validation failed.');
        await auth.requireCsrf(session.token, csrfToken);
        return json(request, env, { success: true, data: await attempts.start(session.data.tenant.id, session.data.user.id, startAttemptRoute[1]!) }, { status: 201 });
      }
      const submitAttemptRoute = /^\/api\/v1\/attempts\/([0-9a-f-]{36})\/submit$/i.exec(url.pathname);
      if (request.method === 'POST' && submitAttemptRoute) {
        const session = await authenticatedSession(request, env, auth);
        const csrfToken = request.headers.get('x-csrf-token');
        if (!csrfToken) throw new AuthError(403, 'FORBIDDEN', 'CSRF validation failed.');
        await auth.requireCsrf(session.token, csrfToken);
        return json(request, env, { success: true, data: await attempts.submit(session.data.tenant.id, session.data.user.id, submitAttemptRoute[1]!, await parseJson(request)) });
      }
      const assignmentSubmitRoute = /^\/api\/v1\/attempts\/([0-9a-f-]{36})\/assignment$/i.exec(url.pathname);
      if (request.method === 'POST' && assignmentSubmitRoute) {
        if (!env.MEDIA) throw new AuthError(503, 'CONFIGURATION_ERROR', 'File storage is not configured.');
        const session = await authenticatedSession(request, env, auth); const csrfToken = request.headers.get('x-csrf-token');
        if (!csrfToken) throw new AuthError(403, 'FORBIDDEN', 'CSRF validation failed.'); await auth.requireCsrf(session.token, csrfToken);
        if (!request.headers.get('content-type')?.toLowerCase().startsWith('multipart/form-data')) throw new AuthError(415, 'VALIDATION_ERROR', 'Upload a multipart assignment file.');
        const attempt = await env.DB.prepare(`SELECT a.id, a.resource_id AS resourceId, a.status, a.student_full_name AS studentFullName,
          a.student_class_name AS studentClassName, r.submission_due_at AS submissionDueAt, r.assignment_max_score AS assignmentMaxScore
          FROM attempts a JOIN learning_resources r ON r.id = a.resource_id
          WHERE a.id = ? AND a.tenant_id = ? AND a.user_id = ? AND r.resource_type = 'ASSESSMENT' LIMIT 1`)
          .bind(assignmentSubmitRoute[1]!, session.data.tenant.id, session.data.user.id).first<{ id:string; resourceId:string; status:string; studentFullName:string|null; studentClassName:string|null; submissionDueAt:string|null; assignmentMaxScore:number }>();
        if (!attempt || attempt.status !== 'IN_PROGRESS') throw new AuthError(404, 'VALIDATION_ERROR', 'The active assignment does not exist.');
        if (!attempt.studentFullName || !attempt.studentClassName) throw new AuthError(400, 'VALIDATION_ERROR', 'Enter your student details before submitting.');
        if (attempt.submissionDueAt && Date.now() > Date.parse(attempt.submissionDueAt)) throw new AuthError(409, 'VALIDATION_ERROR', 'The assignment due date has passed.');
        const form = await request.formData(); const file = form.get('file'); const notes = String(form.get('notes') ?? '').trim().slice(0, 2000);
        const extension = file instanceof File ? /\.(docx?|docm|rtf|xlsx?|xlsm|csv|pptx?|pptm|pub|vsdx?|mdb|accdb|one|pdf|dwg|png|jpe?g)$/i.exec(file.name)?.[1]?.toLowerCase() : undefined;
        if (!(file instanceof File) || !extension || file.size < 1 || file.size > 50_000_000) throw new AuthError(400, 'VALIDATION_ERROR', 'Use a Microsoft Office, PDF, DWG, PNG, or JPEG file smaller than 50 MB.');
        if (!await hasTrustedSignature(file, extension)) throw new AuthError(400, 'VALIDATION_ERROR', 'The uploaded assignment content does not match its file type.');
        const contentTypes: Record<string,string> = { doc:'application/msword',docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',xls:'application/vnd.ms-excel',xlsx:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',ppt:'application/vnd.ms-powerpoint',pptx:'application/vnd.openxmlformats-officedocument.presentationml.presentation',pdf:'application/pdf',dwg:'image/vnd.dwg',png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg' };
        const key = `tenants/${session.data.tenant.id}/assignments/${attempt.id}/${crypto.randomUUID()}.${extension}`; const contentType = contentTypes[extension] ?? 'application/octet-stream';
        await env.MEDIA.put(key, await file.arrayBuffer(), { httpMetadata: { contentType } }); const fileUrl = `/api/v1/media/${key}`;
        await env.DB.prepare(`UPDATE attempts SET status = 'COMPLETED', score = NULL, max_score = ?, assignment_review_status = 'PENDING', submitted_at = CURRENT_TIMESTAMP,
          submission_file_url = ?, submission_file_name = ?, submission_mime_type = ?, submission_file_size = ?, submission_notes = ?, updated_at = CURRENT_TIMESTAMP
          WHERE id = ? AND tenant_id = ? AND user_id = ?`).bind(attempt.assignmentMaxScore, fileUrl, file.name.slice(0,255), contentType, file.size, notes || null, attempt.id, session.data.tenant.id, session.data.user.id).run();
        return json(request, env, { success: true, data: { id: attempt.id, resourceId: attempt.resourceId, status: 'COMPLETED', score: null, maxScore: attempt.assignmentMaxScore,
          submittedAt: new Date().toISOString(), studentFullName: attempt.studentFullName, studentClassName: attempt.studentClassName,
          submissionFileUrl: fileUrl, submissionFileName: file.name, submissionMimeType: contentType, submissionFileSize: file.size, submissionNotes: notes || null,
          assignmentReviewStatus: 'PENDING', assignmentMark: null, assignmentFeedback: null } });
      }
      const checkAttemptRoute = /^\/api\/v1\/attempts\/([0-9a-f-]{36})\/check$/i.exec(url.pathname);
      if (request.method === 'POST' && checkAttemptRoute) {
        const session = await authenticatedSession(request, env, auth); const csrfToken=request.headers.get('x-csrf-token');
        if(!csrfToken)throw new AuthError(403,'FORBIDDEN','CSRF validation failed.'); await auth.requireCsrf(session.token,csrfToken);
        return json(request,env,{success:true,data:await attempts.checkAnswer(session.data.tenant.id,session.data.user.id,checkAttemptRoute[1]!,await parseJson(request))});
      }
      const identityAttemptRoute = /^\/api\/v1\/attempts\/([0-9a-f-]{36})\/identity$/i.exec(url.pathname);
      if (request.method === 'PATCH' && identityAttemptRoute) {
        const session = await authenticatedSession(request, env, auth); const csrfToken = request.headers.get('x-csrf-token');
        if (!csrfToken) throw new AuthError(403, 'FORBIDDEN', 'CSRF validation failed.'); await auth.requireCsrf(session.token, csrfToken);
        return json(request, env, { success: true, data: await attempts.setIdentity(session.data.tenant.id, session.data.user.id, identityAttemptRoute[1]!, await parseJson(request)) });
      }
      const liveDrawRoute = /^\/api\/v1\/attempts\/([0-9a-f-]{36})\/live-draw$/i.exec(url.pathname);
      if (request.method === 'PATCH' && liveDrawRoute) {
        const session = await authenticatedSession(request, env, auth); const csrfToken = request.headers.get('x-csrf-token');
        if (!csrfToken) throw new AuthError(403, 'FORBIDDEN', 'CSRF validation failed.'); await auth.requireCsrf(session.token, csrfToken);
        return json(request, env, { success: true, data: await attempts.updateLiveDrawing(session.data.tenant.id, session.data.user.id, liveDrawRoute[1]!, await parseJson(request)) });
      }
      const resourceActionRoute = /^\/api\/v1\/resources\/([0-9a-f-]{36})\/(publish|unpublish|theme)$/i.exec(url.pathname);
      if ((request.method === 'POST' || request.method === 'PATCH') && resourceActionRoute) {
        const session = await authenticatedSession(request, env, auth);
        requirePermission(toTenantContext(session.data), 'resource.update');
        const csrfToken = request.headers.get('x-csrf-token');
        if (!csrfToken) throw new AuthError(403, 'FORBIDDEN', 'CSRF validation failed.');
        await auth.requireCsrf(session.token, csrfToken);
        if (resourceActionRoute[2] === 'unpublish') { const data=await resources.unpublish(session.data.tenant.id, resourceActionRoute[1]!);publicJoinCache.clear();return json(request, env, { success: true, data }); }
        if (resourceActionRoute[2] === 'theme') return json(request, env, { success: true, data: await resources.updateTheme(session.data.tenant.id, resourceActionRoute[1]!, await parseJson(request)) });
        const publishSettings = request.headers.get('content-type')?.includes('application/json') ? await parseJson(request) : {};
        const data=await resources.publish(session.data.tenant.id, resourceActionRoute[1]!, publishSettings);publicJoinCache.clear();return json(request, env, { success: true, data });
      }
      if ((request.method === 'GET' || request.method === 'PATCH' || request.method === 'DELETE') && url.pathname.startsWith('/api/v1/resources/')) {
        const resourceId = url.pathname.slice('/api/v1/resources/'.length);
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(resourceId)) {
          return errorResponse(request, env, 404, 'NOT_FOUND', 'The requested resource does not exist.');
        }
        const session = await authenticatedSession(request, env, auth);
        if (request.method === 'DELETE') {
          requirePermission(toTenantContext(session.data), 'resource.delete');
          const csrfToken = request.headers.get('x-csrf-token');
          if (!csrfToken) throw new AuthError(403, 'FORBIDDEN', 'CSRF validation failed.');
          await auth.requireCsrf(session.token, csrfToken);
          if (env.MEDIA) {
            const [resourceFiles, assignmentFiles, questionFiles, flashcardFiles] = await Promise.all([
              env.DB.prepare('SELECT asset_url AS url, content_json AS json FROM learning_resources WHERE tenant_id = ? AND id = ?').bind(session.data.tenant.id, resourceId).all<{ url: string | null; json:string|null }>(),
              env.DB.prepare('SELECT submission_file_url AS url FROM attempts WHERE tenant_id = ? AND resource_id = ? AND submission_file_url IS NOT NULL').bind(session.data.tenant.id, resourceId).all<{ url: string | null }>(),
              env.DB.prepare(`SELECT q.prompt_json AS promptJson, q.configuration_json AS configurationJson FROM questions q JOIN quiz_questions qq ON qq.question_id=q.id WHERE qq.resource_id=? AND q.tenant_id=?`).bind(resourceId,session.data.tenant.id).all<{promptJson:string|null;configurationJson:string|null}>(),
              env.DB.prepare('SELECT front_json AS frontJson, back_json AS backJson FROM flashcards WHERE resource_id=? AND tenant_id=?').bind(resourceId,session.data.tenant.id).all<{frontJson:string|null;backJson:string|null}>(),
            ]);
            const keys = [...resourceFiles.results.map((row)=>mediaObjectKey(row.url)),...assignmentFiles.results.map((row)=>mediaObjectKey(row.url)),...resourceFiles.results.flatMap((row)=>mediaObjectKeysInText(row.json)),...questionFiles.results.flatMap((row)=>[...mediaObjectKeysInText(row.promptJson),...mediaObjectKeysInText(row.configurationJson)]),...flashcardFiles.results.flatMap((row)=>[...mediaObjectKeysInText(row.frontJson),...mediaObjectKeysInText(row.backJson)])].filter((key): key is string => Boolean(key));
            if (keys.length) await env.MEDIA.delete([...new Set(keys)]);
          }
          await resources.delete(session.data.tenant.id, resourceId);
          return json(request, env, { success: true, data: {} });
        }
        if (request.method === 'PATCH') {
          requirePermission(toTenantContext(session.data), 'resource.update');
          const csrfToken = request.headers.get('x-csrf-token');
          if (!csrfToken) throw new AuthError(403, 'FORBIDDEN', 'CSRF validation failed.');
          await auth.requireCsrf(session.token, csrfToken);
          return json(request, env, { success: true, data: await resources.updateContent(session.data.tenant.id, resourceId, await parseJson(request)) });
        }
        requirePermission(toTenantContext(session.data), 'resource.read');
        const resource = await new ResourceRepository(env.DB).findDetailById(session.data.tenant.id, resourceId);
        if (!resource) return errorResponse(request, env, 404, 'NOT_FOUND', 'The requested resource does not exist.');
        return json(request, env, { success: true, data: resource });
      }
    } catch (error) {
      if (error instanceof AuthError) return errorResponse(request, env, error.status, error.code, error.message);
      // Keep the client response generic, but preserve a redacted diagnostic for
      // Cloudflare's Worker log. Never include request headers or body here: the
      // login body contains a password.
      console.error('Unhandled API error', {
        method: request.method,
        path: url.pathname,
        name: error instanceof Error ? error.name : 'UnknownError',
        message: error instanceof Error ? error.message : String(error),
      });
      return errorResponse(request, env, 500, 'INTERNAL_ERROR', 'An unexpected error occurred.');
    }
    return errorResponse(request, env, 404, 'NOT_FOUND', 'The requested endpoint does not exist.');
  },
};

export default app;
