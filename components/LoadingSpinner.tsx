/**
 * Loading Spinner Component
 * 
 * Simple loading spinner for async operations
 */

export function LoadingSpinner({ className }: { className?: string }) {
  return (
    <div
      className={`flex items-center justify-center ${className || ''}`}
      role="status"
      aria-label="Loading"
    >
      <div className="h-8 w-8 animate-spin rounded-full border-4 border-slate-300 border-t-emerald-500"></div>
      <span className="sr-only">Loading...</span>
    </div>
  );
}

