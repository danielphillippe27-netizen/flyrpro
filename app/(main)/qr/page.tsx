'use client';

import { QRWorkflowView } from '@/components/qr/QRWorkflowView';

export default function QRPage() {
  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b sticky top-0 z-10">
        <div className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8 py-4">
          <h1 className="text-2xl font-bold">QR Codes</h1>
        </div>
      </header>
      <main className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8 py-6">
        <QRWorkflowView />
      </main>
    </div>
  );
}

