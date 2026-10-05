import {checkRequest,fail,json,stats} from '../lib/core.js';
export default async function handler(req,res) {
  try {checkRequest(req,'GET'); json(res,200,await stats());} catch(error) {fail(res,error);}
}
