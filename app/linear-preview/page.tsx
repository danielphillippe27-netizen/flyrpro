import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { ArrowUpRight, ArrowRight, Crosshair, Map, Layers, Users, Zap, Plus, Command, Check, Circle, Navigation, Activity } from 'lucide-react';
import { content as c } from './content';
import s from './preview.module.css';
import PreviewHeader from './PreviewHeader';

export const metadata: Metadata = {
  title: 'Field sales, connected — Design preview',
  description: c.hero.description,
  robots: { index: false, follow: false },
};

function Brand() {
  return <span className={s.brand}><span className={s.brandMark} aria-hidden="true"><Layers size={22} strokeWidth={1.8} /></span>{c.brand}</span>;
}

function FeatureList({ items }: { items: readonly (readonly [string, string])[] }) {
  return <div className={s.features}><span>Features</span><div>{items.map(([title, body]) => <details key={title}><summary>{title}<Plus size={14} /></summary><p>{body}</p></details>)}</div></div>;
}

function ProductPanel() {
  return <div className={s.productPanel}>
    <aside className={s.sidebar} aria-hidden="true"><Brand /><div className={s.workspace}><Activity size={14} /> Overview</div><div><Map size={14} /> Territories</div><div><Users size={14} /> Leads</div><div><Layers size={14} /> Campaigns</div><small>Workspace</small><div><Users size={14} /> My team</div><div><Activity size={14} /> Performance</div><small>Favorites</small><div className={s.selected}><span className={s.dot} /> Just Sold</div><div><Circle size={13} /> North neighborhood</div><div><Circle size={13} /> Follow-ups</div><span className={s.sidebarBottom}>Your field. Connected.</span></aside>
    <div className={s.productMain}><div className={s.windowBar}><span><Map size={13} /> Campaigns <span className={s.dim}>/</span> Just Sold</span><span className={s.sample}>Product preview</span></div><Image src={c.hero.image} alt={c.hero.imageAlt} width={2048} height={1288} priority sizes="(max-width: 760px) 100vw, 1100px" className={s.dashboard} /></div>
  </div>;
}

function TerritoryVisual() {
  return <div className={`${s.visual} ${s.territoryVisual}`}><div className={s.panelBar}><span><Layers size={14} /> Your next territory</span><span className={s.live}><i /> Campaign view</span></div><Image src="/landing/interactive-demo-cover.png" alt="Three-dimensional WolfGrid neighborhood with color-coded homes" width={2622} height={1206} sizes="(max-width: 760px) 100vw, 1200px" /><div className={s.mapLegend}><span><i style={{background:'#37c677'}} /> Conversation</span><span><i style={{background:'#e4ba4d'}} /> Follow-up</span><span><i style={{background:'#6179ef'}} /> Lead</span></div></div>;
}

function LeadsVisual() {
  const columns = [{name:'New leads', color:'#8a8f98', names:['Roof inspection', 'Window replacement', 'Solar consultation']}, {name:'Follow-up',color:'#deb45b',names:['Schedule a visit', 'Send an estimate']}, {name:'Appointment',color:'#8d80e3',names:['Home consultation', 'Property walkthrough']}];
  return <div className={`${s.visual} ${s.leadsVisual}`}><div className={s.panelBar}><span><Layers size={14} /> Your pipeline</span><span className={s.sample}>Illustrative workflow</span></div><div className={s.board}>{columns.map((col,i) => <div key={col.name} className={s.column}><div className={s.columnTitle}><span><i style={{background:col.color}} /> {col.name} <em>{col.names.length}</em></span><Plus size={13} /></div>{col.names.map((name,j)=><div className={s.leadCard} key={name}><small>WG-{1024+i*3+j}</small><strong>{name}</strong><div><span className={s.tag}>{j===0?'North territory':'West territory'}</span><span className={s.avatar}>{['JD','AL','MK'][j]}</span></div></div>)}</div>)}</div><div className={s.activityNote}><span className={s.check}><Check size={14} /></span><div>Every conversation, connected.<small>Capture the details. Keep the next step in view.</small></div><ArrowUpRight size={17} /></div></div>;
}

function TeamVisual() {
  return <div className={`${s.visual} ${s.teamVisual}`}><div className={s.panelBar}><span><Activity size={14} /> Team overview</span><span className={s.sample}>Sample data · This week</span></div><div className={s.teamInner}><div className={s.metrics}>{[['Doors visited','1,284'],['Conversations','326'],['New leads','84']].map(([label,value])=><div key={label}><span>{label}</span><strong>{value}</strong></div>)}</div><div className={s.chart} role="img" aria-label="Illustrative chart of weekly team activity"><div className={s.chartGrid} />{[30,43,36,57,48,65,55,69,61,82,71,90,80,95,87,100,91,115,105,125,118,140,128,151,141,164,153,178].map((h,i)=><span key={i} style={{height:`${h}px`,opacity:0.4+i/48}} />)}</div><div className={s.chartAxis}><span>MON</span><span>TUE</span><span>WED</span><span>THU</span><span>FRI</span></div><div className={s.teamRow}><div><span className={s.avatar}>JD</span><span className={s.avatar}>AL</span><span className={s.avatar}>MK</span><span>Individual effort. Shared progress.</span></div><Users size={16}/></div></div></div>;
}

