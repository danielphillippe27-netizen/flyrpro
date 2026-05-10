import { toast } from "sonner";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { client } from "@/lib/editor-canva/lib/hono";

type ResponseType = unknown;
type RequestType = { id: string };

export const useDuplicateProject = () => {
  const queryClient = useQueryClient();

  const mutation = useMutation<
    ResponseType,
    Error,
    RequestType
  >({
    mutationFn: async (param) => {
      const response = await client.api.projects[":id"].duplicate.$post({ 
        param,
      });

      if (!response.ok) {
        throw new Error("Failed to duplicate project");
      }

      return await response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["projects"] });
    },
    onError: () => {
      toast.error("Failed to duplicate project");
    }
  });

  return mutation;
};
