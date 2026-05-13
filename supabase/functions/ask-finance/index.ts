// ask-finance: AI-powered finance Q&A using Gemini
// POST { question: string } with Bearer <ADMIN_SECRET>

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

function isAdmin(req: Request): boolean {
  const secret = Deno.env.get('ADMIN_SECRET')
  if (!secret) return false
  const auth = req.headers.get('Authorization') ?? ''
  return auth === `Bearer ${secret}`
}

function fmt(n: number): string {
  return '৳' + n.toLocaleString('en-BD', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  if (!isAdmin(req)) return json({ error: 'Unauthorized' }, 401)

  const { question } = await req.json()
  if (!question) return json({ error: 'No question provided' }, 400)

  const sb = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  // Fetch all data in parallel
  const [ordRes, txRes, spRes, apRes] = await Promise.all([
    sb.from('orders').select('*'),
    sb.from('transactions').select('*'),
    sb.from('supplier_payments').select('*'),
    sb.from('affiliate_payouts').select('*'),
  ])

  const orders = ordRes.data ?? []
  const transactions = txRes.data ?? []
  const supplierPayments = spRes.data ?? []
  const affiliatePayouts = apRes.data ?? []

  // ── Compute key metrics ───────────────────────────────────────────────────

  // Revenue
  const totalSalesRevenue = orders.reduce((s, o) => s + parseFloat(o.total ?? 0) - parseFloat(o.delivery_fee ?? 0), 0)
  const totalDeliveryRevenue = orders.reduce((s, o) => s + parseFloat(o.delivery_fee ?? 0), 0)
  const totalRevenue = totalSalesRevenue + totalDeliveryRevenue

  // COGS
  const totalSupplierCost = supplierPayments.reduce((s, p) => s + parseFloat(p.amount ?? 0), 0)

  // Gross profit
  const grossProfit = totalRevenue - totalSupplierCost

  // Expenses from transactions
  const marketingExpense = transactions
    .filter(t => t.category === 'Marketing' && (t.type === 'Money Out' || t.type === 'Expense'))
    .reduce((s, t) => s + parseFloat(t.amount ?? 0), 0)
  const miscExpense = transactions
    .filter(t => t.category !== 'Marketing' && t.category !== 'Supplier Payment' && t.category !== 'Affiliate Payment' && (t.type === 'Money Out' || t.type === 'Expense'))
    .reduce((s, t) => s + parseFloat(t.amount ?? 0), 0)
  const affiliateExpense = affiliatePayouts.reduce((s, p) => s + parseFloat(p.amount ?? 0), 0)
  const totalExpenses = marketingExpense + miscExpense + affiliateExpense

  // Net profit
  const netProfit = grossProfit - totalExpenses

  // Capital
  const ashikCapitalIn = transactions
    .filter(t => t.type === 'Capital In' && (t.owner ?? '').toLowerCase().includes('ashik'))
    .reduce((s, t) => s + parseFloat(t.amount ?? 0), 0)
  const kausarCapitalIn = transactions
    .filter(t => t.type === 'Capital In' && (t.owner ?? '').toLowerCase().includes('kausar'))
    .reduce((s, t) => s + parseFloat(t.amount ?? 0), 0)

  const ashikDrawings = transactions
    .filter(t => t.type === 'Capital Out' && (t.owner ?? '').toLowerCase().includes('ashik'))
    .reduce((s, t) => s + parseFloat(t.amount ?? 0), 0)
  const kausarDrawings = transactions
    .filter(t => t.type === 'Capital Out' && (t.owner ?? '').toLowerCase().includes('kausar'))
    .reduce((s, t) => s + parseFloat(t.amount ?? 0), 0)

  // bKash balance = all money in - all money out
  const totalCashIn = totalRevenue + ashikCapitalIn + kausarCapitalIn
  const totalCashOut = totalSupplierCost + affiliateExpense + marketingExpense + miscExpense + ashikDrawings + kausarDrawings
  const bkashBalance = totalCashIn - totalCashOut

  // Safe to withdraw (keep 20% reserve)
  const reserve = bkashBalance * 0.2
  const availableToDistribute = Math.max(0, bkashBalance - reserve)
  const safeToWithdrawEach = availableToDistribute / 2

  // Ashik & Kausar net equity
  const ashikNetEquity = ashikCapitalIn - ashikDrawings + (netProfit * 0.5)
  const kausarNetEquity = kausarCapitalIn - kausarDrawings + (netProfit * 0.5)

  // Monthly breakdown (current month)
  const now = new Date()
  const currentMonth = now.getMonth() + 1
  const currentYear = now.getFullYear()

  const monthOrders = orders.filter(o => {
    const d = new Date(o.created_at)
    return d.getMonth() + 1 === currentMonth && d.getFullYear() === currentYear
  })
  const monthRevenue = monthOrders.reduce((s, o) => s + parseFloat(o.total ?? 0), 0)
  const monthOrders_count = monthOrders.length

  const monthSupplierCost = supplierPayments.filter(p => {
    const d = new Date(p.created_at)
    return d.getMonth() + 1 === currentMonth && d.getFullYear() === currentYear
  }).reduce((s, p) => s + parseFloat(p.amount ?? 0), 0)

  // Order status breakdown
  const statusCounts: Record<string, number> = {}
  for (const o of orders) {
    const s = o.status ?? 'unknown'
    statusCounts[s] = (statusCounts[s] ?? 0) + 1
  }

  // Top affiliates
  const affiliateSales: Record<string, number> = {}
  for (const o of orders) {
    if (o.affiliate_code) {
      affiliateSales[o.affiliate_code] = (affiliateSales[o.affiliate_code] ?? 0) + parseFloat(o.total ?? 0)
    }
  }
  const topAffiliates = Object.entries(affiliateSales)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([code, amt]) => `${code}: ${fmt(amt)}`)
    .join(', ')

  // ── Build context for Gemini ──────────────────────────────────────────────
  const financialContext = `
You are the financial assistant for BUET Tees, a Bangladeshi t-shirt business owned by two partners: Ashik (50%) and Kausar (50%).

Today's date: ${now.toISOString().slice(0, 10)}
Currency: BDT (Bangladeshi Taka, symbol ৳)

BUSINESS FINANCIAL SNAPSHOT:
━━━━━━━━━━━━━━━━━━━━━━━━━━━
REVENUE (all time):
- T-shirt Sales: ${fmt(totalSalesRevenue)}
- Delivery Revenue: ${fmt(totalDeliveryRevenue)}
- TOTAL REVENUE: ${fmt(totalRevenue)}

COST OF GOODS SOLD:
- Supplier Payments: ${fmt(totalSupplierCost)}
- GROSS PROFIT: ${fmt(grossProfit)}

OPERATING EXPENSES:
- Affiliate Commissions: ${fmt(affiliateExpense)}
- Marketing: ${fmt(marketingExpense)}
- Miscellaneous: ${fmt(miscExpense)}
- TOTAL EXPENSES: ${fmt(totalExpenses)}

NET PROFIT: ${fmt(netProfit)}

CASH POSITION (bKash):
- Total Cash In: ${fmt(totalCashIn)}
- Total Cash Out: ${fmt(totalCashOut)}
- bKash Balance: ${fmt(bkashBalance)}
- Reserve (20%): ${fmt(reserve)}
- Available to Distribute: ${fmt(availableToDistribute)}
- Safe to Withdraw EACH partner: ${fmt(safeToWithdrawEach)}

PARTNER CAPITAL:
- Ashik: Invested ${fmt(ashikCapitalIn)}, Withdrawn ${fmt(ashikDrawings)}, Net Equity ${fmt(ashikNetEquity)}
- Kausar: Invested ${fmt(kausarCapitalIn)}, Withdrawn ${fmt(kausarDrawings)}, Net Equity ${fmt(kausarNetEquity)}

THIS MONTH (${now.toLocaleString('en', { month: 'long' })} ${currentYear}):
- Orders: ${monthOrders_count}
- Revenue: ${fmt(monthRevenue)}
- Supplier Cost: ${fmt(monthSupplierCost)}

ORDER STATS:
- Total Orders: ${orders.length}
- Status breakdown: ${JSON.stringify(statusCounts)}
- Total Transactions: ${transactions.length}

TOP AFFILIATES BY SALES: ${topAffiliates || 'None'}

RULES:
- Answer in the same language the user asks (English or Bangla)
- Be direct and specific with numbers
- Keep answers short and clear — this is a business owner asking on a busy day
- If asked about withdrawal, always state the "Safe to Withdraw EACH" figure
- Never make up numbers — only use the data provided above
`.trim()

  // ── Call Gemini API ───────────────────────────────────────────────────────
  const geminiKey = Deno.env.get('GEMINI_API_KEY')!
  const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${geminiKey}`

  const geminiRes = await fetch(geminiUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [
        { role: 'user', parts: [{ text: financialContext }] },
        { role: 'model', parts: [{ text: 'Understood. I have the full financial snapshot. Ask me anything.' }] },
        { role: 'user', parts: [{ text: question }] },
      ],
      generationConfig: {
        temperature: 0.2,
        maxOutputTokens: 512,
      },
    }),
  })

  if (!geminiRes.ok) {
    const err = await geminiRes.text()
    throw new Error(`Gemini error: ${err}`)
  }

  const geminiData = await geminiRes.json()
  const answer = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text ?? 'No answer returned.'

  return json({ ok: true, answer })
})
