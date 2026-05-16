export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end('Method Not Allowed');

  const { to, subject, html } = req.body;
  if (!to || !subject || !html) {
    return res.status(400).json({ error: 'Missing fields: to, subject, html required' });
  }

  const RESEND_KEY = process.env.RESEND_KEY;
  if (!RESEND_KEY) {
    console.error('[send-email] RESEND_KEY not set');
    return res.status(500).json({ error: 'RESEND_KEY not configured' });
  }

  const toArr = (Array.isArray(to) ? to : [to]).filter(Boolean);
  if (!toArr.length) return res.status(400).json({ error: 'No valid recipients' });

  console.log('[send-email] Sending to:', toArr, '| Subject:', subject);

  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + RESEND_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: 'BUET Tees <noreply@buettees.shop>',
        to: toArr,
        subject,
        html
      })
    });

    const data = await r.json();

    if (!r.ok) {
      console.error('[send-email] Resend error:', r.status, JSON.stringify(data));
    } else {
      console.log('[send-email] Sent OK, id:', data.id);
    }

    return res.status(r.status).json(data);

  } catch (e) {
    console.error('[send-email] Fetch failed:', e.message);
    return res.status(500).json({ error: e.message });
  }
}
