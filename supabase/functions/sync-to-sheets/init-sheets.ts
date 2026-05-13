import { appendRows, batchUpdate, getSheets, updateRange } from './sheets-api.ts'
import { COA } from './journal.ts'

const TABS = {
  JOURNAL: 'Journal',
  ORDERS: 'Orders',
  TRANSACTIONS: 'Transactions',
  SUPPLIER_PAYMENTS: 'Supplier Payments',
  AFFILIATE_PAYOUTS: 'Affiliate Payouts',
  PNL: 'P&L',
  BALANCE_SHEET: 'Balance Sheet',
  PARTNER_CAPITAL: 'Partner Capital',
  CASH_POSITION: 'Cash Position',
  COA: 'Chart of Accounts',
}

const HEADER_BG = { red: 0.12, green: 0.12, blue: 0.12 }
const HEADER_FG = { red: 0.8, green: 0.66, blue: 0.3 } // gold
const ACCENT_BG = { red: 0.06, green: 0.06, blue: 0.06 }

const HEADERS: Record<string, string[]> = {
  [TABS.JOURNAL]: [
    'Date', 'Time', 'Ref ID', 'Description',
    'Dr Acct Code', 'Dr Account', 'Dr Amount ৳',
    'Cr Acct Code', 'Cr Account', 'Cr Amount ৳', 'Source',
  ],
  [TABS.ORDERS]: [
    'Created At', 'Order ID', 'Customer', 'Phone', 'Email',
    'Address', 'Zone', 'Items', 'Subtotal ৳', 'Delivery ৳',
    'Discount %', 'Discount Amt ৳', 'Total ৳', 'Trx ID', 'Affiliate', 'Status', 'Notes',
  ],
  [TABS.TRANSACTIONS]: ['Date', 'Description', 'Type', 'Amount ৳', 'Owner', 'Category', 'Ref ID'],
  [TABS.SUPPLIER_PAYMENTS]: ['Created At', 'Supplier', 'Amount ৳', 'Method', 'Note', 'Order ID'],
  [TABS.AFFILIATE_PAYOUTS]: ['Created At', 'Affiliate Code', 'Amount ৳', 'Method', 'Note', 'Order ID'],
}

