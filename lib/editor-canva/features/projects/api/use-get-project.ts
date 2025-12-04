import { useQuery } from "@tanstack/react-query";

export type ResponseType = {
  data: {
    id: string;
    name: string;
    userId: string;
    json: string;
    height: number;
    width: number;
    thumbnailUrl: string | null;
    isTemplate: boolean;
    isPro: boolean;
    createdAt: Date;
    updatedAt: Date;
  };
};

export const useGetProject = (id: string) => {
  const query = useQuery({
    enabled: !!id,
    queryKey: ["project", { id }],
    queryFn: async () => {
      const response = await fetch(`/api/editor/projects/${id}`);

      if (!response.ok) {
        throw new Error("Failed to fetch project");
      }

      const result: ResponseType = await response.json();
      return result.data;
    },
  });

  return query;
};