function ConnectedVisual() {
  return <div className={`${s.visual} ${s.connectedVisual}`}><div className={s.orbit} /><div className={s.orbitTwo} /><div className={s.connectionCenter}><Layers size={40} /><span>WolfGrid</span></div>{[{name:'HubSpot',image:'/integrations/hubspot.svg'},{name:'Zapier',image:'/integrations/zapier.svg'},{name:'Follow Up Boss',image:'/integrations/fub.svg'},{name:'monday.com',image:'/integrations/monday.svg'}].map((item,i)=><div className={`${s.integration} ${s[`integration${i}`]}`} key={item.name}><Image src={item.image} width={30} height={30} alt=""/><span>{item.name}</span></div>)}<span className={s.connectedCaption}>A place for the tools you already use.</span></div>;
}

export default function LinearPreview() {
  const visuals = [<TerritoryVisual key="map"/>,<LeadsVisual key="leads"/>,<TeamVisual key="team"/>,<ConnectedVisual key="connected"/>];
  return <div className={s.page}>
    <a href="#main" className={s.skip}>Skip to content</a>
    <PreviewHeader />
    <main id="main">
      <section className={s.hero}><div className={s.container}><h1>{c.hero.title}</h1><p>{c.hero.description}</p><Link href={c.demo.href} className={s.announcement}><span>New</span>{c.hero.announcement}<ArrowRight size={15}/></Link><div className={s.heroProduct}><ProductPanel /></div></div></section>
      <section className={`${s.container} ${s.industrySection}`} aria-label="Industries"><p>FOR THE TEAMS BUILDING THEIR BUSINESS, ONE DOOR AT A TIME</p><div>{c.industries.map(industry=><span key={industry}>{industry}</span>)}</div></section>
      <section className={`${s.container} ${s.intro}`}><h2><span>{c.intro.title}</span> {c.intro.description}</h2><div className={s.principles} role="region" aria-label="Product principles, swipe to explore" tabIndex={0}>{c.principles.map((p,i)=><article key={p.title}><small>FIG 0.{i+1}</small><div className={`${s.principleArt} ${s[`art${i}`]}`} aria-hidden="true">{i===0?<><div/><div/><div/><Crosshair size={44}/></>:i===1?<><span><Map size={24}/></span><span><Layers size={30}/></span><span><Users size={24}/></span></>:<><div/><div/><Zap size={52} strokeWidth={1}/></>}</div><h3>{p.title}</h3><p>{p.description}</p></article>)}</div></section>
      {c.sections.map((section,i)=><section className={`${s.container} ${s.featureSection}`} id={section.id} key={section.id}><div className={s.sectionHeading}><div><span className={s.eyebrow}><i />{section.label}</span><h2>{section.title}</h2></div><div><p>{section.description}</p><Link href={c.demo.href}>Explore the demo <ArrowRight size={15}/></Link></div></div>{visuals[i]}<FeatureList items={section.features}/></section>)}
      <section className={`${s.container} ${s.platforms}`}><div><Command size={22}/><h3>Plan at your desk.</h3><p>A clear view of territories, campaigns, and team activity.</p></div><div><Navigation size={22}/><h3>Make it happen in the field.</h3><p>Your next door, your next conversation, your next opportunity.</p></div><Link href="/download">Get WolfGrid <ArrowUpRight size={17}/></Link></section>
      <section className={s.closing}><div className={s.container}><span className={s.eyebrow}>{c.closing.description}</span><h2>{c.closing.title}</h2><div className={s.ctas}><Link href={c.primary.href} className={s.primaryButton}>{c.primary.label}<ArrowRight size={15}/></Link><Link href={c.demo.href} className={s.secondaryButton}>{c.demo.label}</Link></div></div></section>
    </main>
    <footer className={`${s.container} ${s.footer}`}><div><Brand/><p>Field sales, connected.</p></div><div><h3>Product</h3><a href="#territories">Territories</a><a href="#conversations">Leads & follow-ups</a><a href="#teams">Teams</a><Link href="/plans">Pricing</Link></div><div><h3>Resources</h3><Link href={c.demo.href}>Interactive demo</Link><Link href="/download">Download</Link><Link href="/login">Log in</Link></div><div><h3>WolfGrid</h3><Link href="/privacy">Privacy</Link><Link href="/terms">Terms</Link><Link href={c.primary.href}>Get started</Link></div><div className={s.footerBottom}>© {new Date().getFullYear()} WolfGrid Technologies Inc.<span>Built for the way you work.</span></div></footer>
  </div>;
}
