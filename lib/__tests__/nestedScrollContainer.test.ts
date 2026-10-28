import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { handleWheelScrollContainer } from '../scrollContainer';

const dom = new JSDOM('<div id="page"><div id="panel"><div id="content"></div></div></div>');
const page = dom.window.document.getElementById('page')!;
const panel = dom.window.document.getElementById('panel')!;
const content = dom.window.document.getElementById('content')!;
Object.defineProperties(page, { clientHeight: { value: 600 }, scrollHeight: { value: 600 } });
Object.defineProperties(panel, { clientHeight: { value: 400 }, scrollHeight: { value: 800 }, scrollTop: { value: 0, writable: true } });
page.addEventListener('wheel', event => handleWheelScrollContainer(event as unknown as WheelEvent, page), { passive: false });
const wheel = (deltaY: number) => {
  const event = new dom.window.WheelEvent('wheel', { deltaY, bubbles: true, cancelable: true });
  content.dispatchEvent(event);
  return event;
};
assert.equal(wheel(100).defaultPrevented, true, 'The outer page previously canceled panel wheel scrolling');
panel.addEventListener('wheel', event => handleWheelScrollContainer(event as unknown as WheelEvent, panel), { passive: false });
assert.equal(wheel(100).defaultPrevented, false, 'The panel must allow native downward scrolling');
panel.scrollTop = 100;
assert.equal(wheel(-100).defaultPrevented, false, 'The panel must allow native upward scrolling');
panel.scrollTop = 400;
assert.equal(wheel(100).defaultPrevented, true, 'At the bottom, scrolling must not chain to the page');
dom.window.close();
console.log('Nested panel wheel scrolling passed.');
