import { useMutation } from "@tanstack/react-query";

type RequestType = {
  prompt: string;
};

type ResponseType = {
  data: {
    url: string;
  };
};

export const useGenerateImage = () => {
  const mutation = useMutation<
    ResponseType,
    Error,
    RequestType
  >({
    mutationFn: async (json) => {
      const response = await fetch('/api/editor/ai/generate-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(json),
      });

      if (!response.ok) {
        throw new Error('Failed to generate image');
      }

      return await response.json();
    },
  });

  return mutation;
};
