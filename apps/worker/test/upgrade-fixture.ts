import { DatabaseSync } from 'node:sqlite';
import { readFileSync,readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import type { D1Database,D1PreparedStatement } from '../src/db/types';
export function database(upgrade=true) {
  const sqlite=new DatabaseSync(':memory:');
  for(const file of readdirSync(resolve('migrations')).sort()) {
    if(file.startsWith('0028'))continue;
    sqlite.exec(readFileSync(resolve('migrations',file),'utf8'));
  }
  sqlite.exec(`INSERT INTO tenants(id,slug,name) VALUES('tenant','test-tenant','Test class'),('other','other','Other tenant');
    INSERT INTO users(id,email,display_name) VALUES('teacher','teacher@example.test','Teacher'),('student','student@example.test','Test Learner');
    INSERT INTO learning_resources(id,tenant_id,created_by_user_id,title,resource_type,assigned_class_name) VALUES('resource','tenant','teacher','Upgrade Test','QUIZ','5 PKA 1');
    INSERT INTO questions(id,tenant_id,created_by_user_id,question_type,prompt_json,configuration_json,points) VALUES('question','tenant','teacher','MULTIPLE_CHOICE','{"type":"doc","content":[]}','{"options":[{"id":"a","text":"A","isCorrect":true}]}',2);
    INSERT INTO quiz_questions(resource_id,question_id,position) VALUES('resource','question',0);
    INSERT INTO attempts(id,tenant_id,resource_id,user_id,status,score,max_score,student_full_name,student_class_name,submitted_at) VALUES('attempt','tenant','resource','student','COMPLETED',2,2,'Test Learner','5 PKA 1','2026-10-17 10:00:00');
    INSERT INTO attempt_answers(attempt_id,question_id,answer_json,awarded_points,teacher_points,teacher_feedback,ai_marking_status,ai_provider) VALUES('attempt','question','"a"',2,2,'Preserve review','MANUAL','CLOUDFLARE');
    INSERT INTO resource_live_states(resource_id,tenant_id,active_question_id) VALUES('resource','tenant','question');`);
  const migrate=()=>{sqlite.exec('BEGIN;');sqlite.exec(readFileSync(resolve('migrations/0028_learning_upgrade.sql'),'utf8'));sqlite.exec('COMMIT;');};
  if(upgrade)migrate();
  const db:D1Database={
    prepare(query:string):D1PreparedStatement {let bindings:unknown[]=[];const statement:D1PreparedStatement={bind(...values){bindings=values;return statement;},async first<T>(){return sqlite.prepare(query).get(...bindings as never[]) as T??null;},async all<T>(){return {results:sqlite.prepare(query).all(...bindings as never[]) as T[],success:true,meta:{}};},async run(){const result=sqlite.prepare(query).run(...bindings as never[]);return {results:[],success:true,meta:{changes:Number(result.changes)}};}};return statement;},
    async batch(statements){sqlite.exec('BEGIN');try{const result=await Promise.all(statements.map(s=>s.run()));sqlite.exec('COMMIT');return result as never;}catch(e){sqlite.exec('ROLLBACK');throw e;}}
  };
  return {sqlite,db,migrate};
}

