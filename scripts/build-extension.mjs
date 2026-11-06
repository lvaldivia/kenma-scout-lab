import {mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {resolve,join} from 'node:path';

const version='2026.7';
const checksum='cb852b7b883290fcc1d21b13d80fa10f5b13a0f57335d710d2b1e5956ecb2a94';
const lib=resolve('extension/lib'); const build=resolve('extension/build');
await mkdir(lib,{recursive:true});
const api=join(lib,`montoya-api-${version}.jar`);
let bytes;
try {bytes=await readFile(api);} catch(error) {
  if(error.code!=='ENOENT')throw error;
  const response=await fetch(`https://repo.maven.apache.org/maven2/net/portswigger/burp/extensions/montoya-api/${version}/montoya-api-${version}.jar`);
  if(!response.ok)throw Error(`Montoya download: HTTP ${response.status}`);
  bytes=Buffer.from(await response.arrayBuffer());
}
if(createHash('sha256').update(bytes).digest('hex')!==checksum)throw Error('Checksum de Montoya incorrecto.');
await writeFile(api,bytes);
// Only remove the fixed build directory under this repository.
await rm(build,{recursive:true,force:true}); await mkdir(join(build,'classes'),{recursive:true});
const executable=name=>process.env.JAVA_HOME?join(process.env.JAVA_HOME,'bin',name):name;
function run(name,args){const r=spawnSync(executable(name),args,{stdio:'inherit'});if(r.error)throw r.error;if(r.status!==0)process.exit(r.status??1);}
run('javac',['--release','21','-encoding','UTF-8','-cp',api,'-d',join(build,'classes'),'extension/src/main/java/pe/nekoma/KenmaScout.java']);
run('jar',['--create','--file',join(build,'kenma-scout.jar'),'-C',join(build,'classes'),'.']);
console.log('Extensión: extension/build/kenma-scout.jar (API provided por Burp, no incluida).');
if(process.argv.includes('--test')){
  const cp=[api,join(build,'classes')].join(process.platform==='win32'?';':':');
  run('javac',['--release','21','-encoding','UTF-8','-cp',cp,'-d',join(build,'test-classes'),'extension/src/test/java/pe/nekoma/ExtensionTest.java']);
  run('java',['-Djava.awt.headless=true','-cp',[cp,join(build,'test-classes')].join(process.platform==='win32'?';':':'),'pe.nekoma.ExtensionTest']);
}
