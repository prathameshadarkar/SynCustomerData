import { Users, Sparkles, Loader2, Clock } from 'lucide-react';
import { GenerationSettings, GenerationProgress } from '../types';
import { DisabledHint } from './DisabledHint';

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
  /** Kept for API compatibility with App.tsx; no longer used by this panel. */
  discussionGuideText?: string;
}

// The only two choices a user makes: who the participants are, and how many.
// Everything else (diversity, academic years, schools, interview depth, priority
// questions, speech style) is fixed at its best value in App.tsx defaults and
// still sent to the server unchanged, so generation behaviour is identical.
const PARTICIPANT_PRESETS = [3, 5, 10];

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
}: GenerationSettingsPanelProps) {
  const canGenerate = hasFiles && hasGuide && !isGenerating;

  const disabledReason =
    !hasFiles && !hasGuide
      ? 'Add your materials and your questions first. The quickest way is "Try it with a sample study" at the top of the page.'
      : !hasFiles
      ? 'Add at least one file under "Your materials" first, or use "Try it with a sample study" at the top of the page.'
      : 'Add your questions under "Your questions" first — one per line.';

  return (
    <div id="generation-settings-panel" className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5 sm:p-6 shadow-sm">
      <div className="mb-4">
        <h2 className="text-base sm:text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2">
          <Users className="w-5 h-5 theme-text-primary" />
          <span>Your participants</span>
        </h2>
        <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 mt-0.5">
          Describe who you want to interview. Include anything that matters for your study — year, school, habits, how much they know about the topic.
        </p>
      </div>

      <textarea
        id="target-audience-input"
        rows={3}
        value={settings.targetAudience}
        onChange={(e) => onChange({ targetAudience: e.target.value, populationPreset: 'Custom' })}
        placeholder="e.g. NYU undergraduates across different years and schools. Some commute, some live in dorms. Mixed familiarity with the topic."
        className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-950/60 px-3.5 py-2.5 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 transition-colors resize-y"
      />

      {/* Participant count stepper & presets & Generate */}
      <div className="mt-5 pt-4 border-t border-slate-100 dark:border-slate-800 flex flex-col sm:flex-row sm:flex-wrap sm:items-center sm:justify-between gap-3 sm:gap-4">
        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
          <span className="text-sm font-semibold text-slate-700 dark:text-slate-300">How many?</span>
          <div className="flex items-center gap-1.5" role="radiogroup" aria-label="Number of participants">
            {PARTICIPANT_PRESETS.map((count) => (
              <button
                key={count}
                type="button"
                role="radio"
                aria-checked={settings.numParticipants === count}
                onClick={() => onChange({ numParticipants: count })}
                className={`min-w-[3rem] px-3 py-2 rounded-lg text-sm font-semibold transition-colors cursor-pointer ${
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

        {/* Action Buttons: Resume & Generate */}
        <div className="flex flex-col sm:flex-row sm:flex-wrap items-stretch sm:items-center gap-2">
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

          {/* Generate Button — wrapped so a click while disabled explains what's missing */}
          <DisabledHint disabled={!canGenerate && !isGenerating} message={disabledReason} className="w-full sm:w-auto">
            <button
              id="generate-transcripts-btn"
              type="button"
              onClick={onGenerate}
              disabled={!canGenerate}
              className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-6 py-3 rounded-xl text-sm font-semibold text-white theme-btn-primary disabled:opacity-40 disabled:pointer-events-none shadow-md transition-all cursor-pointer"
            >
              {isGenerating ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Generating…</span>
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4" />
                  <span>Generate {settings.numParticipants} {settings.numParticipants === 1 ? 'Participant' : 'Participants'}</span>
                </>
              )}
            </button>
          </DisabledHint>
        </div>

        {/* Short static nudge; the full instruction lives in the tooltip on the button itself. */}
        {!isGenerating && !canGenerate && (
          <p className="w-full text-xs text-slate-500 dark:text-slate-400">
            {!hasFiles && !hasGuide
              ? 'Add your materials and your questions to get started.'
              : !hasFiles
              ? 'Add at least one file under "Your materials".'
              : 'Add your questions under "Your questions".'}
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
