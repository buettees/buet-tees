// Real-time double-entry bookkeeping sync: Supabase → Google Sheets
// Triggered by:
//   - Supabase DB webhooks (orders, transactions, supplier_payments, affiliate_payouts)
//   - POST {action:"init"} — one-time sheet setup (requires ADMIN_SECRET)
//   - POST {action:"backfill", data:{...}} — backfill all existing data (requires ADMIN_SECRET)
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getAccessToken } from './google-auth.ts'
import { appendRows, batchUpdate, clearSheetData, getSheets } from './sheets-api.ts'
import { COA, entryToRow, journalFromOrder, journalFromTransaction, type JournalEntry } from './journal.ts'
import { initSheets } from './init-sheets.ts'

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

function isAdmin(req: Request): boolean {
  const secret = Deno.env.get('ADMIN_SECRET')
  if (!secret) return false
  const auth = req.headers.get('Authorization') ?? ''
  return auth === `Bearer ${secret}`
}

// ── Raw tab row builders ──────────────────────────────────────────────────────

// deno-lint-ignore no-explicit-any
function orderToRawRow(r: Record<string, any>): unknown[] {
  return [
    r.created_at ?? '', r.id ?? '', r.name ?? '', r.phone ?? '', r.email ?? '',
    r.address ?? '', r.zone ?? '', r.items ?? '', r.subtotal ?? 0, r.delivery_fee ?? 0,
    r.discount_pct ?? 0, r.discount_amt ?? 0, r.total ?? 0,
    r.trx_id ?? '', r.affiliate_code ?? '', r.status ?? '', r.notes ?? '',
  ]
}

// deno-lint-ignore no-explicit-any
function txToRawRow(r: Record<string, any>): unknown[] {
  return [r.date ?? '', r.description ?? '', r.type ?? '', r.amount ?? 0, r.owner ?? '', r.category ?? '', r.id ?? '']
}

// deno-lint-ignore no-explicit-any
function supPayToRawRow(r: Record<string, any>): unknown[] {
  return [r.created_at ?? '', r.supplier ?? '', r.amount ?? 0, r.method ?? '', r.note ?? '', r.order_id ?? '']
}

// deno-lint-ignore no-explicit-any
function affPayToRawRow(r: Record<string, any>): unknown[] {
  return [r.paid_at ?? r.created_at ?? '', r.affiliate_code ?? '', r.amount ?? 0, r.method ?? '', r.note ?? '', r.order_id ?? '']
}

// ── Style helper: bold+gold specific rows ─────────────────────────────────────
async function styleSummaryTabs(token: string) {
  const sheets = await getSheets(token)
  const summaryTabs = ['P&L', 'Balance Sheet', 'Partner Capital', 'Cash Position']
  const requests: unknown[] = []

  for (const sheet of sheets) {
    if (!summaryTabs.includes(sheet.title)) continue
    requests.push(
      {
        repeatCell: {
          range: { sheetId: sheet.sheetId, startRowIndex: 0, endRowIndex: 1 },
          cell: {
            userEnteredFormat: {
              backgroundColor: { red: 0.12, green: 0.12, blue: 0.12 },
              textFormat: { foregroundColor: { red: 0.8, green: 0.66, blue: 0.3 }, bold: true, fontSize: 11 },
            },
          },
          fields: 'userEnteredFormat(backgroundColor,textFormat)',
        },
      },
      {
        repeatCell: {
          range: { sheetId: sheet.sheetId, startRowIndex: 1, endRowIndex: 200 },
          cell: { userEnteredFormat: { backgroundColor: { red: 0.06, green: 0.06, blue: 0.06 } } },
          fields: 'userEnteredFormat.backgroundColor',
        },
      },
    )
  }

  if (requests.length) await batchUpdate(token, requests)
}

