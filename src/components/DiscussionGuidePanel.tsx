import { useState } from 'react';
import { Wand2, Loader2, AlertCircle, CheckCircle2, HelpCircle } from 'lucide-react';
import { apiFetch, readJson } from '../api';

interface DiscussionGuidePanelProps {
  guide: string;
  onChange: (value: string) => void;
  pdfFilesCount: number;
  sessionId?: string;
}

const TEMPLATES = [
  {
    name: 'NYU Undergrad Campus Mobile Tools & Dining UX',
    text: `Section 1: Warm-up & Daily Campus Routines
1. Walk me through a typical weekday at NYU. How do you plan your transit, class schedule, and study spots?
2. Which digital apps or campus tools (e.g., Brightspace, NYU Mobile, campus dining) do you open first, and why?

Section 2: Digital Friction & Dining Experience
3. Think back to a recent moment when a campus mobile tool or ordering process caused you frustration or delay. What happened, and how did you resolve it?
4. How do you manage dining dollars, meal plans, or off-campus food spending between classes?

Section 3: Projective Exercise & Future Wishlist
5. Projective exercise: If your campus digital services were a person or fictional character, how would you describe their personality and dependability?
6. On a scale of 1 to 5, how satisfied are you with the overall mobile digital experience on campus, and what is the #1 improvement you would request?`,
  },
  {
    name: 'Gen Z Audio Streaming, Social Media & Study Focus',
    text: `Section 1: Daily Media & Audio Habits
1. Walk me through how you use music, ambient sound, or podcasts while studying versus commuting. Which apps do you rely on?
2. How do campus community channels (Discord, GroupMe, Sidechat) fit into your daily peer interactions?

Section 2: Information Overload & AI Tools
3. Describe a time you felt overwhelmed by coursework deadlines and screen notifications. How did you regain control?
4. How do you and your classmates honestly view AI study tools and note summarizers? Do they help or hinder deep learning?

Section 3: Subscription Trade-offs & Recommendations
5. On a scale of 1 to 5, how likely are you to pay for an ad-free premium student tier, and what price threshold feels fair?`,
  },
  {
    name: 'College Student Budgeting & Shared Expenses',
    text: `Section 1: Financial Routines & Peer Payments
1. How do you split groceries, utility bills, or dining out with roommates and campus friends? Which payment apps do you trust most?
2. What are your primary financial stressors during the semester (textbooks, food, subway/transit, rent)?

Section 2: Friction & Hidden Costs
3. Think back to the last time you were surprised by an unexpected fee or fine on campus or in a financial app. How did you react?
4. On a scale of 1 to 5, how confident do you feel navigating personal budgeting without parental assistance, and why?`,
  },
];

