import {readdir} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
const files=[];
async function scan(dir){for(const item of await readdir(dir,{withFileTypes:true})){const path=dir==='.'?item.name:dir+'/'+item.name;if(item.isDirectory()){if(['backend','strategies'].includes(path)||path.startsWith('strategies/'))await scan(path);}else if(/\.test\.(js|mjs)$/.test(item.name))files.push(path);}}
await scan('.');const result=spawnSync(process.execPath,['--test',...files],{stdio:'inherit',windowsHide:true});process.exitCode=result.status??1;
