import test from 'node:test';
import assert from 'node:assert/strict';
import carePlan from '../api/care-plan.js';
import waitlist from '../api/waitlist.js';
import statsHandler from '../api/stats.js';
const sample={consent:true,morning:true,morningTime:'08:00',evening:true,eveningTime:'20:00',walk:false,refill:false,appointmentDay:'None',memberA:'morning',memberB:'evening',question:''};
const req=data=>({method:'POST',headers:{'content-type':'application/json',origin:'https://agewell-tau.vercel.app'},body:data,socket:{remoteAddress:'127.0.0.1'}});
function response(){return{headers:{},setHeader(k,v){this.headers[k]=v;},end(text){this.body=JSON.parse(text);}};}
function setup(){Object.assign(process.env,{SUPABASE_URL:'https://test.supabase.co',SUPABASE_SERVICE_KEY:'sb_secret_test',GEMINI_API_KEY:'test-key',VISITOR_SECRET:'test-only-secret-01234567890123456789',APP_ORIGIN:'https://agewell-tau.vercel.app'});}
const reply=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});
test('plan persists exact tasks and token usage before reporting success',async t=>{
  setup();const calls=[];
  t.mock.method(globalThis,'fetch',async(url,options)=>{
    const data=options.body?JSON.parse(options.body):null;calls.push({url,data});
    if(url.includes('agewell_reserve_request'))return reply({allowed:true,id:'test-id',remaining:2});
    if(url.includes('generateContent'))return reply({candidates:[{content:{parts:[{text:JSON.stringify({refused:false,assignments:[{id:'morning',owner:'member_a'},{id:'evening',owner:'member_b'}]})}]}}],usageMetadata:{promptTokenCount:123,candidatesTokenCount:45}});
    if(options.method==='PATCH')return reply(null);
    if(url.includes('agewell_stats'))return reply({plansGenerated:1,mostCommonTask:'medicines',waitlistMembers:0});
    throw Error('Unexpected request');
  });
  const res=response();await carePlan(req(sample),res);assert.equal(res.statusCode,200);assert.equal(res.body.tasks[0].time,'08:00');assert.equal(res.body.usage.inputTokens,123);
  const patch=calls.find(c=>c.url.includes('care_requests?id='));assert.equal(patch.data.status,'completed');assert.equal(patch.data.output_tokens,45);
});
test('clinical refusal is stored without a Gemini call',async t=>{
  setup();const calls=[];t.mock.method(globalThis,'fetch',async(url,options)=>{calls.push({url,data:JSON.parse(options.body)});return url.includes('reserve')?reply({allowed:true,id:'refusal',remaining:2}):reply(null);});
  const res=response();await carePlan(req({...sample,question:'chest pain: what dose?'}),res);
  assert.equal(res.statusCode,422);assert.equal(calls.length,2);assert.equal(calls[0].data.p_input.reason,'clinical_request');assert.equal(calls[1].data.status,'refused');
});
test('database quota blocks the model before any billable call',async t=>{
  setup();t.mock.method(globalThis,'fetch',async(url)=>{assert.ok(url.includes('reserve'));return reply({allowed:false,message:'Three attempts used.'});});
  const res=response();await carePlan(req(sample),res);assert.equal(res.statusCode,429);
});
test('save failure does not produce a success or inflated count',async t=>{
  setup();t.mock.method(globalThis,'fetch',async(url,options)=>{
    if(url.includes('reserve'))return reply({allowed:true,id:'save-failure',remaining:2});
    if(url.includes('generateContent'))return reply({candidates:[{content:{parts:[{text:JSON.stringify({refused:false,assignments:[{id:'morning',owner:'member_a'},{id:'evening',owner:'member_b'}]})}]}}]});
    if(options.method==='PATCH')return reply({error:'database down'},500);
    throw Error('Count must not be called after save failure');
  });const res=response();await carePlan(req(sample),res);assert.equal(res.statusCode,503);assert.equal(res.body.tasks,undefined);
});
test('waitlist uses normalized, duplicate-safe inserts and no contact data in request logs',async t=>{
  setup();const calls=[];t.mock.method(globalThis,'fetch',async(url,options)=>{calls.push({url,options,data:JSON.parse(options.body)});return url.includes('reserve')?reply({allowed:true,id:'signup',remaining:4}):reply(null);});
  const res=response();await waitlist(req({email:'Preview@Example.COM',consent:true}),res);
  assert.equal(res.statusCode,200);assert.equal(calls[0].data.p_input.email,undefined);assert.equal(calls[1].data.email,'preview@example.com');assert.match(calls[1].options.headers.Prefer,/ignore-duplicates/);
});
test('aggregate endpoint exposes no request records',async t=>{
  setup();t.mock.method(globalThis,'fetch',async(url)=>{assert.ok(url.endsWith('rpc/agewell_stats'));return reply({plansGenerated:5,mostCommonTask:'medicines',waitlistMembers:1});});
  const res=response();await statsHandler({method:'GET',headers:{}},res);assert.equal(res.statusCode,200);assert.equal(res.body.plansGenerated,5);assert.equal(res.body.email,undefined);
});
