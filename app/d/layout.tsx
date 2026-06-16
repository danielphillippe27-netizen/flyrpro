import type { Metadata } from 'next';
import { Archivo, IBM_Plex_Mono } from 'next/font/google';
import type { ReactNode } from 'react';

const archivo = Archivo({
  weight: 'variable',
  axes: ['wdth'],
  subsets: ['latin'],
  display: 'swap',
});

const ibmPlexMono = IBM_Plex_Mono({
  weight: ['400', '500', '700'],
  subsets: ['latin'],
  display: 'swap',
});

export const metadata: Metadata = {
  robots: {
    index: false,
    follow: false,
  },
};

export default function DemoLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <style>{`
        :root {
          --ink: #0c0c0a;
          --paper: #d9d5cb;
          --paper-deep: #cfcabe;
          --orange: #ff4d00;
          --green: #27c878;
          --amber: #ffb000;
          --red: #e53935;
          --mono: ${ibmPlexMono.style.fontFamily};
          --disp: ${archivo.style.fontFamily};
        }

        html {
          scroll-behavior: smooth;
        }

        body {
          background: var(--ink);
          color: var(--paper);
          font-family: var(--mono);
          font-size: 15px;
          line-height: 1.5;
          overflow-x: hidden;
        }

        body ::selection {
          background: var(--orange);
          color: var(--ink);
        }
      `}</style>
      {children}
    </>
  );
}
