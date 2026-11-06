// Cross-platform deployment entry point. AWS CLI and SAM use the same profile.
import {spawnSync} from 'node:child_process';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
import {existsSync} from 'node:fs';
import {resolve} from 'node:path';
const action=process.argv[2]??'outputs';
const profile=process.env.AWS_PROFILE??'luisvaldivia';
const region=process.env.AWS_REGION??'us-east-1';
const stack=process.env.STACK_NAME??'kenma-scout-lab';
const mode=process.env.LAB_MODE??'vulnerable';
const env={...process.env,AWS_PROFILE:profile,AWS_REGION:region,STACK_NAME:stack,SAM_CLI_TELEMETRY:'0'};
const localSam=resolve('.tools/sam-env',process.platform==='win32'?'Scripts/sam.exe':'bin/sam');
const sam=process.env.SAM_BIN??(existsSync(localSam)?localSam:'sam');
function run(cmd,args,{json=false,extraEnv={}}={}) {
  const r=spawnSync(cmd,args,{env:{...env,...extraEnv},encoding:'utf8',stdio:json?['ignore','pipe','inherit']:'inherit',shell:false});
  if(r.error)throw r.error;if(r.status!==0)throw Error(`${cmd} terminó con código ${r.status}`);
  return json?JSON.parse(r.stdout):undefined;
}
function aws(args,json=false){return run('aws',[...args,'--profile',profile,'--region',region,...(json?['--output','json']:[])],{json});}
function outputs(){const result=aws(['cloudformation','describe-stacks','--stack-name',stack],true);return Object.fromEntries(result.Stacks[0].Outputs.map(o=>[o.OutputKey,o.OutputValue]));}
function publishFrontend(out){
  aws(['s3','sync','dist/',`s3://${out.FrontendBucketName}/`,'--delete','--cache-control','no-cache']);
  aws(['cloudfront','create-invalidation','--distribution-id',out.DistributionId,'--paths','/*']);
}
async function seed(){
  await mkdir('.local',{recursive:true});
  let password=process.env.DEMO_PASSWORD;
  if(!password){try{password=JSON.parse(await readFile('.local/credentials.json','utf8')).password;}catch(error){if(error.code!=='ENOENT')throw error;}}
  password??=`Volley!${randomBytes(18).toString('base64url')}9aA`;
  await writeFile('.local/credentials.json',JSON.stringify({users:['kenma','kuroo','hinata','ukai'],password},null,2),{mode:0o600});
  run(process.execPath,['scripts/seed-aws.mjs'],{extraEnv:{DEMO_PASSWORD:password}});
}
if(action==='deploy'){
  if(!['fixed','vulnerable'].includes(mode))throw Error('LAB_MODE debe ser fixed o vulnerable.');
  run(process.execPath,['scripts/build.mjs']);
  run(sam,['validate','--lint','--template-file','template.yaml','--profile',profile,'--region',region]);
  // SAM packages backend/ including dependencies installed with npm ci --prefix backend.
  run(sam,['deploy','--template-file','template.yaml','--stack-name',stack,'--resolve-s3','--capabilities','CAPABILITY_IAM','--profile',profile,'--region',region,'--no-confirm-changeset','--no-fail-on-empty-changeset','--parameter-overrides',`LabMode=${mode}`,`AllowedOrigin=${process.env.ALLOWED_ORIGIN??'http://localhost:3000'}`]);
  const out=outputs();
  publishFrontend(out);
  await mkdir('.local',{recursive:true});await writeFile('.local/deployment.json',JSON.stringify(out,null,2));
  await seed();
  aws(['apigateway','flush-stage-authorizers-cache','--rest-api-id',out.ApiId,'--stage-name','demo']);
  console.log(`Frontend: ${out.WebsiteUrl}\nAPI: ${out.CloudFrontApiUrl}\nAccesos locales: .local/credentials.json`);
}else if(action==='frontend'){
  run(process.execPath,['scripts/build.mjs']);
  const out=outputs();publishFrontend(out);console.log(`Frontend: ${out.WebsiteUrl}`);
}else if(action==='seed'){
  await seed();
}else if(action==='reset'){
  await seed();const out=outputs();aws(['apigateway','flush-stage-authorizers-cache','--rest-api-id',out.ApiId,'--stage-name','demo']);
}else if(action==='flush-cache'){
  const out=outputs();aws(['apigateway','flush-stage-authorizers-cache','--rest-api-id',out.ApiId,'--stage-name','demo']);
}else if(action==='delete'){
  // Bucket name comes from this exact stack; never accept an arbitrary bucket argument.
  const out=outputs();aws(['s3','rm',`s3://${out.FrontendBucketName}/`,'--recursive']);
  run(sam,['delete','--stack-name',stack,'--profile',profile,'--region',region,'--no-prompts']);
}else if(action==='outputs')console.log(outputs());
else throw Error('Acción: deploy, frontend, outputs, seed, reset, flush-cache o delete.');
