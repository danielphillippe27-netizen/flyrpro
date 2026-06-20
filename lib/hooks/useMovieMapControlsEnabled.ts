import { useEffect, useState } from 'react';

type MapSettingsResponse = {
  movieMapControlsEnabled?: boolean;
};

export function useMovieMapControlsEnabled(workspaceId: string | null | undefined) {
  const [movieMapControlsEnabled, setMovieMapControlsEnabled] = useState(false);
  const [movieMapControlsLoading, setMovieMapControlsLoading] = useState(false);

  useEffect(() => {
    if (!workspaceId) {
      setMovieMapControlsEnabled(false);
      setMovieMapControlsLoading(false);
      return;
    }

    let cancelled = false;
    setMovieMapControlsEnabled(false);
    setMovieMapControlsLoading(true);

    fetch(`/api/workspace/map-settings?workspaceId=${encodeURIComponent(workspaceId)}`, {
      credentials: 'include',
      cache: 'no-store',
    })
      .then(async (response) => {
        if (!response.ok) return null;
        return (await response.json().catch(() => null)) as MapSettingsResponse | null;
      })
      .then((payload) => {
        if (!cancelled) {
          setMovieMapControlsEnabled(payload?.movieMapControlsEnabled === true);
        }
      })
      .catch(() => {
        if (!cancelled) setMovieMapControlsEnabled(false);
      })
      .finally(() => {
        if (!cancelled) setMovieMapControlsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [workspaceId]);

  return { movieMapControlsEnabled, movieMapControlsLoading };
}
