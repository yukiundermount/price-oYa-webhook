import type { VercelRequest, VercelResponse } from '@vercel/node';

const GAS_WEB_APP_URL = process.env.GAS_WEB_APP_URL || '';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).end('Method Not Allowed');
  }

  try {
    const event = req.body as any;
    const type = event?.type || '';
    const obj = event?.data?.object || {};

    // できるだけ多くのパターンから email を拾う
    const customerEmail =
      obj?.customer_details?.email ||                       // checkout.session.completed
      obj?.customer_email ||                               // 一部のイベント
      obj?.receipt_email ||                                // charge.succeeded など
      obj?.billing_details?.email ||                       // 単一 charge
      obj?.charges?.data?.[0]?.billing_details?.email ||   // payment_intent.succeeded
      obj?.charges?.data?.[0]?.receipt_email ||            // こちらにも入ることあり
      '';

    const customerName =
      obj?.customer_details?.name ||
      obj?.billing_details?.name ||
      obj?.charges?.data?.[0]?.billing_details?.name ||
      '';

    const status =
      obj?.status ||
      obj?.payment_status ||
      obj?.subscription_status ||
      '';

    const priceId =
      obj?.metadata?.price_id ||
      obj?.price?.id ||
      obj?.lines?.data?.[0]?.price?.id ||
      '';

    const planName =
      obj?.metadata?.plan_name ||
      obj?.lines?.data?.[0]?.price?.nickname ||
      '残業Free ご利用プラン';

    const payload = {
      event_type: type,
      customer_email: customerEmail,
      customer_name: customerName,
      price_id: priceId,
      plan_name: planName,
      status: status,
    };

    console.log('Payload to GAS:', payload);

    const response = await fetch(GAS_WEB_APP_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const text = await response.text();
    console.log('Sheets WebApp response:', response.status, text);

    if (!response.ok) {
      return res.status(500).json({ ok: false, error: 'GAS error', detail: text });
    }

    return res.status(200).json({ ok: true });
  } catch (err: any) {
    console.error('Webhook handler error:', err);
    return res.status(500).json({ ok: false, error: err.message || String(err) });
  }
}

