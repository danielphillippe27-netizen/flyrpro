import { useSubscriptionModal } from "@/lib/editor-canva/features/subscriptions/store/use-subscription-modal";
import { useGetSubscription } from "@/lib/editor-canva/features/subscriptions/api/use-get-subscription";

export const usePaywall = () => {
  const { 
    data: subscription,
    isLoading: isLoadingSubscription,
  } = useGetSubscription();

  const subscriptionModal = useSubscriptionModal();

  const shouldBlock = isLoadingSubscription || !subscription?.active;

  return {
    isLoading: isLoadingSubscription,
    shouldBlock,
    triggerPaywall: () => {
      subscriptionModal.onOpen();
    },
  };
};
