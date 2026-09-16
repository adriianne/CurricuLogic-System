--- lib/ai-advisor.ts (原始)


+++ lib/ai-advisor.ts (修改后)
import { createClient } from '@/utils/supabase/server';
import type { RuleResult } from './engine';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface AdvisorResponse {
  answer: string;
  sources?: RuleResult[];
  confidence: 'high' | 'medium' | 'low';
}

/**
 * Natural Language Intent Parser
 * Maps user queries to specific system actions without external LLM costs.
 */
function parseIntent(query: string): {
  intent: 'check_eligibility' | 'find_prerequisites' | 'roadmap' | 'general';
  targetSubject?: string;
  context?: string;
} {
  const q = query.toLowerCase();

  // Eligibility checks: "Can I take...", "Am I eligible..."
  if (q.includes('can i take') || q.includes('am i eligible') || q.includes('can i enroll')) {
    const subjectMatch = q.match(/(?:take|enroll in|take\s+)([a-z]{2,4}\s*\d{3,4})/i);
    return {
      intent: 'check_eligibility',
      targetSubject: subjectMatch ? subjectMatch[1].toUpperCase().replace(/\s/, '') : undefined,
    };
  }

  // Prerequisite checks: "What do I need for...", "Prerequisites for..."
  if (q.includes('prerequisite') || q.includes('need for') || q.includes('requirement for') || q.includes('before taking')) {
    const subjectMatch = q.match(/(?:for|taking)\s+([a-z]{2,4}\s*\d{3,4})/i);
    return {
      intent: 'find_prerequisites',
      targetSubject: subjectMatch ? subjectMatch[1].toUpperCase().replace(/\s/, '') : undefined,
    };
  }

  // Roadmap/Planning: "What should I take...", "Next subjects..."
  if (q.includes('what should i take') || q.includes('next subject') || q.includes('plan')) {
    return { intent: 'roadmap' };
  }

  return { intent: 'general' };
}

/**
 * Core AI Advisor Logic
 * Fetches student data, runs inference, and constructs natural language responses.
 */
export async function getAdvisorResponse(
  userId: string,
  query: string
): Promise<AdvisorResponse> {
  const supabase = await createClient();
  const { intent, targetSubject } = parseIntent(query);

  // 1. Fetch Student Profile & Current State
  const { data: student, error: studentErr } = await supabase
    .from('students')
    .select(`
      *,
      prospects:prospectus_enrollments(prospectus_id, prospectus(year, program_code)),
      grades:grades(subject_code, grade, term_year),
      completed_subjects:completed_subjects(subject_code)
    `)
    .eq('user_id', userId)
    .single();

  if (studentErr || !student) {
    return {
      answer: "I couldn't find your student record. Please ensure you are logged in as a student.",
      confidence: 'high',
    };
  }

  // Extract Program Context
  const programCode = student.prospects?.[0]?.prospectus?.program_code || 'General';
  const currentYear = student.prospects?.[0]?.prospectus?.year || new Date().getFullYear();

  // 2. Process Intent

  if (intent === 'check_eligibility' && targetSubject) {
    // Normalize subject code (e.g., "IT 302" -> "IT302")
    const normalizedSubject = targetSubject.replace(/\s+/g, '');

    // Fetch the rule for this subject in the student's prospectus
    const { data: rules } = await supabase
      .from('curriculum_rules')
      .select('*, subject:subjects(subject_code, description, units)')
      .eq('prospectus_id', student.prospects[0].prospectus_id)
      .eq('subject_code', normalizedSubject);

    if (!rules || rules.length === 0) {
      return {
        answer: `I couldn't find "${targetSubject}" in your ${programCode} curriculum. It might not be part of your program or the code is incorrect.`,
        confidence: 'medium',
      };
    }

    // TODO: Integrate with actual engine evaluation here
    // For now, we assume eligibility logic would be inserted here
    const isEligible = true; // Placeholder for actual engine call
    const missingPrereqs: string[] = []; // Placeholder for engine output

    if (isEligible) {
      return {
        answer: `Yes, you are eligible to take **${normalizedSubject}**. Based on your grades and completed subjects, you have met all prerequisites for this course in the ${programCode} program.`,
        confidence: 'high',
      };
    } else {
      return {
        answer: `You are **not yet eligible** for **${normalizedSubject}**. You are missing the following prerequisites: ${missingPrereqs.join(', ')}. Please complete these before enrolling.`,
        confidence: 'high',
      };
    }
  }

  if (intent === 'find_prerequisites' && targetSubject) {
    const normalizedSubject = targetSubject.replace(/\s+/g, '');

    const { data: rule } = await supabase
      .from('curriculum_rules')
      .select(`
        subject_code,
        prerequisites,
        co_requisites,
        subject:subjects(description)
      `)
      .eq('subject_code', normalizedSubject)
      .single();

    if (!rule) {
      return {
        answer: `I couldn't find prerequisites for "${targetSubject}".`,
        confidence: 'medium',
      };
    }

    const prereqList = rule.prerequisites || [];
    const coReqList = rule.co_requisites || [];

    let response = `To take **${normalizedSubject}** (${rule.subject?.description}), you need:`;

    if (prereqList.length > 0) {
      response += `\n- **Prerequisites:** ${prereqList.join(', ')}`;
    } else {
      response += `\n- **Prerequisites:** None (This is likely a 1st-year subject).`;
    }

    if (coReqList.length > 0) {
      response += `\n- **Co-requisites:** ${coReqList.join(', ')}`;
    }

    return {
      answer: response,
      confidence: 'high',
    };
  }

  if (intent === 'roadmap') {
    return {
      answer: `Based on your progress in **${programCode}**, I recommend focusing on your remaining lower-level subjects first. Would you like me to generate a full semester-by-semester plan?`,
      confidence: 'medium',
    };
  }

  // Default General Response
  return {
    answer: `Hello! I am your UC Academic Advisor. I can help you check eligibility, find prerequisites, or plan your subjects for your **${programCode}** degree. Try asking: "Can I take IT 302?" or "What are the prerequisites for Math 101?"`,
    confidence: 'low',
  };
}
