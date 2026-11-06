import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand, ScanCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';
import { DynamoStore } from './store.mjs';
import { cognitoAuth } from './auth.mjs';
import { createService } from './service.mjs';

const store=new DynamoStore(DynamoDBDocumentClient.from(new DynamoDBClient({})),{GetCommand,PutCommand,ScanCommand,DeleteCommand},process.env.TABLE_NAME);
const auth=cognitoAuth({region:process.env.AWS_REGION,userPoolId:process.env.USER_POOL_ID,clientId:process.env.USER_POOL_CLIENT_ID});
const mode=process.env.LAB_MODE??'fixed';
const service=createService({store,auth,mode,local:false});
const headers={'Content-Type':'application/json; charset=utf-8','Access-Control-Allow-Origin':process.env.ALLOWED_ORIGIN??'http://localhost:3000','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};

export async function handler(event) {
  try {
    let body=event.body?JSON.parse(event.isBase64Encoded?Buffer.from(event.body,'base64').toString():event.body):{};
    if(!body || Array.isArray(body) || typeof body!=='object') throw Error('invalid body');
    const path=event.path.replace(/^\/api/,'')||'/';
    const publicRoute=(event.httpMethod==='POST'&&path==='/auth/login')||(event.httpMethod==='GET'&&path==='/config');
    const gatewayUser=event.requestContext?.authorizer?.userId;
    if(!publicRoute && !gatewayUser) return {statusCode:401,headers,body:JSON.stringify({error:'Falta autorización de API Gateway.'})};
    const result=await service.dispatch({method:event.httpMethod,path,body,gatewayUser,token:''});
    return {statusCode:result.status,headers,body:JSON.stringify(result.body)};
  } catch {return {statusCode:400,headers,body:JSON.stringify({error:'Se esperaba un objeto JSON.'})};}
}

export async function authorizer(event) {
  const token=(event.authorizationToken??'').replace(/^Bearer /i,'');
  let id;
  try{id=await auth.verify(token);}catch{throw Error('Unauthorized');}
  const user=await store.getUser(id); if(!user) throw Error('Unauthorized');
  const method=event.methodArn.split('/')[2];
  const effect=method==='DELETE' && user.role!=='coach'?'Deny':'Allow';
  // VULNERABILIDAD 3: GET recibe Allow para TODAS las rutas y verbos. La caché
  // indexada solo por token reutiliza ese Allow para DELETE sin reinvocar aquí.
  const resource=mode==='vulnerable'?`${event.methodArn.split('/')[0]}/*/*`:event.methodArn;
  return {principalId:id,policyDocument:{Version:'2012-10-17',Statement:[{Action:'execute-api:Invoke',Effect:effect,Resource:resource}]},context:{userId:id}};
}
