// Public edge function — no auth required.
// Calls the next_order_id RPC and inserts a row into the orders table.
// Sending the service key to the client would let anyone bypass order
// validation and insert arbitrary data; doing it here keeps it server-side.
// Email notifications are still sent client-side via /api/send-email.
// Telegram notification to owners is sent here so the bot token never
// needs to leave the server.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })
}

async function sendTelegram(token: string, chatId: string, text: string) {
  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' }),
  })
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  try {
    const body = await req.json()
    const {
      name, phone, email, address, zone,
      items, items_json,
      subtotal, delivery_fee, discount_pct, discount_amt, total,
      trx_id, affiliate_code, notes,
    } = body

    if (!name || !phone || !email || !address || !trx_id) {
      return json({ error: 'Missing required fields' }, 400)
    }

    const sb = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    // Generate order ID server-side so it cannot be forged by the client
    const { data: seqData } = await sb.rpc('next_order_id')
    const orderId: string = seqData ?? ('BT-' + Date.now())

    const { error: oe } = await sb.from('orders').insert({
      id: orderId, name, email, phone, address,
      zone, items, items_json,
      subtotal, delivery_fee, discount_pct, discount_amt, total,
      payment_method: 'bKash', trx_id,
      affiliate_code: affiliate_code ?? null,
      notes: notes ?? '',
      status: 'Pending',
    })
    if (oe) throw oe

    // Telegram notification to owners (non-fatal — order is already saved)
    try {
      const [ownersRes, supRes] = await Promise.all([
        sb.from('settings').select('value').eq('key', 'owners_json').single(),
        sb.from('suppliers').select('telegram_token,telegram_chat_id').eq('active', true).limit(1),
      ])
      const owners: { telegram_chat_id?: string }[] =
        JSON.parse(ownersRes.data?.value ?? '[]')
      const sup = (supRes.data ?? [])[0] as
        | { telegram_token?: string; telegram_chat_id?: string }
        | undefined
      const token = sup?.telegram_token ?? ''
      if (token && owners.length) {
        const chatIds = [
          ...new Set(owners.map((o) => o.telegram_chat_id).filter(Boolean)),
        ] as string[]
        const text =
          `🛍️ <b>New Order — ${orderId}</b>\n` +
          `👤 ${name} · 📞 ${phone}\n` +
          `📍 ${address}\n🚚 ${zone}\n💰 ৳${total}` +
          (affiliate_code ? `\n🏷️ ${affiliate_code}` : '') +
          `\n📦 ${items}`
        for (const cid of chatIds) await sendTelegram(token, cid, text)
      }
    } catch { /**/ }

    return json({ orderId })
  } catch (e: unknown) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500)
  }
})
