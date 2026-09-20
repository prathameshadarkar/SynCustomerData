export type FileCategory = 'dataset' | 'document';
export type FileSourceRole = 'guide' | 'research' | 'prior_evidence';

export interface UploadedFileRecord {
  id: string;
  name: string;
  size: number;
  category: FileCategory;
  role?: FileSourceRole;
  mimeType: string;
  localPath?: string;
  storeDocumentName?: string;
  uploadedAt: string;
  status: 'processing' | 'indexed' | 'error';
  errorMessage?: string;
}

export interface Persona {
  name: string;
  age: number;
  academic_year: string;
  school_or_field: string;
  major: string;
  background: string;
  topic_familiarity: string;
  usage_intensity: string;
  // Deep behavioral & attitudinal traits generated internally
  attitude_baseline?: string;
  trust_orientation?: string;
  price_sensitivity?: string;
  privacy_sensitivity?: string;
  behavioral_pattern?: string;
  occupation?: string; // Backwards-compatible alias
}

export type SentimentType = 'positive' | 'neutral' | 'negative' | 'mixed';

export interface StructuredResponse {
  question: string;
  answer_summary: string;
  sentiment: SentimentType;
  rating_1_to_5: number;
}

export type SourceOverlapStatus = 'clear' | 'possible_overlap';

export interface TranscriptSection {
  section_id: string;
  section_title: string;
  transcript: string;
}

export interface GenerationMetadata {
  requested_model: string;
  actual_model: string;
  fallback_used: boolean;
  retry_count: number;
}

export interface EvidenceProfile {
  recurring_patterns: string[];
  areas_of_disagreement: string[];
  relevant_behaviors: string[];
  motivations: string[];
  trust_concerns: string[];
  price_or_value_patterns: string[];
  topic_specific_patterns: string[];
  source_examples_not_to_copy: string[];
}

export interface ParticipantResult {
  id: string;
  participantIndex: number;
  persona: Persona;
  sections?: TranscriptSection[];
  transcript: string;
  responses: StructuredResponse[];
  grounding_sources: string[];
  source_overlap_status: SourceOverlapStatus;
  generation_metadata?: GenerationMetadata;
  generatedAt: string;
}

export type PopulationPreset =
  | 'NYU Undergraduate Students'
  | 'Undergraduate Students — Broad Mix'
  | 'Gen Z College Students'
  | 'Topic-Relevant Undergraduate Sample'
  | 'Custom';

export type AcademicYear = 'First-year' | 'Sophomore' | 'Junior' | 'Senior';

export type PersonaDiversity = 'Low' | 'Balanced' | 'High';

export type InterviewDepth = 'Concise' | 'Standard' | 'Full Discussion Guide';

export interface GenerationSettings {
  populationPreset: PopulationPreset;
  targetAudience: string;
  academicYears: AcademicYear[];
  schoolSelectionType: 'diverse' | 'custom';
  customSchools: string;
  additionalConstraints: string;
  personaDiversity: PersonaDiversity;
  interviewDepth: InterviewDepth;
  priorityQuestions: string;
  toneStyle: string;
  numParticipants: number;
}

export interface GenerationProgress {
  currentIndex: number;
  total: number;
  currentPersonaName?: string;
  statusMessage: string;
  isComplete: boolean;
  waitingForRateLimit?: boolean;
  waitTimeSeconds?: number;
  error?: string;
}

export interface StoreInfo {
  name: string;
  displayName: string;
  activeDocumentsCount: number;
  files: UploadedFileRecord[];
}

export type ThemeId = 'indigo' | 'teal' | 'obsidian';

export interface ThemeOption {
  id: ThemeId;
  name: string;
  /** One short line. Kept deliberately brief — the swatch does most of the work. */
  tagline: string;
  primaryColor: string;
  accentColor: string;
}
