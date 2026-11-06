import {readdir,readFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
for(const dir of ['backend','frontend','scripts','tests']){
  for(const file of await readdir(dir)){
    if(!/\.(mjs|js)$/.test(file))continue;
    const result=spawnSync(process.execPath,['--check',`${dir}/${file}`],{stdio:'inherit'});
    if(result.status)process.exit(result.status);
  }
}
JSON.parse(await readFile('docs/openapi.json','utf8'));
console.log('Sintaxis JavaScript y contrato JSON correctos.');
