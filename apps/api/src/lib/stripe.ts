import Stripe from 'stripe';

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
if (!STRIPE_SECRET_KEY) throw new Error('STRIPE_SECRET_KEY is required');

export const stripe = new Stripe(STRIPE_SECRET_KEY, {
  typescript: true,
});

export const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET ?? '';

// Price IDs for each tier (set in Stripe Dashboard, reference here)
export const TIER_PRICES: Record<string, string> = {
  starter: process.env.STRIPE_PRICE_STARTER ?? 'price_starter',
  pro: process.env.STRIPE_PRICE_PRO ?? 'price_pro',
  enterprise: process.env.STRIPE_PRICE_ENTERPRISE ?? 'price_enterprise',
};
