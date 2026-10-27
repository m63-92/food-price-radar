import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// 공개 가능한 값만 번들에 포함된다 (URL + anon/publishable key). 데이터 보호는 RLS 가 담당.
const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const supabaseConfigured = Boolean(url && anonKey);

export const supabase: SupabaseClient | null = supabaseConfigured
  ? createClient(url!, anonKey!, { auth: { persistSession: true, autoRefreshToken: true } })
  : null;
