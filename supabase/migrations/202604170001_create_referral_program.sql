-- ============================================================
-- REFERRAL PROGRAM SCHEMA
-- ============================================================

-- 1. Add referral columns to free_subscribers
ALTER TABLE public.free_subscribers
  ADD COLUMN IF NOT EXISTS referral_code text UNIQUE,
  ADD COLUMN IF NOT EXISTS referred_by text,
  ADD COLUMN IF NOT EXISTS premium_unlock_expires_at timestamptz;

-- 2. Create referrals tracking table
CREATE TABLE IF NOT EXISTS public.referrals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_email text NOT NULL,
  referred_email text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'verified', 'rejected')),
  verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);

CREATE INDEX IF NOT EXISTS idx_referrals_referrer_email ON public.referrals (referrer_email);
CREATE INDEX IF NOT EXISTS idx_referrals_status ON public.referrals (status);

ALTER TABLE public.referrals ENABLE ROW LEVEL SECURITY;

-- 3. Create reward fulfillment log
CREATE TABLE IF NOT EXISTS public.referral_rewards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_email text NOT NULL,
  reward_tier integer NOT NULL CHECK (reward_tier IN (1, 2, 3)),
  reward_type text NOT NULL CHECK (reward_type IN ('premium_unlock', 'stripe_coupon')),
  fulfilled_at timestamptz,
  stripe_coupon_id text,
  metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);

CREATE INDEX IF NOT EXISTS idx_referral_rewards_referrer ON public.referral_rewards (referrer_email);
ALTER TABLE public.referral_rewards ENABLE ROW LEVEL SECURITY;

-- 4. Add updated_at trigger to referrals table
CREATE TRIGGER set_referrals_updated_at
  BEFORE UPDATE ON public.referrals
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();
