'use client';

import Image from 'next/image';

export default function EditorPage() {
  const editorUrl = process.env.NEXT_PUBLIC_EDITOR_URL;

  if (!editorUrl) {
    return (
      <div className="h-screen w-full bg-[#050509] flex items-center justify-center">
        <div className="text-center text-white">
          <h1 className="text-2xl font-semibold mb-2">Editor Not Configured</h1>
          <p className="text-white/50">
            Please set NEXT_PUBLIC_EDITOR_URL in your environment variables
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen w-full bg-[#050509] flex flex-col">
      <header className="h-14 border-b border-white/10 flex items-center px-4 justify-between">
        <div className="flex items-center gap-2">
          <Image 
            src="/flyr-logo-white.svg" 
            alt="FLYR" 
            width={24} 
            height={24}
            className="h-6 w-6"
          />
          <span className="font-semibold text-white">FLYR</span>
          <span className="text-xs text-white/50">Editor (beta)</span>
        </div>
      </header>

      <main className="flex-1">
        <iframe
          src={editorUrl}
          className="w-full h-full border-0"
          allow="clipboard-read; clipboard-write"
          title="FLYR Editor"
        />
      </main>
    </div>
  );
}



