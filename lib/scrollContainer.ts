/**
 * Handles wheel events on a scroll container so only that container scrolls
 * and scroll does not chain to the page or sibling containers.
 * Must be attached with addEventListener(..., { passive: false }) so
 * preventDefault() is respected.
 *
 * - If the container can scroll in the direction of deltaY: allow default
 *   (native scroll) and stopPropagation so parent/page does not scroll.
 * - If the container is at top/bottom: preventDefault + stopPropagation
 *   so the page never scrolls when the pointer is over this container.
 */
export function handleWheelScrollContainer(
  e: WheelEvent,
  el: HTMLElement | null
): void {
  if (!el) return;

  const { scrollTop, scrollHeight, clientHeight } = el;
  const maxScroll = scrollHeight - clientHeight;
  const canScrollUp = scrollTop > 0;
  const canScrollDown = maxScroll > 0 && scrollTop < maxScroll - 0.5;

  if (e.deltaY < 0) {
    if (canScrollUp) {
      e.stopPropagation();
    } else {
      e.preventDefault();
      e.stopPropagation();
    }
  } else if (e.deltaY > 0) {
    if (canScrollDown) {
      e.stopPropagation();
    } else {
      e.preventDefault();
      e.stopPropagation();
    }
  } else {
    e.stopPropagation();
  }
}

/**
 * Returns a wheel listener that can be passed to addEventListener.
 * Use with { passive: false } so preventDefault works.
 */
export function createWheelScrollHandler(el: HTMLElement | null) {
  return (e: WheelEvent) => handleWheelScrollContainer(e, el);
}
