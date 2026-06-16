import { DemoShell } from '@/components/demo/DemoShell';
import { DEFAULT_PAYLOAD } from '@/lib/demo/defaults';

export default function DemoPage() {
  void DEFAULT_PAYLOAD;

  return (
    <DemoShell>
      <main
        style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <p
          style={{
            fontFamily: 'var(--mono)',
            color: 'var(--orange)',
            letterSpacing: '0.2em',
          }}
        >
          FLYR PRO · DEMO ENGINE · SCAFFOLD
        </p>
      </main>
    </DemoShell>
  );
}
