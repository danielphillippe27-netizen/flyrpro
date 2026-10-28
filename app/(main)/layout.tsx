import RetiredRecordingCleanup from './RetiredRecordingCleanup';
import MainLayoutClient from './MainLayoutClient';

export default async function MainLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <MainLayoutClient><RetiredRecordingCleanup />{children}</MainLayoutClient>;
}
