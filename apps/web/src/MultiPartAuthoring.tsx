import type { LearningQuestion, QuestionInteraction, QuestionType } from '@interactiq/contracts';
import { RichTextEditor } from './RichTextEditor';
import { defaultInteraction, InteractionAuthoring } from './InteractiveQuestion';

const empty = { type: 'doc' as const, content: [{ type: 'paragraph' }] };
export function newPart(type: QuestionType = 'MULTIPLE_CHOICE'): LearningQuestion {
  const interaction = defaultInteraction(type);
  return { id: crypto.randomUUID(), type, prompt: empty, position: 0, timeLimitSeconds: null,
    points: interaction?.kind === 'math_response' ? interaction.parts?.filter(p=>p.enabled).reduce((s,p)=>s+p.marks,0) ?? 1 : 1,
    acceptedAnswers: [], interaction,
    options: type === 'TRUE_FALSE' ? [{id:'true',text:'True',isCorrect:true},{id:'false',text:'False',isCorrect:false}] : [{id:'a',text:'',isCorrect:true},{id:'b',text:'',isCorrect:false}] };
}
export function MultiPartAuthoring({ value, onChange, onUploadImage, catalog }: {
  value: Extract<QuestionInteraction,{kind:'multi_part'}>;
  onChange: (value: QuestionInteraction) => void;
  onUploadImage: (file:File)=>Promise<string>;
  catalog: Array<{type:QuestionType;label:string}>;
}) {
  const update = (id:string, patch:Partial<LearningQuestion>) => onChange({...value,parts:value.parts.map(p=>p.id===id?{...p,...patch}:p)});
  const move = (index:number,delta:number) => {const parts=[...value.parts];[parts[index],parts[index+delta]]=[parts[index+delta]!,parts[index]!];onChange({...value,parts});};
  return <section className="multipart-builder">
    <header><h3>Question parts</h3><p>Each part is marked separately. Total: {value.parts.reduce((s,p)=>s+p.points,0)} marks.</p></header>
    {value.parts.map((part,index)=><section className="multipart-card" key={part.id}>
      <header><h3>Part {String.fromCharCode(65+index)}</h3><div className="part-tools">
        <button type="button" aria-label="Move part up" disabled={!index} onClick={()=>move(index,-1)}>↑</button>
        <button type="button" aria-label="Move part down" disabled={index===value.parts.length-1} onClick={()=>move(index,1)}>↓</button>
        <button type="button" disabled={value.parts.length<=2} onClick={()=>onChange({...value,parts:value.parts.filter(p=>p.id!==part.id)})}>Remove part</button>
      </div></header>
      <div className="question-settings"><label>Question type<select value={part.type} onChange={e=>{const next=newPart(e.target.value as QuestionType);update(part.id,{...next,id:part.id,prompt:part.prompt});}}>{catalog.filter(t=>t.type!=='MULTI_PART').map(t=><option key={t.type} value={t.type}>{t.label}</option>)}</select></label>
        <label>Marks<input aria-label={`Part ${index+1} marks`} type="number" min="0" max="1000" step="0.5" readOnly={part.type==='MATH_RESPONSE'} value={part.points} onChange={e=>update(part.id,{points:Number(e.target.value)})}/></label></div>
      <RichTextEditor value={part.prompt} onChange={prompt=>update(part.id,{prompt})} onUploadImage={onUploadImage}/>
      {part.interaction && <InteractionAuthoring key={`${part.id}-${part.type}`} type={part.type} interaction={part.interaction} onUploadImage={onUploadImage} onChange={interaction=>update(part.id,{interaction,...(interaction?.kind==='math_response'?{points:interaction.parts?.filter(p=>p.enabled).reduce((s,p)=>s+p.marks,0)??1}:{})})}/>}
      {['MULTIPLE_CHOICE','MULTI_SELECT','DROPDOWN','TRUE_FALSE'].includes(part.type)&&<div className="option-list">{part.options.map((option,i)=><div className="option-row" key={option.id}>
        <input aria-label={`Part ${index+1} correct option ${i+1}`} type={part.type==='MULTI_SELECT'?'checkbox':'radio'} checked={option.isCorrect} onChange={()=>update(part.id,{options:part.options.map(o=>({...o,isCorrect:part.type==='MULTI_SELECT'?(o.id===option.id?!o.isCorrect:o.isCorrect):o.id===option.id}))})}/>
        <input aria-label={`Part ${index+1} option ${i+1}`} readOnly={part.type==='TRUE_FALSE'} placeholder={`Option ${i+1}`} value={option.text} onChange={e=>update(part.id,{options:part.options.map(o=>o.id===option.id?{...o,text:e.target.value}:o)})}/>
        {part.type!=='TRUE_FALSE'&&<button type="button" disabled={part.options.length<=2} onClick={()=>update(part.id,{options:part.options.filter(o=>o.id!==option.id)})}>×</button>}
      </div>)}{part.type!=='TRUE_FALSE'&&<button type="button" disabled={part.options.length>=12} onClick={()=>update(part.id,{options:[...part.options,{id:crypto.randomUUID(),text:'',isCorrect:false}]})}>+ Add option</button>}</div>}
      {part.type==='OPEN_ENDED'&&<label>AI marking guide / expected ideas<textarea value={part.acceptedAnswers.join('\n')} onChange={e=>update(part.id,{acceptedAnswers:e.target.value.split('\n')})}/></label>}
    </section>)}
    <button type="button" className="add-question-hero" disabled={value.parts.length>=20} onClick={()=>onChange({...value,parts:[...value.parts,newPart()]})}>＋ Add Part</button>
  </section>;
}
