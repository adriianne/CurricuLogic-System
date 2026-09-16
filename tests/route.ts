--- app/api/ai-advisor/route.ts (原始)


+++ app/api/ai-advisor/route.ts (修改后)
import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { getAdvisorResponse } from '@/lib/ai-advisor';

export async function POST(request: Request) {
  try {
    const supabase = await createClient();

    // Get authenticated user
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    // Parse request body
    const { query, history } = await request.json();

    if (!query || typeof query !== 'string') {
      return NextResponse.json(
        { error: 'Query is required and must be a string' },
        { status: 400 }
      );
    }

    // Get AI advisor response
    const response = await getAdvisorResponse(user.id, query);

    return NextResponse.json({
      success: true,
      data: response,
    });

  } catch (error) {
    console.error('AI Advisor API Error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
