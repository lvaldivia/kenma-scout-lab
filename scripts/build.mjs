import {cp,mkdir,rm} from 'node:fs/promises';
import {resolve} from 'node:path';
const target=resolve('dist');
// Únicamente el directorio de salida conocido dentro del proyecto.
if(target!==resolve(process.cwd(),'dist'))throw Error('Destino inválido.');
await rm(target,{recursive:true,force:true});await mkdir(target,{recursive:true});
await cp('frontend',target,{recursive:true});console.log('Frontend preparado en dist/ (sin CDN ni dependencias externas).');
