/** LaFix marketplace API for Cloudflare Workers + D1.
 * No unauthenticated admin routes, no client-controlled prices, no fake checkout success.
 * Live use REQUIRES configured email provider, database migration, verified Stripe webhook and admin Access policy.
 */
const H = { 'Content-Type':'application/json; charset=utf-8', 'Cache-Control':'no-store', 'X-Content-Type-Options':'nosniff' };
const allowedStatuses = new Set(['PENDING','APPROVED','SUSPENDED']);
const id = () => crypto.randomUUID();
const now = () => Math.floor(Date.now()/1000);
const validEmail = s => typeof s==='string' && /^[^\s@]{1,64}@[^\s@]{1,200}\.[^\s@]{2,20}$/.test(s.trim());
const emailOf = s => String(s || '').trim().toLowerCase();
const validText = (s,min,max) => typeof s==='string' && s.trim().length>=min && s.trim().length<=max;
const out = (body, status=200, headers={}) => Response.json(body, {status, headers:{...H,...headers}});
const fail = (msg,status=400) => out({error:msg},status);
async function hash(s) { const d=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s));return [...new Uint8Array(d)].map(b=>b.toString(16).padStart(2,'0')).join(''); }
async function hmacHex(secret,payload) {const k=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);return [...new Uint8Array(await crypto.subtle.sign('HMAC',k,new TextEncoder().encode(payload)))].map(b=>b.toString(16).padStart(2,'0')).join('');}
function same(a,b) {if(a.length!==b.length)return false;let v=0;for(let i=0;i<a.length;i++)v|=a.charCodeAt(i)^b.charCodeAt(i);return v===0;}
function cookie(req,name) { const part=(req.headers.get('Cookie')||'').split(';').map(x=>x.trim()).find(x=>x.startsWith(name+'='));return part?part.slice(name.length+1):null; }
function replyCookie(token,maxAge=604800){return `lafix_session=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;}
async function body(req){ const length=Number(req.headers.get('content-length')||'0');if(length>16384)throw new Error('Cerere prea mare');const data=await req.text();if(data.length>16384)throw new Error('Cerere prea mare');try{return JSON.parse(data)}catch{throw new Error('JSON invalid')}}
function originOK(req){const o=req.headers.get('Origin');return o===new URL(req.url).origin;}
async function userFrom(req,env){const token=cookie(req,'lafix_session');if(!token||token.length>128)return null;const digest=await hash(token);return env.DB.prepare('SELECT u.id,u.email,u.display_name,u.is_admin,u.disabled_at FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>?').bind(digest,now()).first();}
async function requireUser(req,env,admin=false){const u=await userFrom(req,env);if(!u||u.disabled_at)return {error:fail('Autentificare necesară',401)};if(admin&&!u.is_admin)return {error:fail('Acces interzis',403)};return {user:u};}
async function audit(db,u,action,type,target,detail=''){await db.prepare('INSERT INTO audit_log(id,actor_id,action,target_type,target_id,detail) VALUES(?,?,?,?,?,?)').bind(id(),u?.id||null,action,type,target,detail).run();}
async function throttle(db,key,max,interval){const t=now(),r=await db.prepare('SELECT window_start,attempts FROM rate_limits WHERE rate_key=?').bind(key).first();if(r && t-r.window_start<interval && r.attempts>=max)return false;await db.prepare(`INSERT INTO rate_limits(rate_key,window_start,attempts) VALUES(?,?,1) ON CONFLICT(rate_key) DO UPDATE SET window_start=CASE WHEN ?-window_start>=? THEN ? ELSE window_start END,attempts=CASE WHEN ?-window_start>=? THEN 1 ELSE attempts+1 END`).bind(key,t,t,interval,t,t,interval).run();return true;}
async function sendCode(env,email,code){const res=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:`Bearer ${env.RESEND_API_KEY}`,'Content-Type':'application/json'},body:JSON.stringify({from:env.AUTH_FROM_EMAIL,to:[email],subject:'Codul tău de autentificare LaFix',text:`Codul tău LaFix este ${code}. Expiră în 10 minute. Dacă nu l-ai cerut, ignoră acest mesaj.`})});if(!res.ok)throw Error('Livrarea codului a eșuat');}
async function authRoutes(req,env,path){
 if(path==='/api/auth/start'&&req.method==='POST'){
  if(!env.RESEND_API_KEY||!env.AUTH_FROM_EMAIL||!env.AUTH_PEPPER)return fail('Autentificarea nu este încă configurată',503);
  const b=await body(req),email=emailOf(b.email);if(!validEmail(email))return fail('Adresă e-mail invalidă');
  const ip=(req.headers.get('CF-Connecting-IP')||'unknown').slice(0,100);
  if(!(await throttle(env.DB,'otp-ip:'+await hash(ip),15,3600))||!(await throttle(env.DB,'otp-email:'+await hash(email),4,3600)))return fail('Prea multe încercări. Încearcă mai târziu.',429);
  const code=String(crypto.getRandomValues(new Uint32Array(1))[0]%100000000).padStart(8,'0');
  await env.DB.prepare('INSERT INTO login_codes(email,code_hash,expires_at,attempts,created_at) VALUES(?,?,?,?,?) ON CONFLICT(email) DO UPDATE SET code_hash=excluded.code_hash,expires_at=excluded.expires_at,attempts=0,created_at=excluded.created_at').bind(email,await hash(`${email}:${code}:${env.AUTH_PEPPER}`),now()+600,0,now()).run();
  try{await sendCode(env,email,code)}catch{await env.DB.prepare('DELETE FROM login_codes WHERE email=?').bind(email).run();return fail('Nu putem expedia codul acum',503)}
  return out({message:'Am trimis un cod de autentificare prin e-mail.'});
 }
 if(path==='/api/auth/verify'&&req.method==='POST'){
  if(!env.AUTH_PEPPER)return fail('Autentificarea nu este configurată',503);
  const b=await body(req),email=emailOf(b.email),code=String(b.code||'');
  if(!validEmail(email)||!/^\d{8}$/.test(code))return fail('Cod invalid');
  const row=await env.DB.prepare('SELECT * FROM login_codes WHERE email=?').bind(email).first();
  if(!row||row.expires_at<now()||row.attempts>=5)return fail('Cod expirat sau invalid',401);
  await env.DB.prepare('UPDATE login_codes SET attempts=attempts+1 WHERE email=?').bind(email).run();
  if(!same(row.code_hash,await hash(`${email}:${code}:${env.AUTH_PEPPER}`)))return fail('Cod expirat sau invalid',401);
  await env.DB.prepare('DELETE FROM login_codes WHERE email=?').bind(email).run();
  let u=await env.DB.prepare('SELECT id,disabled_at FROM users WHERE email=?').bind(email).first();
  if(!u){const uid=id();await env.DB.prepare('INSERT OR IGNORE INTO users(id,email,display_name) VALUES(?,?,?)').bind(uid,email,email.split('@')[0]).run();u=await env.DB.prepare('SELECT id,disabled_at FROM users WHERE email=?').bind(email).first()}
  if(!u||u.disabled_at)return fail('Cont indisponibil',403);
  const bytes=crypto.getRandomValues(new Uint8Array(32));const token=[...bytes].map(b=>b.toString(16).padStart(2,'0')).join('');
  await env.DB.prepare('INSERT INTO sessions(token_hash,user_id,expires_at,created_at) VALUES(?,?,?,?)').bind(await hash(token),u.id,now()+604800,now()).run();
  return out({ok:true},200,{'Set-Cookie':replyCookie(token)});
 }
 if(path==='/api/auth/logout'&&req.method==='POST'){
  const token=cookie(req,'lafix_session');if(token)await env.DB.prepare('DELETE FROM sessions WHERE token_hash=?').bind(await hash(token)).run();return out({ok:true},200,{'Set-Cookie':replyCookie('',0)});
 }
 return null;
}
async function profile(env,u){const provider=await env.DB.prepare('SELECT * FROM providers WHERE user_id=?').bind(u.id).first();let billing=null;if(provider){billing=await env.DB.prepare('SELECT plan,status FROM billing_subscriptions WHERE provider_id=?').bind(provider.id).first();}
 return {id:u.id,email:u.email,name:u.display_name,isAdmin:!!u.is_admin,provider:provider&&{id:provider.id,businessName:provider.business_name,status:provider.status,description:provider.description},billing:billing||{plan:'FREE',status:'INACTIVE'}};}
async function catalog(env){const c=await env.DB.prepare('SELECT slug,name FROM categories WHERE active=1 ORDER BY name').all();return out({categories:c.results||[],coverage:'ROMANIA',paymentsForWorks:false});}
async function providerRoutes(req,env,path,u){
 if(path==='/api/provider/profile'&&req.method==='POST'){
  const b=await body(req);if(!validText(b.businessName,2,120)||!validText(b.phone,8,25)||!validText(b.description||'',0,700))return fail('Profil prestator invalid');
  const categories=[...new Set(Array.isArray(b.categories)?b.categories:[])].filter(x=>typeof x==='string');
  const areas=[...new Set(Array.isArray(b.counties)?b.counties:[])].filter(x=>validText(x,2,60));
  if(!categories.length||categories.length>8||!areas.length||areas.length>42)return fail('Selectează categorii și județe valide');
  const valid=await env.DB.prepare(`SELECT slug FROM categories WHERE active=1`).all();const validSlugs=new Set((valid.results||[]).map(x=>x.slug));if(categories.some(c=>!validSlugs.has(c)))return fail('Categorie indisponibilă');
  const prev=await env.DB.prepare('SELECT id FROM providers WHERE user_id=?').bind(u.id).first(),pid=prev?.id||id();
  const stmts=[env.DB.prepare(`INSERT INTO providers(id,user_id,business_name,phone,description,status) VALUES(?,?,?,?,?,'PENDING') ON CONFLICT(user_id) DO UPDATE SET business_name=excluded.business_name,phone=excluded.phone,description=excluded.description,status='PENDING',reviewed_at=NULL`).bind(pid,u.id,b.businessName.trim(),b.phone.trim(),(b.description||'').trim()),env.DB.prepare('DELETE FROM provider_categories WHERE provider_id=?').bind(pid),env.DB.prepare('DELETE FROM provider_areas WHERE provider_id=?').bind(pid)];
  for(const c of categories)stmts.push(env.DB.prepare('INSERT INTO provider_categories(provider_id,category_slug) VALUES(?,?)').bind(pid,c));
  for(const a of areas)stmts.push(env.DB.prepare('INSERT INTO provider_areas(provider_id,county) VALUES(?,?)').bind(pid,a.trim()));
  await env.DB.batch(stmts);return out({id:pid,status:'PENDING'});
 }
 if(path==='/api/provider/invitations'&&req.method==='GET'){
  const p=await env.DB.prepare('SELECT * FROM providers WHERE user_id=?').bind(u.id).first();if(!p||p.status!=='APPROVED')return out({invitations:[]});
  const r=await env.DB.prepare(`SELECT i.id invitation_id,r.id request_id,r.category_slug,r.county,r.locality,r.description,r.status request_status,
  o.id offer_id,o.amount_minor,o.status offer_status FROM invitations i JOIN requests r ON r.id=i.request_id LEFT JOIN offers o ON o.invitation_id=i.id
  WHERE i.provider_id=? ORDER BY i.created_at DESC LIMIT 100`).bind(p.id).all();return out({invitations:r.results||[]});
 }
 if(path==='/api/provider/offers'&&req.method==='POST'){
  const b=await body(req);const amount=Number(b.amountMinor);if(typeof b.invitationId!=='string'||!Number.isSafeInteger(amount)||amount<100||amount>1000000000||!validText(b.message,8,1500))return fail('Ofertă invalidă');
  const p=await env.DB.prepare('SELECT * FROM providers WHERE user_id=?').bind(u.id).first();if(!p||p.status!=='APPROVED')return fail('Prestator neaprobat',403);
  const inv=await env.DB.prepare(`SELECT i.id,r.status FROM invitations i JOIN requests r ON r.id=i.request_id WHERE i.id=? AND i.provider_id=?`).bind(b.invitationId,p.id).first();
  if(!inv||!['OPEN','MATCHED'].includes(inv.status))return fail('Invitație indisponibilă',409);
  try{const oid=id();await env.DB.prepare(`INSERT INTO offers(id,invitation_id,amount_minor,message) VALUES(?,?,?,?)`).bind(oid,inv.id,amount,b.message.trim()).run();return out({id:oid},201)}catch{return fail('Există deja o ofertă pentru această invitație',409)}
 }
 return null;
}
async function requestRoutes(req,env,path,u){
 if(path==='/api/requests'&&req.method==='POST'){
  const b=await body(req),budget=b.budgetMinor===null||b.budgetMinor===undefined?null:Number(b.budgetMinor);
  if(!validText(b.county,2,60)||!validText(b.locality,2,100)||!validText(b.description,20,3000)||typeof b.category!=='string'||(budget!==null&&(!Number.isSafeInteger(budget)||budget<=0||budget>1000000000)))return fail('Verifică datele solicitării');
  const cat=await env.DB.prepare('SELECT slug FROM categories WHERE slug=? AND active=1').bind(b.category).first();if(!cat)return fail('Categorie invalidă');
  if(!(await throttle(env.DB,'request:'+u.id,10,3600)))return fail('Prea multe cereri',429);
  const rid=id();await env.DB.prepare('INSERT INTO requests(id,customer_id,category_slug,county,locality,description,budget_minor) VALUES(?,?,?,?,?,?,?)').bind(rid,u.id,b.category,b.county.trim(),b.locality.trim(),b.description.trim(),budget).run();return out({id:rid,status:'OPEN'},201);
 }
 if(path==='/api/requests'&&req.method==='GET'){
  const r=await env.DB.prepare('SELECT id,category_slug,county,locality,description,status,created_at FROM requests WHERE customer_id=? ORDER BY created_at DESC LIMIT 100').bind(u.id).all();
  const offers=await env.DB.prepare(`SELECT o.id,o.amount_minor,o.message,o.status,i.request_id FROM offers o JOIN invitations i ON i.id=o.invitation_id JOIN requests r ON r.id=i.request_id WHERE r.customer_id=? ORDER BY o.created_at DESC LIMIT 100`).bind(u.id).all();
  const jobs=await env.DB.prepare('SELECT id,request_id,price_minor,status FROM jobs WHERE customer_id=? ORDER BY created_at DESC LIMIT 100').bind(u.id).all();return out({requests:r.results||[],offers:offers.results||[],jobs:jobs.results||[]});
 }
 let m=path.match(/^\/api\/requests\/([^/]+)\/accept$/);
 if(m&&req.method==='POST'){
  const b=await body(req);if(typeof b.offerId!=='string')return fail('Ofertă invalidă');
  const offer=await env.DB.prepare(`SELECT o.id,o.amount_minor,o.status,i.request_id,i.provider_id,p.status provider_status,r.customer_id,r.status request_status FROM offers o JOIN invitations i ON i.id=o.invitation_id JOIN providers p ON p.id=i.provider_id JOIN requests r ON r.id=i.request_id WHERE o.id=? AND r.id=?`).bind(b.offerId,m[1]).first();
  if(!offer||offer.customer_id!==u.id)return fail('Ofertă indisponibilă',404);
  if(offer.status!=='SENT'||offer.provider_status!=='APPROVED'||!['OPEN','MATCHED'].includes(offer.request_status))return fail('Oferta nu mai poate fi acceptată',409);
  const jid=id();const changes=await env.DB.batch([
   env.DB.prepare(`UPDATE requests SET status='ASSIGNED',accepted_offer_id=? WHERE id=? AND customer_id=? AND status IN ('OPEN','MATCHED') AND accepted_offer_id IS NULL`).bind(offer.id,m[1],u.id),
   env.DB.prepare(`INSERT INTO jobs(id,request_id,offer_id,customer_id,provider_id,price_minor)
     SELECT ?,r.id,?,r.customer_id,?,? FROM requests r WHERE r.id=? AND r.accepted_offer_id=?
     ON CONFLICT(request_id) DO NOTHING`).bind(jid,offer.id,offer.provider_id,offer.amount_minor,m[1],offer.id),
   env.DB.prepare(`UPDATE offers SET status=CASE WHEN id=? THEN 'ACCEPTED' ELSE 'REJECTED' END WHERE invitation_id IN (SELECT id FROM invitations WHERE request_id=?) AND status='SENT' AND EXISTS (SELECT 1 FROM requests WHERE id=? AND accepted_offer_id=?)`).bind(offer.id,m[1],m[1],offer.id)
  ]);
  if(!changes[0].meta?.changes)return fail('Oferta a fost acceptată deja ori cererea a fost închisă',409);
  return out({jobId:jid,status:'ASSIGNED'});
 }
 m=path.match(/^\/api\/jobs\/([^/]+)\/status$/);
 if(m&&req.method==='POST'){
  const b=await body(req);const job=await env.DB.prepare('SELECT * FROM jobs WHERE id=?').bind(m[1]).first();if(!job)return fail('Lucrare inexistentă',404);
  const newStatus=String(b.status||'');const valid=(job.provider_id===(await env.DB.prepare('SELECT id FROM providers WHERE user_id=?').bind(u.id).first())?.id && job.status==='ASSIGNED'&&newStatus==='IN_PROGRESS') || (job.customer_id===u.id&&job.status==='IN_PROGRESS'&&newStatus==='COMPLETED');
  if(!valid)return fail('Tranziție sau permisiune invalidă',409);
  const res=await env.DB.batch([env.DB.prepare('UPDATE jobs SET status=?,completed_at=CASE WHEN ?=\'COMPLETED\' THEN datetime(\'now\') ELSE completed_at END WHERE id=? AND status=?').bind(newStatus,newStatus,job.id,job.status),env.DB.prepare('UPDATE requests SET status=? WHERE id=? AND status=?').bind(newStatus,job.request_id,job.status)]);
  if(!res[0].meta?.changes)return fail('Stare schimbată între timp',409);return out({status:newStatus});
 }
 m=path.match(/^\/api\/jobs\/([^/]+)\/review$/);
 if(m&&req.method==='POST'){
  const b=await body(req),rating=Number(b.rating),job=await env.DB.prepare('SELECT * FROM jobs WHERE id=?').bind(m[1]).first();
  if(!job||job.customer_id!==u.id)return fail('Lucrare negăsită',404);if(job.status!=='COMPLETED'||!Number.isInteger(rating)||rating<1||rating>5||!validText(b.comment||'',0,600))return fail('Recenzia nu este permisă');
  try{await env.DB.prepare('INSERT INTO reviews(id,job_id,customer_id,rating,comment) VALUES(?,?,?,?,?)').bind(id(),job.id,u.id,rating,(b.comment||'').trim()).run();return out({ok:true},201)}catch{return fail('Ai evaluat deja această lucrare',409)}
 }
 if(path==='/api/support'&&req.method==='POST'){
  const b=await body(req);if(!validText(b.message,10,1200))return fail('Mesaj invalid');const reqId=typeof b.requestId==='string'?b.requestId:null;
  if(reqId){const r=await env.DB.prepare('SELECT id FROM requests WHERE id=? AND customer_id=?').bind(reqId,u.id).first();if(!r)return fail('Cerere indisponibilă',404)}
  await env.DB.prepare('INSERT INTO support_cases(id,user_id,request_id,message) VALUES(?,?,?,?)').bind(id(),u.id,reqId,b.message.trim()).run();return out({ok:true},201);
 }
 return null;
}
async function adminRoutes(req,env,path,u){
 if(path==='/api/admin/overview'&&req.method==='GET'){
  const [providers,requests,users,categories,jobs,cases,subscriptions,reviews,auditEntries]=await Promise.all([
   env.DB.prepare(`SELECT p.id,p.business_name,p.phone,p.description,p.status,p.created_at,u.email,
   (SELECT group_concat(category_slug,', ') FROM provider_categories pc WHERE pc.provider_id=p.id) categories,
   (SELECT group_concat(county,', ') FROM provider_areas pa WHERE pa.provider_id=p.id) counties FROM providers p JOIN users u ON u.id=p.user_id ORDER BY p.created_at DESC LIMIT 100`).all(),
   env.DB.prepare(`SELECT r.id,r.category_slug,r.county,r.locality,r.description,r.status,r.created_at,u.email customer_email,
   (SELECT count(*) FROM invitations i WHERE i.request_id=r.id) invited,
   (SELECT count(*) FROM offers o JOIN invitations i ON i.id=o.invitation_id WHERE i.request_id=r.id) offers FROM requests r JOIN users u ON u.id=r.customer_id ORDER BY r.created_at DESC LIMIT 100`).all(),
   env.DB.prepare('SELECT id,email,is_admin,disabled_at,created_at FROM users ORDER BY created_at DESC LIMIT 100').all(),
   env.DB.prepare('SELECT slug,name,active FROM categories ORDER BY name').all(),
   env.DB.prepare('SELECT id,request_id,price_minor,status,created_at FROM jobs ORDER BY created_at DESC LIMIT 100').all(),
   env.DB.prepare('SELECT id,user_id,request_id,message,status,created_at FROM support_cases ORDER BY created_at DESC LIMIT 100').all(),
   env.DB.prepare(`SELECT s.provider_id,s.plan,s.status,s.updated_at,p.business_name FROM billing_subscriptions s JOIN providers p ON p.id=s.provider_id ORDER BY updated_at DESC LIMIT 100`).all(),
   env.DB.prepare('SELECT id,job_id,rating,comment,created_at FROM reviews ORDER BY created_at DESC LIMIT 100').all(),
   env.DB.prepare('SELECT id,actor_id,action,target_type,target_id,detail,created_at FROM audit_log ORDER BY created_at DESC LIMIT 100').all(),
  ]);
  const enabled=await env.DB.prepare("SELECT value FROM settings WHERE key='billing_enabled'").first();
  const rows=x=>x.results||[];
  return out({providers:rows(providers),requests:rows(requests),users:rows(users),categories:rows(categories),jobs:rows(jobs),cases:rows(cases),subscriptions:rows(subscriptions),reviews:rows(reviews),audit:rows(auditEntries),billingEnabled:enabled?.value==='1',paymentConfigured:!!(env.STRIPE_SECRET_KEY&&env.STRIPE_PRICE_PRO&&env.STRIPE_WEBHOOK_SECRET)});
 }
 let m=path.match(/^\/api\/admin\/providers\/([^/]+)$/);
 if(m&&req.method==='PATCH'){
  const b=await body(req);if(!allowedStatuses.has(b.status))return fail('Status invalid');
  const r=await env.DB.prepare('UPDATE providers SET status=?,reviewed_at=datetime(\'now\') WHERE id=?').bind(b.status,m[1]).run();if(!r.meta.changes)return fail('Prestator inexistent',404);
  await audit(env.DB,u,'PROVIDER_STATUS','provider',m[1],b.status);return out({ok:true});
 }
 m=path.match(/^\/api\/admin\/requests\/([^/]+)\/match$/);
 if(m&&req.method==='POST'){
  const reqRow=await env.DB.prepare('SELECT * FROM requests WHERE id=?').bind(m[1]).first();if(!reqRow)return fail('Cerere inexistentă',404);
  if(!['OPEN','MATCHED'].includes(reqRow.status))return fail('Cerere închisă',409);
  const candidates=await env.DB.prepare(`SELECT p.id FROM providers p
   JOIN provider_categories pc ON pc.provider_id=p.id AND pc.category_slug=?
   JOIN provider_areas pa ON pa.provider_id=p.id AND lower(pa.county)=lower(?)
   LEFT JOIN billing_subscriptions bs ON bs.provider_id=p.id
   WHERE p.status='APPROVED' AND p.user_id<>? AND NOT EXISTS (SELECT 1 FROM invitations i WHERE i.request_id=? AND i.provider_id=p.id)
   ORDER BY CASE WHEN bs.plan='PRO' AND bs.status IN ('active','trialing') THEN 0 ELSE 1 END,p.created_at,p.id LIMIT 3`).bind(reqRow.category_slug,reqRow.county,reqRow.customer_id,reqRow.id).all();
  let added=0;
  // Each write checks the count inside a single SQL statement, even if two admins match concurrently.
  for(const p of candidates.results||[]){
   const res=await env.DB.prepare(`INSERT INTO invitations(id,request_id,provider_id,slot)
    SELECT ?,r.id,?,(SELECT coalesce(max(slot),0)+1 FROM invitations WHERE request_id=r.id)
    FROM requests r WHERE r.id=? AND r.status IN ('OPEN','MATCHED')
    AND (SELECT count(*) FROM invitations WHERE request_id=r.id)<3
    ON CONFLICT DO NOTHING`).bind(id(),p.id,reqRow.id).run();added+=res.meta?.changes||0;
  }
  const total=(await env.DB.prepare('SELECT count(*) n FROM invitations WHERE request_id=?').bind(reqRow.id).first())?.n||0;
  if(total)await env.DB.prepare("UPDATE requests SET status='MATCHED' WHERE id=? AND status='OPEN'").bind(reqRow.id).run();
  await audit(env.DB,u,'MATCH_REQUEST','request',reqRow.id,`added=${added},total=${total}`);return out({added,total});
 }
 m=path.match(/^\/api\/admin\/requests\/([^/]+)\/cancel$/);
 if(m&&req.method==='POST'){
  const b=await body(req);if(!validText(b.reason,4,400))return fail('Motiv obligatoriu');
  const r=await env.DB.prepare("UPDATE requests SET status='CANCELLED' WHERE id=? AND status IN ('OPEN','MATCHED')").bind(m[1]).run();if(!r.meta.changes)return fail('Cerere imposibil de anulat',409);
  await audit(env.DB,u,'CANCEL_REQUEST','request',m[1],b.reason.trim());return out({ok:true});
 }
 m=path.match(/^\/api\/admin\/categories\/([a-z0-9-]+)$/);
 if(m&&req.method==='PATCH'){
  const b=await body(req);if(typeof b.active!=='boolean')return fail('Valoare invalidă');
  const r=await env.DB.prepare('UPDATE categories SET active=? WHERE slug=?').bind(b.active?1:0,m[1]).run();if(!r.meta.changes)return fail('Categorie inexistentă',404);
  await audit(env.DB,u,'CATEGORY_STATUS','category',m[1],String(b.active));return out({ok:true});
 }
 m=path.match(/^\/api\/admin\/users\/([^/]+)$/);
 if(m&&req.method==='PATCH'){
  const b=await body(req);if(typeof b.suspended!=='boolean'||u.id===m[1])return fail('Acțiune invalidă');
  const r=await env.DB.prepare('UPDATE users SET disabled_at=? WHERE id=? AND is_admin=0').bind(b.suspended?new Date().toISOString():null,m[1]).run();if(!r.meta.changes)return fail('Utilizator indisponibil',404);
  if(b.suspended)await env.DB.prepare('DELETE FROM sessions WHERE user_id=?').bind(m[1]).run();
  await audit(env.DB,u,'USER_SUSPEND','user',m[1],String(b.suspended));return out({ok:true});
 }
 m=path.match(/^\/api\/admin\/support\/([^/]+)$/);
 if(m&&req.method==='PATCH'){
  const b=await body(req);if(b.status!=='RESOLVED')return fail('Status invalid');
  const r=await env.DB.prepare("UPDATE support_cases SET status='RESOLVED' WHERE id=? AND status='OPEN'").bind(m[1]).run();if(!r.meta.changes)return fail('Sesizare deja închisă',409);
  await audit(env.DB,u,'SUPPORT_RESOLVE','support',m[1]);return out({ok:true});
 }
 if(path==='/api/admin/billing'&&req.method==='PATCH'){
  const b=await body(req);if(typeof b.enabled!=='boolean')return fail('Valoare invalidă');
  if(b.enabled&&!(env.STRIPE_SECRET_KEY&&env.STRIPE_PRICE_PRO&&env.STRIPE_WEBHOOK_SECRET))return fail('Stripe nu este configurat complet',409);
  await env.DB.prepare("UPDATE settings SET value=? WHERE key='billing_enabled'").bind(b.enabled?'1':'0').run();
  await audit(env.DB,u,'BILLING_SWITCH','setting','billing_enabled',String(b.enabled));return out({ok:true});
 }
 return null;
}
async function stripePost(env,path,params){const res=await fetch('https://api.stripe.com/v1/'+path,{method:'POST',headers:{'Authorization':`Bearer ${env.STRIPE_SECRET_KEY}`,'Content-Type':'application/x-www-form-urlencoded','Idempotency-Key':crypto.randomUUID()},body:new URLSearchParams(params).toString()});const response=await res.json();if(!res.ok)throw Error(response.error?.message||'Plata nu poate fi inițiată');return response;}
async function billingRoutes(req,env,path,u){
 if(path==='/api/billing/checkout'&&req.method==='POST'){
  const enabled=await env.DB.prepare("SELECT value FROM settings WHERE key='billing_enabled'").first();if(enabled?.value!=='1'||!env.STRIPE_SECRET_KEY||!env.STRIPE_PRICE_PRO||!env.STRIPE_WEBHOOK_SECRET||!env.APP_ORIGIN)return fail('Monetizarea nu este activată',503);
  const p=await env.DB.prepare('SELECT * FROM providers WHERE user_id=?').bind(u.id).first();if(!p||p.status!=='APPROVED')return fail('Cont prestator neaprobat',403);
  const s=await env.DB.prepare('SELECT * FROM billing_subscriptions WHERE provider_id=?').bind(p.id).first();if(s&&['active','trialing','past_due'].includes(s.status.toLowerCase()))return fail('Ai deja un abonament; folosește portalul de administrare',409);
  const params={'mode':'subscription','line_items[0][price]':env.STRIPE_PRICE_PRO,'line_items[0][quantity]':'1','customer_email':u.email,'client_reference_id':p.id,'subscription_data[metadata][provider_id]':p.id,'metadata[provider_id]':p.id,'success_url':env.APP_ORIGIN+'/cont.html?checkout=returned','cancel_url':env.APP_ORIGIN+'/cont.html?checkout=cancelled'};
  if(s?.stripe_customer_id){delete params.customer_email;params.customer=s.stripe_customer_id;}
  const checkout=await stripePost(env,'checkout/sessions',params);return out({url:checkout.url});
 }
 if(path==='/api/billing/portal'&&req.method==='POST'){
  if(!env.STRIPE_SECRET_KEY||!env.APP_ORIGIN)return fail('Portalul de facturare nu este configurat',503);
  const p=await env.DB.prepare('SELECT id FROM providers WHERE user_id=?').bind(u.id).first();if(!p)return fail('Profil de prestator necesar',403);
  const s=await env.DB.prepare('SELECT stripe_customer_id FROM billing_subscriptions WHERE provider_id=?').bind(p.id).first();if(!s?.stripe_customer_id)return fail('Nu există abonament de administrat',404);
  const portal=await stripePost(env,'billing_portal/sessions',{'customer':s.stripe_customer_id,'return_url':env.APP_ORIGIN+'/cont.html'});return out({url:portal.url});
 }
 return null;
}
async function webhook(req,env){
 if(!env.STRIPE_WEBHOOK_SECRET)return fail('Webhook neconfigurat',503);
 const sig=req.headers.get('Stripe-Signature')||'',ts=sig.match(/(?:^|,)t=(\d+)/)?.[1],signatures=[...sig.matchAll(/(?:^|,)v1=([a-f0-9]{64})/gi)].map(m=>m[1].toLowerCase());
 if(!ts||Math.abs(now()-Number(ts))>300||!signatures.length)return fail('Semnătură invalidă',400);
 const raw=await req.text();if(raw.length>1000000)return fail('Payload prea mare',413);
 const expected=await hmacHex(env.STRIPE_WEBHOOK_SECRET,ts+'.'+raw);if(!signatures.some(x=>same(expected,x)))return fail('Semnătură invalidă',400);
 let event;try{event=JSON.parse(raw)}catch{return fail('Payload invalid',400)}
 if(!/^evt_[a-zA-Z0-9]+$/.test(event.id||''))return fail('Eveniment invalid');
 if(await env.DB.prepare('SELECT id FROM billing_events WHERE id=?').bind(event.id).first())return out({received:true,duplicate:true});
 const o=event.data?.object||{},statements=[];
 if(event.type==='checkout.session.completed'&&o.mode==='subscription'&&o.subscription&&o.customer&&o.client_reference_id){
  // Fulfillment is driven by verified subscription events, not the browser's success redirect.
  statements.push(env.DB.prepare(`INSERT INTO billing_subscriptions(provider_id,stripe_customer_id,stripe_subscription_id,plan,status)
  SELECT id,?,?,'PRO','PENDING' FROM providers WHERE id=?
  ON CONFLICT(provider_id) DO UPDATE SET stripe_customer_id=excluded.stripe_customer_id,
  stripe_subscription_id=excluded.stripe_subscription_id,plan='PRO',
  status=CASE WHEN billing_subscriptions.status IN ('active','trialing') THEN billing_subscriptions.status ELSE 'PENDING' END,
  updated_at=datetime('now')`).bind(String(o.customer),String(o.subscription),String(o.client_reference_id)));
 }
 if(['customer.subscription.created','customer.subscription.updated','customer.subscription.deleted'].includes(event.type)&&o.id){
  const pid=o.metadata?.provider_id||null;
  // Stripe subscription metadata is assigned server-side in Checkout session creation.
  const status=event.type==='customer.subscription.deleted'?'canceled':String(o.status||'incomplete').toLowerCase();
  if(pid)statements.push(env.DB.prepare(`INSERT INTO billing_subscriptions(provider_id,stripe_customer_id,stripe_subscription_id,plan,status)
   SELECT id,?,?,'PRO',? FROM providers WHERE id=?
   ON CONFLICT(provider_id) DO UPDATE SET stripe_customer_id=excluded.stripe_customer_id,
   stripe_subscription_id=excluded.stripe_subscription_id,status=excluded.status,updated_at=datetime('now')`).bind(String(o.customer||''),String(o.id),status,String(pid)));
  else statements.push(env.DB.prepare("UPDATE billing_subscriptions SET status=?,updated_at=datetime('now') WHERE stripe_subscription_id=?").bind(status,String(o.id)));
 }
 if(event.type==='invoice.payment_failed'&&o.subscription){statements.push(env.DB.prepare("UPDATE billing_subscriptions SET status='past_due',updated_at=datetime('now') WHERE stripe_subscription_id=?").bind(String(o.subscription)));}
 statements.push(env.DB.prepare('INSERT OR IGNORE INTO billing_events(id,type) VALUES(?,?)').bind(event.id,event.type));
 await env.DB.batch(statements);return out({received:true});
}
export default {
 async fetch(req,env){
  const path=new URL(req.url).pathname;
  if(!path.startsWith('/api/'))return env.ASSETS?env.ASSETS.fetch(req):fail('Asset unavailable',404);
  if(req.method==='OPTIONS')return fail('CORS indisponibil',405);
  if(req.method!=='GET'&&!['/api/stripe/webhook'].includes(path)&&!originOK(req))return fail('Origine invalidă',403);
  if(!env.DB)return fail('Baza de date nu este configurată',503);
  try{
   if(path==='/api/health'&&req.method==='GET'){await env.DB.prepare('SELECT 1 n').first();return out({ok:true,service:'lafix-marketplace',version:'0.1.0'});}
   if(path==='/api/catalog'&&req.method==='GET')return catalog(env);
   if(path==='/api/stripe/webhook'&&req.method==='POST')return webhook(req,env);
   if(path.startsWith('/api/auth/')){const r=await authRoutes(req,env,path);if(r)return r;}
   const {user,error}=await requireUser(req,env,path.startsWith('/api/admin/'));if(error)return error;
   if(path==='/api/me'&&req.method==='GET')return out(await profile(env,user));
   if(path.startsWith('/api/admin/')){const r=await adminRoutes(req,env,path,user);if(r)return r;}
   if(path.startsWith('/api/provider/')){const r=await providerRoutes(req,env,path,user);if(r)return r;}
   if(path.startsWith('/api/requests')||path.startsWith('/api/jobs/')||path==='/api/support'){const r=await requestRoutes(req,env,path,user);if(r)return r;}
   if(path.startsWith('/api/billing/')){const r=await billingRoutes(req,env,path,user);if(r)return r;}
   return fail('Endpoint inexistent',404);
  }catch(e){
   // Only show safe validation errors. Database/Stripe internal errors stay out of the response.
   const msg=e instanceof Error?e.message:'';
   if(['Cerere prea mare','JSON invalid'].includes(msg))return fail(msg,400);
   console.error('LaFix API error:',String(e?.message||e).slice(0,300));
   return fail('Eroare internă. Verifică jurnalele serverului.',500);
  }
 },
 async scheduled(_event,env){if(!env.DB)return;await env.DB.batch([
  env.DB.prepare('DELETE FROM sessions WHERE expires_at<?').bind(now()),
  env.DB.prepare('DELETE FROM login_codes WHERE expires_at<?').bind(now()),
  env.DB.prepare('DELETE FROM rate_limits WHERE window_start<?').bind(now()-86400)
 ]);}
};
export const internal = {emailOf,validEmail,validText,hash,hmacHex,same};
