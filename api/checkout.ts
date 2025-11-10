// /api/checkout.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_KEY as string, {
  apiVersion: '2024-06-20', // 既存に合わせてOK（固定したくなければ削除）
});

const PRICE_MAP: Record<string, string | undefined> = {
  'starter-month': process.env.PRICE_STARTER_MONTH,
  'starter-year':  process.env.PRICE_STARTER_YEAR,
  'business-month':process.env.PRICE_BUSINESS_MONTH,
  'business-year': process.env.PRICE_BUSINESS_YEAR,
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end('Method Not Allowed');

  try {
    const { plan } = req.body as { plan?: string };

    // plan 例: 'starter-month' | 'starter-year' | 'business-month' | 'business-year'
    const priceId = plan ? PRICE_MAP[plan] : undefined;
    if (!priceId) return res.status(400).json({ error: 'Invalid plan' });

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      line_items: [{ price: priceId, quantity: 1 }],
      allow_promotion_codes: true,
      success_url: `${req.headers.origin}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${req.headers.origin}/checkout/cancel`,
      // 任意：顧客情報事前入力やTax、trial等はここで指定可
    });

    return res.status(200).json({ url: session.url });
  } catch (e: any) {
    console.error('checkout error', e);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}
