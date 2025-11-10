// api/checkout.ts  ← リポジトリ直下の api フォルダ
import type { IncomingMessage, ServerResponse } from 'http';
import Stripe from 'stripe';
import { URL } from 'url';

const stripe = new Stripe(process.env.STRIPE_KEY as string); // apiVersionは指定しない（型ズレ回避）

// JSONボディを読む（POST用）
async function readJson<T = any>(req: IncomingMessage): Promise<T | null> {
  return await new Promise((resolve) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
    req.on('end', () => {
      try {
        const s = Buffer.concat(chunks).toString('utf8') || '{}';
        resolve(JSON.parse(s));
      } catch {
        resolve(null);
      }
    });
    req.on('error', () => resolve(null));
  });
}

// plan → PRICE_ID の安全なマッピング
function planToPriceId(plan?: string): string | undefined {
  const map: Record<string, string | undefined> = {
    'starter-month': process.env.PRICE_STARTER_MONTH,
    'starter-year': process.env.PRICE_STARTER_YEAR,
    'business-month': process.env.PRICE_BUSINESS_MONTH,
    'business-year': process.env.PRICE_BUSINESS_YEAR,
  };
  return plan ? map[plan] : undefined;
}

// 成功/キャンセルURL（必要に応じて自社サイトに変更）
function getSuccessUrl(origin?: string) {
  // 例: 公開サイトのサンクスページに変えてOK
  return (origin || 'https://ai-zangyo-free.studio.site') + '/checkout/success';
}
function getCancelUrl(origin?: string) {
  return (origin || 'https://ai-zangyo-free.studio.site') + '/checkout/cancel';
}

export default async function handler(
  req: IncomingMessage & { method?: string; headers: any; url?: string },
  res: ServerResponse
) {
  try {
    // GET と POST の両対応にして運用を楽にする
    let plan: string | undefined;

    if (req.method === 'GET') {
      const u = new URL(req.url || '', 'http://localhost'); // baseはダミー
      plan = u.searchParams.get('plan') || undefined;
    } else if (req.method === 'POST') {
      const body = (await readJson<{ plan?: string }>(req)) || {};
      plan = body.plan;
    } else {
      res.statusCode = 405;
      res.setHeader('Allow', 'GET, POST');
      res.end('Method Not Allowed');
      return;
    }

    const priceId = planToPriceId(plan);
    if (!priceId) {
      res.statusCode = 400;
      res.end('Invalid plan');
      return;
    }

    const originHeader = req.headers['origin'] as string | undefined;
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      line_items: [{ price: priceId, quantity: 1 }],
      allow_promotion_codes: true,
      success_url: getSuccessUrl(originHeader) + '?session_id={CHECKOUT_SESSION_ID}',
      cancel_url: getCancelUrl(originHeader),
    });

    // GET のときは 302 リダイレクト、POST のときは JSON を返す
    if (req.method === 'GET') {
      res.statusCode = 302;
      res.setHeader('Location', session.url || '/');
      res.end();
    } else {
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ url: session.url }));
    }
  } catch (err: any) {
    console.error('checkout error:', err?.message || err);
    res.statusCode = 500;
    res.end('Internal Server Error');
  }
}
