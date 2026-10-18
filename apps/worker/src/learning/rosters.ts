import type { ClassRoster, ClassRosterEntry } from '@interactiq/contracts';
import { AuthError } from '../auth/service';
import type { D1Database } from '../db/types';
import { ResourceRepository, normalizeClassName } from '../resources/repository';

export const identityKey = (value:string) => value.trim().toLocaleLowerCase().replace(/\s+/g,' ');
export function mergeRoster(entries:ClassRosterEntry[], submitted:ClassRosterEntry[], excluded:string[]=[]):ClassRosterEntry[] {
  const result=entries.map(e=>({...e}));
  const unique=new Map(submitted.map(e=>[identityKey(e.email)||e.id,e]));
  const names=new Map<string,number>();
  for(const e of unique.values()) names.set(identityKey(e.name),(names.get(identityKey(e.name))??0)+1);
  for(const entry of unique.values()) {
    if(excluded.includes(identityKey(entry.email)||identityKey(entry.name)))continue;
    if(result.some(e=>e.email && identityKey(e.email)===identityKey(entry.email)))continue;
    const matching=result.filter(e=>!e.email&&identityKey(e.name)===identityKey(entry.name));
    if(matching.length===1&&names.get(identityKey(entry.name))===1) { matching[0]!.email=entry.email; continue; }
    result.push({...entry,isNew:true});
  }
  return result;
}
export class RosterService {
  constructor(private db:D1Database){}
  async classes(tenant:string):Promise<string[]> {
    const rows=await this.db.prepare(`SELECT class_name AS name FROM class_rosters WHERE tenant_id=? AND archived=0 UNION SELECT assigned_class_name AS name FROM learning_resources WHERE tenant_id=? AND assigned_class_name IS NOT NULL UNION SELECT student_class_name AS name FROM attempts WHERE tenant_id=? AND student_class_name IS NOT NULL UNION SELECT class_name AS name FROM resource_classes WHERE tenant_id=?`).bind(tenant,tenant,tenant,tenant).all<{name:string}>();
    const archived=await this.db.prepare('SELECT class_name AS name FROM class_rosters WHERE tenant_id=? AND archived=1').bind(tenant).all<{name:string}>();
    const hidden=new Set(archived.results.map(r=>normalizeClassName(r.name)));
    return [...new Set(rows.results.map(r=>normalizeClassName(r.name)).filter(n=>n&&!hidden.has(n)))].sort();
  }
  async remove(tenant:string,body:unknown):Promise<string[]> {
    const input=body as {className?:string;confirmation?:string};
    if(typeof input?.className!=='string'||input.confirmation!==input.className)throw new AuthError(400,'VALIDATION_ERROR','Type the exact class name to delete it.');
    const name=this.name(input.className);
    await this.db.prepare('INSERT INTO class_rosters(tenant_id,class_name,archived) VALUES(?,?,1) ON CONFLICT(tenant_id,class_name) DO UPDATE SET archived=1,revision=revision+1').bind(tenant,name).run();
    return this.classes(tenant);
  }
  async studentNames(tenant:string,userId:string,attemptId:string,className:string):Promise<string[]> {
    const attempt=await this.db.prepare("SELECT resource_id AS resourceId FROM attempts WHERE id=? AND tenant_id=? AND user_id=? AND status='IN_PROGRESS' AND kicked_at IS NULL").bind(attemptId,tenant,userId).first<{resourceId:string}>();
    if(!attempt)throw new AuthError(404,'VALIDATION_ERROR','Activity not found.');
    const resource=await new ResourceRepository(this.db).findById(tenant,attempt.resourceId);
    if(resource?.status!=='PUBLISHED')throw new AuthError(404,'VALIDATION_ERROR','Activity not available.');
    const name=this.name(className);
    const allowed=resource.assignedClassNames??[];
    // Unassigned public activities accept free text but never reveal the school's full roster.
    if(!allowed.length)return [];
    if(!allowed.includes(name))throw new AuthError(403,'FORBIDDEN','Choose a class assigned by your teacher.');
    const archived=await this.db.prepare('SELECT archived FROM class_rosters WHERE tenant_id=? AND class_name=?').bind(tenant,name).first<{archived:number}>();
    if(archived?.archived)return [];
    return [...new Set((await this.get(tenant,name)).entries.map(e=>e.name))].sort();
  }
  private name(name:string){const normalized=normalizeClassName(name);if(!name.trim()||name.length>80||!normalized)throw new AuthError(400,'VALIDATION_ERROR','Enter a class name (up to 80 characters).');return normalized;}
  async get(tenant:string,className:string):Promise<ClassRoster> {
    className=this.name(className);
    const row=await this.db.prepare('SELECT entries_json, excluded_json, revision FROM class_rosters WHERE tenant_id=? AND class_name=?').bind(tenant,className).first<{entries_json:string;excluded_json:string;revision:number}>();
    const submitted=await this.db.prepare(`SELECT a.user_id AS id,a.student_full_name AS name,u.email FROM attempts a JOIN users u ON u.id=a.user_id WHERE a.tenant_id=? AND UPPER(REPLACE(a.student_class_name,' ',''))=UPPER(REPLACE(?,' ','')) AND a.status='COMPLETED' ORDER BY a.submitted_at`).bind(tenant,className).all<ClassRosterEntry>();
    return {className,entries:mergeRoster(row?JSON.parse(row.entries_json):[],submitted.results,row?JSON.parse(row.excluded_json):[]),revision:row?.revision??0};
  }
  async save(tenant:string,body:unknown):Promise<ClassRoster> {
    const input=body as ClassRoster & {deletedIds?:string[]};
    if(!input||typeof input.className!=='string'||!Array.isArray(input.entries)||input.entries.length>2000||!Number.isInteger(input.revision))throw new AuthError(400,'VALIDATION_ERROR','Invalid student list. Maximum 2000 rows.');
    const className=this.name(input.className);const ids=new Set<string>();const emails=new Set<string>();
    if(input.entries.some(e=>!e||typeof e!=='object'||typeof e.name!=='string'||typeof e.email!=='string')||(input.deletedIds!==undefined&&(!Array.isArray(input.deletedIds)||input.deletedIds.length>2000||input.deletedIds.some(id=>typeof id!=='string'))))throw new AuthError(400,'VALIDATION_ERROR','Invalid student list rows.');
    const entries=input.entries.filter(e=>e.name?.trim()||e.email?.trim()).map(e=>{
      if(typeof e.id!=='string'||!/^[a-zA-Z0-9_-]{1,64}$/.test(e.id)||ids.has(e.id)||typeof e.name!=='string'||!e.name.trim()||e.name.length>120||typeof e.email!=='string'||e.email.length>254||(e.email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e.email.trim())))throw new AuthError(400,'VALIDATION_ERROR','Every student needs a name, unique row ID and a valid email if supplied.');
      ids.add(e.id);const email=identityKey(e.email);if(email&&emails.has(email))throw new AuthError(400,'VALIDATION_ERROR','Each email can appear only once in a class.');if(email)emails.add(email);
      return {id:e.id,name:e.name.trim(),email,isNew:false};
    });
    const current=await this.get(tenant,className);
    if(current.revision!==input.revision)throw new AuthError(409,'VALIDATION_ERROR','This list changed in another tab. Reload before saving.');
    const row=await this.db.prepare('SELECT excluded_json FROM class_rosters WHERE tenant_id=? AND class_name=?').bind(tenant,className).first<{excluded_json:string}>();
    const excluded=new Set<string>(row?JSON.parse(row.excluded_json):[]);
    current.entries.filter(e=>input.deletedIds?.includes(e.id)&&!ids.has(e.id)).forEach(e=>excluded.add(identityKey(e.email)||identityKey(e.name)));
    entries.forEach(e=>excluded.delete(identityKey(e.email)||identityKey(e.name)));
    await this.db.prepare(`INSERT OR IGNORE INTO class_rosters(tenant_id,class_name) VALUES(?,?)`).bind(tenant,className).run();
    const update=await this.db.prepare(`UPDATE class_rosters SET entries_json=?,excluded_json=?,archived=0,revision=revision+1 WHERE tenant_id=? AND class_name=? AND revision=?`).bind(JSON.stringify(entries),JSON.stringify([...excluded]),tenant,className,input.revision).run();
    if(Number(update.meta.changes)!==1)throw new AuthError(409,'VALIDATION_ERROR','This list changed in another tab. Reload before saving.');
    return this.get(tenant,className);
  }
}
