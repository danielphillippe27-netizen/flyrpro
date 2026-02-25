import Stripe from "stripe";
import { getStripeSecretKey } from "@/app/lib/billing/stripe-env";

export const stripe = new Stripe(getStripeSecretKey(), {
  apiVersion: "2024-06-20",
  typescript: true,
});