export function DiscussionGuidePanel({
  guide,
  onChange,
  pdfFilesCount,
  sessionId = 'default-session',
}: DiscussionGuidePanelProps) {
  const [isExtracting, setIsExtracting] = useState(false);
  const [extractError, setExtractError] = useState<string | null>(null);
  const [extractSuccess, setExtractSuccess] = useState<string | null>(null);

  // Count numbered questions or non-empty lines
  const lines = guide.split('\n').filter((l) => l.trim().length > 0);
  const questionsCount = lines.filter((l) => /^\d+[\.\)]/i.test(l.trim())).length || lines.length;

  const handleExtractFromPdfClick = async () => {
    setExtractError(null);
    setExtractSuccess(null);

    if (pdfFilesCount === 0) {
      setExtractError(
        'No uploaded PDF reference document found. Please upload a PDF in the Reference Documents section or load the sample study first.'
      );
      return;
    }

    setIsExtracting(true);

    try {
      const response = await apiFetch('/api/guide/extract-from-pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId }),
      });

      const data = await readJson(response);

      if (!response.ok || data.error) {
        throw new Error(data.error || 'Failed to extract discussion guide from the uploaded PDF document.');
      }

      if (!data.questions || !data.questions.trim()) {
        throw new Error('No discussion guide questions or topics were found in the uploaded document.');
      }

      const extractedText = data.questions.trim();
      onChange(extractedText);

      const count = extractedText.split('\n').filter((l: string) => l.trim().length > 0).length;
      setExtractSuccess(
        `Extracted ${count} discussion guide questions from "${data.documentName || 'uploaded PDF'}".`
      );

      // Auto clear success message after 7 seconds
      setTimeout(() => {
        setExtractSuccess(null);
      }, 7000);
    } catch (err: any) {
      setExtractError(err.message || 'An error occurred while extracting the discussion guide.');
    } finally {
      setIsExtracting(false);
    }
  };

  return (
    <div id="discussion-guide-panel" className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5 sm:p-6 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
        <div>
          <h2 className="text-base sm:text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <span>2. Discussion Guide</span>
            <span className="text-xs font-normal px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400">
              {questionsCount} {questionsCount === 1 ? 'question' : 'questions'}
            </span>
          </h2>
          <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 mt-0.5">
            The moderator's scripted questions or agenda topics for each synthetic participant interview.
          </p>
        </div>

        {/* Action Button & Preset Select */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Preset templates selector */}
          <select
            id="template-guide-select"
            aria-label="Load preset guide template"
            className="text-xs font-medium bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-2.5 py-1.5 text-slate-700 dark:text-slate-300 focus:outline-none focus:ring-2 focus:ring-indigo-500 cursor-pointer"
            onChange={(e) => {
              const tmpl = TEMPLATES.find((t) => t.name === e.target.value);
              if (tmpl) onChange(tmpl.text);
            }}
            defaultValue=""
          >
            <option value="" disabled>
              Load preset guide...
            </option>
            {TEMPLATES.map((t) => (
              <option key={t.name} value={t.name}>
                {t.name}
              </option>
            ))}
          </select>

          {/* Prompt specified button */}
          <button
            id="extract-guide-from-pdf-btn"
            type="button"
            onClick={handleExtractFromPdfClick}
            disabled={isExtracting}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700 transition-colors shadow-xs disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
            title="Extract discussion questions from your uploaded PDF research document"
          >
            {isExtracting ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin text-indigo-500" />
                <span>Extracting from PDF...</span>
              </>
            ) : (
              <>
                <Wand2 className="w-3.5 h-3.5 text-indigo-500" />
                <span>Extract discussion guide from uploaded PDF</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Inline extraction error alert */}
      {extractError && (
        <div
          id="extract-guide-error"
          className="mb-3 p-3 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800/70 text-xs text-rose-800 dark:text-rose-200 flex items-center justify-between gap-2 animate-in fade-in"
        >
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0" />
            <span>{extractError}</span>
          </div>
          <button
            type="button"
            onClick={() => setExtractError(null)}
            className="text-rose-700 dark:text-rose-300 hover:underline font-semibold cursor-pointer shrink-0 ml-2"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Inline extraction success banner */}
      {extractSuccess && (
        <div
          id="extract-guide-success"
          className="mb-3 p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800/70 text-xs text-emerald-800 dark:text-emerald-200 flex items-center justify-between gap-2 animate-in fade-in"
        >
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
            <span>{extractSuccess}</span>
          </div>
          <button
            type="button"
            onClick={() => setExtractSuccess(null)}
            className="text-emerald-700 dark:text-emerald-300 hover:underline font-semibold cursor-pointer shrink-0 ml-2"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Textarea */}
      <div className="relative">
        <textarea
          id="discussion-guide-textarea"
          rows={7}
          value={guide}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Paste or type discussion guide questions here... Example:
1. Tell me about your current daily habits with...
2. What happened the last time you experienced friction with...
3. On a scale of 1 to 5, how satisfied are you with..."
          className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-950/60 p-3.5 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 font-mono leading-relaxed transition-colors resize-y"
        />
      </div>

      <div className="flex items-center justify-between mt-2 text-[11px] text-slate-400">
        <span className="flex items-center gap-1">
          <HelpCircle className="w-3 h-3" />
          Tip: One question or topic per line (numbered 1., 2., 3.) generates the cleanest structured evaluation tables.
        </span>
        <span>{guide.length} characters</span>
      </div>
    </div>
  );
}
