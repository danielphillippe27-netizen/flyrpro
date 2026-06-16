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

        section:is(#b1, #b2, #b3, #b4, #b5, #b6) {
          position: relative;
          min-height: 100vh;
          padding: 14vh 8vw;
          display: flex;
          flex-direction: column;
          justify-content: center;
        }

        .eyebrow {
          font-family: var(--mono);
          font-size: 12px;
          font-weight: 500;
          letter-spacing: .22em;
          text-transform: uppercase;
          display: flex;
          align-items: center;
          gap: 14px;
          margin-bottom: 4vh;
        }

        .eyebrow::before {
          content: "";
          display: block;
          width: 34px;
          height: 2px;
          background: currentColor;
        }

        h1,
        h2 {
          font-family: var(--disp);
          font-weight: 900;
          font-stretch: 73%;
          text-transform: uppercase;
          line-height: .92;
          letter-spacing: -.01em;
        }

        .h-mega {
          font-size: clamp(52px,11vw,158px);
        }

        .h-big {
          font-size: clamp(40px,7.6vw,104px);
        }

        .accent {
          color: var(--orange);
        }

        .sub {
          max-width: 54ch;
          font-size: clamp(14px,1.4vw,17px);
          opacity: .78;
          margin-top: 3.5vh;
        }

        .rv {
          opacity: 0;
          transform: translateY(34px);
          transition: opacity .8s cubic-bezier(.2,.7,.2,1), transform .8s cubic-bezier(.2,.7,.2,1);
        }

        .rv.d1 {
          transition-delay: .12s;
        }

        .rv.d2 {
          transition-delay: .24s;
        }

        .rv.d3 {
          transition-delay: .38s;
        }

        .rv.d4 {
          transition-delay: .52s;
        }

        .in .rv {
          opacity: 1;
          transform: none;
        }

        .light {
          background: var(--paper);
          color: var(--ink);
        }

        .light ::selection {
          background: var(--ink);
          color: var(--paper);
        }

        #b1 {
          align-items: flex-start;
          overflow: hidden;
        }

        #b1 .coords {
          position: absolute;
          top: 26px;
          right: 8vw;
          font-size: 12px;
          letter-spacing: .12em;
          opacity: .55;
          text-align: right;
          line-height: 1.9;
        }

        #b1 .trace {
          position: absolute;
          inset: 0;
          width: 100%;
          height: 100%;
          opacity: .5;
          pointer-events: none;
        }

        #b1 .trace path {
          fill: none;
          stroke: var(--orange);
          stroke-width: 1.6;
          stroke-dasharray: 3000;
          stroke-dashoffset: 3000;
          animation: trace 7s ease-out .4s forwards;
        }

        @keyframes trace {
          to {
            stroke-dashoffset: 0;
          }
        }

        .scrollcue {
          position: absolute;
          bottom: 30px;
          left: 8vw;
          font-size: 12px;
          letter-spacing: .22em;
          opacity: .5;
          animation: cue 2.2s ease-in-out infinite;
        }

        @keyframes cue {
          0%,
          100% {
            transform: translateY(0);
          }

          50% {
            transform: translateY(8px);
          }
        }

        .wordmark {
          position: absolute;
          top: 26px;
          left: 8vw;
          font-family: var(--disp);
          font-weight: 900;
          font-stretch: 73%;
          font-size: 18px;
          letter-spacing: .04em;
        }

        .wordmark b {
          color: var(--orange);
        }

        #b2 .strikes {
          display: flex;
          flex-direction: column;
          gap: 1.2vh;
          margin: 4.5vh 0;
        }

        .strike {
          font-family: var(--disp);
          font-weight: 900;
          font-stretch: 73%;
          text-transform: uppercase;
          font-size: clamp(26px,4.6vw,62px);
          line-height: 1.04;
          position: relative;
          width: max-content;
          max-width: 100%;
          opacity: .34;
        }

        .strike::after {
          content: "";
          position: absolute;
          left: -2%;
          top: 52%;
          height: .09em;
          width: 0;
          background: var(--orange);
          transition: width .55s cubic-bezier(.7,0,.3,1);
        }

        .in .strike::after {
          width: 104%;
        }

        .in .strike:nth-child(1)::after {
          transition-delay: .5s;
        }

        .in .strike:nth-child(2)::after {
          transition-delay: .85s;
        }

        .in .strike:nth-child(3)::after {
          transition-delay: 1.2s;
        }

        .mathrow {
          border-top: 2px solid var(--ink);
          border-bottom: 2px solid var(--ink);
          display: flex;
          flex-wrap: wrap;
          margin-top: 5vh;
        }

        .mathcell {
          flex: 1 1 160px;
          padding: 22px 22px 22px 0;
          border-right: 2px solid var(--ink);
        }

        .mathcell:last-child {
          border-right: none;
          padding-left: 22px;
        }

        .mathcell .k {
          font-size: 11px;
          letter-spacing: .2em;
          text-transform: uppercase;
          opacity: .6;
        }

        .mathcell .v {
          font-family: var(--disp);
          font-weight: 900;
          font-stretch: 73%;
          font-size: clamp(26px,3.6vw,52px);
          line-height: 1.1;
        }

        .mathcell.hot .v {
          color: var(--orange);
        }

        #b6 {
          text-align: left;
        }

        #b6 .price {
          font-size: clamp(64px,14vw,200px);
        }

        .cta-row {
          display: flex;
          flex-wrap: wrap;
          gap: 18px;
          margin-top: 5vh;
          align-items: center;
        }

        .btn {
          font-family: var(--mono);
          font-weight: 700;
          font-size: 14px;
          letter-spacing: .16em;
          text-transform: uppercase;
          background: var(--orange);
          color: var(--ink);
          border: 2px solid var(--orange);
          padding: 20px 34px;
          text-decoration: none;
          cursor: pointer;
          transition: all .15s;
        }

        .btn:hover,
        .btn:focus-visible {
          background: transparent;
          color: var(--orange);
          outline: none;
        }

        .btn.ghost {
          background: transparent;
          color: var(--paper);
          border-color: var(--paper);
        }

        .btn.ghost:hover,
        .btn.ghost:focus-visible {
          border-color: var(--orange);
          color: var(--orange);
        }

        .founder {
          margin-top: 6vh;
          font-size: 13px;
          letter-spacing: .06em;
          opacity: .7;
          max-width: 46ch;
          line-height: 2;
        }

        .founder b {
          color: var(--orange);
        }

        footer {
          padding: 26px 8vw;
          border-top: 1px solid #2c2c27;
          font-size: 11px;
          letter-spacing: .18em;
          text-transform: uppercase;
          opacity: .45;
          display: flex;
          justify-content: space-between;
          flex-wrap: wrap;
          gap: 10px;
        }

        @media (prefers-reduced-motion: reduce) {
          *,
          *::before,
          *::after {
            animation: none !important;
            transition: none !important;
          }

          .rv {
            opacity: 1;
            transform: none;
          }
        }
      `}</style>
      {children}
    </>
  );
}
