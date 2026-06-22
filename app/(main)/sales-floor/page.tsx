import { SalespersonMessenger } from '@/components/home/SalespersonMessenger';

export default function SalesFloorPage() {
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-4 px-4 py-6 sm:px-6 lg:px-8">
      <header>
        <h1 className="text-2xl font-semibold tracking-normal text-foreground">Sales Floor</h1>
      </header>
      <SalespersonMessenger />
    </div>
  );
}
