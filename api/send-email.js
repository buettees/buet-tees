export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { to, subject, html } = req.body;
  if (!to || !subject || !html) return res.status(400).json({ error: 'Missing fields' });

  const RESEND_KEY = process.env.RESEND_KEY;

  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + RESEND_KEY,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from: 'BUET Tees <onboarding@resend.dev>',
      to: Array.isArray(to) ? to : [to],
      subject,
      html
    })
  });

  const data = await r.json();
  return res.status(r.status).json(data);
}
