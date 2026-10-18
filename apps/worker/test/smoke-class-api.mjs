// Disposable localhost QA only; never sends test data to the production worker.
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const base='http://127.0.0.1:8788';
const login=await fetch(base+'/api/v1/auth/admin/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username:'preview',password:'LocalPreviewOnly2026!'})}).then(r=>r.json());
assert.equal(login.success,true);
const headers={authorization:'Bearer '+login.data.sessionToken,'x-csrf-token':login.data.csrfToken};
const mp4=readFileSync('../web/public/assets/interactiq-phone-showcase.mp4');
const form=new FormData();form.set('file',new File([mp4],'demo.mp4',{type:'video/mp4'}));
const uploaded=await fetch(base+'/api/v1/media/files',{method:'POST',headers,body:form}).then(r=>r.json());assert.equal(uploaded.success,true);
const video=await fetch(base+uploaded.data.url);assert.equal(video.headers.get('content-type'),'video/mp4');assert.equal((await video.arrayBuffer()).byteLength,mp4.length);
const library=await fetch(base+'/api/v1/study-library',{method:'POST',headers:{...headers,'content-type':'application/json'},body:JSON.stringify({section:'tips',kind:'file',title:'Animated cover QA',url:'https://www.khanacademy.org/',cover:uploaded.data.url})}).then(r=>r.json());assert.equal(library.success,true);
const item=library.data.find(e=>e.title==='Animated cover QA');
const published=await fetch(base+'/api/v1/study-library/publish',{method:'POST',headers:{...headers,'content-type':'application/json'},body:JSON.stringify({id:item.id,published:true})}).then(r=>r.json());assert.equal(published.success,true);
const anonymous=await fetch(base+'/api/v1/student-roster?attempt=unknown&class=5PKA1');assert.equal(anonymous.status,401);
console.log('MP4 upload, media playback response, animated cover save/publication and unauthenticated roster rejection passed.');
console.log('Local animated-cover preview: http://127.0.0.1:5176/#/study/'+item.shareCode);
