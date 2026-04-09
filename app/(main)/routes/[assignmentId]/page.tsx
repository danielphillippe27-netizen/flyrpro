'use client';

import { useParams } from 'next/navigation';
import { AssignedRoutesView } from '@/components/routes/AssignedRoutesView';

export default function RouteAssignmentPage() {
  const params = useParams();
  const assignmentId = typeof params?.assignmentId === 'string' ? params.assignmentId : null;

  if (!assignmentId) {
    return (
      <div className="flex flex-col items-center justify-center h-full min-h-[320px] px-6 text-center">
        <p className="text-sm text-muted-foreground">Invalid route.</p>
      </div>
    );
  }

  return <AssignedRoutesView focusAssignmentId={assignmentId} />;
}