// Build SUMPRODUCT formula: sum Cr amounts where Cr account code matches, optionally filtered by month
function crSumYTD(acct: string): string {
  return `=SUMPRODUCT((Journal!$H$2:$H$5000="${acct}")*(Journal!$J$2:$J$5000))`
}
function crSumMonth(acct: string, month: number): string {
  return `=SUMPRODUCT((IFERROR(MONTH(DATEVALUE(Journal!$A$2:$A$5000)),0)=${month})*(Journal!$H$2:$H$5000="${acct}")*(Journal!$J$2:$J$5000))`
}
function drSumYTD(acct: string): string {
  return `=SUMPRODUCT((Journal!$E$2:$E$5000="${acct}")*(Journal!$G$2:$G$5000))`
}
function drSumMonth(acct: string, month: number): string {
  return `=SUMPRODUCT((IFERROR(MONTH(DATEVALUE(Journal!$A$2:$A$5000)),0)=${month})*(Journal!$E$2:$E$5000="${acct}")*(Journal!$G$2:$G$5000))`
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function pnlRow(label: string, formula: (m?: number) => string): unknown[] {
  return [label, ...MONTHS.map((_, i) => formula(i + 1)), formula()]
}

function pnlFormula(type: 'cr' | 'dr', acct: string) {
  return (month?: number) => month ? (type === 'cr' ? crSumMonth(acct, month) : drSumMonth(acct, month)) : (type === 'cr' ? crSumYTD(acct) : drSumYTD(acct))
}

function sumRowRange(startRow: number, endRow: number): (month?: number) => string {
  return (month?: number) => {
    const col = month ? String.fromCharCode(65 + month) : 'N'
    return `=SUM(${col}${startRow}:${col}${endRow})`
  }
}

function diffRows(rowA: number, rowB: number): (month?: number) => string {
  return (month?: number) => {
    const col = month ? String.fromCharCode(65 + month) : 'N'
    return `=${col}${rowA}-${col}${rowB}`
  }
}

export async function initSheets(token: string): Promise<void> {
  const existing = await getSheets(token)
  const existingTitles = new Set(existing.map((s) => s.title))

  const tabOrder = Object.values(TABS)
  const requests: unknown[] = []

  // Rename default "Sheet1" → first tab if it exists
  const sheet1 = existing.find((s) => s.title === 'Sheet1')
  if (sheet1 && !existingTitles.has(TABS.JOURNAL)) {
    requests.push({
      updateSheetProperties: {
        properties: { sheetId: sheet1.sheetId, title: TABS.JOURNAL },
        fields: 'title',
      },
    })
    existingTitles.add(TABS.JOURNAL)
    existingTitles.delete('Sheet1')
  }

  // Add missing tabs
  for (const title of tabOrder) {
    if (!existingTitles.has(title)) {
      requests.push({ addSheet: { properties: { title } } })
    }
  }

  if (requests.length) await batchUpdate(token, requests)

  // Style + freeze header row for data tabs
  const sheetsNow = await getSheets(token)
  const sheetMap = new Map(sheetsNow.map((s) => [s.title, s.sheetId]))

  const styleRequests: unknown[] = []
  for (const [tabName, headers] of Object.entries(HEADERS)) {
    const sid = sheetMap.get(tabName)
    if (sid === undefined) continue

    // Dark background + gold text for header row
    styleRequests.push({
      repeatCell: {
        range: { sheetId: sid, startRowIndex: 0, endRowIndex: 1 },
        cell: {
          userEnteredFormat: {
            backgroundColor: HEADER_BG,
            textFormat: { foregroundColor: HEADER_FG, bold: true, fontSize: 10 },
          },
        },
        fields: 'userEnteredFormat(backgroundColor,textFormat)',
      },
    })
    // Dark background for data rows
    styleRequests.push({
      repeatCell: {
        range: { sheetId: sid, startRowIndex: 1, endRowIndex: 5000 },
        cell: { userEnteredFormat: { backgroundColor: ACCENT_BG } },
        fields: 'userEnteredFormat.backgroundColor',
      },
    })
    // Freeze header row
    styleRequests.push({
      updateSheetProperties: {
        properties: { sheetId: sid, gridProperties: { frozenRowCount: 1 } },
        fields: 'gridProperties.frozenRowCount',
      },
    })
    // Write headers
    await updateRange(token, `${tabName}!A1`, [headers])
    // Unused header count
    void headers
  }

  if (styleRequests.length) await batchUpdate(token, styleRequests)

  // ── Chart of Accounts ──────────────────────────────────────
  await updateRange(token, `${TABS.COA}!A1`, [
    ['Code', 'Account Name', 'Type'],
    ...Object.entries(COA).map(([code, name]) => {
      const type = code.startsWith('1')
        ? 'Asset'
        : code.startsWith('3')
        ? 'Equity'
        : code.startsWith('4')
        ? 'Income'
        : 'Expense / COGS'
      return [code, name, type]
    }),
  ])

  // ── P&L Sheet ──────────────────────────────────────────────
  const pnlHeaders = ['', ...MONTHS, 'YTD']
  const pnlData: unknown[][] = [
    pnlHeaders,
    ['REVENUE'],
    pnlRow('T-shirt Sales (4001)', pnlFormula('cr', '4001')),       // row 3
    pnlRow('Delivery Revenue (4002)', pnlFormula('cr', '4002')),    // row 4
    pnlRow('TOTAL REVENUE', sumRowRange(3, 4)),                      // row 5
    [''],
    ['COST OF GOODS SOLD'],
    pnlRow('Supplier Cost (5001)', pnlFormula('dr', '5001')),       // row 8
    pnlRow('GROSS PROFIT', diffRows(5, 8)),                          // row 9
    [''],
    ['OPERATING EXPENSES'],
    pnlRow('Affiliate Commissions (6001)', pnlFormula('dr', '6001')), // row 12
    pnlRow('Marketing (6002)', pnlFormula('dr', '6002')),            // row 13
    pnlRow('Miscellaneous (6003)', pnlFormula('dr', '6003')),        // row 14
    pnlRow('TOTAL EXPENSES', sumRowRange(12, 14)),                   // row 15
    [''],
    pnlRow('NET PROFIT', diffRows(9, 15)),                           // row 17
  ]
  await updateRange(token, `${TABS.PNL}!A1`, pnlData)

  // ── Balance Sheet ──────────────────────────────────────────
  // bKash balance = total DR to 1001 minus total CR from 1001
  const bkashBal = `=SUMPRODUCT((Journal!$E$2:$E$5000="1001")*(Journal!$G$2:$G$5000))-SUMPRODUCT((Journal!$H$2:$H$5000="1001")*(Journal!$J$2:$J$5000))`
  // Net profit = Revenue - COGS - Expenses (retained in business)
  const netProfit = `='P&L'!N17`
  const ashikEquity = `=SUMPRODUCT((Journal!$H$2:$H$5000="3001")*(Journal!$J$2:$J$5000))-SUMPRODUCT((Journal!$E$2:$E$5000="3003")*(Journal!$G$2:$G$5000))+('P&L'!N17*0.5)`
  const kausarEquity = `=SUMPRODUCT((Journal!$H$2:$H$5000="3002")*(Journal!$J$2:$J$5000))-SUMPRODUCT((Journal!$E$2:$E$5000="3004")*(Journal!$G$2:$G$5000))+('P&L'!N17*0.5)`

  await updateRange(token, `${TABS.BALANCE_SHEET}!A1`, [
    ['BALANCE SHEET', 'Amount ৳'],
    [''],
    ['ASSETS'],
    ['bKash Balance (1001)', bkashBal],
    ['Cash in Hand (1002)', `=SUMPRODUCT((Journal!$E$2:$E$5000="1002")*(Journal!$G$2:$G$5000))-SUMPRODUCT((Journal!$H$2:$H$5000="1002")*(Journal!$J$2:$J$5000))`],
    ['TOTAL ASSETS', '=B4+B5'],
    [''],
    ['EQUITY'],
    ['Ashik Capital — net (3001 − 3003 + 50% profit)', ashikEquity],
    ['Kausar Capital — net (3002 − 3004 + 50% profit)', kausarEquity],
    ['TOTAL EQUITY', '=B9+B10'],
    [''],
    ['Assets = Equity check', '=IF(B6=B11,"✓ Balanced","⚠ Mismatch")'],
  ])

  // ── Partner Capital Sheet ──────────────────────────────────
  await updateRange(token, `${TABS.PARTNER_CAPITAL}!A1`, [
    ['', 'Ashik (50%)', 'Kausar (50%)'],
    ['Capital Contributed',
      `=SUMPRODUCT((Journal!$H$2:$H$5000="3001")*(Journal!$J$2:$J$5000))`,
      `=SUMPRODUCT((Journal!$H$2:$H$5000="3002")*(Journal!$J$2:$J$5000))`,
    ],
    ['Drawings (withdrawn)',
      `=SUMPRODUCT((Journal!$E$2:$E$5000="3003")*(Journal!$G$2:$G$5000))`,
      `=SUMPRODUCT((Journal!$E$2:$E$5000="3004")*(Journal!$G$2:$G$5000))`,
    ],
    ['50% of Net Profit', `='P&L'!N17*0.5`, `='P&L'!N17*0.5`],
    ['NET EQUITY', '=B2-B3+B4', '=C2-C3+C4'],
    [''],
    ['Safe to Withdraw (each)', `=MAX(0,('Balance Sheet'!B4-MAX(0,'Balance Sheet'!B4*0.2))/2)`, ''],
  ])

  // ── Cash Position Sheet ────────────────────────────────────
  await updateRange(token, `${TABS.CASH_POSITION}!A1`, [
    ['CASH POSITION (bKash)', 'Amount ৳'],
    [''],
    ['Capital Invested (in)', `=SUMPRODUCT((Journal!$E$2:$E$5000="1001")*(Journal!$H$2:$H$5000<>"4001")*(Journal!$H$2:$H$5000<>"4002")*(Journal!$G$2:$G$5000))`],
    ['Revenue Received (in)', `=SUMPRODUCT((Journal!$E$2:$E$5000="1001")*((Journal!$H$2:$H$5000="4001")+(Journal!$H$2:$H$5000="4002"))*(Journal!$G$2:$G$5000))`],
    ['Total Cash In', '=B3+B4'],
    [''],
    ['Supplier Payments (out)', drSumYTD('5001')],
    ['Affiliate Commissions (out)', drSumYTD('6001')],
    ['Marketing (out)', drSumYTD('6002')],
    ['Miscellaneous Expenses (out)', drSumYTD('6003')],
    ['Owner Withdrawals (out)', `=SUMPRODUCT((Journal!$E$2:$E$5000="3003")*(Journal!$G$2:$G$5000))+SUMPRODUCT((Journal!$E$2:$E$5000="3004")*(Journal!$G$2:$G$5000))`],
    ['Total Cash Out', '=B7+B8+B9+B10+B11'],
    [''],
    ['NET CASH (bKash Balance)', '=B5-B12'],
    ['Recommended Reserve (20%)', '=B14*0.2'],
    ['Available to Distribute', '=MAX(0,B14-B15)'],
  ])
}
