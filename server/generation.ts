/**
 * server/generation.ts — persona sampling, prompts, and the per-participant pipeline.
 *
 * One participant = 1 persona call + 1 call per discussion-guide section. Each section call
 * retrieves ITS OWN evidence excerpts (token-budgeted, policy-filtered) so grounding is specific
 * and the request stays small enough for every free tier (Groq caps a single request at ~8k tokens).
 */
import { chat, ChatResult, tightestTpm, outputTokenCap } from './llm';
import {
  search,
  applyPolicy,
  formatEvidence,
  externalDataPolicy,
  auditOutbound,
  distinctiveSpans,
  overlapCorpus,
  RetrievedChunk,
  estimateTokens,
} from './retrieval';

// ----------------------------------------------------------------------------
// Guide parsing (unchanged behaviour from the original app)
// ----------------------------------------------------------------------------

export interface GuideSection {
  section_id: string;
  section_title: string;
  questions: string[];
  rawText: string;
}

export function parseGuideIntoSections(guideText: string): GuideSection[] {
  const lines = guideText.split('\n').map((l) => l.trim()).filter(Boolean);
  const sections: GuideSection[] = [];
  let current: GuideSection = { section_id: 'sec_1', section_title: 'Warm-up & Context', questions: [], rawText: '' };
  const headerRe = /^(?:Section\s*(\d*)[:\-.]?|Part\s*(\d*)[:\-.]?|Topic\s*(\d*)[:\-.]?)\s*(.+)/i;
  let idx = 1;
  for (const line of lines) {
    if (headerRe.test(line)) {
      if (current.questions.length > 0) {
        current.rawText = current.questions.join('\n');
        sections.push(current);
        idx++;
      }
      current = { section_id: `sec_${idx}`, section_title: line, questions: [], rawText: '' };
    } else {
      current.questions.push(line);
    }
  }
  if (current.questions.length > 0) {
    current.rawText = current.questions.join('\n');
    sections.push(current);
  }
  if (sections.length <= 1 && current.questions.length >= 4) {
    const q = current.questions;
    const split = Math.ceil(q.length / 2);
    return [
      { section_id: 'sec_1', section_title: 'Section 1: Exploration & Everyday Habits', questions: q.slice(0, split), rawText: q.slice(0, split).join('\n') },
      { section_id: 'sec_2', section_title: 'Section 2: Deep Dive, Friction & Evaluation', questions: q.slice(split), rawText: q.slice(split).join('\n') },
    ];
  }
  const result = sections.length > 0 ? sections : [{ section_id: 'sec_1', section_title: 'Section 1: Discussion Guide', questions: lines, rawText: guideText }];
  return result.map((s, i) => ({ ...s, section_id: s.section_id || `sec_${i + 1}` }));
}

/** Questions are lines that look like prompts; headers/notes are filtered out for the response list. */
export function questionLines(section: GuideSection): string[] {
  const isNote = (l: string) => /^(probe|probes|note|notes|moderator note|facilitator|instruction|tip)s?\s*[:\-–]/i.test(l);
  const qs = section.questions.filter((l) => !isNote(l) && (/\?\s*$/.test(l) || /^\d+[.)]/.test(l) || /^[-•*]/.test(l)));
  return (qs.length > 0 ? qs : section.questions).map((l) => l.replace(/^(\d+[.)]|[-•*])\s*/, '').trim());
}

// ----------------------------------------------------------------------------
// Persona sampling — server-side, so variation never depends on the model's mood
// ----------------------------------------------------------------------------

export interface PersonaSpec {
  academic_year: string;
  school_or_field: string;
  major: string;
  /** Distinct first-initial per slot so parallel participants cannot collide on names. */
  name_initial: string;
  topic_familiarity: 'Low' | 'Moderate' | 'High';
  usage_intensity: 'Rare / Occasional' | 'Weekly' | 'Heavy daily use';
  attitude_baseline: string;
  behavioral_pattern: string;
  living_situation: string;
  speaking_style: string;
}

