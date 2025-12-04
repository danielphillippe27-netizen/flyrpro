import { useMutation } from "@tanstack/react-query";

type RequestType = {
  imageUrl: string;
};

type ResponseType = {
  data: {
    url: string;
  };
};

export const useRemoveBg = () => {
  const mutation = useMutation<
    ResponseType,
    Error,
    RequestType
  >({
    mutationFn: async (json) => {
      const response = await fetch('/api/editor/ai/remove-bg', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(json),
      });

      if (!response.ok) {
        throw new Error('Failed to remove background');
      }

      return await response.json();
    },
  });

  return mutation;
};
