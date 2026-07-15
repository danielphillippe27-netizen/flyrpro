import Link from "next/link";
import Image from "next/image";

export const Logo = () => {
  return (
    <Link href="/">
      <div className="relative h-8 w-24 shrink-0">
        <Image
          src="/brand/wolfgrid-text-light.svg"
          fill
          alt="WolfGrid"
          className="shrink-0 object-contain hover:opacity-75 transition"
        />
      </div>
    </Link>
  );
};
