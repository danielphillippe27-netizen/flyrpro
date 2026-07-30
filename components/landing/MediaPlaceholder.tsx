import { ImageIcon, Play, Video } from 'lucide-react';

type MediaPlaceholderProps = {
  label: string;
  detail?: string;
  kind?: 'image' | 'video' | 'screen';
  className?: string;
};

export function MediaPlaceholder({
  label,
  detail,
  kind = 'screen',
  className = '',
}: MediaPlaceholderProps) {
  const Icon = kind === 'image' ? ImageIcon : kind === 'video' ? Video : Play;

  return (
    <div
      className={`group relative isolate flex min-h-56 items-center justify-center overflow-hidden rounded-[2rem] border border-white/10 bg-[#171717] text-white shadow-2xl shadow-black/20 ${className}`}
    >
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_18%_20%,rgba(239,68,68,0.2),transparent_30%),radial-gradient(circle_at_82%_72%,rgba(255,255,255,0.08),transparent_28%)]" />
      <div className="absolute inset-3 rounded-[1.45rem] border border-dashed border-white/15" />
      <div className="relative flex max-w-sm flex-col items-center px-8 text-center">
        <span className="flex h-12 w-12 items-center justify-center rounded-2xl border border-white/10 bg-white/5 text-red-400">
          <Icon className="h-5 w-5" aria-hidden="true" />
        </span>
        <p className="mt-4 text-sm font-bold uppercase tracking-[0.16em] text-white">{label}</p>
        {detail && <p className="mt-2 text-xs leading-relaxed text-zinc-400">{detail}</p>}
      </div>
    </div>
  );
}
