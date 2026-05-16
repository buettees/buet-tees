// api/admin.js — Vercel Serverless Function
// Holds the Supabase service role key server-side.
// Frontend calls POST /api/admin with { action, payload, token }

const SUPABASE_URL    = process.env.SUPABASE_URL;
const SUPABASE_SECRET = process.env.SUPABASE_SECRET_KEY;
const ADMIN_HASH      = process.env.ADMIN_PASS_HASH; // SHA-256 of admin password

// Actions that require admin password verification
const ADMIN_ACTIONS = [
  'adminLoad',
  'addTransaction',
];

// Actions that are public (order placement, affiliate registration)
const PUBLIC_ACTIONS = [
  'placeOrder',
  'nextOrderId',
  'registerAffiliate',
];

export const config = { runtime: 'edge' };

export default async function handler(req) {
  // CORS headers
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers });
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers });
  }

  const { action, payload, token } = body;

  if (!action) {
    return new Response(JSON.stringify({ error: 'Missing action' }), { status: 400, headers });
  }

  // Verify admin token for protected actions
  if (ADMIN_ACTIONS.includes(action)) {
    if (!token || token !== ADMIN_HASH) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers });
    }
  } else if (!PUBLIC_ACTIONS.includes(action)) {
    return new Response(JSON.stringify({ error: 'Unknown action' }), { status: 400, headers });
  }

  // Helper: call Supabase REST API
  async function sbFetch(path, options = {}) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1${path}`, {
      ...options,
      headers: {
        'apikey': SUPABASE_SECRET,
        'Authorization': `Bearer ${SUPABASE_SECRET}`,
        'Content-Type': 'application/json',
        'Prefer': options.prefer || 'return=representation',
        ...(options.extraHeaders || {}),
      },
    });
    const text = await res.text();
    try { return { data: JSON.parse(text), status: res.status }; }
    catch { return { data: text, status: res.status }; }
  }

  // Helper: call Supabase RPC
  async function sbRpc(fn, args = {}) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_SECRET,
        'Authorization': `Bearer ${SUPABASE_SECRET}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(args),
    });
    const text = await res.text();
    try { return { data: JSON.parse(text), status: res.status }; }
    catch { return { data: text, status: res.status }; }
  }

  try {
    let result;

    // ── PUBLIC ACTIONS ───────────────────────────────────

    if (action === 'nextOrderId') {
      result = await sbRpc('next_order_id');
      return new Response(JSON.stringify(result), { headers });
    }

    if (action === 'placeOrder') {
      result = await sbFetch('/orders', {
        method: 'POST',
        body: JSON.stringify(payload),
        prefer: 'return=representation',
      });
      return new Response(JSON.stringify(result), { headers });
    }

    if (action === 'registerAffiliate') {
      result = await sbFetch('/affiliates', {
        method: 'POST',
        body: JSON.stringify(payload),
        prefer: 'return=representation',
      });
      return new Response(JSON.stringify(result), { headers });
    }

    // ── ADMIN ACTIONS ────────────────────────────────────

    if (action === 'adminLoad') {
      // Fetch all admin data in parallel
      const [orders, affiliates, transactions, settings] = await Promise.all([
        sbFetch('/orders?status=neq.Cancelled&order=created_at.desc&select=*'),
        sbFetch('/affiliates?order=created_at.desc&select=*'),
        sbFetch('/transactions?order=date.desc&select=*'),
        sbFetch('/settings?select=*'),
      ]);
      return new Response(JSON.stringify({
        orders: orders.data,
        affiliates: affiliates.data,
        transactions: transactions.data,
        settings: settings.data,
      }), { headers });
    }

    if (action === 'addTransaction') {
      result = await sbFetch('/transactions', {
        method: 'POST',
        body: JSON.stringify(payload),
        prefer: 'return=representation',
      });
      return new Response(JSON.stringify(result), { headers });
    }

    return new Response(JSON.stringify({ error: 'Unhandled action' }), { status: 400, headers });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers });
  }
}
