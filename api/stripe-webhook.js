// api/stripe-webhook.js

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

    // ---------------------------
    // 1. 対象イベントを絞る
    // ---------------------------
    // ・申込完了      : checkout.session.completed
    // ・請求成功      : invoice.payment_succeeded
    // ・請求失敗      : invoice.payment_failed
    // ・サブスク解約  : customer.subscription.deleted
    const allowedEvents = [
      'checkout.session.completed',
      'invoice.payment_succeeded',
      'invoice.payment_failed',
      'customer.subscription.deleted',
    ];

    if (!allowedEvents.includes(type)) {
      console.log('Ignore event:', type);
      return res.status(200).json({ ok: true, ignored: true });
    }

    // ---------------------------
    // 2. メールアドレスをいろんなパターンから拾う
    // ---------------------------
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

    // Stripe からの生ステータス
    const rawStatus =
      obj.status ||
      obj.payment_status ||
      obj.subscription_status ||
      '';

    // ---------------------------
    // 3. price_id → プラン名マッピング
    // ---------------------------
    let priceId =
      (obj.metadata && obj.metadata.price_id) ||
      (obj.price && obj.price.id) ||
      (obj.lines &&
        obj.lines.data &&
        obj.lines.data[0] &&
        obj.lines.data[0].price &&
        obj.lines.data[0].price.id) ||
      '';

    function mapPlanName(pId) {
      switch (pId) {
        case 'price_1STMO60Y5YzAOfNy6k6TmXJ6':
          return 'Starter 月額プラン';
        case 'price_1SObeG0Y5YzAOfNywjZPRhTt':
          return 'Starter 年額プラン';
        case 'price_1STMPx0Y5YzAOfNyBiy3shCH':
          return 'Business 月額プラン';
        case 'price_1STMPH0Y5YzAOfNytq9OKkyO':
          return 'Business 年額プラン';
        default:
          return '残業Free ご利用プラン';
      }
    }

    const planName = mapPlanName(priceId);

    // ---------------------------
    // 4. 顧客ステータスをイベントから整理
    // ---------------------------
    let normalizedStatus = rawStatus || '';

    if (type === 'checkout.session.completed') {
      // トライアル付きサブスク想定 → trialing or active
      if (rawStatus) {
        normalizedStatus = rawStatus;
      } else {
        normalizedStatus = 'trialing';
      }
    } else if (type === 'invoice.payment_succeeded') {
      normalizedStatus = 'active';
    } else if (type === 'invoice.payment_failed') {
      normalizedStatus = 'payment_failed';
    } else if (type === 'customer.subscription.deleted') {
      normalizedStatus = 'canceled';
    }

    const payload = {
      event_type: type,
      customer_email: customerEmail,
      customer_name: customerName,
      price_id: priceId,
      plan_name: planName,
      status: normalizedStatus,   // trialing / active / canceled / payment_failed など
      status_raw: rawStatus,      // Stripe 側の生 status も残しておく
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
