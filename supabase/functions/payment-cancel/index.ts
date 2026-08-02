import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

serve(async (_req) => {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Payment Cancelled — Prism</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: #0a0a0f;
      color: #f0f0f5;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .card {
      background: #141420;
      border: 1px solid rgba(255,255,255,0.1);
      border-radius: 24px;
      padding: 48px 40px;
      max-width: 440px;
      width: 90%;
      text-align: center;
      box-shadow: 0 40px 80px rgba(0,0,0,0.6);
    }
    .icon { font-size: 56px; margin-bottom: 20px; }
    h1 { font-size: 22px; font-weight: 700; margin-bottom: 10px; }
    p { color: #8888aa; font-size: 14px; line-height: 1.6; }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">↩️</div>
    <h1>Payment Cancelled</h1>
    <p>You cancelled the checkout. No charges were made. Return to Prism whenever you're ready to try again.</p>
  </div>
</body>
</html>`

  return new Response(html, {
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  })
})
