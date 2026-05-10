import { toast } from "sonner";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { client } from "@/lib/editor-canva/lib/hono";

type ResponseType = unknown;
type RequestType = Record<string, unknown>;

export const useCreateProject = () => {
  const queryClient = useQueryClient();

  const mutation = useMutation<ResponseType, Error, RequestType>({
    mutationFn: async (json) => {
      const response = await client.api.projects.$post({ json });

      if (!response.ok) {
        throw new Error("Something went wrong");
      }

      return await response.json();
    },
    onSuccess: () => {
      toast.success("Project created.");

      queryClient.invalidateQueries({ queryKey: ["projects"] });
    },
    onError: () => {
      toast.error(
        "Failed to create project. The session token may have expired, logout and login again, and everything will work fine."
      );
    },
  });

  return mutation;
};
