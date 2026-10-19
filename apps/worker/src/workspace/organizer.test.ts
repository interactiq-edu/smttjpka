import { describe,expect,it } from 'vitest';
import { database } from '../../test/upgrade-fixture';
import { WorkspaceOrganizerService } from './organizer';

describe('workspace organizer',()=>{
  it('moves resources atomically and copies organizer-only shortcuts',async()=>{
    const {db,sqlite}=database();
    const resourceId='11111111-1111-4111-8111-111111111111';
    sqlite.prepare("INSERT INTO learning_resources(id,tenant_id,created_by_user_id,title,resource_type) VALUES(?,'tenant','teacher','Organizer Test','QUIZ')").run(resourceId);
    const service=new WorkspaceOrganizerService(db);
    const first=await service.createFolder('tenant','teacher',{section:'REPORTS',name:'Review now'});
    const second=await service.createFolder('tenant','teacher',{section:'REPORTS',name:'Archive'});

    let folders=await service.moveResource('tenant',{section:'REPORTS',resourceId,folderId:first.id});
    expect(folders.find((item)=>item.id===first.id)?.resourceIds).toEqual([resourceId]);

    folders=await service.moveResource('tenant',{section:'REPORTS',resourceId,folderId:second.id,mode:'COPY'});
    expect(folders.find((item)=>item.id===first.id)?.resourceIds).toEqual([resourceId]);
    expect(folders.find((item)=>item.id===second.id)?.resourceIds).toEqual([resourceId]);

    folders=await service.moveResource('tenant',{section:'REPORTS',resourceId,folderId:null});
    expect(folders.every((item)=>!item.resourceIds.includes(resourceId))).toBe(true);
    sqlite.close();
  });
});
