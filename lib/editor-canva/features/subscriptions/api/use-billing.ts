import { toast } from "sonner";
import { useMutation } from "@tanstack/react-query";

type ResponseType = {
  data: string; // URL to redirect to
};

export const useBilling = () => {
  const mutation = useMutation<
    ResponseType,
    Error
  >({
    mutationFn: async () => {
      const response = await fetch('/api/editor/subscriptions/billing', {
        method: 'POST',
      });

      if (!response.ok) {
        throw new Error("Failed to create session");
      }

      return await response.json();
    },
    onSuccess: ({ data }) => {
      window.location.href = data;
    },
    onError: () => {
      toast.error("Failed to create session");
    },
  });

  return mutation;
};
