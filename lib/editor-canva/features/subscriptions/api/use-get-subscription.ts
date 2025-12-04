import { useQuery } from "@tanstack/react-query";

export const useGetSubscription = () => {
  const query = useQuery({
    queryKey: ["subscription"],
    queryFn: async () => {
      const response = await fetch('/api/editor/subscriptions/current');

      if (!response.ok) {
        // Return default "no subscription" state
        return { active: false };
      }

      const { data } = await response.json();
      return data; 
    },
  });

  return query;
};
