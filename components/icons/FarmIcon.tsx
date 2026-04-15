import type { SVGProps } from 'react';

export function FarmIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M12 20v-7.5" vectorEffect="non-scaling-stroke" />
      <path d="M12 14.2c0-2.8-2-4.7-5-4.7 0 3 2 4.7 5 4.7Z" vectorEffect="non-scaling-stroke" />
      <path d="M12 11.7c.1-2.8 2.1-4.7 5-4.7 0 3-2 4.7-5 4.7Z" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
