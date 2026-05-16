// Chart of Accounts
export const COA: Record<string, string> = {
  '1001': 'bKash Balance',
  '1002': 'Cash in Hand',
  '3001': 'Ashik Capital',
  '3002': 'Kausar Capital',
  '3003': 'Ashik Drawings',
  '3004': 'Kausar Drawings',
  '3005': 'Retained Earnings',
  '4001': 'T-shirt Sales',
  '4002': 'Delivery Revenue',
  '5001': 'Supplier Cost',
  '6001': 'Affiliate Commissions',
  '6002': 'Marketing Expense',
  '6003': 'Miscellaneous Expense',
}

export interface JournalEntry {
  date: string        // YYYY-MM-DD
  time: string        // HH:MM:SS
  refId: string
  description: string
  drCode: string
  drName: string
  amount: number
  crCode: string
  crName: string
  source: string
}

function ownerCapitalCode(owner: string | null): string {
  if (!owner) return '3005'
  const name = (owner || '').toLowerCase()
  if (name.includes('ashik')) return '3001'
  if (name.includes('kausar')) return '3002'
  return '3005'
}

function ownerDrawingsCode(owner: string | null): string {
  if (!owner) return '3005'
  const name = (owner || '').toLowerCase()
  if (name.includes('ashik')) return '3003'
  if (name.includes('kausar')) return '3004'
  return '3005'
}

// deno-lint-ignore no-explicit-any
export function journalFromOrder(record: Record<string, any>): JournalEntry[] {
  const ts = record.created_at ? new Date(record.created_at) : new Date()
  const date = ts.toISOString().slice(0, 10)
  const time = ts.toISOString().slice(11, 19)
  const refId = record.id ?? ''
  const delivery = parseFloat(record.delivery_fee ?? 0)
  const total = parseFloat(record.total ?? 0)
  const salesAmt = parseFloat((total - delivery).toFixed(2))

  const entries: JournalEntry[] = []

  if (salesAmt > 0) {
    entries.push({
      date, time, refId,
      description: `Order ${refId} — T-shirt sales`,
      drCode: '1001', drName: COA['1001'],
      amount: salesAmt,
      crCode: '4001', crName: COA['4001'],
      source: 'orders',
    })
  }

  if (delivery > 0) {
    entries.push({
      date, time, refId,
      description: `Order ${refId} — delivery fee`,
      drCode: '1001', drName: COA['1001'],
      amount: delivery,
      crCode: '4002', crName: COA['4002'],
      source: 'orders',
    })
  }

  return entries
}

// deno-lint-ignore no-explicit-any
export function journalFromTransaction(record: Record<string, any>): JournalEntry[] {
  const date = record.date ?? new Date().toISOString().slice(0, 10)
  const time = new Date().toISOString().slice(11, 19)
  const refId = record.id ? String(record.id) : ''
  const amount = parseFloat(record.amount ?? 0)
  const description = record.description ?? record.type
  const type: string = record.type ?? ''
  const category: string = record.category ?? ''
  const owner: string | null = record.owner ?? null

  if (amount <= 0) return []

  if (type === 'Capital In') {
    const crCode = ownerCapitalCode(owner)
    return [{
      date, time, refId, description,
      drCode: '1001', drName: COA['1001'],
      amount,
      crCode, crName: COA[crCode],
      source: 'transactions',
    }]
  }

  if (type === 'Capital Out') {
    const drCode = ownerDrawingsCode(owner)
    return [{
      date, time, refId, description,
      drCode, drName: COA[drCode],
      amount,
      crCode: '1001', crName: COA['1001'],
      source: 'transactions',
    }]
  }

  if (type === 'Money Out' || type === 'Expense') {
    let drCode = '6003'
    if (category === 'Supplier Payment') drCode = '5001'
    else if (category === 'Affiliate Payment') drCode = '6001'
    else if (category === 'Marketing') drCode = '6002'
    return [{
      date, time, refId, description,
      drCode, drName: COA[drCode],
      amount,
      crCode: '1001', crName: COA['1001'],
      source: 'transactions',
    }]
  }

  return []
}

export function entryToRow(e: JournalEntry): unknown[] {
  return [e.date, e.time, e.refId, e.description, e.drCode, e.drName, e.amount, e.crCode, e.crName, e.amount, e.source]
}
