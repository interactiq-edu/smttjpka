import { database } from '../../test/upgrade-fixture';
import { describe,it,expect } from 'vitest';
import type { D1Database,D1PreparedStatement } from '../db/types';
import { RosterService } from './rosters';
import { StudyLibraryService } from './library';
import { QuestionRepository } from '../questions/repository';
import { QuestionService } from '../questions/service';
import { ResourceRepository } from '../resources/repository';
import { AttemptService } from '../attempts/service';

describe('upgrade database and service integration',()=>{
  it('submits multipart marks, preserves readable review and respects hidden results',async()=>{
    const {db,sqlite}=database();const questions=new QuestionService(new ResourceRepository(db),new QuestionRepository(db));
    const child=(id:string)=>({id,type:'TRUE_FALSE',options:[{id:'true',text:'True',isCorrect:true}],prompt:{type:'doc',content:[]},points:3});
    const question=await questions.create('tenant','teacher','resource',{type:'MULTI_PART',prompt:{type:'doc',content:[]},interaction:{kind:'multi_part',parts:[child('a'),child('b')]}});
    sqlite.exec("UPDATE learning_resources SET status='PUBLISHED',attempt_policy='MULTIPLE',result_release_policy='DETAILED_AFTER_SUBMISSION' WHERE id='resource'");
    const service=new AttemptService(db);const attempt=await service.start('tenant','student','resource');
    const result=await service.submit('tenant','student',attempt.id,{fullName:'Test Learner',className:'5PKA1',answers:[{questionId:question.id,value:JSON.stringify({a:'true',b:'false'})}]});
    expect(result.score).toBe(3);expect(result.maxScore).toBe(8);expect(result.pendingAiCount).toBe(0);
    expect((await service.result('tenant','student',attempt.id)).score).toBe(3);
    expect((await service.review('tenant',attempt.id)).answers[0]?.answer).toEqual(['Part 1: True','Part 2: False']);
    sqlite.exec("UPDATE learning_resources SET result_release_policy='TEACHER_REVIEW' WHERE id='resource'");
    expect((await service.result('tenant','student',attempt.id)).score).toBeNull();sqlite.close();
  });
  it('migrates with foreign keys enabled without losing questions, answers, manual reviews or live references',()=>{
    const {sqlite,migrate}=database(false);const before=sqlite.prepare('SELECT * FROM attempt_answers').all();
    migrate();expect(sqlite.prepare('SELECT * FROM attempt_answers').all()).toEqual(before);
    expect(sqlite.prepare('SELECT active_question_id FROM resource_live_states').get()).toMatchObject({active_question_id:'question'});
    expect(sqlite.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM quiz_questions').get()).toMatchObject({n:1});
    sqlite.close();
  });
  it('persists and retrieves multi-part questions with server-derived total',async()=>{
    const {db,sqlite}=database();const repository=new QuestionRepository(db);const service=new QuestionService(new ResourceRepository(db),repository);
    const child=(id:string)=>({id,type:'TRUE_FALSE',options:[{id:'true',text:'True',isCorrect:true}],prompt:{type:'doc',content:[]},points:3});
    const question=await service.create('tenant','teacher','resource',{type:'MULTI_PART',prompt:{type:'doc',content:[]},interaction:{kind:'multi_part',parts:[child('a'),child('b')]}});
    expect(question.points).toBe(6);expect((await repository.list('tenant','resource')).at(-1)?.interaction).toMatchObject({kind:'multi_part',parts:[{id:'a'},{id:'b'}]});
    expect(await repository.list('other','resource')).toEqual([]);sqlite.close();
  });
  it('saves a roster, links submission identity and prevents lost-update writes',async()=>{
    const {db,sqlite}=database();const service=new RosterService(db);
    expect(await service.classes('tenant')).toContain('5 PKA 1');
    const current=await service.get('tenant','5PKA1');expect(current.entries).toMatchObject([{name:'Test Learner',isNew:true}]);
    const saved=await service.save('tenant',{...current,entries:[...current.entries,{id:'absent',name:'Absent Learner',email:''}]});
    expect(saved.revision).toBe(1);expect(saved.entries).toHaveLength(2);
    await expect(service.save('tenant',current)).rejects.toThrow('another tab');
    expect((await service.get('other','5PKA1')).entries).toEqual([]);
    const removed=await service.save('tenant',{...saved,entries:[],deletedIds:saved.entries.map(e=>e.id)});expect(removed.entries).toEqual([]);
    sqlite.close();
  });
  it('protects draft descendants and other tenants and unpublishes entire folders',async()=>{
    const {db,sqlite}=database();const service=new StudyLibraryService(db);
    const initial=await service.save('tenant',{section:'notes',kind:'folder',title:'Topic 1'});const root=initial[0]!;
    const withFile=await service.save('tenant',{section:'notes',kind:'file',parentId:root.id,title:'Notes',url:'https://www.canva.com/design/demo/view'});const file=withFile.find(e=>e.kind==='file')!;
    await expect(service.publicTree(root.shareCode)).rejects.toThrow('not published');
    await expect(service.save('other',{section:'notes',kind:'file',parentId:root.id,title:'No',url:'https://youtube.com'})).rejects.toThrow('same library');
    await service.publish('tenant',root.id,true);expect((await service.publicTree(root.shareCode)).entries).toHaveLength(2);
    await service.save('tenant',{section:'notes',kind:'file',parentId:root.id,title:'Draft',url:'https://youtube.com'});expect((await service.publicTree(root.shareCode)).entries).toHaveLength(2);
    await service.publish('tenant',root.id,false);await expect(service.publicTree(file.shareCode)).rejects.toThrow('not published');
    await expect(service.save('tenant',{...root,parentId:root.id})).rejects.toThrow('themselves');
    sqlite.close();
  });
});
