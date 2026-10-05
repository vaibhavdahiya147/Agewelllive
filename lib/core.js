import {createHmac, randomBytes, randomUUID, timingSafeEqual} from 'node:crypto';
import {SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY} from './supabase-config.js';

export class PublicError extends Error {
  constructor(status, message, code = 'request_failed') {super(message); this.status = status; this.code = code;}
}
export function json(res, status, data) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.statusCode = status;
  res.end(JSON.stringify(data));
}
export function fail(res, error) {
  // Never log request bodies, email addresses, service keys or provider responses.
  const status = error instanceof PublicError ? error.status : 503;
  json(res, status, {error: error instanceof PublicError ? error.message : 'The service is temporarily unavailable. Please try again shortly.', code: error.code || 'service_unavailable'});
}
export function configuration(keys) {
  for (const key of keys) if (!process.env[key]) throw new PublicError(503, 'AgeWell is not connected yet. Please try again after setup.', 'not_configured');
}
export function checkRequest(req, method = 'POST') {
  if (req.method !== method) throw new PublicError(405, 'Method not allowed.');
  if (method === 'POST') {
    const origin = req.headers.origin;
    const host = String(req.headers.host || '');
    const validHost = /^(?:[a-z0-9-]+\.)*[a-z0-9-]+(?::\d{1,5})?$/i.test(host);
    const automaticOrigin = validHost ? `${process.env.VERCEL ? 'https' : 'http'}://${host}` : null;
    const allowed = [automaticOrigin, process.env.APP_ORIGIN, process.env.VERCEL_URL && `https://${process.env.VERCEL_URL}`, 'http://127.0.0.1:8766'].filter(Boolean);
    if (origin && !allowed.includes(origin)) throw new PublicError(403, 'Please use the AgeWell website to submit this form.');
    if (req.headers['sec-fetch-site'] === 'cross-site') throw new PublicError(403, 'Cross-site submissions are not accepted.');
    if (!String(req.headers['content-type'] || '').startsWith('application/json')) throw new PublicError(415, 'Please submit a JSON request.');
  }
}
export function body(req) {
  let input;
  try {input = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;} catch {throw new PublicError(400, 'Invalid request.');}
  if (!input || typeof input !== 'object' || Array.isArray(input) || JSON.stringify(input).length > 5000) throw new PublicError(400, 'Invalid or oversized request.');
  return input;
}
function visitorSigningKey() {
  configuration(['GEMINI_API_KEY']);
  return createHmac('sha256', process.env.GEMINI_API_KEY).update('AgeWell/visitor/v2').digest();
}
const hash = value => createHmac('sha256', visitorSigningKey()).update(value).digest('hex');
export function visitor(req, res) {
  const cookie = String(req.headers.cookie || '').split(';').find(c => c.trim().startsWith('aw_visitor='));
  const token = cookie ? cookie.trim().slice('aw_visitor='.length) : '';
  const [id, signature] = token.split('.');
  const expected = id && /^[a-f0-9-]{36}$/.test(id) ? hash(id) : '';
  const valid = expected && signature && signature.length === expected.length && timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  const current = valid ? id : randomUUID();
  if (!valid) res.setHeader('Set-Cookie', `aw_visitor=${current}.${hash(current)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000${process.env.NODE_ENV === 'production' || process.env.VERCEL ? '; Secure' : ''}`);
  // Vercel sets this header. Raw IP addresses are never stored.
  const ip = String(req.headers['x-vercel-forwarded-for'] || req.socket?.remoteAddress || 'unknown').split(',')[0].trim();
  return {visitorId: hash(current), networkHash: hash(`network:${ip}`)};
}
export async function database(path, {method = 'POST', data} = {}) {
  const paths = ['rpc/agewell_public_reserve','rpc/agewell_public_finish','rpc/agewell_public_stats','rpc/agewell_join_waitlist'];
  if (method !== 'POST' || !paths.includes(path)) throw new PublicError(500, 'Invalid database operation.');
  const headers = {apikey:SUPABASE_PUBLISHABLE_KEY, 'Content-Type':'application/json'};
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {method, headers, body:JSON.stringify(data || {}), signal:AbortSignal.timeout(7000)});
  if (!response.ok) throw new PublicError(503, 'The care database is temporarily unavailable. Please try again.', 'database_unavailable');
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}
export async function reserve(identity, kind, input) {
  if (kind !== 'plan') throw new PublicError(400, 'Invalid request type.');
  const writeToken = randomBytes(32).toString('hex');
  const result = await database('rpc/agewell_public_reserve', {data:{p_visitor_id:identity.visitorId, p_network_hash:identity.networkHash, p_input:input, p_write_token:writeToken}});
  if (!result?.allowed) throw new PublicError(429, result?.message || 'This preview has reached its request limit. Please try again tomorrow.', 'rate_limited');
  return {...result, writeToken};
}
export async function finish(reservation, status, output, usage = {}) {
  const result = await database('rpc/agewell_public_finish', {data:{p_id:reservation.id, p_write_token:reservation.writeToken, p_status:status, p_output:output, p_input_tokens:usage.promptTokenCount || 0, p_output_tokens:usage.candidatesTokenCount || 0, p_model:usage.model || null}});
  if (result?.saved !== true) throw new PublicError(503, 'The draft could not be saved. Please try again.', 'database_unavailable');
}
export async function stats() {
  return database('rpc/agewell_public_stats');
}
