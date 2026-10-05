(() => {
  const byId = id => document.getElementById(id);
  // This is a publishable key, not a secret. Database permissions remain server-enforced.
  const supabaseUrl = 'https://fnsjqezdcxrfotolrcyv.supabase.co';
  const publishableKey = 'sb_publishable_4FTT2cyu3WpelttJ-ZeOjA_zBs-TLkC';
  async function joinWaitlist(email, consent, website) {
    if (website) throw new Error('Please leave the website field empty.');
    const response = await fetch(`${supabaseUrl}/rest/v1/rpc/agewell_join_waitlist`, {
      method: 'POST',
      headers: {apikey: publishableKey, 'Content-Type': 'application/json'},
      body: JSON.stringify({p_email: email.trim().toLowerCase(), p_consent: consent}),
      signal: AbortSignal.timeout(15000)
    });
    const result = await response.json().catch(() => null);
    if (!response.ok) throw new Error('Waitlist registration is temporarily unavailable. Please try again shortly.');
    if (!result?.registered) throw new Error(result?.message || 'Please check your email and consent, then try again.');
    return result;
  }
  let currentPlan = null;
  let plannerReady = false;
  async function request(url, data) {
    const response = await fetch(url,{method:data ? 'POST':'GET',credentials:'same-origin',headers:data ? {'Content-Type':'application/json'}:undefined,body:data ? JSON.stringify(data):undefined,signal:AbortSignal.timeout(28000)});
    let result;
    try {result = await response.json();} catch {throw new Error('The service could not respond. Please try again shortly.');}
    if (!response.ok) throw new Error(result.error || 'Something went wrong. Please try again.');
    return result;
  }
  const errorText = error => error.name === 'TimeoutError' || error.name === 'AbortError' ? 'This is taking longer than expected. Please wait a moment before trying again; your request may still be processing.' : error.message || 'The service is temporarily unavailable.';
  function showStats(data) {
    byId('plans-count').textContent = Number(data.plansGenerated).toLocaleString('en-IN');
    byId('common-task').textContent = {medicines:'Medicine reminders',appointments:'Appointments',routine:'Daily routines',refills:'Refill checks',none:'No plans yet'}[data.mostCommonTask] || 'Care coordination';
    byId('stats-state').textContent = 'Saved coordination drafts · demonstration totals, not verified clinical outcomes';
  }
  async function loadStats() {
    try {showStats(await request('/api/stats'));} catch {byId('stats-state').textContent = 'Live totals are temporarily unavailable.';}
  }
  async function checkPlanner() {
    const button = byId('generate-plan');
    try {plannerReady = Boolean((await request('/api/status')).plannerConfigured);} catch {plannerReady = false;}
    button.disabled = !plannerReady;
    button.textContent = plannerReady ? 'Create my weekly plan' : 'AI planner · coming soon';
    if (!plannerReady) {
      byId('plan-status').textContent = 'The waitlist is open. AI planning will be available after the private server connection is configured.';
      byId('stats-state').textContent = 'Care-plan totals will be available when the planner opens.';
    }
  }
  function inputData() {
    return {morning:byId('morning').checked,morningTime:byId('morningTime').value,evening:byId('evening').checked,eveningTime:byId('eveningTime').value,walk:byId('walk').checked,walkTime:byId('walkTime').value,refill:byId('refill').checked,appointmentDay:byId('appointmentDay').value,appointmentTime:byId('appointmentTime').value,memberA:byId('memberA').value,memberB:byId('memberB').value,question:byId('question').value.trim(),consent:byId('care-consent').checked};
  }
  const ownerLabel = owner => owner === 'member_a' ? 'Family member A':'Family member B';
  function renderPlan(plan) {
    currentPlan = plan;
    const container = byId('plan-tasks');
    container.replaceChildren();
    for (const task of plan.tasks) {
      const card = document.createElement('article'); card.className='plan-task';
      const top = document.createElement('div'); top.className='plan-task-top';
      const when = document.createElement('span'); when.textContent=`${task.day} · ${task.time} IST`;
      const owner = document.createElement('span'); owner.className='owner-badge'; owner.textContent=ownerLabel(task.owner);
      top.append(when,owner);
      const title=document.createElement('h4'); title.textContent=task.label;
      const detail=document.createElement('p'); detail.textContent='Planned · not yet confirmed';
      card.append(top,title,detail); container.append(card);
    }
    byId('plan-notice').textContent=plan.notice;
    byId('plan-meta').textContent=`Saved in the care database. ${plan.remaining} attempt${plan.remaining === 1 ? '':'s'} remaining. AI token usage: ${plan.usage.inputTokens} input / ${plan.usage.outputTokens} output.`;
    byId('plan-empty').hidden=true; byId('plan-result').hidden=false;
    byId('export-status').textContent='';
    if (plan.stats) showStats(plan.stats); else loadStats();
  }
  byId('load-sample').addEventListener('click',() => {
    byId('morning').checked=true; byId('morningTime').value='08:00';
    byId('evening').checked=true; byId('eveningTime').value='20:00';
    byId('walk').checked=true; byId('walkTime').value='17:00';
    byId('refill').checked=true; byId('appointmentDay').value='Thursday'; byId('appointmentTime').value='11:00';
    byId('memberA').value='morning'; byId('memberB').value='evening'; byId('question').value='';
    byId('plan-status').textContent='Sample routine loaded. Review it and confirm consent before creating a plan.';
    byId('plan-status').dataset.error='false';
  });
  byId('care-form').addEventListener('submit',async event => {
    event.preventDefault();
    if (!plannerReady) return;
    const form=event.currentTarget; if (!form.reportValidity()) return;
    const status=byId('plan-status'), button=byId('generate-plan');
    button.disabled=true; button.textContent='Creating your plan…'; status.dataset.error='false'; status.textContent='Organizing the routine and saving your shared checklist…'; byId('plan-output').setAttribute('aria-busy','true');
    // Hide stale results so a failed new request cannot look like a fresh success.
    currentPlan=null; byId('plan-result').hidden=true; byId('plan-empty').hidden=false;
    try {const plan=await request('/api/care-plan',inputData()); renderPlan(plan); status.textContent='Your weekly coordination draft is ready.'; byId('plan-result').scrollIntoView({behavior:'smooth',block:'nearest'});}
    catch(error){status.dataset.error='true';status.textContent=errorText(error);}
    finally{button.disabled=false;button.textContent='Create my weekly plan';byId('plan-output').setAttribute('aria-busy','false');}
  });
  function checklist() {
    return ['AgeWell · Weekly coordination checklist','Times are in India Standard Time (IST).','',...currentPlan.tasks.map(task => `[ ] ${task.day} at ${task.time} — ${task.label} — ${ownerLabel(task.owner)}`),'',currentPlan.notice].join('\n');
  }
  byId('download-plan').addEventListener('click',() => {
    if (!currentPlan) return;
    const url=URL.createObjectURL(new Blob([checklist()],{type:'text/plain;charset=utf-8'}));
    const link=document.createElement('a');link.href=url;link.download='AgeWell-weekly-checklist.txt';link.click();setTimeout(() => URL.revokeObjectURL(url),1000);
    byId('export-status').textContent='Checklist downloaded.';
  });
  byId('copy-plan').addEventListener('click',async () => {
    if (!currentPlan) return;
    try{await navigator.clipboard.writeText(checklist());byId('export-status').textContent='Checklist copied.';}catch{byId('export-status').textContent='Clipboard is unavailable. Use Download checklist instead.';}
  });
  byId('waitlist-form').addEventListener('submit',async event => {
    event.preventDefault();const form=event.currentTarget;if(!form.reportValidity())return;
    const button=byId('waitlist-submit'),status=byId('form-status');button.disabled=true;button.textContent='Joining…';status.textContent='Saving your waitlist entry…';
    try{const result=await joinWaitlist(byId('email').value,byId('waitlist-consent').checked,byId('website').value);status.textContent=result.message;form.reset();}
    catch(error){status.textContent=errorText(error);}
    finally{button.disabled=false;button.textContent='Join the waitlist';}
  });
  loadStats();
  checkPlanner();
})();
