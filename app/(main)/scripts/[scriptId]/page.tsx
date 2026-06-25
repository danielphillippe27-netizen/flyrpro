import { ScriptRouteClient } from '@/components/scripts/ScriptRouteClient';

export default async function ScriptRoute({
  params,
}: {
  params: Promise<{ scriptId: string }>;
}) {
  const { scriptId } = await params;
  return <ScriptRouteClient scriptId={scriptId} />;
}
