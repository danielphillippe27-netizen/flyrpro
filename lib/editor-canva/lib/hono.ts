// Stub Hono client - replaced with fetch-based API calls
// This allows the editor to load without Hono API routes

const API_BASE = '/api/editor';

export const client = {
  api: {
    projects: {
      ':id': {
        $get: async ({ param }: { param: { id: string } }) => {
          const res = await fetch(`${API_BASE}/projects/${param.id}`);
          return res;
        },
        $patch: async ({ param, json }: { param: { id: string }; json: any }) => {
          const res = await fetch(`${API_BASE}/projects/${param.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(json),
          });
          return res;
        },
      },
      $get: async ({ query }: { query?: { page?: number; limit?: number } }) => {
        const params = new URLSearchParams();
        if (query?.page) params.set('page', query.page.toString());
        if (query?.limit) params.set('limit', query.limit.toString());
        const res = await fetch(`${API_BASE}/projects?${params}`);
        return res;
      },
      $post: async ({ json }: { json: any }) => {
        const res = await fetch(`${API_BASE}/projects`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(json),
        });
        return res;
      },
      templates: {
        $get: async ({ query }: { query: { page: number; limit: number } }) => {
          const params = new URLSearchParams();
          params.set('page', query.page.toString());
          params.set('limit', query.limit.toString());
          const res = await fetch(`${API_BASE}/projects/templates?${params}`);
          return res;
        },
      },
    },
  },
} as any;
