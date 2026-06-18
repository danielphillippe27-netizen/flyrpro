import { ScriptReaderPage } from '@/components/scripts/ScriptReaderPage';

export default async function ScriptRoute({
  params,
}: {
  params: Promise<{ scriptId: string }>;
}) {
  const { scriptId } = await params;
  return <ScriptReaderPage scriptId={scriptId} />;
}
