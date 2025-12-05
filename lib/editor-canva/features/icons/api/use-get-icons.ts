import { useQuery } from "@tanstack/react-query";

import { client } from "@/lib/editor-canva/lib/hono";

export interface Icon {
  id: string;
  name: string;
  description: string;
  previewUrl: string;
  downloadUrl: string;
  tags: string[];
  premium: boolean;
  vector: boolean;
  downloads: number;
  link: string;
}

interface UseGetIconsParams {
  query?: string;
  page?: number;
  perPage?: number;
  enabled?: boolean;
}

export const useGetIcons = ({ 
  query = "icon", 
  page = 1, 
  perPage = 30,
  enabled = true 
}: UseGetIconsParams = {}) => {
  const queryResult = useQuery({
    queryKey: ["icons", query, page, perPage],
    queryFn: async () => {
      const response = await client.api.icons.$get({
        query: {
          query,
          page,
          per_page: perPage,
        },
      });

      if (!response.ok) {
        throw new Error("Failed to fetch icons");
      }

      const { data, meta } = await response.json();
      return { data: data as Icon[], meta };
    },
    enabled: enabled && !!query,
    staleTime: 5 * 60 * 1000, // Cache for 5 minutes
  });

  return queryResult;
};

