// Credenciales mediante la cadena estándar del SDK (AWS_PROFILE), nunca en código.
import {createRequire} from 'node:module';
import {seedData} from '../backend/seed.mjs';
const require=createRequire(new URL('../backend/package.json',import.meta.url));
const {CloudFormationClient,DescribeStacksCommand}=require('@aws-sdk/client-cloudformation');
const {DynamoDBClient}=require('@aws-sdk/client-dynamodb');
const {DynamoDBDocumentClient,PutCommand}=require('@aws-sdk/lib-dynamodb');
const {CognitoIdentityProviderClient,AdminCreateUserCommand,AdminSetUserPasswordCommand}=require('@aws-sdk/client-cognito-identity-provider');
const stack=process.env.STACK_NAME??'kenma-scout-lab';
const password=process.env.DEMO_PASSWORD;
if(!password || password.length<12)throw Error('Configura DEMO_PASSWORD (12+ caracteres) antes de crear usuarios de AWS.');
const cloud=new CloudFormationClient({});
const result=await cloud.send(new DescribeStacksCommand({StackName:stack}));
const outputs=Object.fromEntries(result.Stacks[0].Outputs.map(o=>[o.OutputKey,o.OutputValue]));
const db=DynamoDBDocumentClient.from(new DynamoDBClient({}));
const cognito=new CognitoIdentityProviderClient({});
const data=seedData();
for(const user of data.users){
  try{await cognito.send(new AdminCreateUserCommand({UserPoolId:outputs.UserPoolId,Username:user.username,MessageAction:'SUPPRESS'}));}
  catch(error){if(error.name!=='UsernameExistsException')throw error;}
  await cognito.send(new AdminSetUserPasswordCommand({UserPoolId:outputs.UserPoolId,Username:user.username,Password:password,Permanent:true}));
  await db.send(new PutCommand({TableName:outputs.TableName,Item:{pk:`USER#${user.id}`,kind:'USER',data:user}}));
  console.log(`Perfil preparado: ${user.username}`);
}
for(const report of data.reports)await db.send(new PutCommand({TableName:outputs.TableName,Item:{pk:`REPORT#${report.id}`,kind:'REPORT',data:report}}));
console.log(`6 reportes listos. ApiBaseUrl: ${outputs.ApiBaseUrl}`);
