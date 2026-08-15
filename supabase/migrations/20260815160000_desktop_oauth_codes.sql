-- Migration: Desktop OAuth 2.1 PKCE Authorization Codes Table
-- Description: Stores short-lived single-use authorization codes with PKCE code challenges for Prism Desktop

CREATE TABLE IF NOT EXISTS public.desktop_oauth_codes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    code_hash TEXT NOT NULL UNIQUE,
    code_challenge TEXT NOT NULL,
    code_challenge_method TEXT NOT NULL DEFAULT 'S256',
    redirect_uri TEXT NOT NULL DEFAULT 'prism://auth-callback',
    client_id TEXT NOT NULL DEFAULT 'prism-desktop',
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    expires_at TIMESTAMPTZ NOT NULL,
    consumed_at TIMESTAMPTZ
);

ALTER TABLE public.desktop_oauth_codes ENABLE ROW LEVEL SECURITY;

-- Revoke all direct client access (anon and authenticated); accessible only by service_role in Edge Functions
REVOKE ALL ON TABLE public.desktop_oauth_codes FROM anon, authenticated;
GRANT ALL ON TABLE public.desktop_oauth_codes TO service_role;

-- Performance index for code verification lookup
CREATE INDEX IF NOT EXISTS idx_desktop_oauth_lookup 
ON public.desktop_oauth_codes (code_hash, expires_at) 
WHERE consumed_at IS NULL;
