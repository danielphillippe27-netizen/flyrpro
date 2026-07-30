import Image from 'next/image';
import { LandingVideo } from '@/components/landing/LandingVideo';

type PhoneVideoFrameProps = {
  videoId: string;
  label: string;
  orientation: 'landscape' | 'portrait';
  className?: string;
};

export function PhoneVideoFrame({
  videoId,
  label,
  orientation,
  className = '',
}: PhoneVideoFrameProps) {
  const isLandscape = orientation === 'landscape';

  return (
    <div
      className={`relative ${isLandscape ? 'aspect-[1451/720]' : 'aspect-[720/1451]'} ${className}`}
    >
      <Image
        src="/lgdemo/phone-frame.png"
        alt=""
        width={720}
        height={1451}
        aria-hidden="true"
        className={
          isLandscape
            ? 'pointer-events-none absolute left-1/2 top-1/2 z-0 h-auto w-[49.62%] max-w-none -translate-x-1/2 -translate-y-1/2 rotate-90 select-none grayscale saturate-0 brightness-75 contrast-125'
            : 'pointer-events-none absolute inset-0 z-0 h-full w-full select-none grayscale saturate-0 brightness-75 contrast-125'
        }
      />

      <div
        className={
          isLandscape
            ? 'absolute inset-x-[3.4%] inset-y-[5.7%] z-10 overflow-hidden rounded-[10%] bg-black'
            : 'absolute inset-x-[5.7%] inset-y-[3.4%] z-10 overflow-hidden rounded-[11%] bg-black'
        }
      >
        <LandingVideo
          videoId={videoId}
          label={label}
          className="h-full w-full scale-[1.24] rounded-none shadow-none"
          videoClassName="object-cover"
        />
      </div>

      <div
        aria-hidden="true"
        className={
          isLandscape
            ? 'pointer-events-none absolute right-[4.6%] top-1/2 z-20 h-[22%] w-[2.4%] -translate-y-1/2 rounded-full bg-black'
            : 'pointer-events-none absolute left-1/2 top-[5%] z-20 h-[2.2%] w-[22%] -translate-x-1/2 rounded-full bg-black'
        }
      />
    </div>
  );
}
