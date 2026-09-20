import { useState, useMemo } from 'react';
import {
  Users,
  Sliders,
  Sparkles,
  Loader2,
  GraduationCap,
  Layers,
  ChevronDown,
  ChevronUp,
  BookmarkCheck,
  Compass,
  FileCheck2,
  Clock,
} from 'lucide-react';
import {
  GenerationSettings,
  GenerationProgress,
  PopulationPreset,
  AcademicYear,
  PersonaDiversity,
  InterviewDepth,
} from '../types';

interface GenerationSettingsPanelProps {
  settings: GenerationSettings;
  onChange: (updated: Partial<GenerationSettings>) => void;
  onGenerate: () => void;
  onResume?: () => void;
  participantsCount?: number;
  isGenerating: boolean;
  progress: GenerationProgress | null;
  hasFiles: boolean;
  hasGuide: boolean;
  discussionGuideText?: string;
}

const PARTICIPANT_PRESETS = [1, 3, 5, 8, 10];

const POPULATION_PRESET_DESCRIPTIONS: Record<PopulationPreset, string> = {
  'NYU Undergraduate Students':
    'NYU undergraduate students across different years, schools, majors, backgrounds, interests, and levels of familiarity with the research topic.',
  'Undergraduate Students — Broad Mix':
    'Undergraduate college students representing a broad cross-section of university types, academic disciplines, campus residential habits, and everyday digital tool usage.',
  'Gen Z College Students':
    'Gen Z college students balancing coursework, social media apps, campus obligations, personal budgets, and peer culture.',
  'Topic-Relevant Undergraduate Sample':
    'Undergraduate college students actively screened for direct, authentic experience with the study topic and everyday domain practices.',
  'Custom': '',
};

const ALL_ACADEMIC_YEARS: AcademicYear[] = ['First-year', 'Sophomore', 'Junior', 'Senior'];

const NYU_SCHOOL_EXAMPLES = ['Stern', 'CAS', 'Tandon', 'Tisch', 'Steinhardt', 'Gallatin'];

