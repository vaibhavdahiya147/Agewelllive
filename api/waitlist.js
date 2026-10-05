import {body,checkRequest,configuration,database,fail,finish,json,PublicError,reserve,visitor} from '../lib/core.js';
export default async function handler(req,res) {
  let reservation;
  try {
    checkRequest(req);
    configuration(['SUPABASE_URL','SUPABASE_SERVICE_KEY','VISITOR_SECRET']);
    const input = body(req);
    if (input.website) return json(res,200,{message:'Thank you for your interest.'});
    if (input.consent !== true) throw new PublicError(400,'Please agree to receive AgeWell early-access updates.');
    const email = typeof input.email === 'string' ? input.email.trim().toLowerCase() : '';
    if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new PublicError(400,'Enter a valid email address.');
    reservation = await reserve(visitor(req,res),'waitlist',{consent:true});
    await database('waitlist?on_conflict=email',{method:'POST',data:{email,consent:true,source:'agewell_landing_page'},prefer:'resolution=ignore-duplicates,return=minimal'});
    await finish(reservation.id,'completed',{registered:true});
    json(res,200,{message:'You’re on the AgeWell early-access waitlist. Thank you for joining!'});
  } catch (error) {
    if (reservation) try {await finish(reservation.id,'failed',{message:'waitlist_unavailable'});} catch {}
    fail(res,error);
  }
}
