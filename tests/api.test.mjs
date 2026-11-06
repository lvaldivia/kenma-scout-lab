import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from '../backend/server.mjs';
import {localAuth} from '../backend/auth.mjs';

async function lab(t,mode='vulnerable') {
  let base=process.env.LAB_TEST_URL?.replace(/\/$/,'');
  if(!base){
    const server=createServer({mode});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    t.after(()=>new Promise(resolve=>server.close(resolve)));
    base=`http://127.0.0.1:${server.address().port}`;
  }
  async function request(path,{method='GET',token,body}={}){
    const r=await fetch(`${base}/api${path}`,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},...(body?{body:JSON.stringify(body)}:{})});
    return {status:r.status,body:await r.json()};
  }
  async function login(username='kenma'){const r=await request('/auth/login',{method:'POST',body:{username,password:'DemoVolley2026!'}});assert.equal(r.status,200);return r.body.accessToken;}
  // Optional external local lab exercises the same suite through Docker/Nginx.
  // Never use this with AWS: its reset endpoints intentionally do not exist.
  if(process.env.LAB_TEST_URL){
    const token=await login();const result=await request('/lab/mode',{method:'POST',token,body:{mode}});
    assert.equal(result.status,200,'LAB_TEST_URL debe apuntar al laboratorio LOCAL, no a AWS.');
  }
  return {base,request,login};
}
test('el frontend y la configuración se sirven sin servicios externos',async t=>{
  const {base,request}=await lab(t);const page=await fetch(base);assert.equal(page.status,200);assert.match(await page.text(),/Kenma Scout/);
  assert.equal((await request('/config')).body.runtime,'local');
  assert.equal((await request('/reports')).status,401);
  assert.equal((await request('/auth/login',{method:'POST',body:{username:'kenma',password:'wrong'}})).status,401);
});
test('el JWT rechaza alteraciones y firmas incorrectas',async()=>{
  const a=localAuth('secret-a');const b=localAuth('secret-b');const token=a.issue({id:'kenma'});
  assert.equal(await a.verify(token),'kenma');await assert.rejects(b.verify(token),{status:401});
  assert.notEqual(a.issue({id:'kenma'}),token,'Cada login debe tener una clave de caché distinta.');
  const parts=token.split('.');parts[1]=Buffer.from(JSON.stringify({sub:'ukai',exp:9999999999})).toString('base64url');
  await assert.rejects(a.verify(parts.join('.')),{status:401});
});
test('BOLA: lista de Nekoma, lectura ajena vulnerable y bloqueo corregido',async t=>{
  const {request,login}=await lab(t);const token=await login();const list=await request('/reports',{token});
  assert.equal(list.body.total,3);assert.ok(list.body.items.every(r=>r.team==='NEK'));
  const stolen=await request('/reports/KAR-003',{token});assert.equal(stolen.status,200);assert.match(stolen.body.play,/Señal secreta/);
  await request('/lab/mode',{method:'POST',token,body:{mode:'fixed'}});
  assert.equal((await request('/reports/KAR-003',{token})).status,403);
  assert.equal((await request('/reports/NEK-001',{token})).status,200);
});
test('mass assignment: vulnerable cambia rol; fix rechaza role y team',async t=>{
  const {request,login}=await lab(t);const token=await login();
  const elevated=await request('/me',{method:'PATCH',token,body:{role:'coach'}});assert.equal(elevated.body.role,'coach');
  await request('/lab/mode',{method:'POST',token,body:{mode:'fixed'}});
  assert.equal((await request('/me',{method:'PATCH',token,body:{role:'coach'}})).status,400);
  assert.equal((await request('/me',{method:'PATCH',token,body:{team:'KAR'}})).status,400);
  const updated=await request('/me',{method:'PATCH',token,body:{name:'Kenma Scout',bio:'Nueva lectura.'}});
  assert.equal(updated.status,200);assert.equal(updated.body.role,'player');assert.equal(updated.body.team,'NEK');
});
test('caché: DELETE inicial denegado, GET prima wildcard y DELETE pasa',async t=>{
  const {request,login}=await lab(t);const token=await login();
  assert.equal((await request('/reports/NEK-002',{method:'DELETE',token})).status,403);
  assert.equal((await request('/reports',{token})).status,403);
  await request('/lab/reset',{method:'POST',token,body:{}});
  assert.equal((await request('/reports',{token})).status,200);
  assert.equal((await request('/reports/NEK-002',{method:'DELETE',token})).status,200);
  assert.equal((await request('/reports/NEK-002',{token})).status,404);
  await request('/lab/reset',{method:'POST',token,body:{}});
  assert.equal((await request('/reports/NEK-002',{method:'DELETE',token})).status,403);
  assert.equal((await request('/reports/NEK-002',{token})).status,403);
  await request('/lab/reset',{method:'POST',token,body:{}});
  assert.equal((await request('/reports/NEK-002',{token})).status,200);
});
test('fix: ningún GET autoriza DELETE y coach solo borra en su equipo',async t=>{
  const {request,login}=await lab(t,'fixed');const token=await login();
  await request('/reports',{token});assert.equal((await request('/reports/NEK-002',{method:'DELETE',token})).status,403);
  const coach=await login('kuroo');assert.equal((await request('/reports/KAR-003',{method:'DELETE',token:coach})).status,403);
  assert.equal((await request('/reports/NEK-002',{method:'DELETE',token:coach})).status,200);
});
test('datos malformados, rutas inexistentes y reset reproducible',async t=>{
  const {request,login,base}=await lab(t);const token=await login();
  const malformed=await fetch(`${base}/api/me`,{method:'PATCH',headers:{Authorization:`Bearer ${token}`},body:'{no'});assert.equal(malformed.status,400);
  assert.equal((await request('/reports/NEK-999',{token})).status,404);
  assert.equal((await request('/lab/mode',{method:'POST',token,body:{mode:'oops'}})).status,400);
  await request('/me',{method:'PATCH',token,body:{role:'coach'}});
  await request('/lab/reset',{method:'POST',token,body:{}});
  assert.equal((await request('/me',{token})).body.role,'player');
});
