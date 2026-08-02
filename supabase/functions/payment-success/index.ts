import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

// Simple success page shown after Stripe redirects back.
// User is instructed to return to Prism and click "Verify & Activate".
serve(async (req) => {
  const url = new URL(req.url)
  const sessionId = url.searchParams.get('session_id') ?? ''
  const planId = url.searchParams.get('plan') ?? ''

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Payment Successful — Prism</title>
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
      max-width: 460px;
      width: 90%;
      text-align: center;
      box-shadow: 0 40px 80px rgba(0,0,0,0.6);
    }
    .icon { font-size: 56px; margin-bottom: 20px; }
    h1 { font-size: 22px; font-weight: 700; margin-bottom: 10px; }
    p { color: #8888aa; font-size: 14px; line-height: 1.6; margin-bottom: 24px; }
    .session-id {
      background: #0f0f1a;
      border: 1px solid rgba(255,255,255,0.08);
      border-radius: 12px;
      padding: 12px 16px;
      font-family: monospace;
      font-size: 11px;
      color: #6060cc;
      word-break: break-all;
      margin-bottom: 24px;
    }
    .step {
      background: #1a1a2e;
      border-radius: 12px;
      padding: 14px 18px;
      font-size: 13px;
      color: #c0c0e0;
      text-align: left;
      line-height: 1.5;
    }
    .step strong { color: #a78bfa; }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">✅</div>
    <h1>Payment Confirmed!</h1>
    <p>Your Prism Enterprise purchase was successful. Return to the Prism app to activate your license.</p>
    <div class="session-id">Session: ${sessionId || 'N/A'}</div>
    <div class="step">
      <strong>Next step:</strong> Go back to Prism → Settings → License → click
      <strong>"Verify &amp; Activate Plan"</strong> on the plan you just purchased.
    </div>
  </div>
</body>
</html>`

  return new Response(html, {
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  })
})
