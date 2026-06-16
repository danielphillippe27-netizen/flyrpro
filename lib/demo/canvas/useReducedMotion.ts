export function getInitialReducedMotion() {
  return matchMedia('(prefers-reduced-motion: reduce)').matches;
}
