// Live contract checks. Changes only seeded lab users/reports; reset afterwards.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';
const out=JSON.parse(await readFile('.local/deployment.json','utf8'));
const {password}=JSON.parse(await readFile('.local/credentials.json','utf8'));
const base=out.CloudFrontApiUrl;
const reset=(action='seed')=>{const r=spawnSync(process.execPath,['scripts/aws.mjs',action],{stdio:'inherit',env:process.env});assert.equal(r.status,0);};
let assertions=0;
const equal=(a,b)=>{assert.equal(a,b);assertions++;};
async function request(path,{method='GET',token,body}={}){
  const response=await fetch(`${base}${path}`,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(30000)});
  const text=await response.text();let data;try{data=JSON.parse(text);}catch{throw Error(`HTTP ${response.status} no JSON en ${path}`);}
  if(process.env.AWS_TEST_VERBOSE==='1')console.log(`${method} ${path} -> ${response.status}${response.ok?'':` ${JSON.stringify(data)}`}`);
  equal(response.headers.get('x-cache')?.includes('Hit from cloudfront')??false,false);
  return {status:response.status,body:data};
}
async function login(username='kenma'){
  const result=await request('/auth/login',{method:'POST',body:{username,password}});equal(result.status,200);assert.ok(result.body.accessToken);return result.body.accessToken;
}
reset();
try{
  const page=await fetch(out.WebsiteUrl);equal(page.status,200);assert.match(await page.text(),/Kenma Scout/);
  const config=await request('/config');equal(config.status,200);equal(config.body.runtime,'aws');
  const mode=config.body.mode;
  equal((await request('/me')).status,401);
  equal((await request('/me',{token:'invalid.token.here'})).status,401);
  let token=await login();
  // Start cold: cached Deny must also affect the following GET in vulnerable mode.
  equal((await request('/reports/NEK-002',{method:'DELETE',token})).status,403);
  await delay(1500);
  equal((await request('/me',{token})).status,mode==='vulnerable'?403:200);
  // Do not invalidate policies during the sequence: asynchronous invalidation
  // could erase the freshly cached Deny between DELETE and GET.
  // A new Cognito token guarantees a cold entry for the Allow sequence.
  token=await login();
  const me=await request('/me',{token});equal(me.status,200);equal(me.body.team,'NEK');equal(me.body.role,'player');
  const reports=await request('/reports',{token});equal(reports.status,200);equal(reports.body.total,3);
  const cross=await request('/reports/KAR-003',{token});equal(cross.status,mode==='vulnerable'?200:403);
  if(mode==='vulnerable')assert.match(cross.body.play,/Señal secreta/);
  equal((await request('/reports/NEK-002',{method:'DELETE',token})).status,mode==='vulnerable'?200:403);
  equal((await request('/me',{method:'PATCH',token,body:{role:'coach',team:'KAR'}})).status,mode==='vulnerable'?200:400);
  const changed=await request('/me',{token});equal(changed.body.role,mode==='vulnerable'?'coach':'player');equal(changed.body.team,mode==='vulnerable'?'KAR':'NEK');
  equal((await request('/me',{method:'PATCH',token,body:{name:'Kenma Kozume',bio:'Prueba de contrato.'}})).status,200);
  if(mode==='fixed'){
    token=await login('kuroo');
    equal((await request('/reports/KAR-003',{method:'DELETE',token})).status,403);
    equal((await request('/reports/NEK-002',{method:'DELETE',token})).status,200);
  }
  console.log(`AWS ${mode}: ${assertions} aserciones correctas por CloudFront, Cognito y API Gateway.`);
}finally{reset();}
