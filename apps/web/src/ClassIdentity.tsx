import { useEffect, useId, useState } from 'react';
import type { LearningResourceSummary } from '@interactiq/contracts';
import type { ApiRequest } from './StudyLibrary';
export const classKey=(s:string)=>s.trim().toUpperCase().replace(/[^A-Z0-9]/g,'');
export const assignedClasses=(r:LearningResourceSummary)=>r.assignedClassNames??(r.assignedClassName?[r.assignedClassName]:[]);
export const initialClass=(r:LearningResourceSummary)=>assignedClasses(r).length===1?assignedClasses(r)[0]!:'';
export function ClassAssignmentPicker({value,options,onChange}:{value:string[];options:string[];onChange:(v:string[])=>void}) {
  const [typed,setTyped]=useState('');
  const all=[...options,...value].filter((s,i,a)=>a.findIndex(n=>classKey(n)===classKey(s))===i);
  return <fieldset className="class-assignment"><legend>Assigned classes (optional)</legend>
    <details><summary>{value.length?value.join(', '):'Choose classes — no restriction'}</summary><div className="class-checkboxes">
      {all.map(n=><label key={n}><input type="checkbox" checked={value.some(v=>classKey(v)===classKey(n))} onChange={e=>onChange(e.target.checked?[...value,n]:value.filter(v=>classKey(v)!==classKey(n)))}/>{n}</label>)}
      <div className="class-add"><input aria-label="New assigned class" placeholder="Type another class" maxLength={80} value={typed} onChange={e=>setTyped(e.target.value)}/><button type="button" disabled={!classKey(typed)} onClick={()=>{if(!value.some(n=>classKey(n)===classKey(typed)))onChange([...value,typed.trim()]);setTyped('');}}>Add</button></div>
    </div></details><small>Students choose their class first. Leave empty to allow a typed class.</small>
  </fieldset>;
}
export function StudentIdentityFields({resource,attemptId,request,name,className,onName,onClass}:{resource:LearningResourceSummary;attemptId:string;request:ApiRequest;name:string;className:string;onName:(s:string)=>void;onClass:(s:string)=>void}) {
  const classes=assignedClasses(resource),id=useId();
  const [names,setNames]=useState<string[]>([]),[open,setOpen]=useState(false),[active,setActive]=useState(-1),[loading,setLoading]=useState(false),[error,setError]=useState('');
  useEffect(()=>{let live=true;setNames([]);setError('');setActive(-1);setLoading(false);
    if(!className.trim()||!classes.length)return;
    setLoading(true);request<string[]>('/api/v1/student-roster?attempt='+encodeURIComponent(attemptId)+'&class='+encodeURIComponent(className))
      .then(n=>{if(live)setNames(n);}).catch(()=>{if(live)setError('Name suggestions are unavailable. You can still type your full name.');}).finally(()=>{if(live)setLoading(false);});
    return()=>{live=false;};
  },[attemptId,className,request]);
  const matches=names.filter(n=>n.toLocaleLowerCase().includes(name.trim().toLocaleLowerCase())).slice(0,100);
  const choose=(n:string)=>{onName(n);setOpen(false);setActive(-1);};
  const highlight=(n:string)=>{const q=name.trim(),i=n.toLocaleLowerCase().indexOf(q.toLocaleLowerCase());return !q||i<0?n:<>{n.slice(0,i)}<mark>{n.slice(i,i+q.length)}</mark>{n.slice(i+q.length)}</>;};
  return <div className="student-identity-fields"><label>Class{classes.length>1?<select value={className} onChange={e=>{onClass(e.target.value);onName('');}}><option value="">Choose your class</option>{classes.map(c=><option key={c}>{c}</option>)}</select>:<input value={className} readOnly={classes.length===1} maxLength={80} placeholder="Example: 5 PKA 1" onChange={e=>{onClass(e.target.value);onName('');}}/>}</label>
    <div className="student-name-search"><label htmlFor={id}>Full name</label><input id={id} role="combobox" aria-autocomplete="list" aria-expanded={open&&matches.length>0} aria-controls={id+'-list'} aria-activedescendant={active>=0?id+'-'+active:undefined} disabled={!className.trim()} autoComplete="off" value={name} maxLength={120} placeholder="Search or type your full name" onFocus={()=>setOpen(true)} onBlur={()=>setOpen(false)} onChange={e=>{onName(e.target.value);setOpen(true);setActive(-1);}} onKeyDown={e=>{if(e.key==='Escape')setOpen(false);if(e.key==='ArrowDown'){e.preventDefault();setOpen(true);setActive(i=>Math.min(matches.length-1,i+1));}if(e.key==='ArrowUp'){e.preventDefault();setActive(i=>Math.max(0,i-1));}if(e.key==='Enter'&&open&&active>=0&&matches[active]){e.preventDefault();choose(matches[active]!);}}}/>
    {open&&matches.length>0&&<div id={id+'-list'} role="listbox" className="student-name-options">{matches.map((n,i)=><div role="option" id={id+'-'+i} key={n} aria-selected={i===active} onMouseDown={e=>e.preventDefault()} onClick={()=>choose(n)}>{highlight(n)}</div>)}</div>}
    <small role="status">{loading?'Loading names…':error||'Name not listed? Type your full name. It will be added to your class when you submit.'}</small></div>
  </div>;
}
