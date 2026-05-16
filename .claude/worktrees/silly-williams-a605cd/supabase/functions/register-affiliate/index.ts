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

    const { error } = await sb.from('affiliates').upsert(
      {
        code, full_name, whatsapp, student_id, hall, email,
        storage_type, promotion_method,
        payment_method, payment_details, income_goal,
        status: 'inactive',
        commission_regular, commission_drop, commission_hoodie,
      },
      { onConflict: 'code', ignoreDuplicates: false },
    )

    if (error) throw error

    return json({ code, success: true })
  } catch (e: unknown) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500)
  }
})