const MAJORS: Record<string, string[]> = {
  Stern: ['Finance', 'Marketing', 'Business & Political Economy', 'Accounting', 'Management & Organizations'],
  CAS: ['Biology', 'Economics', 'Psychology', 'English', 'Politics', 'Chemistry', 'Sociology', 'History', 'Mathematics'],
  Tandon: ['Computer Science', 'Mechanical Engineering', 'Electrical Engineering', 'Civil Engineering', 'Integrated Design & Media'],
  Tisch: ['Film & TV', 'Drama', 'Photography & Imaging', 'Game Design', 'Recorded Music'],
  Steinhardt: ['Applied Psychology', 'Media, Culture & Communication', 'Music Education', 'Nutrition & Food Studies', 'Studio Art'],
  Gallatin: ['Individualized Study (urban policy)', 'Individualized Study (design & ethics)', 'Individualized Study (narrative & tech)'],
  default: ['Undeclared', 'Public Health', 'Data Science', 'Environmental Studies', 'Linguistics', 'Nursing', 'Social Work', 'Journalism'],
};

const ATTITUDES = [
  'Constructive skeptic who wants proof before trusting a tool',
  'Pragmatic satisficer — uses whatever is fastest, low emotional investment',
  'Enthusiastic early adopter who forgives rough edges',
  'Quietly frustrated — has learned workarounds and rarely complains out loud',
  'Detail-oriented planner who notices every inconsistency',
  'Socially driven — follows what friends and group chats use',
  'Privacy-conscious and wary of tracking',
  'Budget-first thinker; evaluates everything through cost',
];

const BEHAVIORS = [
  'Rushed commuter who does everything on a phone in transit',
  'Library regular with long, structured study blocks',
  'Works a part-time job; time-poor and interruption-driven',
  'Lives on campus and eats most meals through the meal plan',
  'Off-campus apartment dweller who cooks and rarely uses dining halls',
  'Multitasker with many tabs and notifications always on',
  'Minimalist who mutes notifications and checks things twice a day',
  'Club leader who coordinates people and schedules constantly',
];

const LIVING = ['first-year residence hall', 'upper-year residence hall', 'off-campus apartment with roommates', 'commutes from family home', 'off-campus studio, lives alone'];

const STYLES = [
  'short, blunt sentences; occasional dry humour',
  'thinks out loud, circles back, corrects themself',
  'warm and anecdotal, tells small stories',
  'precise and analytical, quantifies things',
  'casual, uses filler words like "like" and "honestly", trails off sometimes',
  'earnest and reflective, pauses before answering',
];

function pick<T>(arr: T[], seed: number): T {
  return arr[Math.abs(seed) % arr.length];
}

function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

export function samplePersonaSpec(
  i: number,
  years: string[],
  schools: string[],
  diversity: string,
  existing: any[],
  batchSeed: string
): PersonaSpec {
  const seed = hashStr(`${batchSeed}:${i}`);
  const academic_year = years[(i - 1) % years.length];
  const school_or_field = schools[(i - 1) % schools.length];
  const majors = MAJORS[school_or_field] || MAJORS.default;
  // Deterministic per slot: participants run in parallel now, so we cannot look at what other
  // participants already picked. Offsetting by (i-1) guarantees distinct majors within a school
  // for as many participants as that school has majors.
  const major = majors[(Math.abs(hashStr(batchSeed)) + i - 1) % majors.length];

  const famPool: PersonaSpec['topic_familiarity'][] = diversity === 'Low' ? ['Moderate', 'High'] : ['Low', 'Moderate', 'High'];
  const usePool: PersonaSpec['usage_intensity'][] = ['Rare / Occasional', 'Weekly', 'Heavy daily use'];
  const INITIALS = 'AKMRTSJLNPDEGHBCFIOV';
  return {
    academic_year,
    school_or_field,
    major,
    name_initial: INITIALS[(Math.abs(hashStr(batchSeed) >> 5) + i - 1) % INITIALS.length],
    topic_familiarity: famPool[(i - 1) % famPool.length],
    usage_intensity: usePool[(i + (seed % 3)) % usePool.length],
    attitude_baseline: pick(ATTITUDES, seed >> 3),
    behavioral_pattern: pick(BEHAVIORS, seed >> 7),
    living_situation: academic_year === 'First-year' ? LIVING[0] : pick(LIVING.slice(1), seed >> 11),
    speaking_style: pick(STYLES, seed >> 13),
  };
}

