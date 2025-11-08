// api/webhook.ts  ← リポジトリ直下に小文字の api フォルダで
import type { IncomingMessage, ServerResponse } from 'http';
import Stripe from 'stripe';

// 生ボディを読み取るユーティリティ
async function readRawBody(req: IncomingMessage): Promise<string> {
  return await new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

export default async function handler(req: IncomingMessage & { method?: string; headers: any }, res: ServerResponse) {
  if (req.method !== 'POST') {
    res.statusCode = 405;
    res.end('Method Not Allowed');
    return;
  }

  try {
    const rawBody = await readRawBody(req);                // 重要：生ボディ
    const signature = req.headers['stripe-signature'] || '';

    const stripe = new Stripe(process.env.STRIPE_KEY as string);


    const event = stripe.webhooks.constructEvent(
      rawBody,
      signature as string,
      process.env.STRIPE_WH_SECRET as string
    );

    console.log('event:', event.type);

    switch (event.type) {
      case 'checkout.session.completed':
        // TODO: 決済完了時の処理
        break;
      case 'invoice.payment_succeeded':
        // TODO: 継続課金成功時の処理
        break;
      case 'invoice.payment_failed':
        // TODO: 継続課金失敗時の処理
        break;
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted':
      case 'customer.subscription.trial_will_end':
        // TODO: サブスク状態の同期など
        break;
      default:
        // 未使用イベントは無視
        break;
    }

    res.statusCode = 200;
    res.end('ok');
  } catch (err: any) {
    console.error('Webhook error:', err?.message || err);
    res.statusCode = 400;
    res.end(`Webhook Error: ${err?.message || 'invalid'}`);
  }
}
