// /api/stripe-webhook  for 「値付けoYa」
// Vercel Edge Function (Node.js) 用

import Stripe from 'stripe';

export const config = {
  api: { bodyParser: false }, // Stripe の署名検証のため必須
};

const stripe = new Stripe(process.env.STRIPE_KEY, {
  apiVersion: '2023-10-16',
});

const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

// 生のボディを読み取るヘルパー
async function readBuffer(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

// Google Apps Script WebApp に転送
async function sendToSheet(payload) {
  const url = process.env.SHEETS_WEBAPP_URL;
  if (!url) {
    console.error('SHEETS_WEBAPP_URL が設定されていません');
    return;
  }

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': process.env.ADMIN_KEY || '',
      },
      body: JSON.stringify(payload),
    });

    const text = await res.text();
    console.log('Sheets WebApp response:', res.status, text);
  } catch (err) {
    console.error('Sheets WebApp への送信でエラー:', err);
  }
}

// price_id → プラン名
function planFromPriceId(priceId) {
  switch (priceId) {
    case 'price_1STMO60Y5YzAOfNy6k6TmXJ6':
      return 'starter_monthly';
    case 'price_1SObeG0Y5YzAOfNywjZPRhTt':
      return 'starter_yearly';
    case 'price_1STMPx0Y5YzAOfNyBiy3shCH':
      return 'business_monthly';
    case 'price_1STMPH0Y5YzAOfNytq9OKkyO':
      return 'business_yearly';
    default:
      return '';
  }
}

// Webhook ハンドラ本体
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).send('Method Not Allowed');
  }

  const buf = await readBuffer(req);
  const sig = req.headers['stripe-signature'];

  let event;

  // 署名検証
  try {
    event = stripe.webhooks.constructEvent(buf, sig, endpointSecret);
    console.log('✅ Webhook verified:', event.id, event.type);
  } catch (err) {
    console.error('❌ Webhook signature error:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  const data = event.data.object;

  // ここでは checkout.session.completed を主に想定
  // 他のイベントも一旦そのままシートに流します
  let email = '';
  let customerId = '';
  let subscriptionId = '';
  let periodStart = '';
  let periodEnd = '';
  let priceId = '';

  // checkout.session.completed の場合
  if (event.type === 'checkout.session.completed') {
    email =
      data.customer_details?.email ||
      data.client_reference_id ||
      data.customer_email ||
      '';
    customerId = data.customer || '';
    subscriptionId = data.subscription || '';

    // サブスクリプション情報が入っていればそこから期間を拾う（あれば）
    if (data.subscription && data.subscription.items) {
      const item = data.subscription.items.data[0];
      priceId = item.price?.id || '';
      if (data.subscription.current_period_start) {
        periodStart = data.subscription.current_period_start;
      }
      if (data.subscription.current_period_end) {
        periodEnd = data.subscription.current_period_end;
      }
    }
  } else if (event.type.startsWith('customer.subscription.')) {
    // customer.subscription.created / updated / deleted など
    email = ''; // 必要なら別途取得
    customerId = data.customer || '';
    subscriptionId = data.id || '';
    priceId = data.items?.data?.[0]?.price?.id || '';
    periodStart = data.current_period_start || '';
    periodEnd = data.current_period_end || '';
  }

  const plan = planFromPriceId(priceId);

  const payloadForSheet = {
    event_id: event.id,
    event_type: event.type,
    email,
    plan,
    status: event.type,
    stripe_customer_id: customerId,
    stripe_subscription_id: subscriptionId,
    period_start: periodStart,
    period_end: periodEnd,
    updated_at: new Date().toISOString(),
    price_id: priceId,
  };

  console.log('➡️ Send payload to sheet:', payloadForSheet);

  await sendToSheet(payloadForSheet);

  return res.json({ received: true });
}

