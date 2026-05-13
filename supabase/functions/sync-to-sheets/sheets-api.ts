const BASE = 'https://sheets.googleapis.com/v4/spreadsheets'

function sheetId(): string {
  return Deno.env.get('GOOGLE_SHEET_ID')!
}

export async function appendRows(
  token: string,
  sheetName: string,
  rows: unknown[][],
): Promise<void> {
  const range = encodeURIComponent(`${sheetName}!A1`)
  const url = `${BASE}/${sheetId()}/values/${range}:append?valueInputOption=USER_ENTERED&insertDataOption=OVERWRITE`
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ values: rows }),
  })
  if (!res.ok) throw new Error(`Sheets append [${sheetName}] failed: ${await res.text()}`)
}

export async function updateRange(
  token: string,
  range: string,
  values: unknown[][],
): Promise<void> {
  const url = `${BASE}/${sheetId()}/values/${encodeURIComponent(range)}?valueInputOption=USER_ENTERED`
  const res = await fetch(url, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ values }),
  })
  if (!res.ok) throw new Error(`Sheets update [${range}] failed: ${await res.text()}`)
}

export async function batchUpdate(token: string, requests: unknown[]): Promise<void> {
  const res = await fetch(`${BASE}/${sheetId()}:batchUpdate`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ requests }),
  })
  if (!res.ok) throw new Error(`Sheets batchUpdate failed: ${await res.text()}`)
}

export async function clearSheetData(
  token: string,
  sheetName: string,
): Promise<void> {
  // Clears rows 2 onwards (preserves header row 1)
  const range = encodeURIComponent(`${sheetName}!A2:Z10000`)
  const url = `${BASE}/${sheetId()}/values/${range}:clear`
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  })
  if (!res.ok) throw new Error(`Sheets clear [${sheetName}] failed: ${await res.text()}`)
}

export async function getSheets(
  token: string,
): Promise<{ title: string; sheetId: number }[]> {
  const res = await fetch(`${BASE}/${sheetId()}?fields=sheets.properties`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  const data = await res.json()
  // deno-lint-ignore no-explicit-any
  return (data.sheets ?? []).map((s: any) => ({
    title: s.properties.title as string,
    sheetId: s.properties.sheetId as number,
  }))
}
