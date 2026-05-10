import { toast } from "sonner";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { client } from "@/lib/editor-canva/lib/hono";

type ResponseType = { data: { id: string } };
type RequestType = { id: string };

export const useDeleteProject = () => {
  const queryClient = useQueryClient();

  const mutation = useMutation<
    ResponseType,
    Error,
    RequestType
  >({
    mutationFn: async (param) => {
      const response = await client.api.projects[":id"].$delete({ 
        param,
      });

      if (!response.ok) {
        throw new Error("Failed to delete project");
      }

      return await response.json();
    },
    onSuccess: ({ data }) => {
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      queryClient.invalidateQueries({ queryKey: ["project", { id: data.id }] });
    },
    onError: () => {
      toast.error("Failed to delete project");
    }
  });

  return mutation;
};
