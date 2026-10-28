'use client';

import { useRef } from 'react';
import Link from 'next/link';
import { Layers, Menu, X } from 'lucide-react';
import { content as c } from './content';
import s from './preview.module.css';

function Logo() {
  return <Link href="/linear-preview" aria-label="WolfGrid preview home" className={s.brand}><Layers size={24} strokeWidth={1.8} />{c.brand}</Link>;
}

export default function PreviewHeader() {
  const menu = useRef<HTMLDialogElement>(null);
  const closeMenu = () => menu.current?.close();
  return <header className={s.header}>
    <div className={s.nav}>
      <Logo />
      <nav aria-label="Main navigation" className={s.desktopNav}>
        <a href="#territories">Product</a><a href="#connected">Integrations</a><a href="#teams">Teams</a><Link href="/plans">Pricing</Link><Link href="/download">Download</Link><span className={s.navDivider}/><Link href="/login">Log in</Link><Link href={c.primary.href} className={s.navButton}>Sign up</Link>
      </nav>
      <div className={s.mobileActions}><Link href="/login">Log in</Link><Link href={c.primary.href} className={s.navButton}>Sign up</Link><button type="button" aria-label="Open navigation" aria-haspopup="dialog" onClick={() => menu.current?.showModal()}><Menu size={19}/></button></div>
    </div>
    <dialog ref={menu} className={s.menuDialog} aria-label="Site navigation">
      <div className={s.dialogHeader}><Logo/><div className={s.mobileActions}><Link href="/login">Log in</Link><Link href={c.primary.href} className={s.navButton}>Sign up</Link><button type="button" aria-label="Close navigation" onClick={closeMenu}><X size={19}/></button></div></div>
      <nav aria-label="Mobile navigation" className={s.menuLinks} onClick={event => { if ((event.target as HTMLElement).closest('a')) closeMenu(); }}>
        <span>System</span>{c.sections.map(section => <a key={section.id} href={`#${section.id}`}>{({ territories: 'Territories and planning', conversations: 'Leads and follow-ups', teams: 'Team and performance', connected: 'Connected workflows' })[section.id]}</a>)}
        <span>Product</span><a href="#connected">Integrations</a><Link href="/plans">Pricing</Link><Link href="/download">Download</Link>
        <span>Resources</span><Link href={c.demo.href}>Interactive demo</Link><Link href="/privacy">Privacy</Link><Link href="/terms">Terms</Link>
      </nav>
    </dialog>
  </header>;
}
