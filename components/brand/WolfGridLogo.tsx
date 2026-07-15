import Image from 'next/image';

type WolfGridLogoProps = {
  kind?: 'combined' | 'text' | 'auth';
  className?: string;
  priority?: boolean;
};

export function WolfGridLogo({ kind = 'text', className = 'h-10 w-auto', priority = false }: WolfGridLogoProps) {
  const prefix = `/brand/wolfgrid-${kind}`;
  return (
    <>
      <Image src={`${prefix}-light.svg`} alt="WolfGrid" width={400} height={200} className={`${className} dark:hidden`} priority={priority} />
      <Image src={`${prefix}-dark.svg`} alt="WolfGrid" width={400} height={200} className={`hidden ${className} dark:block`} priority={priority} />
    </>
  );
}
