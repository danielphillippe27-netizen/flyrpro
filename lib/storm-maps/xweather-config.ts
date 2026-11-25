export function isXweatherEnabled(): boolean {
  return process.env.XWEATHER_ENABLED === 'true';
}
