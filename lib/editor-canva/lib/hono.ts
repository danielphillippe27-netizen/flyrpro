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
    ai: {
      'generate-image': {
        $post: async ({ json }: { json: any }) => {
          const res = await fetch(`${API_BASE}/ai/generate-image`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(json),
          });
          return res;
        },
      },
      'remove-bg': {
        $post: async ({ json }: { json: any }) => {
          const res = await fetch(`${API_BASE}/ai/remove-bg`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(json),
          });
          return res;
        },
      },
    },
    subscriptions: {
      current: {
        $get: async () => {
          const res = await fetch(`${API_BASE}/subscriptions/current`);
          return res;
        },
      },
      billing: {
        $post: async () => {
          const res = await fetch(`${API_BASE}/subscriptions/billing`, {
            method: 'POST',
          });
          return res;
        },
      },
    },
    icons: {
      $get: async ({ query }: { query?: { query?: string; page?: number; per_page?: number } }) => {
        const params = new URLSearchParams();
        if (query?.query) params.set('query', query.query);
        if (query?.page) params.set('page', query.page.toString());
        if (query?.per_page) params.set('per_page', query.per_page.toString());
        const res = await fetch(`${API_BASE}/icons?${params}`);
        return res;
      },
    },
  },
} as any;
