import type { OrganizerFolder, OrganizerSection, PlannerStatus, PlannerTask } from '@interactiq/contracts';
import { AuthError } from '../auth/service';
import type { D1Database } from '../db/types';

const sections:OrganizerSection[]=['STUDENTS','REPORTS'];
const statuses:PlannerStatus[]=['DONE','WORKING','STUCK','NOT_STARTED'];
const uuid=/^[0-9a-f-]{36}$/i;
const datePattern=/^\d{4}-\d{2}-\d{2}$/;
const colorPattern=/^#[0-9a-f]{6}$/i;

export class WorkspaceOrganizerService {
  constructor(private db:D1Database){}
  private section(value:unknown):OrganizerSection { if(typeof value!=='string'||!sections.includes(value as OrganizerSection))throw new AuthError(400,'VALIDATION_ERROR','Choose Students or Marking & reports.');return value as OrganizerSection; }
  private name(value:unknown):string { if(typeof value!=='string'||!value.trim()||value.trim().length>80)throw new AuthError(400,'VALIDATION_ERROR','Enter a folder name up to 80 characters.');return value.trim(); }
  async folders(tenantId:string,sectionValue:unknown):Promise<OrganizerFolder[]> {
    const section=this.section(sectionValue);
    const rows=await this.db.prepare(`SELECT f.id,f.section,f.name,f.created_at AS createdAt,f.updated_at AS updatedAt,
      COALESCE((SELECT json_group_array(resource_id) FROM workspace_folder_items i WHERE i.folder_id=f.id),'[]') AS resourceIdsJson
      FROM workspace_folders f WHERE f.tenant_id=? AND f.section=? ORDER BY f.name COLLATE NOCASE`).bind(tenantId,section).all<Omit<OrganizerFolder,'resourceIds'>&{resourceIdsJson:string}>();
    return rows.results.map(({resourceIdsJson,...row})=>({...row,resourceIds:JSON.parse(resourceIdsJson) as string[]}));
  }
  async createFolder(tenantId:string,userId:string,body:unknown):Promise<OrganizerFolder> {
    const input=body as {section?:unknown;name?:unknown};const section=this.section(input?.section),name=this.name(input?.name);
    const duplicate=await this.db.prepare('SELECT id FROM workspace_folders WHERE tenant_id=? AND section=? AND name=? COLLATE NOCASE').bind(tenantId,section,name).first();
    if(duplicate)throw new AuthError(409,'VALIDATION_ERROR','A folder with this name already exists.');
    const id=crypto.randomUUID();await this.db.prepare('INSERT INTO workspace_folders(id,tenant_id,created_by_user_id,section,name) VALUES(?,?,?,?,?)').bind(id,tenantId,userId,section,name).run();
    return (await this.folders(tenantId,section)).find((folder)=>folder.id===id)!;
  }
  async deleteFolder(tenantId:string,id:string,body:unknown):Promise<void> {
    const input=body as {confirmation?:unknown};const folder=await this.db.prepare('SELECT name FROM workspace_folders WHERE tenant_id=? AND id=?').bind(tenantId,id).first<{name:string}>();
    if(!folder)throw new AuthError(404,'VALIDATION_ERROR','Folder not found.');
    if(input?.confirmation!==folder.name)throw new AuthError(400,'VALIDATION_ERROR','Type the exact folder name to delete it.');
    await this.db.prepare('DELETE FROM workspace_folders WHERE tenant_id=? AND id=?').bind(tenantId,id).run();
  }
  async moveResource(tenantId:string,body:unknown):Promise<void> {
    const input=body as {section?:unknown;resourceId?:unknown;folderId?:unknown};const section=this.section(input?.section);
    if(typeof input?.resourceId!=='string'||!uuid.test(input.resourceId))throw new AuthError(400,'VALIDATION_ERROR','Select a resource.');
    const resource=await this.db.prepare('SELECT id FROM learning_resources WHERE tenant_id=? AND id=?').bind(tenantId,input.resourceId).first();if(!resource)throw new AuthError(404,'VALIDATION_ERROR','Resource not found.');
    let folderId:string|null=null;if(input.folderId!==null&&input.folderId!==undefined&&input.folderId!==''){if(typeof input.folderId!=='string'||!uuid.test(input.folderId))throw new AuthError(400,'VALIDATION_ERROR','Select a folder.');const folder=await this.db.prepare('SELECT id FROM workspace_folders WHERE tenant_id=? AND section=? AND id=?').bind(tenantId,section,input.folderId).first();if(!folder)throw new AuthError(404,'VALIDATION_ERROR','Folder not found.');folderId=input.folderId;}
    await this.db.prepare('DELETE FROM workspace_folder_items WHERE tenant_id=? AND section=? AND resource_id=?').bind(tenantId,section,input.resourceId).run();
    if(folderId)await this.db.prepare('INSERT INTO workspace_folder_items(tenant_id,section,folder_id,resource_id) VALUES(?,?,?,?)').bind(tenantId,section,folderId,input.resourceId).run();
  }
  async tasks(tenantId:string):Promise<PlannerTask[]> { const rows=await this.db.prepare('SELECT id,task,status,label,label_color AS labelColor,due_date AS dueDate,created_at AS createdAt,updated_at AS updatedAt FROM planner_tasks WHERE tenant_id=? ORDER BY due_date,created_at').bind(tenantId).all<PlannerTask>();return rows.results; }
  private taskInput(body:unknown,partial=false){const input=body as Record<string,unknown>;const result:Record<string,unknown>={};if(!partial||input.task!==undefined){if(typeof input.task!=='string'||!input.task.trim()||input.task.trim().length>240)throw new AuthError(400,'VALIDATION_ERROR','Enter a task up to 240 characters.');result.task=input.task.trim();}if(!partial||input.status!==undefined){const status=(input.status??'NOT_STARTED') as PlannerStatus;if(!statuses.includes(status))throw new AuthError(400,'VALIDATION_ERROR','Choose a valid task status.');result.status=status;}if(!partial||input.dueDate!==undefined){if(typeof input.dueDate!=='string'||!datePattern.test(input.dueDate)||Number.isNaN(Date.parse(input.dueDate+'T00:00:00')))throw new AuthError(400,'VALIDATION_ERROR','Choose a valid due date.');result.dueDate=input.dueDate;}if(!partial||input.label!==undefined){if(input.label!==null&&input.label!==undefined&&(typeof input.label!=='string'||input.label.length>40))throw new AuthError(400,'VALIDATION_ERROR','Labels can contain up to 40 characters.');result.label=typeof input.label==='string'&&input.label.trim()?input.label.trim():null;}if(!partial||input.labelColor!==undefined){if(input.labelColor!==null&&input.labelColor!==undefined&&(typeof input.labelColor!=='string'||!colorPattern.test(input.labelColor)))throw new AuthError(400,'VALIDATION_ERROR','Choose a valid label colour.');result.labelColor=typeof input.labelColor==='string'?input.labelColor:null;}return result;}
  async createTask(tenantId:string,userId:string,body:unknown):Promise<PlannerTask> {const input=this.taskInput(body);const id=crypto.randomUUID();await this.db.prepare('INSERT INTO planner_tasks(id,tenant_id,created_by_user_id,task,status,label,label_color,due_date) VALUES(?,?,?,?,?,?,?,?)').bind(id,tenantId,userId,input.task,input.status,input.label,input.labelColor,input.dueDate).run();return (await this.db.prepare('SELECT id,task,status,label,label_color AS labelColor,due_date AS dueDate,created_at AS createdAt,updated_at AS updatedAt FROM planner_tasks WHERE tenant_id=? AND id=?').bind(tenantId,id).first<PlannerTask>())!;}
  async updateTask(tenantId:string,id:string,body:unknown):Promise<PlannerTask> {const input=this.taskInput(body,true);const current=await this.db.prepare('SELECT id,task,status,label,label_color AS labelColor,due_date AS dueDate,created_at AS createdAt,updated_at AS updatedAt FROM planner_tasks WHERE tenant_id=? AND id=?').bind(tenantId,id).first<PlannerTask>();if(!current)throw new AuthError(404,'VALIDATION_ERROR','Task not found.');const next={...current,...input};await this.db.prepare('UPDATE planner_tasks SET task=?,status=?,label=?,label_color=?,due_date=?,updated_at=CURRENT_TIMESTAMP WHERE tenant_id=? AND id=?').bind(next.task,next.status,next.label,next.labelColor,next.dueDate,tenantId,id).run();return (await this.db.prepare('SELECT id,task,status,label,label_color AS labelColor,due_date AS dueDate,created_at AS createdAt,updated_at AS updatedAt FROM planner_tasks WHERE tenant_id=? AND id=?').bind(tenantId,id).first<PlannerTask>())!;}
  async deleteTask(tenantId:string,id:string):Promise<void>{const result=await this.db.prepare('DELETE FROM planner_tasks WHERE tenant_id=? AND id=?').bind(tenantId,id).run();if(Number(result.meta.changes)!==1)throw new AuthError(404,'VALIDATION_ERROR','Task not found.');}
}
