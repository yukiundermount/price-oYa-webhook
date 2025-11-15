// /api/stripe-webhook.js
// 値付けAI「値付けoYa」用 Webhook

import Stripe from 'stripe';

export const config = {
  api: { bodyParser: false },
};

// 環境変数：STRIPE_SECRET_KEY（なければ STRIPE_KEY）を使用
const stripe = new Stripe(
  process.env.STRIPE_SECRET_KEY || process.env.STRIPE_KEY,
  { apiVersion: '2023-10-16' }
);

const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

// ★ ここにテスト環境の price ID をマッピング
const PRICE_TO_PLAN = {
  'price_1STMO60Y5YzAOfNy6k6TmXJ6': 'starter_monthly',
  'price_1SObeG0Y5YzAOfNywjZPRhTt': 'starter_yearly',
  'price_1STMPx0Y5YzAOfNyBiy3shCH': 'business_monthly',
  'price_1STMPH0Y5YzAOfNytq9OKkyO': 'business_yearly',
};

function getPlanFromPriceId(priceId) {
  return PRICE_TO_PLAN[priceId] || 'unknown';
}

async function readBuffer(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

// Google スプレッドシート Web App へ送信
async function updateSheet(payload) {
  const url = process.env.SHEETS_WEBAPP_URL;
  if (!url) {
    console.error('SHEETS_WEBAPP_URL is not set');
    return;
  }

  await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      // 任意。Apps Script 側でチェックしたい場合用
      'X-API-Key': process.env.ADMIN_KEY || '',
    },
    body: JSON.stringify(payload),
  });
}

// Stripe の Subscription 情報 → スプレッドシート1行ぶんのデータに変換
async function subscriptionToPayload(subscription, extra = {}) {
  const customerId = subscription.customer;

  // email をできるだけ取る（checkout.session から渡されたものを優先）
  let email = extra.email || subscription.customer_email || '';

  if (!email && customerId) {
    try {
      const customer = await stripe.customers.retrieve(customerId);
      if (!customer.deleted) {
        email = customer.email || '';
      }
    } catch (err) {
      console.error('Failed to fetch customer', err);
    }
  }

  const item = subscription.items?.data?.[0];
  const price = item?.price;
  const priceId = typeof price === 'string' ? price : price?.id;
  const plan = getPlanFromPriceId(priceId);

  const periodStart = subscription.current_period_start
    ? new Date(subscription.current_period_start * 1000).toISOString()
    : null;

  const periodEnd = subscription.current_period_end
    ? new Date(subscription.current_period_end * 1000).toISOString()
    : null;

  return {
    // ★ スプレッドシートのヘッダーに合わせる
    email: email || '',
    plan,
    status: subscription.status, // active / canceled など
    stripe_customer_id: customerId || '',
    stripe_subscription_id: subscription.id,
    period_start: periodStart,
    period_end: periodEnd,
    updated_at: new Date().toISOString(),
    // おまけ情報（必要なら Apps Script 側で参照）
    ...extra,
  };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).end('Method Not Allowed');
  }

  const buf = await readBuffer(req);
  const sig = req.headers['stripe-signature'] || '';

  let event;
  try {
    event = stripe.webhooks.constructEvent(buf, sig, endpointSecret);
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    switch (event.type) {
      // 新規課金完了（Checkout 完了）
      case 'checkout.session.completed': {
        const session = event.data.object;

        // サブスク以外は無視
        if (session.mode !== 'subscription') break;

        const subscriptionId = session.subscription;
        if (!subscriptionId) break;

        // Subscription の中に price / status / period などが入っているので取得
        const subscription = await stripe.subscriptions.retrieve(subscriptionId);

        const email =
          session.customer_details?.email ||
          session.customer_email ||
          '';

        const payload = await subscriptionToPayload(subscription, {
          source: 'checkout.session.completed',
          // ここに必要なら他の情報も載せられる
        });

        // email は extra で優先したいので上書き
        payload.email = email || payload.email;

        await updateSheet(payload);
        break;
      }

      // プラン変更・更新・キャンセルなど
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        const subscription = event.data.object;
        const payload = await subscriptionToPayload(subscription, {
          source: event.type,
        });
        await updateSheet(payload);
        break;
      }

      default:
        // 開発中はログだけ出しておく
        console.log(`Unhandled event type ${event.type}`);
    }

    res.json({ received: true });
  } catch (err) {
    console.error('Error handling webhook event:', err);
    res.status(500).send('Internal Server Error');
  }
}
