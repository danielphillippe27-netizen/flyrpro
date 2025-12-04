import { toast } from "sonner";
import { useMutation, useQueryClient } from "@tanstack/react-query";

type RequestType = {
  name?: string;
  json?: string;
  height?: number;
  width?: number;
  thumbnailUrl?: string | null;
};

type ResponseType = {
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

export const useUpdateProject = (id: string) => {
  const queryClient = useQueryClient();

  const mutation = useMutation<
    ResponseType["data"],
    Error,
    RequestType
  >({
    mutationKey: ["project", { id }],
    mutationFn: async (json) => {
      const response = await fetch(`/api/editor/projects/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(json),
      });

      if (!response.ok) {
        throw new Error("Failed to update project");
      }

      const result: ResponseType = await response.json();
      return result.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      queryClient.invalidateQueries({ queryKey: ["project", { id }] });
    },
    onError: () => {
      toast.error("Failed to update project");
    }
  });

  return mutation;
};
