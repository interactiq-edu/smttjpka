import type { LibraryEntry } from '@interactiq/contracts';
import { AuthError } from '../auth/service';
import type { D1Database } from '../db/types';

const columns = 'id, section, parent_id AS parentId, kind, title, description, tips, url, cover, published, share_code AS shareCode, position';
const hosts = ['youtube.com','youtu.be','canva.com','docs.google.com','drive.google.com','sheets.google.com','slides.google.com','forms.gle','onedrive.live.com','1drv.ms','sharepoint.com','microsoft.com','wikipedia.org','khanacademy.org','geogebra.org','desmos.com'];
export const covers = ['books','science','globe','maths','art','graduation','pencil','computer','ideas','trophy'];
export function safeLibraryUrl(value:string,tenant:string,cover=false):boolean {
  if (!value) return !cover;
  if(value.startsWith('/api/v1/media/tenants/'+tenant+'/') && !value.includes('..') && !value.includes('\\') && !/%2e|%2f|%5c/i.test(value))
    return cover ? /\.(png|jpg|jpeg|webp|gif)(?:\?|$)/i.test(value) : /\.(pdf|pptx?|xlsx?|docx?|png|jpe?g|webp|gif)(?:\?|$)/i.test(value);
  if(cover) return covers.includes(value);
  try {const url=new URL(value);return url.protocol==='https:'&&!url.username&&!url.password&&!url.port&&hosts.some(host=>url.hostname===host||url.hostname.endsWith('.'+host));}catch{return false;}
}
export class StudyLibraryService {
  constructor(private db:D1Database){}
  async list(tenant:string):Promise<LibraryEntry[]> {
    const rows=await this.db.prepare('SELECT '+columns+' FROM study_library WHERE tenant_id=? ORDER BY position,title').bind(tenant).all<LibraryEntry>();
    return rows.results.map(e=>({...e,published:Boolean(e.published)}));
  }
  async publicTree(code:string):Promise<{root:LibraryEntry;entries:LibraryEntry[]}> {
    const row=await this.db.prepare('SELECT tenant_id AS tenantId,id FROM study_library WHERE share_code=? AND published=1').bind(code).first<{tenantId:string;id:string}>();
    if(!row)throw new AuthError(404,'VALIDATION_ERROR','This library is not published or no longer available.');
    const all=await this.list(row.tenantId);const root=all.find(e=>e.id===row.id)!;
    const ids=new Set([root.id]);let changed=true;
    while(changed){changed=false;for(const entry of all)if(entry.published&&entry.parentId&&ids.has(entry.parentId)&&!ids.has(entry.id)){ids.add(entry.id);changed=true;}}
    return {root,entries:all.filter(e=>ids.has(e.id)&&e.published)};
  }
  async save(tenant:string,input:unknown):Promise<LibraryEntry[]> {
    const body=input as Partial<LibraryEntry>;
    if(!body||!['notes','tips'].includes(body.section??'')||!['folder','file'].includes(body.kind??'')||typeof body.title!=='string'||!body.title.trim()||body.title.length>160)
      throw new AuthError(400,'VALIDATION_ERROR','Choose a library, item type and title (up to 160 characters).');
    const all=await this.list(tenant);const existing=body.id?all.find(e=>e.id===body.id):undefined;
    if(body.id&&!existing)throw new AuthError(404,'VALIDATION_ERROR','Library item not found.');
    if(existing&&(existing.kind!==body.kind||existing.section!==body.section))throw new AuthError(400,'VALIDATION_ERROR','An existing item cannot change its library or type.');
    for(const field of ['description','tips','url','cover'] as const)if(body[field]!==undefined&&(typeof body[field]!=='string'||body[field]!.length>(field==='tips'?20000:field==='description'?4000:2048)))throw new AuthError(400,'VALIDATION_ERROR','Invalid library text or URL.');
    const parent=body.parentId?all.find(e=>e.id===body.parentId):null;
    if(body.parentId&&(!parent||parent.kind!=='folder'||parent.section!==body.section))throw new AuthError(400,'VALIDATION_ERROR','Choose a folder in the same library.');
    let ancestor=parent;let depth=0;
    while(ancestor){if(ancestor.id===body.id||++depth>12)throw new AuthError(400,'VALIDATION_ERROR','Folders cannot contain themselves; maximum depth is 12.');ancestor=all.find(e=>e.id===ancestor!.parentId)??null;}
    const url=body.url?.trim()??'';const cover=body.cover??'books';
    if(!safeLibraryUrl(url,tenant)||!safeLibraryUrl(cover,tenant,true)||(body.kind==='file'&&!url))throw new AuthError(400,'VALIDATION_ERROR','Upload a supported file or use an HTTPS link from YouTube, Canva, Google Drive, Microsoft, Wikipedia, Khan Academy, GeoGebra or Desmos.');
    const id=existing?.id??crypto.randomUUID();
    await this.db.prepare(`INSERT INTO study_library(id,tenant_id,section,parent_id,kind,title,description,tips,url,cover,share_code,position) VALUES(?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET parent_id=excluded.parent_id,title=excluded.title,description=excluded.description,tips=excluded.tips,url=excluded.url,cover=excluded.cover,updated_at=CURRENT_TIMESTAMP WHERE study_library.tenant_id=excluded.tenant_id`)
      .bind(id,tenant,body.section,body.parentId??null,body.kind,body.title.trim(),body.description??'',body.tips??'',body.kind==='folder'?'':url,cover,existing?.shareCode??crypto.randomUUID().replaceAll('-',''),existing?.position??all.length).run();
    return this.list(tenant);
  }
  async publish(tenant:string,id:string,published:boolean):Promise<LibraryEntry[]> {
    const all=await this.list(tenant);if(!all.some(e=>e.id===id))throw new AuthError(404,'VALIDATION_ERROR','Library item not found.');
    const ids=new Set([id]);let changed=true;while(changed){changed=false;for(const e of all)if(e.parentId&&ids.has(e.parentId)&&!ids.has(e.id)){ids.add(e.id);changed=true;}}
    // A single recursive statement keeps an entire folder publication atomic.
    await this.db.prepare(`WITH RECURSIVE subtree(id) AS (SELECT id FROM study_library WHERE tenant_id=? AND id=? UNION ALL SELECT s.id FROM study_library s JOIN subtree p ON s.parent_id=p.id WHERE s.tenant_id=?) UPDATE study_library SET published=?,updated_at=CURRENT_TIMESTAMP WHERE tenant_id=? AND id IN (SELECT id FROM subtree)`).bind(tenant,id,tenant,published?1:0,tenant).run();
    return this.list(tenant);
  }
  async remove(tenant:string,id:string):Promise<LibraryEntry[]> {
    await this.db.prepare('DELETE FROM study_library WHERE tenant_id=? AND id=?').bind(tenant,id).run();
    return this.list(tenant);
  }
}
