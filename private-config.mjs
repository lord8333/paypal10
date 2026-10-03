import serverSettings from './config.server.mjs';
import {configuration} from './checkout-core.mjs';
const failure=message=>Object.assign(new Error(message),{status:503});
export function loadPrivateConfiguration({platform=process.env,read=()=>JSON.stringify(serverSettings)}={}){
 let settings;
 try{settings=JSON.parse(read());}catch{throw failure('Configuração do servidor inválida. Confira config.server.mjs no pacote do deploy.');}
 if(!settings||typeof settings!=='object'||Array.isArray(settings))throw failure('Configuração privada inválida.');
 if(typeof settings.clientId!=='string'||!settings.clientId.trim())throw failure('Preencha clientId em config.server.mjs.');
 if(typeof settings.clientSecret!=='string'||!settings.clientSecret.trim())throw failure('Preencha clientSecret localmente em config.server.mjs com um segredo novo. Não envie o segredo no chat.');
 // Variáveis automáticas da plataforma, não precisam ser cadastradas pelo usuário.
 let publicUrl=settings.publicUrl;
 if(!publicUrl){
  const host=platform.VERCEL_PROJECT_PRODUCTION_URL||platform.VERCEL_URL;
  if(!host||typeof host!=='string'||!host.endsWith('.vercel.app')||!/^[a-zA-Z0-9.-]+$/.test(host))throw failure('Não foi possível detectar o domínio Vercel. Preencha publicUrl no arquivo privado com sua origem HTTPS.');
  publicUrl='https://'+host;
 }
 if(platform.VERCEL_ENV==='preview'&&settings.environment==='live')throw failure('Live bloqueado em Preview. Use Production ou mude environment para sandbox no arquivo privado.');
 return configuration({PAYPAL_CLIENT_ID:settings.clientId,PAYPAL_CLIENT_SECRET:settings.clientSecret,PUBLIC_URL:publicUrl,PAYPAL_ENV:settings.environment,ALLOW_LIVE_PAYMENTS:settings.allowLivePayments===true?'true':'false',AMOUNT:settings.amount,CURRENCY:settings.currency});
}
