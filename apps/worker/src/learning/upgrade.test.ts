import { describe,it,expect } from 'vitest';
import { gradeQuestionAnswer, questionRequiresAi, questionAnswered, parsePartAnswers, type LearningQuestion } from '@interactiq/contracts';
import { parseQuestionInput } from '../questions/registry';
import { displayAnswer } from '../attempts/service';
import { mergeRoster } from './rosters';
import { safeLibraryUrl } from './library';
const prompt={type:'doc' as const,content:[{type:'paragraph',content:[{type:'text',text:'Main question'}]}]};
const part=(id:string):LearningQuestion=>({id,type:'MULTIPLE_CHOICE',prompt,points:2,position:0,timeLimitSeconds:null,acceptedAnswers:[],options:[{id:'a',text:'Correct',isCorrect:true},{id:'b',text:'Wrong',isCorrect:false}]});
const multi=(parts=[part('one'),part('two')]):LearningQuestion=>({id:'parent',type:'MULTI_PART',prompt,points:parts.reduce((s,p)=>s+p.points,0),position:0,timeLimitSeconds:null,options:[],acceptedAnswers:[],interaction:{kind:'multi_part',parts}});
describe('multi-part lifecycle',()=>{
  it('validates children and computes marks server-side',()=>expect(parseQuestionInput({...multi(),points:999}).points).toBe(4));
  it('forbids nesting and duplicate IDs',()=>{
    expect(()=>parseQuestionInput(multi([part('one'),multi()]))).toThrow('cannot contain');
    expect(()=>parseQuestionInput(multi([part('same'),part('same')]))).toThrow('unique');
  });
  it('validates each child option key',()=>expect(()=>parseQuestionInput(multi([{...part('one'),options:[]},part('two')]))).toThrow('options'));
  it('preserves saved true-false keys',()=>expect(parseQuestionInput(multi([{...part('one'),type:'TRUE_FALSE',options:[{id:'false',text:'False',isCorrect:true}]},part('two')])).interaction).toMatchObject({parts:[{options:[{id:'true',isCorrect:false},{id:'false',isCorrect:true}]},{}]}));
  it('awards independent marks, ignores unknown answer IDs and rejects forged marks',()=>{
    expect(gradeQuestionAnswer(multi(),JSON.stringify({one:'a',two:'b',fake:'a',points:500}))).toEqual({correct:false,points:2});
    expect(gradeQuestionAnswer(multi(),JSON.stringify({one:'a',two:'a'}))).toEqual({correct:true,points:4});
    expect(gradeQuestionAnswer(multi(),'{bad')).toEqual({correct:false,points:0});
  });
  it('distinguishes partial completion and AI parts',()=>{
    expect(questionAnswered(multi(),JSON.stringify({one:'a'}))).toBe(false);
    expect(questionAnswered(multi(),JSON.stringify({one:'a',two:'b'}))).toBe(true);
    expect(questionRequiresAi(multi())).toBe(false);
    expect(questionRequiresAi(multi([part('one'),{...part('two'),type:'OPEN_ENDED'}]))).toBe(true);
    expect(parsePartAnswers('{"one":10,"two":{"points":99}}')).toEqual({});
  });
  it('renders readable answers for teacher review',()=>expect(displayAnswer('{"one":"a","two":"b"}',multi())).toEqual(['Part 1: Correct','Part 2: Wrong']));
});
describe('roster matching',()=>{
  it('matches an email before a changed name',()=>expect(mergeRoster([{id:'a',name:'Alya',email:'a@example.com'}],[{id:'b',name:'Changed',email:'A@example.com'}])).toHaveLength(1));
  it('links a unique pre-entered name to the submitting email',()=>expect(mergeRoster([{id:'a',name:'  Ali  Ahmad ',email:''}],[{id:'b',name:'ALI AHMAD',email:'ali@example.com'}])).toEqual([{id:'a',name:'  Ali  Ahmad ',email:'ali@example.com'}]));
  it('never merges two different emails just because names match',()=>expect(mergeRoster([{id:'a',name:'Ali',email:''}],[{id:'b',name:'Ali',email:'ali1@example.com'},{id:'c',name:'Ali',email:'ali2@example.com'}])).toHaveLength(3));
  it('marks unknown submitters new, deduplicates attempts, respects explicit deletion',()=>{
    const user={id:'a',name:'Alya',email:'a@example.com'};
    expect(mergeRoster([],[user,user])).toEqual([{...user,isNew:true}]);
    expect(mergeRoster([],[user],['a@example.com'])).toEqual([]);
  });
});
describe('published material URL policy',()=>{
  it('accepts provider links and tenant-owned files',()=>{
    expect(safeLibraryUrl('https://www.youtube.com/watch?v=demo','tenant')).toBe(true);
    expect(safeLibraryUrl('/api/v1/media/tenants/tenant/presentations/file.pdf?name=notes.pdf','tenant')).toBe(true);
    expect(safeLibraryUrl('science','tenant',true)).toBe(true);
  });
  it.each(['javascript:alert(1)','data:text/html,test','http://youtube.com','https://youtube.com.attacker.example','https://attacker.example@youtube.com','https://127.0.0.1/file','/api/v1/media/tenants/other/file.pdf','/api/v1/media/tenants/tenant/../other.pdf'])('rejects unsafe or foreign URL %s',url=>expect(safeLibraryUrl(url,'tenant')).toBe(false));
});
