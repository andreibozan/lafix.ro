import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import worker, {internal} from '../apps/api/worker.mjs';

class D1 {
 constructor(){this.sql=new DatabaseSync(':memory:');this.sql.exec(readFileSync(new URL('../infra/d1/0001_core.sql',import.meta.url),'utf8'));}
 prepare(query){const stmt=this.sql.prepare(query);let args=[];return {bind(...v){args=v;return this},first(){return stmt.get(...args)||null},all(){return {results:stmt.all(...args)}},run(){const r=stmt.run(...args);return {meta:{changes:Number(r.changes)}}}}}
 async batch(stmts){this.sql.exec('BEGIN');try{const result=[];for(const s of stmts)result.push(await s.run());this.sql.exec('COMMIT');return result}catch(e){this.sql.exec('ROLLBACK');throw e}}
}
const db=new D1();let lastCode;const realFetch=globalThis.fetch;
const fakeResend=(input,init)=>{if(!String(input).includes('api.resend.com'))throw Error('Unexpected upstream '+input);const msg=JSON.parse(init.body);lastCode=msg.text.match(/(\d{8})/)?.[1];return Promise.resolve(new Response(JSON.stringify({id:'em_test'}),{status:200,headers:{'Content-Type':'application/json'}}))};
const env={DB:db,ASSETS:{fetch:()=>new Response('Asset')} ,AUTH_PEPPER:'long-secret-pepper',RESEND_API_KEY:'fake-test-key',AUTH_FROM_EMAIL:'auth@test.example',APP_ORIGIN:'https://lafix.test'};
async function call(path,{method='GET',payload,cookie='',origin=true,headers={}}={}){
 const h={...headers};if(cookie)h.Cookie=cookie;if(origin&&method!=='GET')h.Origin=env.APP_ORIGIN;if(payload!==undefined)h['Content-Type']='application/json';
 return worker.fetch(new Request(env.APP_ORIGIN+path,{method,headers:h,body:payload===undefined?undefined:JSON.stringify(payload)}),env);
}
async function ok(r){const json=await r.json();assert.ok(r.ok,JSON.stringify(json));return json}
async function login(email){await ok(await call('/api/auth/start',{method:'POST',payload:{email}}));assert.match(lastCode,/^\d{8}$/);const r=await call('/api/auth/verify',{method:'POST',payload:{email,code:lastCode}});await ok(r);const c=r.headers.get('set-cookie').split(';')[0];assert.ok(c);return c}
test('LaFix integration — authentication, admin authorization, matching, offers, jobs, review, audit, billing gate',async()=>{
 globalThis.fetch=fakeResend;
 try{
  let customer=await login('customer@lafix.test');let provider=await login('provider@lafix.test');let admin=await login('admin@lafix.test');
  const adminUser=db.sql.prepare('SELECT id FROM users WHERE email=?').get('admin@lafix.test');db.sql.prepare('UPDATE users SET is_admin=1 WHERE id=?').run(adminUser.id);
  let forbidden=await call('/api/admin/overview',{cookie:customer});assert.equal(forbidden.status,403);
  const category=await ok(await call('/api/catalog'));assert.equal(category.categories.length,8);
  await ok(await call('/api/provider/profile',{method:'POST',cookie:provider,payload:{businessName:'Firma Test SRL',phone:'0712345678',description:'Montaj și reparații',categories:['renovari'],counties:['Cluj']}}));
  const providerId=db.sql.prepare('SELECT id FROM providers LIMIT 1').get().id;
  await ok(await call('/api/admin/providers/'+providerId,{method:'PATCH',cookie:admin,payload:{status:'APPROVED'}}));
  const req=await ok(await call('/api/requests',{method:'POST',cookie:customer,payload:{category:'renovari',county:'Cluj',locality:'Turda',description:'Renovare apartament cu pereți interiori și zugrăvit',budgetMinor:100000}}));
  let matched=await ok(await call('/api/admin/requests/'+req.id+'/match',{method:'POST',cookie:admin,payload:{}}));assert.equal(matched.total,1);
  matched=await ok(await call('/api/admin/requests/'+req.id+'/match',{method:'POST',cookie:admin,payload:{}}));assert.equal(matched.total,1);
  const invitations=await ok(await call('/api/provider/invitations',{cookie:provider}));assert.equal(invitations.invitations.length,1);
  const inv=invitations.invitations[0];const offer=await ok(await call('/api/provider/offers',{method:'POST',cookie:provider,payload:{invitationId:inv.invitation_id,amountMinor:84000,message:'Execut renovarea conform descrierii în două zile'}}));
  let secondOffer=await call('/api/provider/offers',{method:'POST',cookie:provider,payload:{invitationId:inv.invitation_id,amountMinor:80000,message:'Încercare de suprascriere a ofertei'}});assert.equal(secondOffer.status,409);
  let acc=await ok(await call('/api/requests/'+req.id+'/accept',{method:'POST',cookie:customer,payload:{offerId:offer.id}}));assert.ok(acc.jobId);
  let again=await call('/api/requests/'+req.id+'/accept',{method:'POST',cookie:customer,payload:{offerId:offer.id}});assert.equal(again.status,409);
  await ok(await call('/api/jobs/'+acc.jobId+'/status',{method:'POST',cookie:provider,payload:{status:'IN_PROGRESS'}}));
  await ok(await call('/api/jobs/'+acc.jobId+'/status',{method:'POST',cookie:customer,payload:{status:'COMPLETED'}}));
  await ok(await call('/api/jobs/'+acc.jobId+'/review',{method:'POST',cookie:customer,payload:{rating:5,comment:'Foarte bun'}}));
  let duplicateReview=await call('/api/jobs/'+acc.jobId+'/review',{method:'POST',cookie:customer,payload:{rating:4,comment:'x'}});assert.equal(duplicateReview.status,409);
  await ok(await call('/api/support',{method:'POST',cookie:customer,payload:{message:'Am nevoie de clarificări privind procesul de plată'}}));
  const overview=await ok(await call('/api/admin/overview',{cookie:admin}));assert.equal(overview.requests.length,1);assert.equal(overview.jobs.length,1);assert.equal(overview.reviews.length,1);assert.equal(overview.cases.length,1);assert.equal(overview.billingEnabled,false);
  let noStripe=await call('/api/admin/billing',{method:'PATCH',cookie:admin,payload:{enabled:true}});assert.equal(noStripe.status,409);
  let noCsrf=await call('/api/requests',{method:'POST',cookie:customer,origin:false,payload:{}});assert.equal(noCsrf.status,403);
 }finally{globalThis.fetch=realFetch;}
});
test('Stripe webhook signature and replay guard, no browser-side payment fulfillment',async()=>{
 env.STRIPE_WEBHOOK_SECRET='whsec_unit_testing';
 const p=db.sql.prepare('SELECT id FROM providers LIMIT 1').get();const event={id:'evt_test123',type:'customer.subscription.created',data:{object:{id:'sub_unit_test',customer:'cus_unit_test',status:'active',metadata:{provider_id:p.id}}}};
 const raw=JSON.stringify(event),ts=Math.floor(Date.now()/1000);const sig=await internal.hmacHex(env.STRIPE_WEBHOOK_SECRET,ts+'.'+raw);
 const request=signature=>new Request(env.APP_ORIGIN+'/api/stripe/webhook',{method:'POST',headers:{'Stripe-Signature':`t=${ts},v1=${signature}`},body:raw});
 let invalid=await worker.fetch(request('0'.repeat(64)),env);assert.equal(invalid.status,400);
 let result=await worker.fetch(request(sig),env);assert.equal(result.status,200);
 let duplicated=await worker.fetch(request(sig),env);assert.equal((await duplicated.json()).duplicate,true);
 assert.equal(db.sql.prepare('SELECT status FROM billing_subscriptions WHERE provider_id=?').get(p.id).status,'active');
});
