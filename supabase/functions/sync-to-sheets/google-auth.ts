const TOKEN_URL = 'https://oauth2.googleapis.com/token'

function b64url(input: string | Uint8Array): string {
  const str = typeof input === 'string' ? input : String.fromCharCode(...input)
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}

export async function getAccessToken(): Promise<string> {
  const email = Deno.env.get('GOOGLE_SERVICE_ACCOUNT_EMAIL')!
  const pem = Deno.env.get('GOOGLE_PRIVATE_KEY')!.replace(/\\n/g, '\n')

  const pemBody = pem.replace(/-----[A-Z ]+-----/g, '').replace(/\s/g, '')
  const der = Uint8Array.from(atob(pemBody), (c) => c.charCodeAt(0))

  const key = await crypto.subtle.importKey(
    'pkcs8',
    der.buffer,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  )

  const now = Math.floor(Date.now() / 1000)
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const payload = b64url(JSON.stringify({
    iss: email,
    scope: 'https://www.googleapis.com/auth/spreadsheets',
    aud: TOKEN_URL,
    exp: now + 3600,
    iat: now,
  }))

  const sig = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    key,
    new TextEncoder().encode(`${header}.${payload}`),
  )
  const jwt = `${header}.${payload}.${b64url(new Uint8Array(sig))}`

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`,
  })
  const { access_token, error } = await res.json()
  if (!access_token) throw new Error(`Google auth failed: ${error}`)
  return access_token
}
