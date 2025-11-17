// api/stripe-webhook.js あるいは .ts でもOK（型を使わない形）

const GAS_WEB_APP_URL = process.env.GAS_WEB_APP_URL || '';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).end('Method Not Allowed');
  }

  try {
    const event = req.body || {};
    const type = event.type || '';
    const obj = (event.data && event.data.object) || {};

    // できるだけ多くのパターンから email を拾う
    const customerEmail =
      (obj.customer_details && obj.customer_details.email) ||
      obj.customer_email ||
      obj.receipt_email ||
      (obj.billing_details && obj.billing_details.email) ||
      (obj.charges &&
        obj.charges.data &&
        obj.charges.data[0] &&
        obj.charges.data[0].billing_details &&
        obj.charges.data[0].billing_details.email) ||
      (obj.charges &&
        obj.charges.data &&
        obj.charges.data[0] &&
        obj.charges.data[0].receipt_email) ||
      '';

    const customerName =
      (obj.customer_details && obj.customer_details.name) ||
      (obj.billing_details && obj.billing_details.name) ||
      (obj.charges &&
        obj.charges.data &&
        obj.charges.data[0] &&
        obj.charges.data[0].billing_details &&
        obj.charges.data[0].billing_details.name) ||
      '';

    const status =
      obj.status ||
      obj.payment_status ||
      obj.subscription_status ||
      '';

    const priceId =
      (obj.metadata && obj.metadata.price_id) ||
      (obj.price && obj.price.id) ||
      (obj.lines &&
        obj.lines.data &&
        obj.lines.data[0] &&
        obj.lines.data[0].price &&
        obj.lines.data[0].price.id) ||
      '';

    const planName =
      (obj.metadata && obj.metadata.plan_name) ||
      (obj.lines &&
        obj.lines.data &&
        obj.lines.data[0] &&
        obj.lines.data[0].price &&
        obj.lines.data[0].price.nickname) ||
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

    if (!GAS_WEB_APP_URL) {
      throw new Error('GAS_WEB_APP_URL is not set');
    }

    const response = await fetch(GAS_WEB_APP_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const text = await response.text();
    console.log('Sheets WebApp response:', response.status, text);

    if (!response.ok) {
      return res
        .status(500)
        .json({ ok: false, error: 'GAS error', detail: text });
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('Webhook handler error:', err);
    return res
      .status(500)
      .json({ ok: false, error: err.message || String(err) });
  }
}

