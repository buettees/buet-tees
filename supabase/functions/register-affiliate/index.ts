// Public edge function — no auth required.
// Upserts an affiliate registration. The affiliates table requires the
// service key for writes; keeping it server-side prevents customers from
// inserting arbitrary affiliate records or overwriting existing ones.
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

async function tgPostGroup(text: string) {
  const token = Deno.env.get('TELEGRAM_BOT_TOKEN')
  const chatId = Deno.env.get('TELEGRAM_AFF_GROUP_CHAT_ID')
  if (!token || !chatId) return
  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      }),
    })
  } catch (_) { /* non-blocking */ }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  try {
    const body = await req.json()
    const {
      code, full_name, whatsapp, student_id, hall, email,
      storage_type, promotion_method,
      payment_method, payment_details, income_goal,
      commission_regular, commission_drop, commission_hoodie,
    } = body

    if (!code || !full_name || !whatsapp || !student_id || !hall || !email) {
      return json({ error: 'Missing required fields' }, 400)
    }

    const sb = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    const { data: settRow } = await sb.from('settings')
      .select('value').eq('key', 'affiliate_discount_pct').maybeSingle()
    const default_discount_pct = parseFloat(settRow?.value ?? '10') || 10

    const { error } = await sb.from('affiliates').upsert(
      {
        code, full_name, whatsapp, student_id, hall, email,
        storage_type, promotion_method,
        payment_method, payment_details, income_goal,
        status: 'inactive',
        commission_regular, commission_drop, commission_hoodie,
        discount_pct: default_discount_pct,
      },
      { onConflict: 'code', ignoreDuplicates: false },
    )

    if (error) throw error

    // Brand-style group post — pending activation
    await tgPostGroup(
      `🆕 <b>New Affiliate Application</b>\n` +
      `━━━━━━━━━━━━━━━━━━\n` +
      `👤 <b>${full_name}</b>\n` +
      `🏠 ${hall} · 🎓 ${student_id}\n` +
      `📞 ${whatsapp}\n` +
      `💾 ${storage_type === 'storage' ? 'With Storage' : 'No Storage'}\n` +
      `🔑 Code: <code>${code}</code>\n\n` +
      `<i>Pending admin activation.</i>`
    )

    return json({ code, success: true })
  } catch (e: unknown) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500)
  }
})
