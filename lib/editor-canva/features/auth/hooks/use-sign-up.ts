import { toast } from "sonner";
import { useMutation } from "@tanstack/react-query";
import { client } from "@/lib/editor-canva/lib/hono";

type ResponseType = unknown;
type RequestType = Record<string, unknown>;

export const useSignUp = () => {
  const mutation = useMutation<
    ResponseType,
    Error,
    RequestType
  >({
    mutationFn: async (json) => {
      const response = await client.api.users.$post({ json });

      if (!response.ok) {
        throw new Error("Something went wrong");
      }

      return await response.json();
    },
    onSuccess: () => {
      toast.success("User created");
    }
  });

  return mutation;
};
