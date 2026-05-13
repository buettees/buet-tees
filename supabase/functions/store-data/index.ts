// Public edge function — no auth required.
// Returns all data needed to render the storefront: products, suppliers,
// affiliate_discount_pct, and offers_config. Runs server-side with the
// service key so no RLS policies are required on the client.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  const sb = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  try {
    const [prodRes, supRes, settRes, affRes] = await Promise.all([
      sb.from('products').select('*, product_categories(*)').eq('active', true),
      sb.from('suppliers').select('name,categories').eq('active', true),
      sb.from('settings')
        .select('key,value')
        .in('key', ['affiliate_discount_pct', 'offers_config']),
      sb.from('affiliates').select('code').eq('status', 'active'),
    ])

    const settings: Record<string, string> = {}
    ;(settRes.data ?? []).forEach((s: { key: string; value: string }) => {
      settings[s.key] = s.value
    })

    let offers_config: unknown = {}
    try { offers_config = JSON.parse(settings.offers_config ?? '{}') } catch { /**/ }

    return json({
      products: prodRes.data ?? [],
      suppliers: supRes.data ?? [],
      affiliate_discount_pct: settings.affiliate_discount_pct ?? '10',
      offers_config,
      affiliates: affRes.data ?? [],
    })
  } catch (e: unknown) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500)
  }
})
