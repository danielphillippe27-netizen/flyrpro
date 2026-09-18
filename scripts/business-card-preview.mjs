// Local UI fixture only. Production SQL is separately exercised by test-business-cards.mjs.
import {createServer} from 'node:http';
import {mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {build} from 'esbuild';
const root=process.cwd();const dir=await mkdtemp(join(tmpdir(),'wolfcard-preview-'));
await writeFile(join(dir,'image.tsx'),`import React from 'react';export default function Image({unoptimized,...p}){return <img {...p}/>}`);
await writeFile(join(dir,'link.tsx'),`import React from 'react';export default function Link(p){return <a {...p}/>}`);
await writeFile(join(dir,'entry.tsx'),`import React from 'react';import {createRoot} from 'react-dom/client';import PublicCard from '${root}/components/cards/PublicCard';createRoot(document.getElementById('root')).render(<PublicCard token={'a'.repeat(48)} referral={location.pathname.includes('referral')} content={{name:'Daniel Phillippe',title:'Founder',company:'WolfGrid',bio:'Great meeting you! Stay connected, explore my latest updates, or introduce someone I can help.',phone:'+12896752788',email:'demo@example.com',photo:'',reviewUrl:'https://example.com/reviews',socials:[{platform:'Instagram',url:'https://instagram.com/'},{platform:'Facebook',url:'https://facebook.com/'},{platform:'LinkedIn',url:'https://linkedin.com/'},{platform:'TikTok',url:'https://tiktok.com/'},{platform:'YouTube',url:'https://youtube.com/'},{platform:'X',url:'https://x.com/'},{platform:'Website',url:'https://wolfgrid.app/'}]}}/>);`);
await build({entryPoints:[join(dir,'entry.tsx')],bundle:true,outfile:join(dir,'bundle.js'),jsx:'automatic',nodePaths:[join(root,'node_modules')],alias:{'next/image':join(dir,'image.tsx'),'next/link':join(dir,'link.tsx')},define:{'process.env.NODE_ENV':'"development"'}});
const events=[];const referrals=[];
createServer(async(req,res)=>{
 const url=new URL(req.url,'http://localhost:4318');
 if(url.pathname==='/bundle.js'){res.setHeader('Content-Type','text/javascript');res.end(await readFile(join(dir,'bundle.js')));return;}
 if(url.pathname==='/bundle.css'){res.setHeader('Content-Type','text/css');let css=await readFile(join(dir,'bundle.css'),'utf8');css=css.replace(/@media\s*\(prefers-color-scheme:\s*dark\)/g,url.searchParams.get('theme')==='dark'?'@media all':'@media not all');res.end(css);return;}
 if(url.pathname==='/fixture-status'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({events,referrals}));return;}
 if(url.pathname.startsWith('/api/cards/')){let raw='';for await(const chunk of req)raw+=chunk;const body=JSON.parse(raw||'{}');res.setHeader('Content-Type','application/json');if(url.pathname.endsWith('/events'))events.push(body);if(url.pathname.endsWith('/referrals'))referrals.push(body);res.end(JSON.stringify(url.pathname.endsWith('/referral-link')?{url:'http://localhost:4318/referral'}:{ok:true}));return;}
 res.setHeader('Content-Type','text/html');res.end(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"/><title>WolfCard local fixture</title><link rel="stylesheet" href="/bundle.css?theme=${url.searchParams.get('theme')||'light'}"/><style>body{margin:0}*{box-sizing:border-box}</style></head><body><div id="root"></div><script src="/bundle.js"></script></body></html>`);
}).listen(4318,'127.0.0.1',()=>console.log('Business card fixture http://localhost:4318 (no real messages or customer data)'));
