// ask-finance: AI-powered finance Q&A using Groq
// Receives pre-computed business snapshot from frontend — no DB queries needed
// POST { question: string, snapshot: object } with Bearer <ADMIN_SECRET>

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
  return req.headers.get('Authorization') === `Bearer ${secret}`
}

function fmt(n: number): string {
  return '৳' + Math.round(n).toLocaleString('en-BD')
}

function pf(v: unknown): number { return parseFloat(String(v ?? 0)) || 0 }

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (!isAdmin(req)) return json({ error: 'Unauthorized' }, 401)

  const { question, snapshot } = await req.json()
  if (!question) return json({ error: 'No question provided' }, 400)

  const now = new Date()
  const s = snapshot ?? {}

  // ── Summary ───────────────────────────────────────────────────────────────
  const sum = s.summary ?? {}

  // ── Cash flow ─────────────────────────────────────────────────────────────
  const transactions: Record<string, unknown>[] = s.transactions ?? []
  const affiliatePayouts: Record<string, unknown>[] = s.affiliatePayouts ?? []
  const supplierPayments: Record<string, unknown>[] = s.supplierPayments ?? []

  const capitalIn    = transactions.filter(t => t.type === 'Capital In').reduce((a, t) => a + pf(t.amount), 0)
  const capitalOut   = transactions.filter(t => t.type === 'Capital Out').reduce((a, t) => a + pf(t.amount), 0)
  const expensesPaid = transactions.filter(t => t.type === 'Expense' || t.type === 'Money Out').reduce((a, t) => a + pf(t.amount), 0)
  const affPaid      = affiliatePayouts.reduce((a, p) => a + pf(p.amount), 0)
  const supPaid      = supplierPayments.reduce((a, p) => a + pf(p.amount), 0)
  const cashBalance  = capitalIn + pf(sum.totalRevenue) - expensesPaid - affPaid - supPaid - capitalOut

  const reserveSetting = (s.rawSettings ?? []).find((r: Record<string,unknown>) => r.key === 'reserve_amount')
  const reserve = reserveSetting ? pf(reserveSetting.value) : 8000
  const supplierOwed = Math.max(0, pf(sum.totalSupplierCost) - supPaid)
  const affOwed      = Math.max(0, pf(sum.totalAffComm) - affPaid)
  const safeToExtract = Math.max(0, cashBalance - reserve - supplierOwed - affOwed)

  // ── Per-owner breakdown ───────────────────────────────────────────────────
  const owners: Record<string, unknown>[] = s.ownersRaw ?? []
  const ownerWithdrawn: Record<string, number> = {}
  const ownerInvested: Record<string, number> = {}
  transactions.filter(t => t.type === 'Capital Out' && t.owner).forEach(t => {
    const o = String(t.owner); ownerWithdrawn[o] = (ownerWithdrawn[o] ?? 0) + pf(t.amount)
  })
  transactions.filter(t => t.type === 'Capital In' && t.owner).forEach(t => {
    const o = String(t.owner); ownerInvested[o] = (ownerInvested[o] ?? 0) + pf(t.amount)
  })
  const ownerLines = owners.map((o: Record<string, unknown>) => {
    const share = pf(o.share)
    const withdrawn = ownerWithdrawn[String(o.name)] ?? 0
    const invested  = ownerInvested[String(o.name)] ?? 0
    const canWithdraw = Math.max(0, safeToExtract * share / 100 - withdrawn)
    return `  ${o.name} (${share}%): invested ${fmt(invested)}, withdrawn ${fmt(withdrawn)}, can withdraw now ${fmt(canWithdraw)}`
  }).join('\n')

  // ── Monthly breakdown ─────────────────────────────────────────────────────
  const monthly: Record<string, unknown>[] = s.monthly ?? []
  const monthlyLines = monthly.slice(-12).map((m: Record<string, unknown>) =>
    `  ${m.month}: ${m.orders} orders, rev ${fmt(pf(m.revenue))}, cost ${fmt(pf(m.supplierCost))}, aff ${fmt(pf(m.affComm))}, net ${fmt(pf(m.netProfit))}`
  ).join('\n')

  // ── Affiliate breakdown ───────────────────────────────────────────────────
  const affiliates: Record<string, unknown>[] = s.affiliates ?? []
  const affLines = affiliates.map((a: Record<string, unknown>) =>
    `  ${a.name} [${a.code}] status=${a.status} orders=${a.orderCount} commission_earned=${fmt(pf(a.totalCommission))} total_paid=${fmt(pf(a.total_paid ?? 0))} owes=${fmt(Math.max(0, pf(a.totalCommission) - pf(a.total_paid ?? 0)))}`
  ).join('\n')

  // ── Recent transactions (last 60) ─────────────────────────────────────────
  const recentTx = transactions.slice(-60).map((t: Record<string, unknown>) =>
    `  ${t.date} | ${t.type} | ${t.category ?? '-'} | ${fmt(pf(t.amount))} | ${t.owner ?? '-'} | ${t.description ?? ''}`
  ).join('\n')

  // ── Suppliers ─────────────────────────────────────────────────────────────
  const suppliers: Record<string, unknown>[] = s.suppliersRaw ?? []
  const supLines = suppliers.map((sp: Record<string, unknown>) => `  ${sp.name} (active=${sp.active})`).join('\n')

  // ── Build context ─────────────────────────────────────────────────────────
  const context = `
You are the financial assistant for BUET Tees, a Bangladeshi t-shirt business run by university students.
Today: ${now.toISOString().slice(0,10)}. Currency: BDT (৳). Answer in same language as question (English or Bangla).
Be concise. Use only numbers from the data below. Do not guess or hallucinate.

=== BUSINESS SUMMARY (all-time) ===
Total orders: ${sum.totalOrders ?? '?'}
Revenue: ${fmt(pf(sum.totalRevenue))}
Supplier cost (COGS): ${fmt(pf(sum.totalSupplierCost))}
Gross profit: ${fmt(pf(sum.totalGrossProfit))}
Affiliate commissions accrued: ${fmt(pf(sum.totalAffComm))}
Other expenses: ${fmt(pf(sum.totalExtraExpenses))}
Net profit: ${fmt(pf(sum.totalNetProfit))}

=== CASH POSITION ===
Cash balance (bKash + hand): ${fmt(cashBalance)}
  = Capital In ${fmt(capitalIn)} + Revenue ${fmt(pf(sum.totalRevenue))} − Expenses ${fmt(expensesPaid)} − Supplier paid ${fmt(supPaid)} − Aff paid ${fmt(affPaid)} − Withdrawals ${fmt(capitalOut)}
Reserve (locked): ${fmt(reserve)}
Supplier still owed: ${fmt(supplierOwed)}
Affiliates still owed: ${fmt(affOwed)}
SAFE TO EXTRACT (owners total): ${fmt(safeToExtract)}

=== OWNERS ===
${ownerLines || '  (no owner data)'}

=== MONTHLY TREND (last 12 months) ===
${monthlyLines || '  (no monthly data)'}

=== AFFILIATES (${affiliates.length} total) ===
${affLines || '  (none)'}

=== SUPPLIERS ===
${supLines || '  (none)'}

=== RECENT TRANSACTIONS (last 60) ===
${recentTx || '  (none)'}
`.trim()

  // ── Groq API ──────────────────────────────────────────────────────────────
  const groqKey = Deno.env.get('GROQ_API_KEY')!
  const gRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${groqKey}` },
    body: JSON.stringify({
      model: 'llama-3.3-70b-versatile',
      messages: [
        { role: 'system', content: context },
        { role: 'user', content: question },
      ],
      temperature: 0.2,
      max_tokens: 600,
    }),
  })

  if (!gRes.ok) throw new Error(`Groq error: ${await gRes.text()}`)
  const gData = await gRes.json()
  const answer = gData?.choices?.[0]?.message?.content ?? 'No answer returned.'

  return json({ ok: true, answer })
})
