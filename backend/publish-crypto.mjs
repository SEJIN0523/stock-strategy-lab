import { randomBytes,createCipheriv } from 'node:crypto';
import { gzipSync } from 'node:zlib';
export function sealBundle(bundle,keyText) {
  const key=Buffer.from(keyText,'base64url');if(key.length!==32)throw Error('Invalid encryption key');
  const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);
  const data=Buffer.concat([cipher.update(gzipSync(Buffer.from(JSON.stringify(bundle)))),cipher.final(),cipher.getAuthTag()]);
  return {schema:'daily.encrypted.v1',iv:iv.toString('base64'),data:data.toString('base64')};
}
