// Public edge function — no auth required.
// Validates an affiliate code and returns whether it is active plus the
// discount percentage. The affiliates table does not need to be readable
// by anon because this runs server-side with the service key.
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
    const { code } = await req.json()
    if (!code) return json({ valid: false })

    const sb = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    const { data, error } = await sb
      .from('affiliates')
      .select('discount_pct,status')
      .eq('code', String(code).toUpperCase().trim())
      .single()

    if (error || !data || data.status !== 'active') {
      return json({ valid: false })
    }

    return json({ valid: true, discount_pct: parseFloat(data.discount_pct) || 10 })
  } catch (e: unknown) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500)
  }
})
