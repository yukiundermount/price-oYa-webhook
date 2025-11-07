import type { NextApiRequest, NextApiResponse } from 'next';
import Stripe from 'stripe';
import { buffer } from 'micro';

export const config = { api: { bodyParser: false } };

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end('Method Not Allowed');
  try {
    const rawBody = (await buffer(req)).toString();
    const signature = req.headers['stripe-signature'] as string;
    const stripe = new Stripe(process.env.STRIPE_KEY!, { apiVersion: '2025-08-27.basil' });
    const event = stripe.webhooks.constructEvent(
      rawBody,
      signature,
      process.env.STRIPE_WH_SECRET!
    );

    switch (event.type) {
      case 'checkout.session.completed':
        break;
      case 'invoice.payment_succeeded':
        break;
      case 'invoice.payment_failed':
        break;
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted':
      case 'customer.subscription.trial_will_end':
        break;
      default:
        break;
    }

    return res.status(200).send('ok');
  } catch (err: any) {
    console.error('Webhook error:', err?.message || err);
    return res.status(400).send(`Webhook Error: ${err.message || 'invalid'}`);
  }
}
