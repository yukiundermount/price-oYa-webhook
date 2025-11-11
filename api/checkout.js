// /api/checkout.js
import Stripe from 'stripe';

const ALLOW_ORIGIN = process.env.CORS_ORIGIN || '*';

async function readJson(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const s = Buffer.concat(chunks).toString('utf8') || '{}';
  try { return JSON.parse(s); } catch { return {}; }
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', ALLOW_ORIGIN);
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    return res.status(200).end();
  }
  if (req.method !== 'POST') return res.status(405).end();

  res.setHeader('Access-Control-Allow-Origin', ALLOW_ORIGIN);

  const { email, priceId } = await readJson(req);
  if (!email || !priceId) {
    return res.status(400).json({ error: 'email and priceId are required' });
  }

  if (!process.env.STRIPE_KEY) {
    return res.status(500).json({ error: 'STRIPE_KEY is missing in env' });
  }

  const stripe = new Stripe(process.env.STRIPE_KEY);

  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      
      customer_email: email,
      success_url: 'https://app.ai-zangyo-free.com/welcome?session_id={CHECKOUT_SESSION_ID}',
      cancel_url:  'https://app.ai-zangyo-free.com/paywall',
      line_items: [{ price: priceId, quantity: 1 }],
      allow_promotion_codes: true,
      metadata: { email }
    });
    return res.json({ url: session.url });
  } catch (e) {
    console.error('Stripe error:', e);
    const msg = (e && e.message) ? e.message : String(e);
    return res.status(500).json({ error: msg });
  }
}
