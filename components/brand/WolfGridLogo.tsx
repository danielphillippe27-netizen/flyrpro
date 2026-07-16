import Image from 'next/image';

type WolfGridLogoProps = {
  kind?: 'combined' | 'text' | 'auth';
  className?: string;
  priority?: boolean;
  surface?: 'auto' | 'light' | 'dark';
};

export function WolfGridLogo({
  kind = 'text',
  className = 'h-10 w-auto',
  priority = false,
  surface = 'auto',
}: WolfGridLogoProps) {
  const prefix = `/brand/wolfgrid-${kind}`;
  const dimensions = kind === 'text'
    ? { width: 1900, height: 250 }
    : kind === 'combined'
      ? { width: 2000, height: 500 }
      : { width: 2000, height: 1000 };

  if (surface !== 'auto') {
    return (
      <Image
        src={`${prefix}-${surface}.svg`}
        alt="WolfGrid"
        {...dimensions}
        className={className}
        priority={priority}
      />
    );
  }

  return (
    <>
      <Image src={`${prefix}-light.svg`} alt="WolfGrid" {...dimensions} className={`${className} dark:hidden`} priority={priority} />
      <Image src={`${prefix}-dark.svg`} alt="WolfGrid" {...dimensions} className={`hidden ${className} dark:block`} priority={priority} />
    </>
  );
}
