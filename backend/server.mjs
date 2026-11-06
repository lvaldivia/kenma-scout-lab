import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, sep, extname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { MemoryStore } from './store.mjs';
import { localAuth } from './auth.mjs';
import { createService } from './service.mjs';

export function createServer(options={}) {
  const service=createService({ store:new MemoryStore(), auth:localAuth(process.env.LOCAL_JWT_SECRET), mode:options.mode??process.env.LAB_MODE??'vulnerable' });
  const root=resolve('frontend');
  const mime={ '.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml' };
  return http.createServer(async (request,response)=>{
    response.setHeader('X-Content-Type-Options','nosniff');
    response.setHeader('Cache-Control','no-store');
    try {
      const url=new URL(request.url,'http://localhost');
      if(url.pathname.startsWith('/api/')) {
        let raw='';
        for await (const chunk of request) { raw+=chunk; if(Buffer.byteLength(raw)>16384) { response.writeHead(413,{'Content-Type':'application/json'}); response.end(JSON.stringify({error:'Cuerpo demasiado grande.'})); return; } }
        let body={};
        try { if(raw) body=JSON.parse(raw); if(!body || Array.isArray(body) || typeof body!=='object') throw Error(); }
        catch { response.writeHead(400,{'Content-Type':'application/json'}); response.end(JSON.stringify({error:'Se esperaba un objeto JSON.'})); return; }
        const result=await service.dispatch({ method:request.method, path:url.pathname.slice(4),body,token:(request.headers.authorization??'').replace(/^Bearer /i,'') });
        response.writeHead(result.status,{'Content-Type':'application/json; charset=utf-8'}); response.end(JSON.stringify(result.body)); return;
      }
      if(!['GET','HEAD'].includes(request.method)) {response.writeHead(405);response.end();return;}
      const file=resolve(root,`.${decodeURIComponent(url.pathname==='/'?'/index.html':url.pathname)}`);
      if(!file.startsWith(root+sep)) {response.writeHead(403);response.end();return;}
      const content=await readFile(file); response.writeHead(200,{'Content-Type':mime[extname(file)]??'application/octet-stream'}); response.end(request.method==='HEAD'?undefined:content);
    } catch(error) {response.writeHead(error.code==='ENOENT'?404:500);response.end('Recurso no disponible.');}
  });
}
if(process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  const host=process.env.HOST??'127.0.0.1'; const port=Number(process.env.PORT??3000);
  createServer().listen(port,host,()=>console.log(`\n  KENMA SCOUT · Scouting API\n  http://${host}:${port}\n  Modo: ${process.env.LAB_MODE??'vulnerable'} · reinicio = datos originales\n`));
}