export function GenerationSettingsPanel({
  settings,
  onChange,
  onGenerate,
  onResume,
  participantsCount = 0,
  isGenerating,
  progress,
  hasFiles,
  hasGuide,
  discussionGuideText = '',
}: GenerationSettingsPanelProps) {
  const [showAdvancedTone, setShowAdvancedTone] = useState(false);

  const canGenerate = hasFiles && hasGuide && !isGenerating;

  // Extract question identifiers (e.g. Q1, Q2, 1., 2.) from discussionGuideText
  const detectedQuestions = useMemo(() => {
    if (!discussionGuideText) return [];
    const lines = discussionGuideText.split('\n');
    const qIds: string[] = [];
    const qRegex = /^(?:Q|Question\s*)?(\d+)[.:)]\s*(.*)/i;
    for (const line of lines) {
      const match = line.trim().match(qRegex);
      if (match) {
        const num = match[1];
        const label = `Q${num}`;
        if (!qIds.includes(label)) {
          qIds.push(label);
        }
      }
    }
    return qIds.slice(0, 15); // limit to 15 chips
  }, [discussionGuideText]);

  const handlePresetChange = (preset: PopulationPreset) => {
    const desc = POPULATION_PRESET_DESCRIPTIONS[preset];
    onChange({
      populationPreset: preset,
      targetAudience: preset === 'Custom' ? settings.targetAudience : desc,
    });
  };

  const handleToggleAcademicYear = (year: AcademicYear) => {
    const current = settings.academicYears || [];
    if (current.includes(year)) {
      if (current.length === 1) return; // Keep at least one
      onChange({ academicYears: current.filter((y) => y !== year) });
    } else {
      onChange({ academicYears: [...current, year] });
    }
  };

  const handleTogglePriorityChip = (qId: string) => {
    const currentTokens = (settings.priorityQuestions || '')
      .split(/[,;\s]+/)
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean);

    const normQ = qId.toUpperCase();
    let updatedTokens: string[];
    if (currentTokens.includes(normQ)) {
      updatedTokens = currentTokens.filter((t) => t !== normQ);
    } else {
      updatedTokens = [...currentTokens, normQ];
    }
    onChange({ priorityQuestions: updatedTokens.join(', ') });
  };

  const isChipSelected = (qId: string) => {
    const currentTokens = (settings.priorityQuestions || '')
      .split(/[,;\s]+/)
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean);
    const numOnly = qId.replace(/[^0-9]/g, '');
    return currentTokens.includes(qId.toUpperCase()) || currentTokens.includes(numOnly);
  };

  return (
    <div id="generation-settings-panel" className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5 sm:p-6 shadow-sm">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 dark:border-slate-800 pb-3">
        <div>
          <h2 className="text-base sm:text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <span>3. Participant & Simulation Settings</span>
            <span className="text-xs font-normal px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400">
              Evidence-Informed Setup
            </span>
          </h2>
          <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 mt-0.5">
            Configure undergraduate research demographics, interview coverage depth, priority questions, and batch size.
          </p>
        </div>
      </div>

      {/* SECTION 1: PARTICIPANT POPULATION */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-indigo-600 dark:text-indigo-400">
            <GraduationCap className="w-4 h-4" />
            <span>Participant Population</span>
          </div>
          <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
            Preset & Demographic Framing
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Preset dropdown */}
          <div>
            <label htmlFor="population-preset-select" className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
              Population Preset Dropdown
            </label>
            <select
              id="population-preset-select"
              value={settings.populationPreset}
              onChange={(e) => handlePresetChange(e.target.value as PopulationPreset)}
              className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-950/60 px-3.5 py-2 text-sm text-slate-900 dark:text-slate-100 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 transition-colors cursor-pointer font-medium"
            >
              <option value="NYU Undergraduate Students">NYU Undergraduate Students (Default)</option>
              <option value="Gen Z College Students">Gen Z College Students</option>
              <option value="Undergraduate Students — Broad Mix">Undergraduate Students — Broad Mix</option>
              <option value="Topic-Relevant Undergraduate Sample">Topic-Relevant Undergraduate Sample</option>
              <option value="Custom">Custom Cohort</option>
            </select>
            <p className="text-[11px] text-slate-400 mt-1">
              Select a standard population archetype or choose Custom to specify your own target audience.
            </p>
          </div>

          {/* Persona Diversity */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
              Persona Diversity: <span className="font-bold text-indigo-600 dark:text-indigo-400">{settings.personaDiversity}</span>
            </label>
            <div className="grid grid-cols-3 gap-1.5 p-1 rounded-xl bg-slate-100 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700">
              {(['Low', 'Balanced', 'High'] as PersonaDiversity[]).map((level) => (
                <button
                  key={level}
                  type="button"
                  onClick={() => onChange({ personaDiversity: level })}
                  className={`py-1.5 text-xs font-semibold rounded-lg transition-all cursor-pointer text-center ${
                    settings.personaDiversity === level
                      ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-xs'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  {level}
                </button>
              ))}
            </div>
            <p className="text-[11px] text-slate-400 mt-1">
              Varies participants across schools, majors, behavior, topic familiarity, and attitudes without stereotypes.
            </p>
          </div>
        </div>

        {/* Population Description / Custom Cohort */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <label htmlFor="target-audience-input" className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
              Target Population Cohort Description
            </label>
            {settings.populationPreset !== 'Custom' && (
              <button
                type="button"
                onClick={() => onChange({ populationPreset: 'Custom' })}
                className="text-[11px] text-indigo-600 dark:text-indigo-400 hover:underline cursor-pointer"
              >
                Customize description
              </button>
            )}
          </div>
          <input
            id="target-audience-input"
            type="text"
            value={settings.targetAudience}
            onChange={(e) => onChange({ targetAudience: e.target.value, populationPreset: 'Custom' })}
            placeholder="e.g. NYU undergraduate students across different years, schools, majors, and interests"
            className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-950/60 px-3.5 py-2 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 transition-colors"
          />
        </div>

        {/* Academic Years & School Selection */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-1">
          {/* Academic Years Checkboxes */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
              Academic Years (Select all that apply)
            </label>
            <div className="flex flex-wrap items-center gap-2">
              {ALL_ACADEMIC_YEARS.map((year) => {
                const isSelected = settings.academicYears?.includes(year);
                return (
                  <button
                    key={year}
                    type="button"
                    onClick={() => handleToggleAcademicYear(year)}
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-all cursor-pointer ${
                      isSelected
                        ? 'bg-indigo-50 dark:bg-indigo-950/60 border-indigo-300 dark:border-indigo-700 text-indigo-700 dark:text-indigo-300'
                        : 'bg-white dark:bg-slate-800/60 border-slate-200 dark:border-slate-700 text-slate-500 hover:border-slate-300'
                    }`}
                  >
                    <span className={`w-2 h-2 rounded-full ${isSelected ? 'bg-indigo-600' : 'bg-slate-300 dark:bg-slate-600'}`} />
                    <span>{year}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Academic Fields / Schools */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
              Academic Fields & Schools
            </label>
            <div className="flex items-center gap-3 mb-1.5">
              <label className="inline-flex items-center gap-1.5 text-xs text-slate-700 dark:text-slate-300 cursor-pointer">
                <input
                  type="radio"
                  name="schoolSelectionType"
                  checked={settings.schoolSelectionType === 'diverse'}
                  onChange={() => onChange({ schoolSelectionType: 'diverse' })}
                  className="text-indigo-600 focus:ring-indigo-500"
                />
                <span>Diverse across available programs</span>
              </label>
              <label className="inline-flex items-center gap-1.5 text-xs text-slate-700 dark:text-slate-300 cursor-pointer">
                <input
                  type="radio"
                  name="schoolSelectionType"
                  checked={settings.schoolSelectionType === 'custom'}
                  onChange={() => onChange({ schoolSelectionType: 'custom' })}
                  className="text-indigo-600 focus:ring-indigo-500"
                />
                <span>Custom schools / majors</span>
              </label>
            </div>

            {settings.schoolSelectionType === 'diverse' ? (
              <div className="p-2 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700/60 text-[11px] text-slate-500 dark:text-slate-400">
                <span className="font-semibold text-slate-700 dark:text-slate-300">NYU Examples: </span>
                {NYU_SCHOOL_EXAMPLES.join(', ')} (and across arts, sciences, business, and engineering)
              </div>
            ) : (
              <input
                type="text"
                value={settings.customSchools}
                onChange={(e) => onChange({ customSchools: e.target.value })}
                placeholder="e.g. Stern (Finance/Marketing), CAS (Psychology), Tandon (CS)"
                className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-950/60 px-3 py-1.5 text-xs text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none"
              />
            )}
          </div>
        </div>

        {/* Additional Participant Constraints */}
        <div>
          <label htmlFor="additional-constraints-input" className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
            Additional Participant Constraints (Optional)
          </label>
          <input
            id="additional-constraints-input"
            type="text"
            value={settings.additionalConstraints}
            onChange={(e) => onChange({ additionalConstraints: e.target.value })}
            placeholder="e.g. Participants should use campus mobile apps at least 3x/week, or commute via subway"
            className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-950/60 px-3.5 py-2 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 transition-colors"
          />
          <p className="text-[11px] text-slate-400 mt-1">
            Screening criteria to narrow or qualify the simulated participant cohort.
          </p>
        </div>
      </div>

      {/* SECTION 2: INTERVIEW DEPTH & DIALOGUE CONTROLS */}
      <div className="mt-5 pt-4 border-t border-slate-100 dark:border-slate-800 space-y-4">
        <div className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-indigo-600 dark:text-indigo-400">
          <Compass className="w-4 h-4" />
          <span>Interview Depth & Priority Questions</span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Interview Depth */}
          <div>
            <label htmlFor="interview-depth-select" className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
              Interview Depth
            </label>
            <select
              id="interview-depth-select"
              value={settings.interviewDepth}
              onChange={(e) => onChange({ interviewDepth: e.target.value as InterviewDepth })}
              className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-950/60 px-3.5 py-2 text-sm text-slate-900 dark:text-slate-100 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 transition-colors"
            >
              <option value="Full Discussion Guide">Full Discussion Guide (Default — Rich qualitative laddering & exercises)</option>
              <option value="Standard">Standard (Moderate answers with selective probing)</option>
              <option value="Concise">Concise (Short answers, minimal follow-ups)</option>
            </select>
            <p className="text-[11px] text-slate-400 mt-1">
              Follows all expected discussion guide sections in order with high qualitative reasoning and rate-limit pacing.
            </p>
          </div>

          {/* Priority Questions */}
          <div>
            <label htmlFor="priority-questions-input" className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
              Priority Questions (Optional)
            </label>
            <input
              id="priority-questions-input"
              type="text"
              value={settings.priorityQuestions}
              onChange={(e) => onChange({ priorityQuestions: e.target.value })}
              placeholder="e.g. Q3, Q5 (or click detected questions below)"
              className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-950/60 px-3.5 py-2 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 transition-colors"
            />

            {/* Detected Question Chips */}
            {detectedQuestions.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5 mt-2">
                <span className="text-[11px] text-slate-400">Click to prioritize:</span>
                {detectedQuestions.map((qId) => {
                  const selected = isChipSelected(qId);
                  return (
                    <button
                      key={qId}
                      type="button"
                      onClick={() => handleTogglePriorityChip(qId)}
                      className={`px-2 py-0.5 rounded-md text-[11px] font-semibold transition-colors cursor-pointer border ${
                        selected
                          ? 'bg-indigo-600 text-white border-indigo-600'
                          : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:border-indigo-400'
                      }`}
                    >
                      {qId}
                    </button>
                  );
                })}
              </div>
            )}
            <p className="text-[11px] text-slate-400 mt-1">
              Priority questions receive greater qualitative depth and follow-up probes without skipping later sections.
            </p>
          </div>
        </div>

        {/* Speech Style Default Notice & Advanced Toggle */}
        <div className="p-3 rounded-xl bg-slate-50/80 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700/70">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <FileCheck2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
              <div>
                <p className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                  Default Speech Style: <span className="font-bold text-slate-900 dark:text-white">Natural Focus-Group Conversation</span>
                </p>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  Conversational, authentic, and imperfect with realistic pauses and revisions. Free of slang, caricatures, or demographic stereotypes.
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={() => setShowAdvancedTone(!showAdvancedTone)}
              className="text-xs font-semibold text-indigo-600 dark:text-indigo-400 hover:underline inline-flex items-center gap-1 cursor-pointer shrink-0 ml-3"
            >
              <span>{showAdvancedTone ? 'Hide Advanced' : 'Advanced Style'}</span>
              {showAdvancedTone ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            </button>
          </div>

          {showAdvancedTone && (
            <div className="mt-3 pt-3 border-t border-slate-200 dark:border-slate-700 animate-in fade-in duration-150">
              <label htmlFor="tone-style-input" className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Custom Speech Style Override
              </label>
              <input
                id="tone-style-input"
                type="text"
                value={settings.toneStyle}
                onChange={(e) => onChange({ toneStyle: e.target.value })}
                placeholder="e.g. Analytical, cautious, reflective, occasional hesitation before agreeing"
                className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-1.5 text-xs text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none"
              />
              <p className="text-[10px] text-slate-400 mt-1">
                Leave default for the calibrated natural focus group conversational cadence.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Participant count stepper & presets & Generate */}
      <div className="mt-5 pt-4 border-t border-slate-100 dark:border-slate-800 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <label htmlFor="participant-count-input" className="text-xs font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-300 flex items-center gap-1.5">
            <Sliders className="w-3.5 h-3.5 text-indigo-500" />
            <span>Participants to Simulate (1–15):</span>
          </label>

          <div className="flex items-center gap-2">
            <input
              id="participant-count-input"
              type="number"
              min={1}
              max={15}
              value={settings.numParticipants}
              onChange={(e) => {
                const val = Math.max(1, Math.min(15, parseInt(e.target.value) || 1));
                onChange({ numParticipants: val });
              }}
              className="w-16 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-2.5 py-1.5 text-sm font-semibold text-center text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />

            {/* Quick Presets */}
            <div className="hidden sm:flex items-center gap-1">
              {PARTICIPANT_PRESETS.map((count) => (
                <button
                  key={count}
                  type="button"
                  onClick={() => onChange({ numParticipants: count })}
                  className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
                    settings.numParticipants === count
                      ? 'theme-btn-primary text-white shadow-xs'
                      : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700'
                  }`}
                >
                  {count}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Action Buttons: Resume & Generate */}
        <div className="flex flex-wrap items-center gap-2">
          {!isGenerating && participantsCount > 0 && participantsCount < settings.numParticipants && onResume && (
            <button
              id="resume-generation-btn"
              type="button"
              onClick={onResume}
              className="inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl text-sm font-semibold text-indigo-700 dark:text-indigo-300 bg-indigo-50 dark:bg-indigo-950/60 hover:bg-indigo-100 dark:hover:bg-indigo-900/80 border border-indigo-200 dark:border-indigo-800 shadow-sm transition-all cursor-pointer"
            >
              <Sparkles className="w-4 h-4 text-indigo-500" />
              <span>Resume Remaining ({settings.numParticipants - participantsCount} left)</span>
            </button>
          )}

          {/* Generate Button */}
          <button
            id="generate-transcripts-btn"
            type="button"
            onClick={onGenerate}
            disabled={!canGenerate}
            className="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-xl text-sm font-semibold text-white theme-btn-primary disabled:opacity-40 disabled:cursor-not-allowed shadow-md transition-all cursor-pointer"
          >
            {isGenerating ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Generating Grounded Transcripts...</span>
              </>
            ) : (
              <>
                <Sparkles className="w-4 h-4" />
                <span>Generate {settings.numParticipants} {settings.numParticipants === 1 ? 'Participant' : 'Participants'}</span>
              </>
            )}
          </button>
        </div>

        {/* Why is the button disabled? */}
        {!isGenerating && !canGenerate && (
          <p className="mt-2 text-xs theme-text-muted">
            {!hasFiles && !hasGuide
              ? 'Upload a reference file and add a discussion guide to enable generation.'
              : !hasFiles
              ? 'Upload at least one reference file (or use Quick Load Test) to enable generation.'
              : 'Add a discussion guide (or use Quick Load Test) to enable generation.'}
          </p>
        )}
      </div>

      {/* Real-time Progress Bar */}
      {isGenerating && progress && (
        <div id="generation-progress-box" className="mt-5 p-4 rounded-xl theme-bg-tint theme-border-tint border animate-in fade-in duration-150">
          <div className="flex items-center justify-between text-xs font-medium theme-text-primary mb-2">
            <span className="flex items-center gap-2">
              {progress.waitingForRateLimit || progress.statusMessage?.includes('Waiting') ? (
                <Clock className="w-3.5 h-3.5 animate-pulse text-amber-500" />
              ) : (
                <Loader2 className="w-3.5 h-3.5 animate-spin theme-text-primary" />
              )}
              <span className="font-semibold">
                {progress.statusMessage || `Simulating participant ${progress.currentIndex} of ${progress.total}...`}
              </span>
            </span>
            <span className="font-semibold text-slate-700 dark:text-slate-300">
              {Math.round((progress.currentIndex / progress.total) * 100)}%
            </span>
          </div>

          {/* Progress track */}
          <div className="w-full h-2 rounded-full bg-slate-200/80 dark:bg-slate-800 overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-300"
              style={{
                width: `${Math.max(5, (progress.currentIndex / progress.total) * 100)}%`,
                backgroundColor: 'var(--theme-brand)',
              }}
            />
          </div>

          {progress.waitingForRateLimit || progress.statusMessage?.includes('Waiting') ? (
            <div className="mt-2.5 flex items-center gap-2 text-xs text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/40 px-2.5 py-1.5 rounded-lg border border-amber-200 dark:border-amber-800/60">
              <Clock className="w-3.5 h-3.5 shrink-0" />
              <span>
                Pacing requests to stay inside the free-tier limits of the configured providers. Completed participants remain saved above.
              </span>
            </div>
          ) : (
            <p className="text-[11px] theme-text-primary opacity-80 mt-2">
              Generating persona, then section-by-section dialogue grounded in retrieved excerpts from your research…
            </p>
          )}
        </div>
      )}
    </div>
  );
}
