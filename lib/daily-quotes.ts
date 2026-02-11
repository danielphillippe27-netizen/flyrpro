/**
 * Daily motivation quotes for Home dashboard.
 * One quote per day (rotated by day of year).
 * TODO: Admin/dev ability to update today's quote (feature flag or role check).
 */

const QUOTES = [
  'The best way to get started is to quit talking and begin doing.',
  'It does not matter how slowly you go as long as you do not stop.',
  'Quality is not an act, it is a habit.',
  'The only impossible journey is the one you never begin.',
  'Success usually comes to those who are too busy to be looking for it.',
  'Do one thing every day that scares you.',
  'Believe you can and you\'re halfway there.',
  'The secret of getting ahead is getting started.',
  'Don’t watch the clock; do what it does. Keep going.',
  'You don’t have to be great to start, but you have to start to be great.',
  'Small steps every day add up to big results.',
  'Your only limit is you.',
  'Every door is an opportunity.',
  'Consistency beats intensity.',
  'Show up. Knock. Repeat.',
];

/** Returns the quote for today (stable for the same calendar day). */
export function getQuoteForToday(): string {
  const now = new Date();
  const start = new Date(now.getFullYear(), 0, 0);
  const diff = now.getTime() - start.getTime();
  const dayOfYear = Math.floor(diff / (1000 * 60 * 60 * 24));
  const index = dayOfYear % QUOTES.length;
  return QUOTES[index] ?? QUOTES[0];
}
