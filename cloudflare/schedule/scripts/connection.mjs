import {readFileSync,existsSync} from 'node:fs';
import {resolve} from 'node:path';
const root=resolve(import.meta.dirname,'..');
export function tokenForBegum(){
  if(process.env.BEGUM_CLOUDFLARE_API_TOKEN)return process.env.BEGUM_CLOUDFLARE_API_TOKEN;
  const tokenFile=resolve(root,'.private/cloudflare-token.txt');
  if(existsSync(tokenFile))return readFileSync(tokenFile,'utf8').trim();
  const profile=resolve(root,'.private/auth/.wrangler/config/default.toml');
  if(!existsSync(profile))throw new Error('Begüm’s dedicated Cloudflare sign-in is missing');
  const toml=readFileSync(profile,'utf8');
  const token=toml.match(/^oauth_token\s*=\s*"([^"]+)"/m)?.[1];
  const expiry=toml.match(/^expiration_time\s*=\s*"([^"]+)"/m)?.[1];
  if(!token||expiry&&Date.parse(expiry)<Date.now()+60000)throw new Error('Renew Begüm’s dedicated Cloudflare sign-in');
  return token;
}
