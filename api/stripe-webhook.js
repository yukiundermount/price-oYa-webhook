// Vercel /api/stripe-webhook example for "値付けoYa"
import Stripe from 'stripe';

export const config = { api: { bodyParser: false } };

const stripe = new Stripe(process.env.STRIPE_KEY, { apiVersion: '2023-10-16' });
const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

async function readBuffer(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks);
}

async function updateSheet(payload) {
  const url = process.env.SHEETS_WEBAPP_URL;
  await fetch(url, {
    method: 'POST',
    headers: {'Content-Type': 'application/json', 'X-API-Key': process.env.ADMIN_KEY},
    body: JSON.stringify(payload),
  });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const buf = await readBuffer(req);
  const sig = req.headers['stripe-signature'] || '';

  let event;
  try {
    event = stripe.webhooks.constructEvent(buf, sig, endpointSecret);
  } catch (err) {
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  switch (event.type) {
    case 'checkout.session.completed': {
      const s = event.data.object;
      const email = s.customer_details?.email;
      const customer = s.customer;
      await updateSheet({ op:'upsert_user', email, status:'ACTIVE', stripe_customer_id: customer });
      break;
    }
    case 'invoice.payment_failed': {
      const inv = event.data.object;
      const email = inv.customer_email;
      await updateSheet({ op:'set_status', email, status:'SUSPENDED' });
      break;
    }
    case 'customer.subscription.deleted': {
      const sub = event.data.object;
      const email = sub?.metadata?.email || '';
      await updateSheet({ op:'set_status', email, status:'CANCELED' });
      break;
    }
    default:
      // ignore
  }

  res.json({ received: true });
}