// ── Backfill ──────────────────────────────────────────────────────────────────
async function backfill(token: string) {
  const sb = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  const [ordRes, txRes, spRes, apRes] = await Promise.all([
    sb.from('orders').select('*').order('created_at', { ascending: true }),
    sb.from('transactions').select('*').order('date', { ascending: true }),
    sb.from('supplier_payments').select('*').order('created_at', { ascending: true }),
    sb.from('affiliate_payouts').select('*').order('paid_at', { ascending: true }),
  ])

  const orders = ordRes.data ?? []
  const txs = txRes.data ?? []
  const supPays = spRes.data ?? []
  const affPays = apRes.data ?? []

  // Clear all data tabs first (keep headers) — makes backfill safe to re-run
  await Promise.all([
    clearSheetData(token, 'Journal'),
    clearSheetData(token, 'Orders'),
    clearSheetData(token, 'Transactions'),
    clearSheetData(token, 'Supplier Payments'),
    clearSheetData(token, 'Affiliate Payouts'),
  ])

  // Raw tabs
  if (orders.length) await appendRows(token, 'Orders', orders.map(orderToRawRow))
  if (txs.length) await appendRows(token, 'Transactions', txs.map(txToRawRow))
  if (supPays.length) await appendRows(token, 'Supplier Payments', supPays.map(supPayToRawRow))
  if (affPays.length) await appendRows(token, 'Affiliate Payouts', affPays.map(affPayToRawRow))

  // Journal entries
  const journalRows: unknown[][] = []

  for (const o of orders) {
    for (const e of journalFromOrder(o)) journalRows.push(entryToRow(e))
  }
  for (const t of txs) {
    if ((t.description ?? '').includes('[auto-logged]')) continue
    for (const e of journalFromTransaction(t)) journalRows.push(entryToRow(e))
  }

  for (const sp of supPays) {
    const amount = parseFloat(sp.amount ?? 0)
    if (amount <= 0) continue
    journalRows.push(entryToRow({
      date: new Date(sp.created_at).toISOString().slice(0, 10),
      time: new Date(sp.created_at).toISOString().slice(11, 19),
      refId: String(sp.id ?? ''),
      description: `Supplier payment — ${sp.supplier ?? ''} (Order ${sp.order_id ?? ''})`,
      drCode: '5001', drName: COA['5001'],
      amount,
      crCode: '1001', crName: COA['1001'],
      source: 'supplier_payments',
    }))
  }

  for (const ap of affPays) {
    const amount = parseFloat(ap.amount ?? 0)
    if (amount <= 0) continue
    const apTs = ap.paid_at ?? ap.created_at
    journalRows.push(entryToRow({
      date: new Date(apTs).toISOString().slice(0, 10),
      time: new Date(apTs).toISOString().slice(11, 19),
      refId: String(ap.id ?? ''),
      description: `Affiliate payout — ${ap.affiliate_code ?? ''} (Order ${ap.order_id ?? ''})`,
      drCode: '6001', drName: COA['6001'],
      amount,
      crCode: '1001', crName: COA['1001'],
      source: 'affiliate_payouts',
    }))
  }

  if (journalRows.length) await appendRows(token, 'Journal', journalRows)

  return {
    orders: orders.length, transactions: txs.length,
    supplier_payments: supPays.length, affiliate_payouts: affPays.length,
    journal_entries: journalRows.length,
  }
}

// ── Main handler ──────────────────────────────────────────────────────────────
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  try {
    const body = await req.json()

    // Admin actions
    if (body.action === 'init' || body.action === 'backfill') {
      if (!isAdmin(req)) return json({ error: 'Unauthorized' }, 401)
      const token = await getAccessToken()

      if (body.action === 'init') {
        await initSheets(token)
        await styleSummaryTabs(token)
        return json({ ok: true, message: 'Sheets initialized' })
      }

      if (body.action === 'backfill') {
        const result = await backfill(token)
        return json({ ok: true, result })
      }
    }

    // DB webhook payload
    const { type, table, record } = body as {
      type: 'INSERT' | 'UPDATE' | 'DELETE'
      table: string
      record: Record<string, unknown>
    }

    if (!type || !table || !record) return json({ error: 'Invalid webhook payload' }, 400)

    // Only process INSERT for now (updates/deletes don't affect ledger)
    if (type !== 'INSERT') return json({ ok: true, skipped: true })

    const token = await getAccessToken()

    // Append to raw tab
    if (table === 'orders') {
      await appendRows(token, 'Orders', [orderToRawRow(record)])
      const entries = journalFromOrder(record)
      if (entries.length) await appendRows(token, 'Journal', entries.map(entryToRow))
    } else if (table === 'transactions') {
      await appendRows(token, 'Transactions', [txToRawRow(record)])
      // Skip auto-logged duplicates
      if (!(record.description as string ?? '').includes('[auto-logged]')) {
        const entries = journalFromTransaction(record)
        if (entries.length) await appendRows(token, 'Journal', entries.map(entryToRow))
      }
    } else if (table === 'supplier_payments') {
      await appendRows(token, 'Supplier Payments', [supPayToRawRow(record)])
      const spEntry: JournalEntry = {
        date: new Date(record.created_at as string).toISOString().slice(0, 10),
        time: new Date(record.created_at as string).toISOString().slice(11, 19),
        refId: String(record.id ?? ''),
        description: `Supplier payment — ${record.supplier ?? ''} (Order ${record.order_id ?? ''})`,
        drCode: '5001', drName: COA['5001'],
        amount: parseFloat(String(record.amount ?? 0)),
        crCode: '1001', crName: COA['1001'],
        source: 'supplier_payments',
      }
      if (spEntry.amount > 0) await appendRows(token, 'Journal', [entryToRow(spEntry)])
    } else if (table === 'affiliate_payouts') {
      await appendRows(token, 'Affiliate Payouts', [affPayToRawRow(record)])
      const apTs = (record.paid_at ?? record.created_at) as string
      const apEntry: JournalEntry = {
        date: new Date(apTs).toISOString().slice(0, 10),
        time: new Date(apTs).toISOString().slice(11, 19),
        refId: String(record.id ?? ''),
        description: `Affiliate payout — ${record.affiliate_code ?? ''} (Order ${record.order_id ?? ''})`,
        drCode: '6001', drName: COA['6001'],
        amount: parseFloat(String(record.amount ?? 0)),
        crCode: '1001', crName: COA['1001'],
        source: 'affiliate_payouts',
      }
      if (apEntry.amount > 0) await appendRows(token, 'Journal', [entryToRow(apEntry)])
    }

    return json({ ok: true, table, type })
  } catch (e: unknown) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500)
  }
})
