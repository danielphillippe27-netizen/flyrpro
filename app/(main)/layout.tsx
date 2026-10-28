import { CrmAssistant } from '@/components/crm-ai/CrmAssistant';
import { MacSessionBridge } from '@/components/crm-ai/MacSessionBridge';
import RetiredRecordingCleanup from './RetiredRecordingCleanup';
import MainLayoutClient from './MainLayoutClient';

export default async function MainLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <MainLayoutClient><RetiredRecordingCleanup /><MacSessionBridge /><CrmAssistant />{children}</MainLayoutClient>;
}
