import { lazy, Suspense, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import type { LibraryEntry } from '@interactiq/contracts';
const PdfReader=lazy(()=>import('./PdfReader'));
export type ApiRequest = <T>(path:string, init?:RequestInit)=>Promise<T>;
const educationCovers = [
  ['books','📚','Book garden'],['science','🧪','Science lab'],['globe','🌍','Our world'],['maths','📐','Math studio'],
  ['art','🎨','Creative arts'],['graduation','🎓','Graduation'],['pencil','✏️','Writing desk'],['computer','💻','Digital classroom'],
  ['ideas','💡','Bright ideas'],['trophy','🏆','Achievement'],
];
const mediaUrl=(base:string,value:string)=>value.startsWith('/api/')?base+value:value;
function Cover({cover,base}:{cover:string;base:string}) {
  const preset=educationCovers.find(c=>c[0]===cover);
  return preset?<div className={`education-cover cover-${cover}`} aria-label={preset[2]}><i/><i/><span>{preset[1]}</span><b>INTERACTIQ</b></div>:/\.mp4(?:\?|$)/i.test(cover)?<video className="library-cover-image" src={mediaUrl(base,cover)} autoPlay muted loop playsInline preload="metadata" aria-label="Animated cover"/>:<img className="library-cover-image" src={mediaUrl(base,cover)} alt=""/>;
}
function StudentNoteButton({onClick}:{onClick:()=>void}) {
  return <button className="student-note-alert" onClick={onClick} aria-label="Open note from your teacher"><span aria-hidden="true">🔔</span> Notes <b aria-label="1 unread note">1</b></button>;
}
function StudentNoteDialog({item,onClose}:{item:LibraryEntry;onClose:()=>void}) {
  return <div className="dialog-backdrop student-note-backdrop" onMouseDown={(event)=>{if(event.target===event.currentTarget)onClose();}}><section className="dialog student-note-dialog" role="dialog" aria-modal="true" aria-labelledby="student-note-title"><button className="dialog-close" aria-label="Close note" onClick={onClose}>×</button><p className="eyebrow">Note from your teacher</p><h2 id="student-note-title">{item.title}</h2><p className="student-note-copy">{item.studentNote}</p><button className="primary-action primary-action--dark" onClick={onClose}>Got it</button></section></div>;
}
function LibraryCarousel({items,base,onOpen,actions}:{items:LibraryEntry[];base:string;onOpen:(item:LibraryEntry)=>void;actions?:(item:LibraryEntry)=>ReactNode}) {
  const [active,setActive]=useState(0);
  useEffect(()=>setActive(0),[items.map(e=>e.id).join(',')]);
  if(!items.length)return <div className="empty-feature"><h3>A little room for discovery</h3><p>No items in this folder yet.</p></div>;
  const current=items[Math.min(active,items.length-1)]!;
  return <section className="library-showcase" aria-label="Learning library carousel" onKeyDown={e=>{if(e.key==='ArrowLeft')setActive(i=>Math.max(0,i-1));if(e.key==='ArrowRight')setActive(i=>Math.min(items.length-1,i+1));}}>
    <div className="library-carousel">{items.map((item,index)=>Math.abs(index-active)<=2&&<button key={item.id} className={`library-scene-card ${index===active?'is-active':''}`} style={{'--offset':index-active} as CSSProperties} tabIndex={index===active?0:-1} onClick={()=>index===active?onOpen(item):setActive(index)} aria-label={`${item.kind==='folder'?'Open folder':'Open material'}: ${item.title}`}>
      <Cover cover={item.cover} base={base}/><div className="library-card-caption"><small>{item.kind==='folder'?'COLLECTION':'LEARNING MATERIAL'}</small><h3>{item.title}</h3></div>
    </button>)}</div>
    <div className="library-carousel-controls"><button aria-label="Previous material" disabled={!active} onClick={()=>setActive(i=>i-1)}>←</button><span>{String(active+1).padStart(2,'0')} / {String(items.length).padStart(2,'0')}</span><button aria-label="Next material" disabled={active>=items.length-1} onClick={()=>setActive(i=>i+1)}>→</button></div>
    <div className="library-current"><h2>{current.title}</h2><p>{current.description}</p><button className="primary-action" onClick={()=>onOpen(current)}>{current.kind==='folder'?'Explore collection':'Open material'} ↗</button>{actions?.(current)}</div>
    <div className="library-index" aria-label="Choose material">{items.map((item,i)=><button key={item.id} className={active===i?'active':''} onClick={()=>setActive(i)}>{item.title}</button>)}</div>
  </section>;
}
function Material({item,base,onClose,onNote}:{item:LibraryEntry;base:string;onClose:()=>void;onNote?:(item:LibraryEntry)=>void}) {
  const url=mediaUrl(base,item.url),image=/\.(png|jpe?g|webp|gif)(?:\?|$)/i.test(url),pdf=/\.pdf(?:\?|$)/i.test(url);
  const close=useRef<HTMLButtonElement>(null);
  useEffect(()=>{const old=document.body.style.overflow,previous=document.activeElement as HTMLElement;document.body.style.overflow='hidden';close.current?.focus();const key=(e:KeyboardEvent)=>{if(e.key==='Escape')onClose();if(e.key==='Tab'){const nodes=close.current?.closest('.material-reader')?.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],select:not(:disabled),summary');if(nodes?.length){const first=nodes[0]!,last=nodes[nodes.length-1]!;if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}}}};document.addEventListener('keydown',key);return()=>{document.body.style.overflow=old;document.removeEventListener('keydown',key);previous?.focus();};},[]);
  const download=item.url.startsWith('/api/')?url+(url.includes('?')?'&':'?')+'download=1':url;
  return <div className="dialog-backdrop material-backdrop"><section className="material-reader" role="dialog" aria-modal="true" aria-labelledby="material-title"><header className="material-topbar"><div><small>{item.section==='tips'?'Exam tips':'Notes Library'}</small><h2 id="material-title">{item.title}</h2></div>{item.studentNote&&onNote&&<StudentNoteButton onClick={()=>onNote(item)}/>}<a className="primary-action" href={download} target="_blank" rel="noopener noreferrer">{item.url.startsWith('/api/')?'Download':'Open original'} ↗</a><button ref={close} aria-label="Close material" onClick={onClose}>×</button></header>
    {pdf?<Suspense fallback={<p role="status">Opening PDF reader…</p>}><PdfReader url={url}/></Suspense>:<div className="material-content">{image?<img src={url} alt={item.title}/>:<div className="study-file-preview"><Cover cover={item.cover} base={base}/><p>Open this material in its original viewer using the button above.</p></div>}</div>}
    {(item.description||item.tips)&&<details className="material-notes"><summary>Description{item.tips?' & Exam tips':''}</summary><p>{item.description}</p>{item.tips&&<p className="exam-tips-copy">{item.tips}</p>}</details>}
  </section></div>;
}
export function PublicStudyLibrary({code,base}:{code:string;base:string}) {
  const [data,setData]=useState<{root:LibraryEntry;entries:LibraryEntry[]}|null>(null);
  const [path,setPath]=useState<string[]>([]);const [material,setMaterial]=useState<LibraryEntry|null>(null);const [noteItem,setNoteItem]=useState<LibraryEntry|null>(null);const [error,setError]=useState('');
  const [retry,setRetry]=useState(0);
  const load=()=>setRetry(n=>n+1);
  useEffect(()=>{
    let active=true;setError('');setData(null);setMaterial(null);
    const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),15000);
    fetch(base+'/api/v1/study-public/'+code,{signal:controller.signal}).then(r=>r.json()).then(payload=>{if(!payload.success)throw new Error(payload.error?.message??'Unable to open this library.');if(active){setData(payload.data);setPath([payload.data.root.id]);}}).catch(e=>{if(active)setError(e.name==='AbortError'?'The connection timed out. Please try again.':e.message);}).finally(()=>clearTimeout(timer));
    return()=>{active=false;clearTimeout(timer);controller.abort();};
  },[code,base,retry]);
  const parent=path.at(-1);const current=data?.entries.find(e=>e.id===parent);
  return <main className="public-study"><header className="public-study-brand"><img src={import.meta.env.BASE_URL+'assets/interactiq-symbol.png'} alt=""/><b>InteractIQ</b><span>{data?.root.section==='tips'?'Exam tips':'Notes Library'}</span></header>
    {error?<section className="empty-feature" role="alert"><h1>Library unavailable</h1><p>{error}</p><button onClick={load}>Try again</button></section>:!data?<p role="status">Opening your library…</p>:<>
      <nav className="study-breadcrumb" aria-label="Folders">{path.map((id,i)=><button key={id} onClick={()=>setPath(path.slice(0,i+1))}>{i>0?'› ':''}{data.entries.find(e=>e.id===id)?.title}</button>)}</nav>
      <header className="study-heading"><p className="eyebrow">A space to learn, at your own pace</p><h1>{current?.title}</h1><p>{current?.description}</p>{current?.tips&&<p className="exam-tips-copy">{current.tips}</p>}{current?.studentNote&&<StudentNoteButton onClick={()=>setNoteItem(current)}/>}</header>
      <LibraryCarousel items={data.root.kind==='file'?[data.root]:data.entries.filter(e=>e.parentId===parent)} base={base} onOpen={item=>item.kind==='folder'?setPath([...path,item.id]):setMaterial(item)} actions={item=>item.studentNote?<StudentNoteButton onClick={()=>setNoteItem(item)}/>:null}/>
      {material&&<Material item={material} base={base} onClose={()=>setMaterial(null)} onNote={setNoteItem}/>}
      {noteItem&&<StudentNoteDialog item={noteItem} onClose={()=>setNoteItem(null)}/>}
    </>}
  </main>;
}
export function StudyLibrary({section,request,csrf,base}:{section:'notes'|'tips';request:ApiRequest;csrf:string;base:string}) {
  const [entries,setEntries]=useState<LibraryEntry[]>([]);const [path,setPath]=useState<string[]>([]);const [editing,setEditing]=useState<Partial<LibraryEntry>|null>(null);
  const [busy,setBusy]=useState(false);const [message,setMessage]=useState('');const [material,setMaterial]=useState<LibraryEntry|null>(null);const [share,setShare]=useState('');const [noting,setNoting]=useState<LibraryEntry|null>(null);const [noteDraft,setNoteDraft]=useState('');
  const parentId=path.at(-1)??null;const title=section==='notes'?'Notes Library':'Exam tips';
  useEffect(()=>{setPath([]);setEditing(null);request<LibraryEntry[]>('/api/v1/study-library').then(setEntries).catch(e=>setMessage(e.message));},[section,request]);
  const action=async(work:()=>Promise<void>)=>{setBusy(true);setMessage('');try{await work();}catch(e){setMessage(e instanceof Error?e.message:'Unable to complete this action.');}finally{setBusy(false);}};
  const mutate=(path:string,method:string,body?:unknown)=>request<LibraryEntry[]>(path,{method,headers:{'content-type':'application/json','x-csrf-token':csrf},...(body?{body:JSON.stringify(body)}:{})});
  const upload=async(file:File,cover=false)=>{await action(async()=>{const form=new FormData();form.set('file',file);const result=await request<{url:string}>(file.type.startsWith('image/')?'/api/v1/media/images':'/api/v1/media/files',{method:'POST',headers:{'x-csrf-token':csrf},body:form});setEditing(item=>item?{...item,[cover?'cover':'url']:result.url}:null);});};
  const create=(kind:'folder'|'file')=>setEditing({section,parentId,kind,title:'',description:'',tips:'',studentNote:'',cover:'books',url:''});
  const openNotes=(item:LibraryEntry)=>{setNoting(item);setNoteDraft(item.studentNote);};
  const publish=(entry:LibraryEntry)=>{if(entry.kind==='folder'&&!confirm((entry.published?'Unpublish':'Publish')+' this folder and every material/subfolder inside it?'))return;void action(async()=>{const next=await mutate('/api/v1/study-library/publish','POST',{id:entry.id,published:!entry.published});setEntries(next);setMessage(entry.published?'Unpublished. Student links no longer open this collection.':'Published. You can now copy the student link.');});};
  const items=entries.filter(e=>e.section===section&&e.parentId===parentId);
  return <section className="study-library-admin"><header className="section-heading"><div><p className="eyebrow">Your learning collections</p><h2>{title}</h2><p>Organise, inspire, and share a little knowledge.</p></div><div className="part-tools"><button className="primary-action" onClick={()=>create('folder')}>＋ Folder</button><button className="primary-action primary-action--dark" onClick={()=>create('file')}>＋ Material</button></div></header>
    <nav className="study-breadcrumb"><button onClick={()=>setPath([])}>{title}</button>{path.map((id,i)=><button key={id} onClick={()=>setPath(path.slice(0,i+1))}>› {entries.find(e=>e.id===id)?.title}</button>)}</nav>
    {message&&<p className="message" role="status">{message}</p>}
    <LibraryCarousel items={items} base={base} actions={item=><div className="library-item-actions"><small>{item.published?'Published':'Draft'} · {item.kind==='folder'?'Collection':'Material'}{item.studentNote?' · Note added':''}</small><div className="part-tools"><button onClick={()=>setEditing(item)}>Edit</button><button className={item.studentNote?'has-student-note':''} onClick={()=>openNotes(item)}>Notes{item.studentNote?' ✓':''}</button><button disabled={busy} onClick={()=>publish(item)}>{item.published?'Unpublish':item.kind==='folder'?'Publish folder & contents':'Publish'}</button>{item.published&&<button onClick={()=>setShare(location.origin+import.meta.env.BASE_URL+'#/study/'+item.shareCode)}>Share</button>}<button className="danger-text" disabled={busy} onClick={()=>{if(confirm('Delete '+item.title+(item.kind==='folder'?' and all its subfolders/materials':'')+'? Uploaded files remain in Memory control.'))void action(async()=>setEntries(await mutate('/api/v1/study-library/'+item.id,'DELETE')));}}>Delete</button></div></div>} onOpen={item=>item.kind==='folder'?setPath([...path,item.id]):setMaterial(item)}/>
    {material&&<Material item={material} base={base} onClose={()=>setMaterial(null)}/>}
    {share&&<div className="dialog-backdrop"><section className="dialog"><button className="dialog-close" onClick={()=>setShare('')}>×</button><h2>Student library link</h2><p>Anyone with this link can view the published collection. No sign-in is required.</p><input readOnly value={share} onFocus={e=>e.target.select()}/><button className="primary-action" onClick={()=>void navigator.clipboard.writeText(share).then(()=>setMessage('Link copied.')).catch(()=>setMessage('Select the link and copy it manually.'))}>Copy link</button><a href={share} target="_blank" rel="noreferrer">Preview as student ↗</a></section></div>}
    {noting&&<div className="dialog-backdrop"><form className="dialog library-note-editor" onSubmit={(event)=>{event.preventDefault();void action(async()=>{const next=await mutate('/api/v1/study-library','POST',{...noting,studentNote:noteDraft});setEntries(next);setNoting(null);setMessage(noteDraft.trim()?'Student note saved.':'Student note removed.');});}}><button className="dialog-close" type="button" onClick={()=>setNoting(null)}>×</button><p className="eyebrow">Student note</p><h2>{noting.title}</h2><p>This note appears only on the shared student page. Leave it empty to hide the Notes button.</p><label>Note for students<textarea autoFocus rows={8} maxLength={6000} placeholder="Write an instruction, reminder, or study tip…" value={noteDraft} onChange={(event)=>setNoteDraft(event.target.value)}/></label><small>{noteDraft.length} / 6000 characters</small><div className="dialog-actions"><button type="button" onClick={()=>setNoting(null)}>Cancel</button><button className="primary-action primary-action--dark" disabled={busy}>{busy?'Saving…':'Save note'}</button></div></form></div>}
    {editing&&<div className="dialog-backdrop"><form className="dialog library-edit-dialog" onSubmit={e=>{e.preventDefault();void action(async()=>{setEntries(await mutate('/api/v1/study-library','POST',editing));setEditing(null);});}}><button className="dialog-close" type="button" disabled={busy} onClick={()=>setEditing(null)}>×</button><p className="eyebrow">{title}</p><h2>{editing.id?'Edit':'New'} {editing.kind}</h2>
      <label>Title<input required maxLength={160} value={editing.title??''} onChange={e=>setEditing({...editing,title:e.target.value})}/></label>
      <label>Folder<select value={editing.parentId??''} onChange={e=>setEditing({...editing,parentId:e.target.value||null})}><option value="">Main library</option>{entries.filter(e=>e.section===section&&e.kind==='folder'&&e.id!==editing.id).map(e=><option value={e.id} key={e.id}>{e.title}</option>)}</select></label>
      <label>Description<textarea maxLength={4000} value={editing.description??''} onChange={e=>setEditing({...editing,description:e.target.value})}/></label>
      {editing.kind==='file'&&<><label>File or link<input required value={editing.url??''} placeholder="https://www.youtube.com/… or upload below" onChange={e=>setEditing({...editing,url:e.target.value})}/></label><label>Upload file (up to 50 MB; images 5 MB)<input disabled={busy} type="file" accept=".pdf,.ppt,.pptx,.xls,.xlsx,.doc,.docx,.png,.jpg,.jpeg,.webp,.gif" onChange={e=>{const file=e.target.files?.[0];if(file)void upload(file);}}/></label><small>Links: YouTube, Canva, Google Drive/Docs, Microsoft, Wikipedia, Khan Academy, GeoGebra and Desmos.</small></>}
      {section==='tips'&&<label>Exam tips<textarea rows={5} maxLength={20000} value={editing.tips??''} onChange={e=>setEditing({...editing,tips:e.target.value})}/></label>}
      <fieldset className="education-cover-picker"><legend>Choose an animated education cover</legend>{educationCovers.map(([id,icon,label])=><button type="button" key={id} aria-pressed={editing.cover===id} onClick={()=>setEditing({...editing,cover:id})}><span>{icon}</span>{label}</button>)}</fieldset>
      <label>Or upload your own cover (PNG / GIF up to 5 MB, MP4 up to 50 MB)<input type="file" disabled={busy} accept="image/png,image/jpeg,image/webp,image/gif,video/mp4" onChange={e=>{const file=e.target.files?.[0];if(file)void upload(file,true);}}/></label>
      <div className="selected-cover"><Cover cover={editing.cover??'books'} base={base}/></div>
      {message&&<p role="alert">{message}</p>}<button className="primary-action" disabled={busy}>{busy?'Saving / uploading…':'Save '+editing.kind}</button>
    </form></div>}
  </section>;
}
