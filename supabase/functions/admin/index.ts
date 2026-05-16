// Admin-only edge function — requires Authorization: Bearer <ADMIN_SECRET>.
// Set ADMIN_SECRET in Supabase Dashboard → Edge Functions → Secrets.
// It must match the admin password used in the browser.
//
// Acts as a generic Supabase query proxy so the sbAdmin client proxy in
// index.html can route all existing admin DB operations here with minimal
// changes to the admin panel JS code.
//
// Supported actions: select | insert | update | upsert | delete | rpc
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

// deno-lint-ignore no-explicit-any
type AnyQuery = any

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  // ── Auth ──────────────────────────────────────────────────
  const adminSecret = Deno.env.get('ADMIN_SECRET')
  if (!adminSecret) return json({ error: 'ADMIN_SECRET not configured' }, 500)

  const authHeader = req.headers.get('Authorization') ?? ''
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : ''
  if (token !== adminSecret) return json({ error: 'Unauthorized' }, 401)

  // ── Client ────────────────────────────────────────────────
  const sb = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  try {
    const body = await req.json()
    const { action, table } = body as { action: string; table?: string }

    // ── select ───────────────────────────────────────────────
    if (action === 'select') {
      let q: AnyQuery = sb.from(table!).select(body.select ?? '*')
      if (body.eq) {
        for (const [col, val] of Object.entries(body.eq as Record<string, unknown>)) {
          q = q.eq(col, val)
        }
      }
      if (body.like) {
        for (const [col, pat] of body.like as [string, string][]) {
          q = q.like(col, pat)
        }
      }
      if (body.order) {
        const orders: { column: string; ascending: boolean }[] = Array.isArray(body.order)
          ? body.order
          : [body.order]
        for (const o of orders) q = q.order(o.column, { ascending: o.ascending })
      }
      return json(body.single ? await q.single() : await q)
    }

    // ── insert ───────────────────────────────────────────────
    if (action === 'insert') {
      return json(await sb.from(table!).insert(body.data))
    }

    // ── update ───────────────────────────────────────────────
    if (action === 'update') {
      let q: AnyQuery = sb.from(table!).update(body.data)
      if (body.eq) {
        for (const [col, val] of Object.entries(body.eq as Record<string, unknown>)) {
          q = q.eq(col, val)
        }
      }
      return json(await q)
    }

    // ── upsert ───────────────────────────────────────────────
    if (action === 'upsert') {
      const opts: Record<string, unknown> = {}
      if (body.onConflict) opts.onConflict = body.onConflict
      if (body.ignoreDuplicates !== undefined) opts.ignoreDuplicates = body.ignoreDuplicates
      return json(await sb.from(table!).upsert(body.data, opts))
    }

    // ── delete ───────────────────────────────────────────────
    if (action === 'delete') {
      let q: AnyQuery = sb.from(table!).delete()
      if (body.eq) {
        for (const [col, val] of Object.entries(body.eq as Record<string, unknown>)) {
          q = q.eq(col, val)
        }
      }
      if (body.like) {
        for (const [col, pat] of body.like as [string, string][]) {
          q = q.like(col, pat)
        }
      }
      return json(await q)
    }

    // ── rpc ──────────────────────────────────────────────────
    if (action === 'rpc') {
      return json(await sb.rpc(body.fn, body.params ?? {}))
    }

    // ── tg-aff-notify — post brand-style message to affiliate group ─
    if (action === 'tg-aff-notify') {
      const token = Deno.env.get('TELEGRAM_BOT_TOKEN')
      const chatId = Deno.env.get('TELEGRAM_AFF_GROUP_CHAT_ID')
      if (!token || !chatId) return json({ skipped: true, reason: 'tg env vars missing' })
      const { event, data } = body as { event: string; data: Record<string, unknown> }
      const d = data || {}
      const sep = '━━━━━━━━━━━━━━━━━━'
      let text = ''
      if (event === 'activated') {
        text = `✅ <b>Affiliate Activated</b>\n${sep}\n` +
          `👤 <b>${d.full_name}</b>\n` +
          `🔑 Code: <code>${d.code}</code>\n` +
          `🎁 Discount: ${d.discount_pct}%\n\n` +
          `<i>Welcome aboard! Start sharing the code.</i>`
      } else if (event === 'deactivated') {
        text = `🚫 <b>Affiliate Deactivated</b>\n${sep}\n` +
          `👤 <b>${d.full_name}</b>\n` +
          `🔑 Code: <code>${d.code}</code>`
      } else if (event === 'payment-sent') {
        text = `💸 <b>Affiliate Payment Sent</b>\n${sep}\n` +
          `👤 <b>${d.full_name}</b>\n` +
          `🔑 Code: <code>${d.code}</code>\n` +
          `💰 Amount: ৳${d.amount}\n` +
          (d.method ? `🏦 Method: ${d.method}\n` : '') +
          (d.orderId ? `📦 Order: <b>${d.orderId}</b>\n` : '') +
          `\n<i>Thank you for the hustle.</i>`
      } else {
        return json({ error: 'Unknown event' }, 400)
      }
      try {
        const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true }),
        })
        return json({ ok: r.ok })
      } catch (e) {
        return json({ ok: false, error: e instanceof Error ? e.message : String(e) })
      }
    }

    // ── load-all ─────────────────────────────────────────────
    if (action === 'load-all') {
      const [ordRes, affRes, txRes, settRes, supRes, payoutRes, supPayRes, prodCatRes] =
        await Promise.all([
          sb.from('orders').select('*').order('created_at', { ascending: false }),
          sb.from('affiliates').select('*').order('created_at', { ascending: false }),
          sb.from('transactions').select('*').order('date', { ascending: false }),
          sb.from('settings').select('*'),
          sb.from('suppliers').select('*').order('created_at', { ascending: true }),
          sb.from('affiliate_payouts').select('*').order('paid_at', { ascending: false }),
          sb.from('supplier_payments').select('*').order('paid_at', { ascending: false }),
          sb.from('product_categories').select('product_id,category,design_w,design_h,products(name)'),
        ])
      return json({
        orders: ordRes.data ?? [],
        affiliates: affRes.data ?? [],
        transactions: txRes.data ?? [],
        settings: settRes.data ?? [],
        suppliers: supRes.data ?? [],
        affiliate_payouts: payoutRes.data ?? [],
        supplier_payments: supPayRes.data ?? [],
        product_categories: prodCatRes.data ?? [],
      })
    }

    return json({ error: `Unknown action: ${action}` }, 400)
  } catch (e: unknown) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500)
  }
})
