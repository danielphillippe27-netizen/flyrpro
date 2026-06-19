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
          min-height: 100dvh;
          padding: 14vh 8vw;
          padding: 14dvh 8vw;
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
          overflow: hidden;
          contain: layout paint;
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

        .stage {
          position: relative;
          width: 100%;
          border: 2px solid currentColor;
          margin-top: 4vh;
          aspect-ratio: 16/9;
          max-height: 62vh;
          max-height: 62dvh;
          overflow: hidden;
        }

        @media(max-width:760px) {
          .stage {
            aspect-ratio: 4/5;
          }
        }

        .stage canvas {
          position: absolute;
          inset: 0;
          width: 100%;
          height: 100%;
          display: block;
        }

        .stage .hud {
          position: absolute;
          left: 0;
          right: 0;
          bottom: 0;
          display: flex;
          justify-content: space-between;
          align-items: flex-end;
          padding: 14px 16px;
          font-size: 12px;
          letter-spacing: .14em;
          text-transform: uppercase;
          pointer-events: none;
        }

        .counter {
          font-family: var(--disp);
          font-weight: 900;
          font-stretch: 73%;
          font-size: clamp(30px,4.4vw,58px);
          line-height: 1;
        }

        .counter small {
          display: block;
          font-family: var(--mono);
          font-weight: 500;
          font-size: 11px;
          letter-spacing: .2em;
          margin-top: 6px;
        }

        .demo-map-label {
          position: absolute;
          top: 17px;
          left: 16px;
          z-index: 5;
          max-width: calc(100% - 240px);
          overflow: hidden;
          font-family: var(--mono);
          font-size: 13px;
          font-weight: 700;
          letter-spacing: .2em;
          line-height: 1.4;
          text-transform: uppercase;
          text-overflow: ellipsis;
          white-space: nowrap;
          color: var(--ink);
          opacity: .84;
          pointer-events: none;
        }

        .demo-map-counter {
          margin-bottom: 44px;
        }

        .demo-campaign-detail-stage {
          width: 100%;
          aspect-ratio: 4/3;
          max-height: 100vh;
          max-height: 100dvh;
          display: flex;
          flex-direction: column;
          background: #ffffff;
          color: oklch(0.145 0 0);
        }

        .demo-campaign-map-area {
          position: relative;
          flex: 1 1 auto;
          width: 100%;
          height: 100%;
          min-height: 100%;
          overflow: hidden;
          background: #f4f5f3;
        }

        @media(max-width:760px) {
          .demo-map-label {
            max-width: calc(100% - 180px);
            font-size: 11px;
            letter-spacing: .16em;
          }

          .demo-map-counter {
            margin-bottom: 46px;
          }

          .demo-campaign-detail-stage {
            width: 100%;
            aspect-ratio: 4/5;
          }
        }

        .replay {
          position: absolute;
          top: 14px;
          right: 14px;
          z-index: 5;
          font-family: var(--mono);
          font-size: 12px;
          letter-spacing: .16em;
          text-transform: uppercase;
          background: var(--ink);
          color: var(--paper);
          border: 2px solid var(--ink);
          padding: 10px 18px;
          min-height: 44px;
          cursor: pointer;
          transition: background .2s,color .2s;
        }

        .replay:hover,
        .replay:focus-visible {
          background: var(--orange);
          border-color: var(--orange);
          color: var(--ink);
          outline: none;
        }

        #b4 .replay {
          background: var(--paper);
          color: var(--ink);
          border-color: var(--paper);
        }

        #b4 .replay:hover,
        #b4 .replay:focus-visible {
          background: var(--orange);
          border-color: var(--orange);
        }

        #b4 .grid4 {
          display: grid;
          grid-template-columns: 1fr 300px;
          gap: 18px;
          margin-top: 4vh;
        }

        @media(max-width:980px) {
          #b4 .grid4 {
            grid-template-columns: 1fr;
          }
        }

        #b4 .stage {
          margin-top: 0;
          border-color: #3a3a35;
        }

        .panel {
          border: 2px solid #3a3a35;
          display: flex;
          flex-direction: column;
          min-height: 0;
        }

        .panel h3 {
          font-family: var(--mono);
          font-size: 11px;
          font-weight: 700;
          letter-spacing: .22em;
          text-transform: uppercase;
          padding: 12px 14px;
          border-bottom: 2px solid #3a3a35;
          color: var(--orange);
        }

        .feed {
          flex: 1;
          overflow: hidden;
          padding: 10px 14px;
          font-size: 12px;
          line-height: 2.1;
          display: flex;
          flex-direction: column;
          justify-content: flex-end;
          min-height: 150px;
        }

        .feed div {
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          animation: feedin .4s ease-out;
        }

        @keyframes feedin {
          from {
            opacity: 0;
            transform: translateY(8px);
          }

          to {
            opacity: 1;
            transform: none;
          }
        }

        .feed .ok {
          color: var(--green);
        }

        .feed .nh {
          color: var(--amber);
        }

        .feed .dk {
          color: var(--red);
        }

        .lb {
          padding: 10px 14px;
          border-top: 2px solid #3a3a35;
        }

        .lb .row {
          display: flex;
          justify-content: space-between;
          font-size: 12px;
          line-height: 2.2;
        }

        .lb .row b {
          font-weight: 700;
        }

        .lb .row .n {
          font-family: var(--disp);
          font-weight: 900;
          font-size: 16px;
        }

        .demo-session-card {
          margin-top: 4vh;
          border: 2px solid #3a3a35;
          background: rgba(217, 213, 203, .035);
          color: var(--paper);
          overflow: hidden;
        }

        .demo-session-header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          gap: 18px;
          padding: 16px 18px;
          border-bottom: 2px solid #3a3a35;
        }

        .demo-session-header h3 {
          margin: 0;
          font-family: var(--mono);
          font-size: 13px;
          font-weight: 700;
          letter-spacing: .18em;
          text-transform: uppercase;
          color: var(--orange);
        }

        .demo-session-header p {
          margin: 6px 0 0;
          font-family: var(--mono);
          font-size: 12px;
          color: var(--paper);
          opacity: .68;
        }

        .demo-session-header span {
          border: 1px solid #3a3a35;
          padding: 5px 8px;
          font-family: var(--mono);
          font-size: 10px;
          font-weight: 700;
          letter-spacing: .16em;
          text-transform: uppercase;
          color: var(--paper-deep);
          white-space: nowrap;
        }

        .demo-session-mapbox,
        .demo-session-fallback-map {
          display: block;
          width: 100%;
          height: 360px;
          background: var(--ink);
          border-bottom: 2px solid #3a3a35;
        }

        .demo-session-stats {
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 0;
        }

        .demo-session-stats div {
          min-height: 78px;
          padding: 12px 14px;
          border-right: 2px solid #3a3a35;
          border-bottom: 2px solid #3a3a35;
        }

        .demo-session-stats div:nth-child(4n),
        .demo-session-stats div:last-child {
          border-right: 0;
        }

        .demo-session-stats div:nth-last-child(-n+4) {
          border-bottom: 0;
        }

        .demo-session-stats .wide {
          grid-column: span 2;
        }

        .demo-session-stats small {
          display: block;
          margin-bottom: 8px;
          font-family: var(--mono);
          font-size: 10px;
          font-weight: 500;
          letter-spacing: .14em;
          text-transform: uppercase;
          color: var(--paper);
          opacity: .62;
        }

        .demo-session-stats b {
          font-family: var(--mono);
          font-size: 18px;
          font-weight: 700;
          line-height: 1.2;
          color: var(--paper);
        }

        @media(max-width:760px) {
          .demo-session-header {
            flex-direction: column;
          }

          .demo-session-mapbox,
          .demo-session-fallback-map {
            height: 300px;
          }

          .demo-session-stats {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }

          .demo-session-stats div:nth-child(4n) {
            border-right: 2px solid #3a3a35;
          }

          .demo-session-stats div:nth-child(2n),
          .demo-session-stats div:last-child {
            border-right: 0;
          }

          .demo-session-stats div:nth-last-child(-n+4) {
            border-bottom: 2px solid #3a3a35;
          }

          .demo-session-stats div:nth-last-child(-n+2) {
            border-bottom: 0;
          }
        }

        #b5 .duo {
          display: grid;
          grid-template-columns: 1.1fr .9fr;
          gap: 6vw;
          align-items: center;
          margin-top: 2vh;
        }

        @media(max-width:900px) {
          #b5 .duo {
            grid-template-columns: 1fr;
          }
        }

        .phone {
          width: min(330px,86vw);
          box-sizing: border-box;
          margin: 0 auto;
          background: var(--ink);
          color: var(--paper);
          border: 3px solid var(--ink);
          border-radius: 34px;
          padding: 14px;
          box-shadow: 14px 14px 0 rgba(12,12,10,.18);
        }

        .screen {
          background: #161613;
          border-radius: 22px;
          overflow: hidden;
          display: flex;
          flex-direction: column;
          min-height: 480px;
        }

        .appbar {
          display: flex;
          justify-content: space-between;
          padding: 14px 16px;
          font-size: 11px;
          letter-spacing: .14em;
          border-bottom: 1px solid #2c2c27;
        }

        .appbar b {
          color: var(--orange);
        }

        .doorcard {
          padding: 18px 16px;
          border-bottom: 1px solid #2c2c27;
        }

        .doorcard .addr {
          font-family: var(--disp);
          font-weight: 900;
          font-stretch: 73%;
          font-size: 26px;
          text-transform: uppercase;
          line-height: 1;
        }

        .doorcard .meta {
          font-size: 11px;
          letter-spacing: .12em;
          opacity: .6;
          margin-top: 8px;
        }

        .outs {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 10px;
          padding: 16px;
        }

        .outs button {
          font-family: var(--mono);
          font-size: 12px;
          letter-spacing: .1em;
          text-transform: uppercase;
          font-weight: 700;
          padding: 14px 8px;
          min-height: 44px;
          background: transparent;
          color: var(--paper);
          border: 2px solid #3a3a35;
          cursor: pointer;
          transition: all .15s;
        }

        .outs button:hover,
        .outs button:focus-visible {
          border-color: var(--paper);
          outline: none;
        }

        .outs button.sel-ok {
          background: var(--green);
          border-color: var(--green);
          color: var(--ink);
        }

        .outs button.sel-nh {
          background: var(--amber);
          border-color: var(--amber);
          color: var(--ink);
        }

        .outs button.sel-na {
          background: #888;
          border-color: #888;
          color: var(--ink);
        }

        .outs button.sel-dk {
          background: var(--red);
          border-color: var(--red);
          color: var(--ink);
        }

        .leadflow {
          padding: 0 16px 18px;
          display: none;
          flex-direction: column;
          gap: 8px;
        }

        .leadflow.show {
          display: flex;
        }

        .leadline {
          display: flex;
          justify-content: space-between;
          font-size: 12px;
          border-bottom: 1px dashed #3a3a35;
          padding: 8px 0;
        }

        .leadline span:first-child {
          opacity: .55;
        }

        .sync {
          margin-top: 10px;
          font-size: 12px;
          letter-spacing: .14em;
          text-transform: uppercase;
          font-weight: 700;
          border: 2px solid var(--green);
          color: var(--green);
          padding: 10px 12px;
          text-align: center;
          opacity: 0;
          transform: translateY(8px);
          transition: all .5s .5s;
        }

        .leadflow.show .sync {
          opacity: 1;
          transform: none;
        }

        #b5 .pitch li {
          list-style: none;
          font-size: clamp(14px,1.5vw,17px);
          padding: 14px 0;
          border-bottom: 2px solid var(--ink);
          display: flex;
          gap: 14px;
        }

        #b5 .pitch li::before {
          content: "→";
          color: var(--orange);
          font-weight: 700;
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
          min-height: 44px;
          max-width: 100%;
          box-sizing: border-box;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          text-align: center;
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
