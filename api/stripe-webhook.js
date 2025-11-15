// /api/stripe-webhook.js  値付けoYa用

import Stripe from 'stripe';

export const config = {
  api: {
    bodyParser: false,
  },
};

const stripe = new Stripe(process.env.STRIPE_KEY, {
  apiVersion: '2023-10-16',
});

const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

// Stripe からの生のボディを読み込む
async function readBuffer(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

// Google Apps Script（Sheets WebApp）に送る
async function updateSheet(payload) {
  const url = process.env.SHEETS_WEBAPP_URL;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': process.env.ADMIN_KEY || '',
    },
    body: JSON.stringify(payload),
  });

  const text = await res.text();

  console.log(
    'Sheets WebApp response:',
    res.status,
    res.statusText || '',
    text.slice(0, 200)
  );
}

// Stripe の price ID → プラン情報 対応表（テスト環境の ID）
const PRICE_TO_PLAN = {
  // Starter 月額
  price_1STMO60Y5YzAOfNy6k6TmXJ6: { plan: 'starter', billing: 'monthly' },

  // Starter 年額
  price_1SObeG0Y5YzAOfNywjZPRhTt: { plan: 'starter', billing: 'yearly' },

  // Business 月額
  price_1STMPx0Y5YzAOfNyBiy3shCH: { plan: 'business', billing: 'monthly' },

  // Business 年額
  price_1STMPH0Y5YzAOfNytq9OKkyO: { plan: 'business', billing: 'yearly' },
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).end('Method Not Allowed');
  }

  const buf = await readBuffer(req);
  const sig = req.headers['stripe-signature'];

  let event;

  // --- 1) 署名チェック ---
  if (sig && endpointSecret) {
    try {
      event = stripe.webhooks.constructEvent(buf, sig, endpointSecret);
      console.log('✅ Webhook verified:', event.type);
    } catch (err) {
      console.error(
        '❌ Webhook signature error: No signatures found matching the expected signature for payload.',
        'Are you passing the raw request body you received from Stripe?'
      );
      console.error('Detail:', err.message);
      // 署名エラーの場合はここで終了（シートは触らない）
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }
  } else {
    // Stripe 以外から叩いたとき用のフォールバック（開発・テスト向け）
    try {
      event = JSON.parse(buf.toString('utf8'));
      console.warn('⚠️ No stripe-signature header. Parsed body as JSON directly (dev only).');
    } catch (err) {
      console.error('❌ Failed to parse request body as JSON:', err.message);
      return res.status(400).send('Invalid payload');
    }
  }

  // --- 2) イベントハンドリング ---
  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;

        const subscriptionId = session.subscription;
        let subscription = null;

        if (subscriptionId) {
          subscription = await stripe.subscriptions.retrieve(subscriptionId);
        }

        const priceId = subscription?.items?.data?.[0]?.price?.id;
        const planInfo = PRICE_TO_PLAN[priceId] || {
          plan: 'unknown',
          billing: 'unknown',
        };

        const customerEmail =
          session.customer_details?.email || session.customer_email || '';

        const payloadForSheet = {
          email: customerEmail,
          plan: `${planInfo.plan}_${planInfo.billing}`, // starter_monthly など
          status: subscription?.status || session.payment_status || 'unknown',
          stripe_customer_id: session.customer || '',
          stripe_subscription_id: subscriptionId || '',
          period_start: subscription?.current_period_start || '',
          period_end: subscription?.current_period_end || '',
          updated_at: new Date().toISOString(),
        };

        console.log('➡️ Send payload to sheet:', payloadForSheet);
        await updateSheet(payloadForSheet);
        break;
      }

      // サブスク更新系（任意で）
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        const subscription = event.data.object;
        const customerId = subscription.customer;

        const priceId = subscription.items?.data?.[0]?.price?.id;
        const planInfo = PRICE_TO_PLAN[priceId] || {
          plan: 'unknown',
          billing: 'unknown',
        };

        // 顧客情報を取りに行く（email 用）
        let customerEmail = '';
        if (customerId) {
          const customer = await stripe.customers.retrieve(customerId);
          customerEmail = customer.email || '';
        }

        const payloadForSheet = {
          email: customerEmail,
          plan: `${planInfo.plan}_${planInfo.billing}`,
          status: subscription.status || 'unknown',
          stripe_customer_id: customerId || '',
          stripe_subscription_id: subscription.id || '',
          period_start: subscription.current_period_start || '',
          period_end: subscription.current_period_end || '',
          updated_at: new Date().toISOString(),
        };

        console.log('➡️ Send payload to sheet (subscription update):', payloadForSheet);
        await updateSheet(payloadForSheet);
        break;
      }

      default:
        console.log('ℹ️ Ignored event type:', event.type);
    }

    res.json({ received: true });
  } catch (err) {
    console.error('❌ Error while handling event:', err);
    res.status(500).send('Webhook handler error');
  }
}
