import { describe,it,expect } from 'vitest';
import { database } from '../../test/upgrade-fixture';
import { ResourceRepository } from '../resources/repository';
import { ResourceService } from '../resources/service';
import { RosterService } from './rosters';
import { AttemptService, resolveStudentClass } from '../attempts/service';
import { safeLibraryUrl } from './library';

describe('class lists and assigned classes',()=>{
  it('normalizes all typed variants and rejects non-assigned classes',()=>{
    for(const name of ['5PKA1','5 PKA 1','5 pka1','5pka 1'])expect(resolveStudentClass([],name)).toBe('5 PKA 1');
    expect(resolveStudentClass(['5 PKA 1'],'anything')).toBe('5 PKA 1');
    expect(resolveStudentClass(['5 PKA 1','5 PKA 2'],'5pka2')).toBe('5 PKA 2');
    expect(()=>resolveStudentClass(['5 PKA 1','5 PKA 2'],'5PKA3')).toThrow('assigned class');
  });
  it('persists multiple classes and removes legacy single-class restrictions when cleared',async()=>{
    const {db,sqlite}=database();const repo=new ResourceRepository(db);const service=new ResourceService(repo);
    const result=await service.updateAssignedClass('tenant','resource',{assignedClassNames:['5PKA1','5 PKA 1','5pka2']});
    expect(result.assignedClassNames).toEqual(['5 PKA 1','5 PKA 2']);expect(result.assignedClassName).toBeNull();
    expect(await new RosterService(db).classes('tenant')).toEqual(['5 PKA 1','5 PKA 2']);
    await service.updateAssignedClass('tenant','resource',{assignedClassNames:[]});
    expect((await repo.findById('tenant','resource'))?.assignedClassNames).toEqual([]);
    await expect(service.updateAssignedClass('other','resource',{assignedClassNames:['Other']})).rejects.toThrow('does not exist');sqlite.close();
  });
  it('requires exact delete confirmation and preserves attempts, marks and recoverable roster',async()=>{
    const {db,sqlite}=database();const roster=new RosterService(db),current=await roster.get('tenant','5PKA1');
    await roster.save('tenant',current);
    await expect(roster.remove('tenant',{className:'5 PKA 1',confirmation:'wrong'})).rejects.toThrow('exact');
    expect(await roster.remove('tenant',{className:'5 PKA 1',confirmation:'5 PKA 1'})).toEqual([]);
    expect(sqlite.prepare('SELECT score FROM attempts WHERE id=?').get('attempt')).toMatchObject({score:2});
    await roster.save('tenant',await roster.get('tenant','5PKA1'));
    expect(await roster.classes('tenant')).toContain('5 PKA 1');sqlite.close();
  });
  it('returns names only, scoped to the owned active activity and assigned class',async()=>{
    const {db,sqlite}=database();sqlite.exec("UPDATE learning_resources SET status='PUBLISHED'");
    const roster=new RosterService(db),attempts=new AttemptService(db);
    const attempt=await attempts.start('tenant','student','resource');
    expect(await roster.studentNames('tenant','student',attempt.id,'5pka1')).toEqual(['Test Learner']);
    await expect(roster.studentNames('other','student',attempt.id,'5PKA1')).rejects.toThrow('not found');
    await expect(roster.studentNames('tenant','teacher',attempt.id,'5PKA1')).rejects.toThrow('not found');
    await expect(roster.studentNames('tenant','student',attempt.id,'5PKA2')).rejects.toThrow('assigned');
    await new ResourceRepository(db).updateAssignedClass('tenant','resource',[]);
    expect(await roster.studentNames('tenant','student',attempt.id,'5PKA1')).toEqual([]);sqlite.close();
  });
  it('fills a missing email from the authenticated submission and adds an unknown student',async()=>{
    const {db,sqlite}=database();sqlite.exec("UPDATE learning_resources SET status='PUBLISHED'; DELETE FROM attempts;");
    const roster=new RosterService(db),attempts=new AttemptService(db);
    await roster.save('tenant',{className:'5PKA1',revision:0,entries:[{id:'row',name:'Test Learner',email:''},{id:'absent',name:'Not Yet Submitted',email:''}]});
    let attempt=await attempts.start('tenant','student','resource');
    await attempts.submit('tenant','student',attempt.id,{fullName:'Test Learner',className:'5 pka 1',answers:[]});
    expect((await roster.get('tenant','5PKA1')).entries.find(e=>e.id==='row')).toMatchObject({email:'student@example.test',isNew:false});
    sqlite.exec("INSERT INTO users(id,email) VALUES('second','second@example.test')");
    attempt=await attempts.start('tenant','second','resource');
    await attempts.submit('tenant','second',attempt.id,{fullName:'New Learner',className:'5PKA1',answers:[]});
    expect((await roster.get('tenant','5PKA1')).entries).toContainEqual({id:'second',name:'New Learner',email:'second@example.test',isNew:true});sqlite.close();
  });
  it('accepts tenant-owned animated covers but never cross-tenant covers',()=>{
    expect(safeLibraryUrl('/api/v1/media/tenants/tenant/cover.mp4?name=demo.mp4','tenant',true)).toBe(true);
    expect(safeLibraryUrl('/api/v1/media/tenants/tenant/cover.gif','tenant',true)).toBe(true);
    expect(safeLibraryUrl('/api/v1/media/tenants/other/cover.mp4','tenant',true)).toBe(false);
  });
});