// ----------------------------------------------------------------------------
// Schemas (plain JSON Schema — provider independent)
// ----------------------------------------------------------------------------

export const personaSchema = {
  type: 'object',
  properties: {
    name: { type: 'string', description: 'Realistic first and last name; must differ from all previous participants' },
    age: { type: 'integer', description: '18 to 23' },
    academic_year: { type: 'string', enum: ['First-year', 'Sophomore', 'Junior', 'Senior'] },
    school_or_field: { type: 'string' },
    major: { type: 'string' },
    background: { type: 'string', description: '2-3 sentences: routine, living situation, tech habits, relationship to the topic' },
    topic_familiarity: { type: 'string', enum: ['Low', 'Moderate', 'High'] },
    usage_intensity: { type: 'string', enum: ['Rare / Occasional', 'Weekly', 'Heavy daily use'] },
    behavioral_pattern: { type: 'string' },
    attitude_baseline: { type: 'string' },
  },
  required: ['name', 'age', 'academic_year', 'school_or_field', 'major', 'background', 'topic_familiarity', 'usage_intensity', 'behavioral_pattern', 'attitude_baseline'],
};

export const sectionSchema = {
  type: 'object',
  properties: {
    transcript: {
      type: 'string',
      description: 'Verbatim dialogue for this section. Lines alternate "Moderator: ..." and "<Participant first name>: ...". Include natural probes and follow-ups.',
    },
    responses: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          question: { type: 'string', description: 'The exact question text from the guide' },
          answer_summary: { type: 'string', description: '1-3 sentence synthesis of what this participant said' },
          sentiment: { type: 'string', enum: ['positive', 'neutral', 'negative', 'mixed'] },
          rating_1_to_5: { type: 'integer' },
        },
        required: ['question', 'answer_summary', 'sentiment', 'rating_1_to_5'],
      },
    },
    evidence_used: { type: 'array', items: { type: 'string' }, description: 'Labels like E1, E3 of excerpts that informed this section' },
  },
  required: ['transcript', 'responses', 'evidence_used'],
};

export const evidenceProfileSchema = {
  type: 'object',
  properties: {
    recurring_patterns: { type: 'array', items: { type: 'string' } },
    areas_of_disagreement: { type: 'array', items: { type: 'string' } },
    relevant_behaviors: { type: 'array', items: { type: 'string' } },
    motivations: { type: 'array', items: { type: 'string' } },
    trust_concerns: { type: 'array', items: { type: 'string' } },
    price_or_value_patterns: { type: 'array', items: { type: 'string' } },
    topic_specific_patterns: { type: 'array', items: { type: 'string' } },
    source_examples_not_to_copy: { type: 'array', items: { type: 'string' } },
  },
  required: ['recurring_patterns', 'areas_of_disagreement', 'relevant_behaviors', 'motivations', 'trust_concerns', 'price_or_value_patterns', 'topic_specific_patterns', 'source_examples_not_to_copy'],
};

// ----------------------------------------------------------------------------
// Prompts
// ----------------------------------------------------------------------------

export const ANTI_COPYING_SAFEGUARD_INSTRUCTION = `REFERENCE DATA IS EVIDENCE, NOT DIALOGUE TO IMITATE.

Infer behavioral patterns, attitudes, trade-offs, concerns, motivations, and variation from the evidence excerpts.

Never reproduce or closely paraphrase distinctive participant wording, direct quotations, anecdotes, named characters, unusual metaphors, or projective-exercise answers found in the excerpts. Do not reuse specific numbers, place names, or product names that appear only in a single excerpt as if they were this participant's own experience.

For projective exercises, invent an original response that does not appear in the excerpts.

Preserve the underlying research pattern while creating novel participant-level language and examples.`;

