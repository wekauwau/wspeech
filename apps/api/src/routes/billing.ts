import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { db } from '../lib/db.js';
import { stripe, STRIPE_WEBHOOK_SECRET, TIER_PRICES } from '../lib/stripe.js';
import { SubscriptionTier, SubscriptionStatus } from '@wspeech/shared';

export async function billingRoutes(app: FastifyInstance) {
  // POST /v1/billing/checkout — create Stripe Checkout session
  app.post(
    '/v1/billing/checkout',
    {
      schema: {
        body: z.object({
          tier: z.enum(['starter', 'pro', 'enterprise']),
        }),
        response: {
          200: z.object({ url: z.string() }),
          400: z.object({ error: z.string() }),
        },
      },
    },
    async (request, reply) => {
      const userId = request.authUser!.id;
      const { tier } = request.body as { tier: string };

      // Get or create Stripe customer
      const sub = await db
        .selectFrom('subscriptions')
        .where('user_id', '=', userId)
        .select(['stripe_customer_id', 'stripe_subscription_id'])
        .executeTakeFirst();

      let customerId = sub?.stripe_customer_id;

      if (!customerId) {
        const user = await db
          .selectFrom('users')
          .where('id', '=', userId)
          .select(['email'])
          .executeTakeFirstOrThrow();

        const customer = await stripe.customers.create({
          email: user.email,
          metadata: { userId },
        });
        customerId = customer.id;

        await db
          .insertInto('subscriptions')
          .values({
            user_id: userId,
            stripe_customer_id: customerId,
            tier: SubscriptionTier.Free,
            status: SubscriptionStatus.Active,
          })
          .execute();
      }

      const priceId = TIER_PRICES[tier];
      if (!priceId) {
        return reply.status(400).send({ error: 'Invalid tier' });
      }

      // If upgrading from existing subscription, use subscription_update mode
      if (sub?.stripe_subscription_id) {
        const session = await stripe.billingPortal.sessions.create({
          customer: customerId,
          flow_data: {
            type: 'subscription_update_confirm',
            subscription_update_confirm: {
              subscription: sub.stripe_subscription_id,
              items: [{ id: priceId, quantity: 1 }],
            },
          },
          return_url: process.env.STRIPE_RETURN_URL ?? 'http://localhost:3000',
        });
        return reply.send({ url: session.url });
      }

      // New subscription via Checkout
      const session = await stripe.checkout.sessions.create({
        customer: customerId,
        mode: 'subscription',
        line_items: [{ price: priceId, quantity: 1 }],
        success_url: `${process.env.STRIPE_RETURN_URL ?? 'http://localhost:3000'}?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: process.env.STRIPE_RETURN_URL ?? 'http://localhost:3000',
        metadata: { userId, tier },
      });

      return reply.send({ url: session.url! });
    },
  );

  // POST /v1/billing/webhook — Stripe webhook receiver
  // NO auth middleware — verified via Stripe signature
  app.post(
    '/v1/billing/webhook',
    {
      schema: {
        // Raw body needed for signature verification — handled via preHandler
        body: z.any(),
      },
    },
    async (request, reply) => {
      const sig = request.headers['stripe-signature'] as string;
      if (!sig || !STRIPE_WEBHOOK_SECRET) {
        return reply.status(400).send({ error: 'Missing signature' });
      }

      let event;
      try {
        // Use raw body for verification
        const rawBody = (request as FastifyRequest & { rawBody?: string })
          .rawBody;
        event = stripe.webhooks.constructEvent(
          rawBody ?? JSON.stringify(request.body),
          sig,
          STRIPE_WEBHOOK_SECRET,
        );
      } catch (err) {
        app.log.error(`Webhook signature verification failed: ${err}`);
        return reply.status(400).send({ error: 'Invalid signature' });
      }

      switch (event.type) {
        case 'checkout.session.completed': {
          const session = event.data.object;
          const userId = session.metadata?.userId;
          const tier = session.metadata?.tier;
          if (userId && tier) {
            await db
              .updateTable('subscriptions')
              .set({
                tier: tier as SubscriptionTier,
                status: SubscriptionStatus.Active,
                stripe_subscription_id: session.subscription as string,
              })
              .where('user_id', '=', userId)
              .execute();
          }
          break;
        }

        case 'customer.subscription.created':
        case 'customer.subscription.updated': {
          const subscription = event.data.object;
          const customerId = subscription.customer as string;
          const status = subscription.status;

          // Map Stripe status to our status
          let subStatus: SubscriptionStatus;
          switch (status) {
            case 'active':
              subStatus = SubscriptionStatus.Active;
              break;
            case 'past_due':
              subStatus = SubscriptionStatus.PastDue;
              break;
            case 'canceled':
            case 'unpaid':
              subStatus = SubscriptionStatus.Canceled;
              break;
            case 'trialing':
              subStatus = SubscriptionStatus.Trialing;
              break;
            default:
              subStatus = SubscriptionStatus.Active;
          }

          await db
            .updateTable('subscriptions')
            .set({
              status: subStatus,
              current_period_start: new Date(
                (subscription as { current_period_start?: number })
                  .current_period_start! * 1000,
              ),
              current_period_end: new Date(
                (subscription as { current_period_end?: number })
                  .current_period_end! * 1000,
              ),
            })
            .where('stripe_customer_id', '=', customerId)
            .execute();
          break;
        }

        case 'customer.subscription.deleted': {
          const subscription = event.data.object;
          const customerId = subscription.customer as string;

          await db
            .updateTable('subscriptions')
            .set({
              tier: SubscriptionTier.Free,
              status: SubscriptionStatus.Canceled,
              stripe_subscription_id: null,
              current_period_start: null,
              current_period_end: null,
            })
            .where('stripe_customer_id', '=', customerId)
            .execute();
          break;
        }

        default:
          app.log.info(`Unhandled webhook event: ${event.type}`);
      }

      return reply.send({ received: true });
    },
  );

  // GET /v1/billing/subscription — current tier/status
  app.get(
    '/v1/billing/subscription',
    {
      schema: {
        response: {
          200: z.object({
            tier: z.string(),
            status: z.string(),
            current_period_start: z.string().nullable(),
            current_period_end: z.string().nullable(),
          }),
        },
      },
    },
    async (request, reply) => {
      const userId = request.authUser!.id;

      const sub = await db
        .selectFrom('subscriptions')
        .where('user_id', '=', userId)
        .select([
          'tier',
          'status',
          'current_period_start',
          'current_period_end',
        ])
        .executeTakeFirst();

      return reply.send({
        tier: sub?.tier ?? SubscriptionTier.Free,
        status: sub?.status ?? SubscriptionStatus.Active,
        current_period_start: sub?.current_period_start?.toISOString() ?? null,
        current_period_end: sub?.current_period_end?.toISOString() ?? null,
      });
    },
  );
}
