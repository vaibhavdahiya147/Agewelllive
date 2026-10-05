import {json, checkRequest, fail} from '../lib/core.js';
export default function handler(req, res) {
  try {
    checkRequest(req, 'GET');
    json(res, 200, {plannerConfigured: Boolean(process.env.GEMINI_API_KEY)});
  } catch (error) {fail(res, error);}
}
