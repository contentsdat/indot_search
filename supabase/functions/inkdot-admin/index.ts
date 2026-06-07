import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS })
  }

  try {
    // ── 1. 요청한 사용자가 admin인지 검증 ──────────────────────────────
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return json({ error: 'Unauthorized' }, 401)
    }

    // anon key로 요청 유저 확인
    const supabaseUser = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    )
    const { data: { user }, error: userErr } = await supabaseUser.auth.getUser()
    if (userErr || !user) return json({ error: 'Unauthorized' }, 401)

    // service role key로 플랜 확인 (RLS 우회 가능한 키)
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )
    const { data: planRow } = await supabaseAdmin
      .from('user_plans')
      .select('plan')
      .eq('user_id', user.id)
      .single()

    if (planRow?.plan !== 'admin') {
      return json({ error: 'Forbidden: admin only' }, 403)
    }

    // ── 2. 액션 분기 ───────────────────────────────────────────────────
    const { action, userId, plan, email } = await req.json()

    // 전체 회원 목록
    if (action === 'get_all_users') {
      const { data, error } = await supabaseAdmin
        .from('user_plans')
        .select('user_id, email, full_name, plan, created_at')
        .order('created_at', { ascending: false })
      if (error) throw error
      return json({ data })
    }

    // 플랜 변경 (목록 또는 검색 결과에서)
    if (action === 'save_plan') {
      if (!userId || !plan) return json({ error: 'userId, plan 필요' }, 400)
      const allowed = ['free', 'basic', 'pro', 'admin']
      if (!allowed.includes(plan)) return json({ error: '유효하지 않은 플랜' }, 400)

      const { error } = await supabaseAdmin
        .from('user_plans')
        .upsert({
          user_id: userId,
          plan,
          email: email || undefined,
          updated_at: new Date().toISOString(),
        })
      if (error) throw error
      return json({ ok: true })
    }

    // 이메일로 사용자 검색
    if (action === 'search_user') {
      if (!email) return json({ error: 'email 필요' }, 400)
      const { data, error } = await supabaseAdmin
        .from('user_plans')
        .select('user_id, email, full_name, plan')
        .ilike('email', `%${email}%`)
        .limit(5)
      if (error) throw error
      return json({ data })
    }

    return json({ error: '알 수 없는 action' }, 400)

  } catch (e) {
    return json({ error: e.message }, 500)
  }
})

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })
}
