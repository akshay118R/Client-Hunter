-- ==========================================================
-- CLIENTHUNTER LEADS TABLE SCHEMA FOR SUPABASE
-- Run this in your Supabase SQL Editor:
-- https://supabase.com/dashboard/project/elagbmcvzzxqmynsikhf/sql
-- ==========================================================

CREATE TABLE IF NOT EXISTS public.leads (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id TEXT,
    place_id TEXT UNIQUE NOT NULL,
    business_name TEXT NOT NULL,
    category TEXT NOT NULL,
    state TEXT,
    city TEXT,
    district TEXT,
    address TEXT,
    phone TEXT DEFAULT 'Not available',
    email TEXT DEFAULT 'Not available',
    website TEXT,
    website_status TEXT DEFAULT 'NO',
    google_maps_url TEXT,
    latitude DOUBLE PRECISION,
    longitude DOUBLE PRECISION,
    rating NUMERIC(3, 1),
    review_count INTEGER DEFAULT 0,
    opportunity_score INTEGER DEFAULT 50,
    opportunity_level TEXT DEFAULT 'MEDIUM',
    favorite BOOLEAN DEFAULT FALSE,
    status TEXT DEFAULT 'New',
    outreach_status TEXT DEFAULT 'Pending',
    source TEXT DEFAULT 'Google Places API',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable Row Level Security (RLS)
ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;

-- Set up permissive policies for service role & frontend client
CREATE POLICY "Allow all operations for service role" ON public.leads
    FOR ALL
    USING (true)
    WITH CHECK (true);

CREATE POLICY "Allow anon read" ON public.leads
    FOR SELECT
    USING (true);

CREATE POLICY "Allow anon insert" ON public.leads
    FOR INSERT
    WITH CHECK (true);

CREATE POLICY "Allow anon update" ON public.leads
    FOR UPDATE
    USING (true);

CREATE POLICY "Allow anon delete" ON public.leads
    FOR DELETE
    USING (true);

-- Indexes for lightning-fast lookup and strict uniqueness
CREATE UNIQUE INDEX IF NOT EXISTS leads_place_id_idx ON public.leads (place_id);
CREATE INDEX IF NOT EXISTS leads_category_idx ON public.leads (category);
CREATE INDEX IF NOT EXISTS leads_city_idx ON public.leads (city);
CREATE INDEX IF NOT EXISTS leads_created_at_idx ON public.leads (created_at DESC);

-- Outreach Terminal & Scheduled Follow-Up Columns
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS first_message_sent BOOLEAN DEFAULT FALSE;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS first_message_sent_at TIMESTAMPTZ;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS main_message_sent_at TIMESTAMPTZ;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS last_message_sent_at TIMESTAMPTZ;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS last_message_type TEXT;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS last_message_text TEXT;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS follow_up_day INTEGER DEFAULT 0;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS current_follow_up_number INTEGER DEFAULT 0;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS next_follow_up_number INTEGER;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS next_follow_up_name TEXT;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS next_follow_up_at TIMESTAMPTZ;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS follow_up_completed BOOLEAN DEFAULT FALSE;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS reply_status TEXT;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS replied_at TIMESTAMPTZ;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS outreach_completed_at TIMESTAMPTZ;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS message_history JSONB DEFAULT '[]'::jsonb;


