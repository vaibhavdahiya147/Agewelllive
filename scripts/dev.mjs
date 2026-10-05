import http from 'node:http';
import fs from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import carePlan from '../api/care-plan.js';
import waitlist from '../api/waitlist.js';
import stats from '../api/stats.js';
import status from '../api/status.js';
const root = fileURLToPath(new URL('../',import.meta.url));
const routes = {'/api/care-plan':carePlan,'/api/waitlist':waitlist,'/api/stats':stats,'/api/status':status};
const staticFiles = {'/':'index.html','/index.html':'index.html','/assets/planner.css':'assets/planner.css','/assets/planner.js':'assets/planner.js'};
http.createServer(async(req,res) => {
  const pathname = new URL(req.url,'http://127.0.0.1').pathname;
  try {
    if (routes[pathname]) {
      const buffers=[];let size=0;
      for await (const buffer of req) {size+=buffer.length;if(size>6000){res.writeHead(413);res.end('Request too large');return;}buffers.push(buffer);}
      req.body=Buffer.concat(buffers).toString();
      await routes[pathname](req,res);return;
    }
    if (!staticFiles[pathname]) {res.writeHead(404);res.end('Not found');return;}
    const file = staticFiles[pathname];
    res.setHeader('Content-Type',file.endsWith('.css')?'text/css':file.endsWith('.js')?'text/javascript':'text/html; charset=utf-8');
    res.end(await fs.readFile(path.join(root,file)));
  } catch {res.writeHead(500);res.end('Service unavailable');}
}).listen(8766,'127.0.0.1',() => console.log('AgeWell preview: http://127.0.0.1:8766'));
