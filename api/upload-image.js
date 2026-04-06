// /api/upload-image.js
// Vercel Serverless Function — uploads product image to Supabase Storage
// Add these to Vercel Environment Variables:
//   SUPABASE_URL = https://kgjrnmlheqwhlmwkcvns.supabase.co
//   SUPABASE_SERVICE_KEY = your service role key

import { createClient } from '@supabase/supabase-js';

export const config = { api: { bodyParser: false } };

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_KEY
    );

    // Read raw body
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const buffer = Buffer.concat(chunks);

    // Parse multipart manually using boundary
    const contentType = req.headers['content-type'] || '';
    const boundaryMatch = contentType.match(/boundary=(.+)$/);
    if (!boundaryMatch) return res.status(400).json({ error: 'No boundary found' });

    const boundary = '--' + boundaryMatch[1];
    const parts = buffer.toString('binary').split(boundary);

    let fileBuffer = null;
    let fileName = 'image.jpg';
    let mimeType = 'image/jpeg';
    let folder = 'regular';

    for (const part of parts) {
      if (part.includes('name="folder"')) {
        folder = part.split('\r\n\r\n')[1]?.replace(/\r\n--$/, '').trim() || 'regular';
      }
      if (part.includes('name="file"')) {
        const nameMatch = part.match(/filename="([^"]+)"/);
        if (nameMatch) fileName = nameMatch[1];
        const mimeMatch = part.match(/Content-Type: ([^\r\n]+)/);
        if (mimeMatch) mimeType = mimeMatch[1].trim();
        const dataStart = part.indexOf('\r\n\r\n') + 4;
        const dataEnd = part.lastIndexOf('\r\n');
        fileBuffer = Buffer.from(part.slice(dataStart, dataEnd), 'binary');
      }
    }

    if (!fileBuffer) return res.status(400).json({ error: 'No file found in request' });

    // Sanitize filename and build path
    const ext = fileName.split('.').pop().toLowerCase();
    const safeName = Date.now() + '-' + Math.random().toString(36).slice(2) + '.' + ext;
    const path = `${folder}/${safeName}`;

    const { error: uploadError } = await supabase.storage
      .from('product-images')
      .upload(path, fileBuffer, { contentType: mimeType, upsert: false });

    if (uploadError) return res.status(500).json({ error: uploadError.message });

    const { data: { publicUrl } } = supabase.storage
      .from('product-images')
      .getPublicUrl(path);

    return res.status(200).json({ url: publicUrl });

  } catch (err) {
    console.error('Upload error:', err);
    return res.status(500).json({ error: err.message });
  }
}
