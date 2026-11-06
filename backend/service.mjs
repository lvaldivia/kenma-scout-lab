const fail = (status, message) => { throw Object.assign(Error(message), { status }); };
export const teams = [
  { id:'NEK', name:'Nekoma', city:'Tokio', motto:'Conectar.', animal:'Gatos', color:'#c52c3b' },
  { id:'KAR', name:'Karasuno', city:'Miyagi', motto:'Vuela.', animal:'Cuervos', color:'#ef873c' }
];

export function createService({ store, auth, mode='vulnerable', local=true }) {
  let currentMode=mode;
  // LOCAL: reproduce una política Allow */* cacheada por token durante 300 s.
  // AWS: API Gateway cachea de verdad el resultado del authorizer en lambda.mjs.
  const policyCache = new Map();
  return {
    get mode() { return currentMode; },
    async dispatch({ method, path, body={}, token='', gatewayUser }) {
      try {
        if (method==='GET' && path==='/config') return { status:200, body:{ name:'Kenma Scout', mode:currentMode, runtime:local?'local':'aws', auth:local?'JWT local (HS256)':'Amazon Cognito (RS256)', localControls:local, version:'1.0.0' } };
        if (method==='POST' && path==='/auth/login') {
          if (typeof body.username!=='string' || typeof body.password!=='string') fail(400,'Usuario y contraseña son obligatorios.');
          const user = await store.getUser(body.username);
          if (local) { if (!user || body.password!=='DemoVolley2026!') fail(401,'Usuario o contraseña incorrectos.'); }
          const accessToken = local ? auth.issue(user) : await auth.login(body.username, body.password);
          return { status:200, body:{ accessToken, expiresIn:3600 } };
        }
        const userId = gatewayUser ?? await auth.verify(token);
        const user = await store.getUser(userId); if (!user) fail(401,'Usuario no registrado en el laboratorio.');
        if (local && method==='POST' && path==='/lab/reset') {
          store.reset(); policyCache.clear(); return { status:200, body:{ message:'Datos y caché restaurados.', mode:currentMode } };
        }
        if (local && method==='POST' && path==='/lab/mode') {
          if (!['fixed','vulnerable'].includes(body.mode)) fail(400,'Modo inválido.');
          currentMode=body.mode; store.reset(); policyCache.clear(); return { status:200, body:{ mode:currentMode, message:'Modo actualizado. Datos y caché restaurados.' } };
        }
        // El authorizer decide antes de ejecutar la Lambda. El comodín en el modo
        // vulnerable permite que el GET previo autorice también un DELETE.
        if (local) {
          if (currentMode==='vulnerable') {
            const cached=policyCache.get(token);
            if (!cached || cached.expiresAt<=Date.now()) {
              if(policyCache.size>1000) policyCache.clear();
              policyCache.set(token,{expiresAt:Date.now()+300000,allow:method!=='DELETE'||user.role==='coach'});
            }
            // API Gateway también cachea Deny: un DELETE inicial bloquea GET.
            if(!policyCache.get(token).allow) fail(403,'Política Deny cacheada. Usa un token nuevo o restaura la caché.');
          } else if (method==='DELETE' && user.role!=='coach') fail(403,'Solo un coach puede borrar reportes.');
        }
        if (path==='/me' && method==='GET') return { status:200, body:user };
        if (path==='/me' && method==='PATCH') {
          let updated;
          if (currentMode==='vulnerable') {
            // VULNERABILIDAD 2: campos de autorización controlados por el cliente.
            updated={ ...user, ...body, id:user.id, username:user.username };
          } else {
            const allowed=['name','bio'];
            if(Object.keys(body).some(key=>!allowed.includes(key))) fail(400,'Solo puedes actualizar name y bio.');
            updated={...user,...body};
          }
          if (typeof updated.name!=='string' || updated.name.length<2 || updated.name.length>80 || typeof updated.bio!=='string' || updated.bio.length>280) fail(400,'Nombre: 2–80 caracteres. Biografía: máximo 280.');
          await store.putUser(updated); return { status:200, body:updated };
        }
        if (path==='/teams' && method==='GET') return { status:200, body:{ items:teams } };
        if (path==='/reports' && method==='GET') {
          const reports=(await store.listReports()).filter(r=>r.team===user.team);
          // La lista es siempre del equipo autenticado; BOLA se explota por ID.
          return { status:200, body:{ items:reports, total:reports.length } };
        }
        const match=path.match(/^\/reports\/([A-Z]{3}-\d{3})$/);
        if (match && ['GET','DELETE'].includes(method)) {
          const report=await store.getReport(match[1]); if(!report) fail(404,'Reporte no encontrado.');
          // FIX 1: la pertenencia al equipo se comprueba en CADA acceso al objeto.
          if(currentMode==='fixed' && report.team!==user.team) fail(403,'Este reporte pertenece a otro equipo.');
          if(method==='GET') return { status:200, body:report }; // VULNERABILIDAD 1: falta ownership en modo vulnerable.
          // FIX 3: defensa en profundidad. No depender solo del authorizer.
          if(currentMode==='fixed' && user.role!=='coach') fail(403,'Solo un coach puede borrar reportes.');
          await store.deleteReport(report.id); return { status:200, body:{ deleted:report.id } };
        }
        fail(404,'Ruta no encontrada.');
      } catch(error) {
        if(!error.status) console.error('Error interno de API:',error.name);
        return { status:error.status??500, body:{ error:error.status?error.message:'Error interno. Revisa los logs del servidor.' } };
      }
    }
  };
}