function personaCard(p: any, spec: PersonaSpec) {
  return `PARTICIPANT (stay strictly in character)
Name: ${p.name} | Age: ${p.age} | ${p.academic_year}, ${p.school_or_field} (${p.major})
Living situation: ${spec.living_situation}
Background: ${p.background}
Topic familiarity: ${p.topic_familiarity} | Usage intensity: ${p.usage_intensity}
Behavioural pattern: ${p.behavioral_pattern}
Attitude baseline: ${p.attitude_baseline}
Speaking style: ${spec.speaking_style}`;
}

// ----------------------------------------------------------------------------
// Anti-copy check (fully local)
// ----------------------------------------------------------------------------

export function checkSourceOverlap(text: string, corpus: string[], spans: string[]): { status: 'clear' | 'possible_overlap'; hits: string[] } {
  const full = text.toLowerCase().replace(/\s+/g, ' ');
  const hits: string[] = [];
  const N = 7;
  for (const snippet of corpus) {
    const words = snippet.toLowerCase().replace(/[^a-z0-9'\s]/g, ' ').split(/\s+/).filter(Boolean);
    if (words.length < N) continue;
    for (let i = 0; i <= words.length - N; i++) {
      const gram = words.slice(i, i + N).join(' ');
      if (full.replace(/[^a-z0-9'\s]/g, ' ').replace(/\s+/g, ' ').includes(gram)) {
        hits.push(gram);
        break;
      }
    }
    if (hits.length >= 3) break;
  }
  // Distinctive proper-noun phrases / quoted passages reused verbatim
  for (const s of spans) {
    if (s.length >= 12 && full.includes(s.toLowerCase())) hits.push(s);
    if (hits.length >= 5) break;
  }
  return { status: hits.length > 0 ? 'possible_overlap' : 'clear', hits };
}

// ----------------------------------------------------------------------------
// Pipeline
// ----------------------------------------------------------------------------

export interface GenerateParams {
  sessionId: string;
  index: number;
  sections: GuideSection[];
  targetAudience: string;
  additionalConstraints: string;
  personaDiversity: string;
  interviewDepth: string;
  priorityQuestions: string;
  toneStyle: string;
  spec: PersonaSpec;
  existingPersonas: any[];
  evidenceProfile: any | null;
  fileNames: string[];
  onProgress: (msg: string, extra?: Record<string, any>) => void;
}

/**
 * Hard ceiling on generated tokens per section. This must comfortably fit the transcript AND the
 * per-question `responses` array — a guide with 10 questions in a section needs far more room than
 * the transcript alone. Too small and the JSON is truncated mid-object, which surfaces as
 * "no JSON object found". These were originally sized for an 8k-tokens/minute free tier; on a paid
 * provider there is no reason to be stingy.
 */
const depthTokens = (depth: string) =>
  Math.min(outputTokenCap(), depth === 'Concise' ? 2500 : depth === 'Standard' ? 3500 : 4500);

/** Target transcript length in WORDS. Decoupled from depthTokens, which is only a safety ceiling. */
const depthWords = (depth: string) => (depth === 'Concise' ? 320 : depth === 'Standard' ? 480 : 700);
/** Evidence budget per call shrinks when the tightest configured provider has a small per-minute budget (Groq: 8k). */
const evidenceBudget = () => (tightestTpm() <= 10000 ? 700 : 1200);
const evidenceK = () => (tightestTpm() <= 10000 ? 4 : 6);

export async function generateParticipant(params: GenerateParams) {
  const { sessionId, index: i, sections, spec, onProgress } = params;
  const policy = externalDataPolicy();
  const waitHook = (ms: number, reason: string) => onProgress(reason, { waitingForRateLimit: true, waitTimeSeconds: Math.ceil(ms / 1000) });
  const fallbackHook = (_f: string, _t: string, reason: string) => onProgress(reason);

  // ---- 1. Persona -----------------------------------------------------------
  onProgress(`Creating persona for participant ${i}…`);
  const personaEvidence = applyPolicy(
    await search(sessionId, `${params.targetAudience} student habits routines attitudes ${sections.map((s) => s.section_title).join(' ')}`, { k: 3, tokenBudget: tightestTpm() <= 10000 ? 350 : 600 }),
    policy
  );
  auditOutbound(`persona-${i}`, personaEvidence, policy);

  const existingSummary = params.existingPersonas
    .map((p, k) => `#${k + 1}: ${p.name} — ${p.academic_year}, ${p.school_or_field}, ${p.major}; ${p.behavioral_pattern}`)
    .join('\n');

  const personaPrompt = `Create ONE synthetic undergraduate research participant for a qualitative study.

TARGET AUDIENCE: ${params.targetAudience}
ADDITIONAL CONSTRAINTS: ${params.additionalConstraints || 'Undergraduate attending classes on campus.'}

REQUIRED ATTRIBUTES (use exactly these values):
- academic_year: ${spec.academic_year}
- school_or_field: ${spec.school_or_field}
- major: ${spec.major}
- topic_familiarity: ${spec.topic_familiarity}
- usage_intensity: ${spec.usage_intensity}
- behavioral_pattern: ${spec.behavioral_pattern}
- attitude_baseline: ${spec.attitude_baseline}
- living situation: ${spec.living_situation}

Write a realistic full name and 2-3 sentence background consistent with those attributes. Vary cultural backgrounds naturally without stereotyping.
NAME REQUIREMENT: the participant's FIRST NAME must begin with the letter "${spec.name_initial}". This keeps participants in the same study distinguishable.
${existingSummary ? `\nPREVIOUS PARTICIPANTS (must differ in name and profile):\n${existingSummary}` : ''}

${personaEvidence.length ? `EVIDENCE EXCERPTS (for realism of routines/attitudes only — do not copy specifics):\n${formatEvidence(personaEvidence)}` : ''}

Return JSON only.`;

  const personaRes = await chat({
    tier: 'generation',
    taskName: `persona-${i}`,
    schemaName: 'persona',
    jsonSchema: personaSchema,
    maxTokens: 600,
    temperature: 0.95,
    messages: [
      { role: 'system', content: 'You design believable, internally consistent research participants. Output strict JSON.' },
      { role: 'user', content: personaPrompt },
    ],
    onWait: waitHook,
    onFallback: fallbackHook,
  });
  const persona = { ...personaRes.json };
  // Enforce the sampled spec even if the model drifted.
  persona.academic_year = spec.academic_year;
  persona.school_or_field = spec.school_or_field;
  persona.major = persona.major || spec.major;
  persona.topic_familiarity = spec.topic_familiarity;
  persona.usage_intensity = spec.usage_intensity;
  persona.behavioral_pattern = persona.behavioral_pattern || spec.behavioral_pattern;
  persona.attitude_baseline = persona.attitude_baseline || spec.attitude_baseline;
  if (typeof persona.age !== 'number' || persona.age < 17 || persona.age > 26) persona.age = 18 + ((i * 7) % 5);
  const firstName = String(persona.name || 'Participant').split(/\s+/)[0];

  // ---- 2. Sections ----------------------------------------------------------
  const spans = await distinctiveSpans(sessionId, 25);
  const sectionOut: { section_id: string; section_title: string; transcript: string }[] = [];
  const responses: any[] = [];
  const groundingSources = new Map<string, string>();
  const calls: ChatResult[] = [personaRes];
  let previousSummary = '';

  for (let s = 0; s < sections.length; s++) {
    const sec = sections[s];
    onProgress(`Participant ${i} (${firstName}): ${sec.section_title.slice(0, 60)}…`, { currentPersonaName: persona.name });

    const q = questionLines(sec);
    const retrieved = await search(sessionId, `${sec.section_title}\n${q.join('\n')}`, { k: evidenceK(), tokenBudget: evidenceBudget() });
    for (const c of retrieved) groundingSources.set(c.id, `${c.fileName} (${c.locator}): ${c.text.slice(0, 80).replace(/\n/g, ' ')}…`);
    const evidence = applyPolicy(retrieved, policy);
    auditOutbound(`section-${i}-${sec.section_id}`, evidence, policy);

    const priority = params.priorityQuestions ? `Give slightly deeper probes to questions matching: ${params.priorityQuestions}.` : '';
    const profileBlock = params.evidenceProfile
      ? `RESEARCH THEMES (background only):
- Recurring patterns: ${(params.evidenceProfile.recurring_patterns || []).slice(0, 4).join('; ')}
- Disagreements: ${(params.evidenceProfile.areas_of_disagreement || []).slice(0, 3).join('; ')}
- Motivations: ${(params.evidenceProfile.motivations || []).slice(0, 3).join('; ')}`
      : '';

    const userPrompt = `${personaCard(persona, spec)}

${previousSummary ? `EARLIER IN THIS INTERVIEW (keep continuity, do not repeat):\n${previousSummary}\n` : ''}
SECTION TO SIMULATE: ${sec.section_title}
Questions the moderator must ask, in order:
${q.map((x, k) => `${k + 1}. ${x}`).join('\n')}

INTERVIEW DEPTH: ${params.interviewDepth}. ${priority}
TONE: ${params.toneStyle}. Natural spoken language; hesitations, self-corrections and concrete small details are welcome. The moderator probes ("Can you say more about…?") when an answer is thin.

${profileBlock}

EVIDENCE EXCERPTS (ground the participant's realistic experiences in these patterns; cite as E#):
${formatEvidence(evidence)}

DO NOT REUSE these distinctive phrases, names or examples from the source material: ${spans.slice(0, 12).map((x) => `"${x}"`).join(', ') || '(none listed)'}

LENGTH: keep the transcript under about ${depthWords(params.interviewDepth)} words. Prefer fewer, richer exchanges over many short ones. Keep each answer_summary to one or two sentences.

Write the dialogue for this section only, alternating "Moderator:" and "${firstName}:". Then summarise each question. Return JSON only.`;

    const res = await chat({
      tier: 'generation',
      taskName: `section-${i}-${sec.section_id}`,
      schemaName: 'section',
      jsonSchema: sectionSchema,
      maxTokens: depthTokens(params.interviewDepth),
      temperature: 0.9,
      messages: [
        { role: 'system', content: `You are a high-fidelity synthetic qualitative-research participant simulator.\n\n${ANTI_COPYING_SAFEGUARD_INSTRUCTION}` },
        { role: 'user', content: userPrompt },
      ],
      onWait: waitHook,
      onFallback: fallbackHook,
    });
    calls.push(res);
    const data = res.json;
    const transcript: string = String(data.transcript || '').trim();
    sectionOut.push({ section_id: sec.section_id, section_title: sec.section_title, transcript });
    const secResponses = Array.isArray(data.responses) ? data.responses : [];
    // Make sure every guide question has an entry, in guide order.
    for (const question of q) {
      const hit = secResponses.find((r: any) => r.question && (r.question === question || question.toLowerCase().includes(String(r.question).toLowerCase().slice(0, 30))));
      responses.push(
        hit
          ? { ...hit, question, rating_1_to_5: clampRating(hit.rating_1_to_5) }
          : { question, answer_summary: summariseFromTranscript(transcript, firstName), sentiment: 'neutral', rating_1_to_5: 3 }
      );
    }
    previousSummary = `${previousSummary}${sec.section_title}: ${secResponses.map((r: any) => r.answer_summary).join(' ').slice(0, 500)}\n`.slice(-1500);
  }

  // ---- 3. Assemble + local anti-copy check ----------------------------------
  const fullTranscript = sectionOut.map((s) => `[${s.section_title}]\n${s.transcript}`).join('\n\n');
  const corpus = await overlapCorpus(sessionId);
  const overlap = checkSourceOverlap(`${fullTranscript} ${responses.map((r) => r.answer_summary).join(' ')}`, corpus, spans);
  if (overlap.status === 'possible_overlap') console.warn(`[anti-copy] participant ${i} flagged: ${overlap.hits.slice(0, 3).join(' | ')}`);

  const last = calls[calls.length - 1];
  const totalTokens = calls.reduce((a, c) => a + (c.usage?.total_tokens || 0), 0);
  return {
    id: `participant-${i}-${Date.now()}`,
    participantIndex: i,
    persona: {
      name: persona.name,
      age: persona.age,
      academic_year: persona.academic_year,
      school_or_field: persona.school_or_field,
      major: persona.major,
      background: persona.background,
      topic_familiarity: persona.topic_familiarity,
      usage_intensity: persona.usage_intensity,
      behavioral_pattern: persona.behavioral_pattern,
      attitude_baseline: persona.attitude_baseline,
      occupation: `${persona.academic_year} in ${persona.school_or_field} (${persona.major})`,
    },
    sections: sectionOut,
    transcript: fullTranscript,
    responses,
    grounding_sources: groundingSources.size > 0 ? [...groundingSources.values()] : params.fileNames,
    source_overlap_status: overlap.status,
    generation_metadata: {
      requested_model: personaRes.requestedModel,
      actual_model: `${last.provider}/${last.model}`,
      fallback_used: calls.some((c) => c.fallbackUsed),
      retry_count: calls.reduce((a, c) => a + c.retryCount, 0),
      calls: calls.length,
      total_tokens: totalTokens || undefined,
      external_data_policy: policy,
    },
    generatedAt: new Date().toISOString(),
  };
}

function clampRating(v: any): number {
  const n = Math.round(Number(v));
  return isNaN(n) ? 3 : Math.min(5, Math.max(1, n));
}

function summariseFromTranscript(transcript: string, firstName: string): string {
  const lines = transcript.split('\n').filter((l) => l.startsWith(`${firstName}:`));
  return (lines[0] || transcript).replace(`${firstName}:`, '').trim().slice(0, 240) || 'No explicit answer captured.';
}

// ----------------------------------------------------------------------------
// Evidence profile (once per session; optional; policy-aware)
// ----------------------------------------------------------------------------

export async function buildEvidenceProfile(sessionId: string, topicHint: string): Promise<any | null> {
  const policy = externalDataPolicy();
  if (policy === 'none') return null;
  const queries = [
    `${topicHint} recurring frustrations and pain points`,
    `${topicHint} what students value and enjoy`,
    `${topicHint} disagreements trade-offs between students`,
    `${topicHint} trust privacy cost budget concerns`,
  ];
  const seen = new Map<string, RetrievedChunk>();
  for (const q of queries) for (const c of await search(sessionId, q, { k: 5, tokenBudget: 700 })) seen.set(c.id, c);
  let chunks = applyPolicy([...seen.values()], policy);
  // Keep the outbound payload bounded.
  let used = 0;
  chunks = chunks.filter((c) => (used += estimateTokens(c.text)) <= 2500);
  if (chunks.length === 0) return null;
  auditOutbound('evidence-profile', chunks, policy);

  const res = await chat({
    tier: 'utility',
    taskName: 'evidence-profile',
    schemaName: 'evidence_profile',
    jsonSchema: evidenceProfileSchema,
    maxTokens: 900,
    temperature: 0.2,
    messages: [
      { role: 'system', content: 'You are a research synthesis assistant. Output strict JSON. Each list item 1-2 sentences.' },
      {
        role: 'user',
        content: `Analyse these excerpts from prior research and produce a concise Evidence Profile: recurring patterns, areas of disagreement, relevant behaviors, motivations, trust concerns, price/value patterns, topic-specific patterns, and "source examples NOT to copy" (specific quotes, unique anecdotes, or named characters that synthetic participants must not parrot).\n\n${formatEvidence(chunks)}`,
      },
    ],
  });
  return res.json || null;
}

// ----------------------------------------------------------------------------
// Guide extraction from a document's text (policy-aware; local fallback)
// ----------------------------------------------------------------------------

export function extractGuideLocally(text: string): string {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  const keep = lines.filter((l) => /^(section|part|topic)\s*\d*/i.test(l) || /\?\s*$/.test(l) || /^\d+[.)]\s+\S/.test(l));
  return keep.join('\n');
}

/** Characters of source document per extraction call. ~12k chars ≈ 3k tokens in, leaving plenty of
 *  output headroom for a section that is almost entirely questions. */
const GUIDE_WINDOW_CHARS = 12000;
/** Overlap so a question split across a window boundary still appears whole in one of them. */
const GUIDE_WINDOW_OVERLAP = 800;
/** Ceiling on how much of a long PDF we will process, so one upload cannot run away with cost. */
const GUIDE_MAX_WINDOWS = 8;

function splitIntoWindows(text: string): string[] {
  if (text.length <= GUIDE_WINDOW_CHARS) return [text];
  const out: string[] = [];
  let start = 0;
  while (start < text.length && out.length < GUIDE_MAX_WINDOWS) {
    out.push(text.slice(start, start + GUIDE_WINDOW_CHARS));
    start += GUIDE_WINDOW_CHARS - GUIDE_WINDOW_OVERLAP;
  }
  return out;
}

function stripFences(s: string): string {
  return s.trim().replace(/^```[a-zA-Z]*\n?/, '').replace(/\n?```$/, '').trim();
}

/**
 * Merge per-window extractions. The windows overlap, and long guides repeat section headers, so
 * drop lines already seen (compared case- and whitespace-insensitively) while keeping the order
 * the document presented them in.
 */
function mergeGuideParts(parts: string[]): string {
  const seen = new Set<string>();
  const kept: string[] = [];
  for (const part of parts) {
    for (const rawLine of part.split('\n')) {
      const line = rawLine.trimEnd();
      const key = line.trim().toLowerCase().replace(/\s+/g, ' ');
      if (!key) {
        // collapse runs of blank lines instead of dropping them entirely
        if (kept.length && kept[kept.length - 1] !== '') kept.push('');
        continue;
      }
      if (seen.has(key)) continue;
      seen.add(key);
      kept.push(line);
    }
  }
  return kept.join('\n').trim();
}

/**
 * Extract a discussion guide from document text.
 *
 * Long guides used to fail two ways at once: the input was hard-truncated at 24k characters, so the
 * back half of a real 20-page guide was never seen, and the output was capped at 1500 tokens, which
 * a guide with probes blows straight through. Truncation then threw a *retryable* error, so the
 * identical request was re-sent and truncated identically. This walks the document in overlapping
 * windows instead, gives each call room proportional to what the provider allows, and accepts a
 * partial answer rather than throwing it away.
 */
export async function extractGuideWithModel(text: string): Promise<string> {
  const windows = splitIntoWindows(text);
  // Leave headroom under the provider's ceiling; a window is ~3k tokens in, and the extracted
  // questions are usually a large fraction of that.
  const maxTokens = Math.max(1500, Math.min(outputTokenCap(), 4000));
  const parts: string[] = [];

  for (let i = 0; i < windows.length; i++) {
    const isOnlyWindow = windows.length === 1;
    try {
      const res = await chat({
        tier: 'utility',
        taskName: `guide-extract${isOnlyWindow ? '' : `-${i + 1}/${windows.length}`}`,
        maxTokens,
        temperature: 0.1,
        allowTruncated: true,
        messages: [
          { role: 'system', content: 'You are an expert qualitative and UX research assistant.' },
          {
            role: 'user',
            content: `Extract all discussion guide questions, interview prompts, agenda topics, and participant evaluation questions from the document below.

STRICT RULES:
- Return the list as plain text. Keep section headers (e.g. "Section 1: Warm-up") and numbering (1., 2., …).
- No commentary, no introduction, no markdown fences.
- Do not summarise or rewrite the questions; reproduce them.
- If this excerpt contains no discussion guide questions, reply with the single word: NONE
${isOnlyWindow ? '' : `\nNOTE: this is part ${i + 1} of ${windows.length} of a longer document. Extract only what appears below.`}

DOCUMENT:
${windows[i]}`,
          },
        ],
      });
      const cleaned = stripFences(res.text);
      if (cleaned && cleaned.toUpperCase() !== 'NONE') parts.push(cleaned);
    } catch (err: any) {
      // One bad window should not lose the rest of the guide.
      console.warn(`[guide-extract] window ${i + 1}/${windows.length} failed: ${err?.message || err}`);
    }
  }

  const merged = mergeGuideParts(parts);
  // If the model gave us nothing usable, the regex extractor is better than an empty box.
  return merged || extractGuideLocally(text);
}
