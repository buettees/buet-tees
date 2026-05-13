// ask-finance: AI-powered finance Q&A using Gemini
// Zero imports = instant cold start
// POST { question: string } with Bearer <ADMIN_SECRET>

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

// Direct Supabase REST API — no SDK, no cold start delay
async function sbSelect(table: string, select = '*'): Promise<Record<string, unknown>[]> {
  const url = `${Deno.env.get('SUPABASE_URL')}/rest/v1/${table}?select=${encodeURIComponent(select)}`
  const res = await fetch(url, {
    headers: {
      apikey: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      Authorization: `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!}`,
      'Content-Type': 'application/json',
    },
  })
  if (!res.ok) throw new Error(`DB fetch [${table}] failed: ${await res.text()}`)
  return res.json()
}

function fmt(n: number): string {
  return '৳' + n.toLocaleString('en-BD', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function pf(v: unknown): number { return parseFloat(String(v ?? 0)) || 0 }

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (!isAdmin(req)) return json({ error: 'Unauthorized' }, 401)

  const { question } = await req.json()
  if (!question) return json({ error: 'No question provided' }, 400)

  // Fetch all tables in parallel — no SDK, pure fetch
  const [orders, transactions, supplierPayments, affiliatePayouts] = await Promise.all([
    sbSelect('orders'),
    sbSelect('transactions'),
    sbSelect('supplier_payments'),
    sbSelect('affiliate_payouts'),
  ])

  // ── Compute metrics ───────────────────────────────────────────────────────
  const totalSalesRevenue = orders.reduce((s, o) => s + pf(o.total) - pf(o.delivery_fee), 0)
  const totalDeliveryRevenue = orders.reduce((s, o) => s + pf(o.delivery_fee), 0)
  const totalRevenue = totalSalesRevenue + totalDeliveryRevenue
  const totalSupplierCost = supplierPayments.reduce((s, p) => s + pf(p.amount), 0)
  const grossProfit = totalRevenue - totalSupplierCost

  const marketingExpense = transactions
    .filter(t => t.category === 'Marketing' && (t.type === 'Money Out' || t.type === 'Expense'))
    .reduce((s, t) => s + pf(t.amount), 0)
  const miscExpense = transactions
    .filter(t => !['Marketing','Supplier Payment','Affiliate Payment'].includes(String(t.category ?? '')) && (t.type === 'Money Out' || t.type === 'Expense'))
    .reduce((s, t) => s + pf(t.amount), 0)
  const affiliateExpense = affiliatePayouts.reduce((s, p) => s + pf(p.amount), 0)
  const totalExpenses = marketingExpense + miscExpense + affiliateExpense
  const netProfit = grossProfit - totalExpenses

  const ownerFilter = (type: string, name: string) =>
    transactions.filter(t => t.type === type && String(t.owner ?? '').toLowerCase().includes(name))
      .reduce((s, t) => s + pf(t.amount), 0)

  const ashikCapitalIn = ownerFilter('Capital In', 'ashik')
  const kausarCapitalIn = ownerFilter('Capital In', 'kausar')
  const ashikDrawings = ownerFilter('Capital Out', 'ashik')
  const kausarDrawings = ownerFilter('Capital Out', 'kausar')

  const totalCashIn = totalRevenue + ashikCapitalIn + kausarCapitalIn
  const totalCashOut = totalSupplierCost + affiliateExpense + marketingExpense + miscExpense + ashikDrawings + kausarDrawings
  const bkashBalance = totalCashIn - totalCashOut
  const reserve = bkashBalance * 0.2
  const availableToDistribute = Math.max(0, bkashBalance - reserve)
  const safeToWithdrawEach = availableToDistribute / 2

  const ashikNetEquity = ashikCapitalIn - ashikDrawings + (netProfit * 0.5)
  const kausarNetEquity = kausarCapitalIn - kausarDrawings + (netProfit * 0.5)

  const now = new Date()
  const cm = now.getMonth() + 1
  const cy = now.getFullYear()
  const monthOrders = orders.filter(o => { const d = new Date(String(o.created_at ?? '')); return d.getMonth()+1===cm && d.getFullYear()===cy })
  const monthRevenue = monthOrders.reduce((s, o) => s + pf(o.total), 0)

  const statusCounts: Record<string, number> = {}
  for (const o of orders) { const s = String(o.status ?? 'unknown'); statusCounts[s] = (statusCounts[s] ?? 0) + 1 }

  const affiliateSales: Record<string, number> = {}
  for (const o of orders) { if (o.affiliate_code) affiliateSales[String(o.affiliate_code)] = (affiliateSales[String(o.affiliate_code)] ?? 0) + pf(o.total) }
  const topAffiliates = Object.entries(affiliateSales).sort((a,b)=>b[1]-a[1]).slice(0,5).map(([c,a])=>`${c}: ${fmt(a)}`).join(', ')

  // ── Build context ─────────────────────────────────────────────────────────
  const context = `
You are the financial assistant for BUET Tees, a Bangladeshi t-shirt business. Two equal partners: Ashik (50%) and Kausar (50%).
Today: ${now.toISOString().slice(0,10)}. Currency: BDT (৳).

FINANCIALS (all-time):
Revenue: T-shirt ${fmt(totalSalesRevenue)} + Delivery ${fmt(totalDeliveryRevenue)} = ${fmt(totalRevenue)}
COGS (supplier): ${fmt(totalSupplierCost)}
Gross Profit: ${fmt(grossProfit)}
Expenses: Affiliate ${fmt(affiliateExpense)}, Marketing ${fmt(marketingExpense)}, Misc ${fmt(miscExpense)} = ${fmt(totalExpenses)}
NET PROFIT: ${fmt(netProfit)}

CASH (bKash):
In: ${fmt(totalCashIn)} | Out: ${fmt(totalCashOut)} | Balance: ${fmt(bkashBalance)}
Reserve 20%: ${fmt(reserve)} | Free: ${fmt(availableToDistribute)}
SAFE TO WITHDRAW EACH: ${fmt(safeToWithdrawEach)}

PARTNERS:
Ashik — invested ${fmt(ashikCapitalIn)}, withdrawn ${fmt(ashikDrawings)}, net equity ${fmt(ashikNetEquity)}
Kausar — invested ${fmt(kausarCapitalIn)}, withdrawn ${fmt(kausarDrawings)}, net equity ${fmt(kausarNetEquity)}

THIS MONTH (${now.toLocaleString('en',{month:'long'})} ${cy}):
Orders: ${monthOrders.length} | Revenue: ${fmt(monthRevenue)}

ORDERS: total ${orders.length} | status: ${JSON.stringify(statusCounts)}
TOP AFFILIATES: ${topAffiliates || 'none'}

Answer concisely. Same language as question (English or Bangla). Numbers only from above data.
`.trim()

  // ── Groq API (OpenAI-compatible) ──────────────────────────────────────────
  const groqKey = Deno.env.get('GROQ_API_KEY')!
  const gRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${groqKey}` },
    body: JSON.stringify({
      model: 'llama-3.1-8b-instant',
      messages: [
        { role: 'system', content: context },
        { role: 'user', content: question },
      ],
      temperature: 0.2,
      max_tokens: 512,
    }),
  })

  if (!gRes.ok) throw new Error(`Groq error: ${await gRes.text()}`)
  const gData = await gRes.json()
  const answer = gData?.choices?.[0]?.message?.content ?? 'No answer returned.'

  return json({ ok: true, answer })
})
