import {json, checkRequest, fail} from '../lib/core.js';
export default function handler(req, res) {
  try {
    checkRequest(req, 'GET');
    json(res, 200, {plannerConfigured: ['SUPABASE_URL', 'SUPABASE_SERVICE_KEY', 'GEMINI_API_KEY', 'VISITOR_SECRET'].every(key => Boolean(process.env[key])) && (process.env.VISITOR_SECRET?.length || 0) >= 32});
  } catch (error) {fail(res, error);}
}
