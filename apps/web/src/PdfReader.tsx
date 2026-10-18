import { useEffect, useRef, useState } from 'react';
import { getDocument, GlobalWorkerOptions, type PDFDocumentProxy } from 'pdfjs-dist/legacy/build/pdf.mjs';
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';
GlobalWorkerOptions.workerSrc=workerUrl;
export default function PdfReader({url}:{url:string}) {
  const [pdf,setPdf]=useState<PDFDocumentProxy|null>(null),[page,setPage]=useState(1),[zoom,setZoom]=useState(1),[error,setError]=useState(''),[loading,setLoading]=useState(true),[width,setWidth]=useState(800),[text,setText]=useState('');
  const host=useRef<HTMLDivElement>(null),paper=useRef<HTMLDivElement>(null);
  useEffect(()=>{const el=host.current;if(!el)return;const observer=new ResizeObserver(entries=>setWidth(entries[0]!.contentRect.width));observer.observe(el);return()=>observer.disconnect();},[]);
  useEffect(()=>{let active=true;setPdf(null);setPage(1);setError('');setLoading(true);const task=getDocument({url});
    task.promise.then(doc=>{if(active)setPdf(doc);}).catch(e=>{if(active){setError(e.message||'Unable to load PDF. Use Download to open it on your device.');setLoading(false);}});
    return()=>{active=false;void task.destroy();};
  },[url]);
  useEffect(()=>{if(!pdf)return;let active=true;let render:ReturnType<Awaited<ReturnType<PDFDocumentProxy['getPage']>>['render']>|undefined;
    setLoading(true);setError('');setText('');
    pdf.getPage(page).then(async p=>{if(!active||!paper.current)return;const natural=p.getViewport({scale:1}),scale=Math.max(.2,Math.min(2,(width-32)/natural.width))*zoom;
      const viewport=p.getViewport({scale}),canvas=document.createElement('canvas'),ratio=Math.min(2,window.devicePixelRatio||1);
      canvas.width=Math.floor(viewport.width*ratio);canvas.height=Math.floor(viewport.height*ratio);canvas.style.width=viewport.width+'px';canvas.style.height=viewport.height+'px';canvas.setAttribute('aria-label','PDF page '+page);
      paper.current.replaceChildren(canvas);render=p.render({canvas,canvasContext:canvas.getContext('2d')!,viewport,transform:[ratio,0,0,ratio,0,0]});await render.promise;
      if(active){setLoading(false);const content=await p.getTextContent();if(active)setText(content.items.map(i=>'str' in i?i.str:'').join(' '));}
    }).catch(e=>{if(active&&e.name!=='RenderingCancelledException'){setError('Could not display this page. Try another page or download the PDF.');setLoading(false);}});
    return()=>{active=false;render?.cancel();};
  },[pdf,page,zoom,width]);
  return <div className="pdf-reader"><div className="pdf-toolbar"><button disabled={!pdf||page<=1} onClick={()=>setPage(p=>p-1)} aria-label="Previous page">←</button>
    <label>Page <select aria-label="PDF page" disabled={!pdf} value={page} onChange={e=>setPage(Number(e.target.value))}>{Array.from({length:pdf?.numPages??1},(_,i)=><option key={i} value={i+1}>{i+1}</option>)}</select> / {pdf?.numPages??'…'}</label>
    <button disabled={!pdf||page>=pdf.numPages} onClick={()=>setPage(p=>p+1)} aria-label="Next page">→</button>
    <button disabled={zoom<=.5} onClick={()=>setZoom(z=>Math.max(.5,z-.25))} aria-label="Zoom out">−</button><button onClick={()=>setZoom(1)}>Fit width</button><button disabled={zoom>=2} onClick={()=>setZoom(z=>Math.min(2,z+.25))} aria-label="Zoom in">＋</button>
  </div><div ref={host} className="pdf-scroll">{loading&&<p role="status">Loading page…</p>}{error&&<p role="alert">{error}</p>}<div ref={paper} className="pdf-paper"/><div className="sr-only">{text}</div></div></div>;
}
