import MainLayoutClient from '@/app/(main)/MainLayoutClient';
import { FarmsLayoutClient } from '@/components/farms/FarmsLayoutClient';

export default function FarmsRootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <MainLayoutClient>
      <FarmsLayoutClient>{children}</FarmsLayoutClient>
    </MainLayoutClient>
  );
}
