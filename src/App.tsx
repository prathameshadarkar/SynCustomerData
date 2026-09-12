import { useState, useEffect, useCallback } from 'react';
import { Header } from './components/Header';
import { UploadPanel } from './components/UploadPanel';
import { DiscussionGuidePanel } from './components/DiscussionGuidePanel';
import { GenerationSettingsPanel } from './components/GenerationSettingsPanel';
import { ResultsView } from './components/ResultsView';
import { ExportBar } from './components/ExportBar';
import { ErrorAlert } from './components/ErrorAlert';
import { ThemeSelectorModal } from './components/ThemeSelectorModal';
import {
  UploadedFileRecord,
  GenerationSettings,
  GenerationProgress,
  ParticipantResult,
  ThemeId,
  FileSourceRole,
} from './types';
import { FileText, KeyRound } from 'lucide-react';
import { apiFetch, getPasscode, setPasscode, PasscodeRequiredError } from './api';

const STORAGE_SESSION_KEY = 'synthetic_transcripts_session_id';
const STORAGE_THEME_KEY = 'synthetic_transcripts_theme';

/** Files above this size bypass the server and upload straight to private storage (Vercel body limit is 4.5 MB). */
const DIRECT_UPLOAD_THRESHOLD = 3.5 * 1024 * 1024;

function getOrGenerateSessionId(): string {
  let id = localStorage.getItem(STORAGE_SESSION_KEY);
  if (!id) {
    id = 'session-' + Math.random().toString(36).substring(2, 10);
    localStorage.setItem(STORAGE_SESSION_KEY, id);
  }
  return id;
}

function getStoredTheme(): ThemeId {
  if (typeof window !== 'undefined') {
    const saved = localStorage.getItem(STORAGE_THEME_KEY);
    if (saved && ['indigo', 'teal', 'warm', 'emerald', 'obsidian', 'violet'].includes(saved)) {
      return saved as ThemeId;
    }
  }
  return 'indigo';
}

interface HealthInfo {
  passcodeRequired: boolean;
  clientUploads: boolean;
  externalDataPolicy: 'raw' | 'redacted' | 'none';
  providers: { configured: string[]; available: string[] };
  models: { generation: string; utility: string };
}

export default function App() {
  const [sessionId, setSessionId] = useState<string>(getOrGenerateSessionId);
  const [files, setFiles] = useState<UploadedFileRecord[]>([]);
  const [storeName, setStoreName] = useState<string | undefined>(undefined);
  const [isUploading, setIsUploading] = useState(false);
  const [isLoadingSample, setIsLoadingSample] = useState(false);
  const [isResetting, setIsResetting] = useState(false);
  const [health, setHealth] = useState<HealthInfo | null>(null);
  const [needsPasscode, setNeedsPasscode] = useState(false);
  const [passcodeInput, setPasscodeInput] = useState('');

  // Theme state
  const [currentTheme, setCurrentTheme] = useState<ThemeId>(getStoredTheme);
  const [isThemeModalOpen, setIsThemeModalOpen] = useState(false);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', currentTheme);
    localStorage.setItem(STORAGE_THEME_KEY, currentTheme);
  }, [currentTheme]);

  // Discussion guide state
  const [discussionGuide, setDiscussionGuide] = useState<string>(`Section 1: Warm-up & Daily Campus Routines
1. Walk me through a typical weekday at NYU. How do you plan your transit, class schedule, and study spots?
2. Which digital apps or campus tools (e.g., Brightspace, NYU Mobile, campus dining) do you open first, and why?

Section 2: Digital Friction & Dining Experience
3. Think back to a recent moment when a campus mobile tool or ordering process caused you frustration or delay. What happened, and how did you resolve it?
4. How do you manage dining dollars, meal plans, or off-campus food spending between classes?

Section 3: Projective Exercise & Future Wishlist
5. Projective exercise: If your campus digital services were a person or fictional character, how would you describe their personality and dependability?
6. On a scale of 1 to 5, how satisfied are you with the overall mobile digital experience on campus, and what is the #1 improvement you would request?`);

  // Generation settings
  const [settings, setSettings] = useState<GenerationSettings>({
    populationPreset: 'NYU Undergraduate Students',
    targetAudience:
      'NYU undergraduate students across different years, schools, majors, backgrounds, interests, and levels of familiarity with the research topic.',
    academicYears: ['First-year', 'Sophomore', 'Junior', 'Senior'],
    schoolSelectionType: 'diverse',
    customSchools: '',
    additionalConstraints: '',
    personaDiversity: 'High',
    interviewDepth: 'Full Discussion Guide',
    priorityQuestions: '',
    toneStyle: 'Natural focus-group conversation',
    numParticipants: 3,
  });

  // Generation execution state
  const [isGenerating, setIsGenerating] = useState(false);
  const [progress, setProgress] = useState<GenerationProgress | null>(null);
  const [participants, setParticipants] = useState<ParticipantResult[]>([]);

  // Error alert
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Light / Dark mode
  const [isDarkMode, setIsDarkMode] = useState<boolean>(false);
  useEffect(() => {
    if (isDarkMode) {
      document.documentElement.classList.add('dark');
      localStorage.setItem('theme_mode', 'dark');
    } else {
      document.documentElement.classList.remove('dark');
      localStorage.setItem('theme_mode', 'light');
    }
  }, [isDarkMode]);

  const handleApiError = useCallback((err: any, fallback: string) => {
    if (err instanceof PasscodeRequiredError) {
      setNeedsPasscode(true);
      setErrorMessage('This deployment is protected. Enter the passcode to continue.');
      return;
    }
    setErrorMessage(err?.message || fallback);
  }, []);

  // Health + initial store status
  useEffect(() => {
    const init = async () => {
      try {
        const h = await fetch('/api/health').then((r) => r.json());
        setHealth(h);
        if (h.passcodeRequired && !getPasscode()) {
          setNeedsPasscode(true);
          return;
        }
      } catch (err: any) {
        console.warn('Health check warning:', err.message);
      }
      try {
        const res = await apiFetch(`/api/store/status?sessionId=${sessionId}`);
        if (res.ok) {
          const data = await res.json();
          if (data.exists) {
            setStoreName(data.storeName);
            setFiles(data.files || []);
          }
        }
      } catch (err: any) {
        if (err instanceof PasscodeRequiredError) setNeedsPasscode(true);
        else console.warn('Initial store status fetch warning:', err.message);
      }
    };
    init();
  }, [sessionId, needsPasscode]);

  const submitPasscode = async () => {
    setPasscode(passcodeInput.trim());
    try {
      const res = await apiFetch(`/api/store/status?sessionId=${sessionId}`);
      if (res.ok) {
        setNeedsPasscode(false);
        setErrorMessage(null);
        const data = await res.json();
        if (data.exists) {
          setStoreName(data.storeName);
          setFiles(data.files || []);
        }
      }
    } catch (err: any) {
      if (err instanceof PasscodeRequiredError) setErrorMessage('Incorrect passcode.');
      else setErrorMessage(err.message);
    }
  };

  // Upload file with specific source role (guide, research, prior_evidence)
  const handleUploadFile = async (
    file: File,
    role: FileSourceRole = 'research',
    category: 'dataset' | 'document' = 'dataset'
  ) => {
    setIsUploading(true);
    setErrorMessage(null);
    try {
      let data: any;
      if (health?.clientUploads && file.size > DIRECT_UPLOAD_THRESHOLD) {
        // 1) ask the server where to put it, 2) upload browser → private Blob, 3) ask the server to ingest.
        const { upload } = await import('@vercel/blob/client');
        const pathRes = await apiFetch('/api/store/upload-path', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId, filename: file.name }),
        });
        const { pathname } = await pathRes.json();
        const passcode = getPasscode();
        const blob = await upload(pathname, file, {
          access: 'private',
          handleUploadUrl: '/api/store/upload-token',
          headers: passcode ? { 'x-app-passcode': passcode } : undefined,
          multipart: file.size > 20 * 1024 * 1024,
          contentType: file.type || 'application/octet-stream',
        } as any);
        const res = await apiFetch('/api/store/ingest', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId, pathname: blob.pathname, originalName: file.name, category, sourceRole: role }),
        });
        data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to index uploaded file.');
      } else {
        const formData = new FormData();
        formData.append('file', file);
        formData.append('sessionId', sessionId);
        formData.append('category', category);
        formData.append('sourceRole', role);
        const res = await apiFetch('/api/store/upload', { method: 'POST', body: formData });
        data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to upload and index file.');
      }
      setStoreName(data.storeName);
      setFiles((prev) => [...prev, data.file]);
    } catch (err: any) {
      handleApiError(err, 'File upload failed');
    } finally {
      setIsUploading(false);
    }
  };

  // Remove file
  const handleRemoveFile = async (fileId: string) => {
    try {
      const res = await apiFetch(`/api/store/file/${fileId}?sessionId=${sessionId}`, { method: 'DELETE' });
      if (res.ok) {
        const data = await res.json();
        setFiles(data.files || []);
      }
    } catch (err: any) {
      handleApiError(err, 'Failed to remove file');
    }
  };

  // Load sample dataset
  const handleLoadSample = async () => {
    setIsLoadingSample(true);
    setErrorMessage(null);
    try {
      const res = await apiFetch('/api/store/sample', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load sample dataset.');
      setFiles((prev) => [...prev, ...(data.files || [])]);
      setStoreName((prev) => prev || `local:${sessionId}`);
      if (data.sampleDiscussionGuide) setDiscussionGuide(data.sampleDiscussionGuide);
      setSettings((prev) => ({
        ...prev,
        populationPreset: 'NYU Undergraduate Students',
        targetAudience:
          'NYU undergraduate students across different years, schools, majors, backgrounds, interests, and levels of familiarity with the research topic.',
        academicYears: ['First-year', 'Sophomore', 'Junior', 'Senior'],
        schoolSelectionType: 'diverse',
        personaDiversity: 'High',
        interviewDepth: 'Full Discussion Guide',
        toneStyle: 'Natural focus-group conversation',
        numParticipants: 3,
      }));
    } catch (err: any) {
      handleApiError(err, 'Failed to load sample dataset');
    } finally {
      setIsLoadingSample(false);
    }
  };

  // Reset session
  const handleResetSession = async () => {
    setIsResetting(true);
    setErrorMessage(null);
    try {
      await apiFetch(`/api/store/clear?sessionId=${sessionId}`, { method: 'DELETE' });
    } catch {}
    const newId = 'session-' + Math.random().toString(36).substring(2, 10);
    localStorage.setItem(STORAGE_SESSION_KEY, newId);
    setSessionId(newId);
    setStoreName(undefined);
    setFiles([]);
    setParticipants([]);
    setProgress(null);
    setIsResetting(false);
  };

  /**
   * Generate transcripts. One SSE request per participant so each HTTP call stays short
   * (serverless-friendly) and a failure only costs one participant. Supports resume.
   */
  const handleGenerate = async (resumeFromIndex?: number) => {
    if (files.length === 0) {
      setErrorMessage('Please upload at least one reference dataset or document before generating.');
      return;
    }
    if (!discussionGuide.trim()) {
      setErrorMessage('Please provide a discussion guide with questions for the moderator.');
      return;
    }

    const isResume = typeof resumeFromIndex === 'number' && resumeFromIndex > 1;
    const startIndex = isResume ? resumeFromIndex : 1;
    const total = settings.numParticipants;
    const batchSeed = `${sessionId}:${Date.now()}`;

    setIsGenerating(true);
    setErrorMessage(null);
    if (!isResume) setParticipants([]);
    setProgress({
      currentIndex: startIndex,
      total,
      statusMessage: isResume ? `Resuming simulation for participant ${startIndex} of ${total}...` : 'Preparing retrieval and persona plan…',
      isComplete: false,
    });

    let personas: any[] = isResume ? participants.map((p) => p.persona) : [];
    let stopped = false;

    try {
      for (let i = startIndex; i <= total && !stopped; i++) {
        const response = await apiFetch('/api/transcripts/generate-stream', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sessionId,
            discussionGuide,
            targetAudience: settings.targetAudience,
            academicYears: settings.academicYears,
            schoolSelectionType: settings.schoolSelectionType,
            customSchools: settings.customSchools,
            additionalConstraints: settings.additionalConstraints,
            personaDiversity: settings.personaDiversity,
            interviewDepth: settings.interviewDepth,
            priorityQuestions: settings.priorityQuestions,
            toneStyle: settings.toneStyle,
            numParticipants: total,
            startIndex: i,
            endIndex: i,
            existingPersonas: personas,
            batchSeed,
          }),
        });

        if (!response.ok) {
          const errData = await response.json().catch(() => ({}));
          throw new Error(errData.error || `Server responded with status ${response.status}`);
        }
        if (!response.body) throw new Error('ReadableStream not supported by browser.');

        const reader = response.body.getReader();
        const decoder = new TextDecoder('utf-8');
        let buffer = '';
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const events = buffer.split('\n\n');
          buffer = events.pop() || '';
          for (const raw of events) {
            const trimmed = raw.trim();
            if (!trimmed.startsWith('data: ')) continue; // ignore keepalive comments
            try {
              const data = JSON.parse(trimmed.slice(6));
              if (data.type === 'init') {
                setProgress((prev) => ({ ...(prev || { currentIndex: i, total, isComplete: false }), statusMessage: data.message, total }));
              } else if (data.type === 'progress') {
                setProgress({
                  currentIndex: data.currentIndex,
                  total: data.total,
                  statusMessage: data.statusMessage,
                  currentPersonaName: data.currentPersonaName,
                  isComplete: false,
                  waitingForRateLimit: Boolean(data.waitingForRateLimit),
                  waitTimeSeconds: data.waitTimeSeconds,
                });
              } else if (data.type === 'participant') {
                personas = [...personas, data.participant.persona];
                setParticipants((prev) => {
                  const idx = prev.findIndex((p) => p.participantIndex === data.participant.participantIndex);
                  if (idx !== -1) {
                    const copy = [...prev];
                    copy[idx] = data.participant;
                    return copy;
                  }
                  return [...prev, data.participant];
                });
                setProgress({
                  currentIndex: Math.min(data.currentIndex, data.total),
                  total: data.total,
                  statusMessage: `Completed simulation for ${data.participant.persona.name}`,
                  isComplete: false,
                });
              } else if (data.type === 'error_item') {
                setErrorMessage(typeof data.error === 'string' ? data.error : 'A participant failed to generate. Click "Resume Remaining" to continue.');
                stopped = true;
              } else if (data.type === 'complete' && i === total) {
                setProgress((prev) => (prev ? { ...prev, isComplete: true, statusMessage: `Completed ${total} participant${total === 1 ? '' : 's'}.` } : null));
              }
            } catch (pErr) {
              console.warn('Failed to parse SSE chunk:', pErr);
            }
          }
        }
      }
      if (!stopped) {
        setProgress((prev) => (prev ? { ...prev, isComplete: true, currentIndex: total } : null));
      }
    } catch (err: any) {
      console.error('Generation error:', err);
      if (err instanceof PasscodeRequiredError) {
        setNeedsPasscode(true);
      } else {
        const rawMsg = err.message || '';
        setErrorMessage(rawMsg.startsWith('{') || rawMsg.includes('SyntaxError') ? 'Unexpected response format from the server. Please try again.' : rawMsg);
      }
    } finally {
      setIsGenerating(false);
    }
  };

  const pdfFilesCount = files.filter((f) => f.category === 'document').length;
  const policyLabel =
    health?.externalDataPolicy === 'none'
      ? 'No source text is sent to the model (policy: none)'
      : health?.externalDataPolicy === 'raw'
      ? 'Retrieved excerpts are sent unredacted (policy: raw)'
      : 'Retrieved excerpts are PII-redacted before leaving the server (policy: redacted)';

  return (
    <div className="min-h-screen flex flex-col bg-white dark:bg-slate-950 text-slate-800 dark:text-slate-100 transition-colors duration-150">
      <Header
        storeName={storeName}
        filesCount={files.length}
        isDarkMode={isDarkMode}
        onToggleDarkMode={() => setIsDarkMode(!isDarkMode)}
        onResetSession={handleResetSession}
        isResetting={isResetting}
        currentTheme={currentTheme}
        onOpenThemeModal={() => setIsThemeModalOpen(true)}
      />

      <ThemeSelectorModal
        isOpen={isThemeModalOpen}
        onClose={() => setIsThemeModalOpen(false)}
        currentTheme={currentTheme}
        onSelectTheme={(themeId) => {
          setCurrentTheme(themeId);
          setIsThemeModalOpen(false);
        }}
        isDarkMode={isDarkMode}
        onToggleDarkMode={() => setIsDarkMode(!isDarkMode)}
      />

      {needsPasscode && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-xl border border-slate-200 dark:border-slate-800 p-6 w-full max-w-sm space-y-4">
            <div className="flex items-center gap-2">
              <div className="w-9 h-9 rounded-xl theme-bg-tint theme-text-primary flex items-center justify-center">
                <KeyRound className="w-4 h-4" />
              </div>
              <h2 className="font-bold text-slate-900 dark:text-white">Enter access passcode</h2>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400">This research prototype is passcode-protected to keep its free API quota for the team.</p>
            <input
              type="password"
              value={passcodeInput}
              onChange={(e) => setPasscodeInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && submitPasscode()}
              className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm"
              placeholder="Passcode"
              autoFocus
            />
            <button onClick={submitPasscode} className="w-full py-2 rounded-xl text-sm font-semibold text-white theme-btn-primary hover:opacity-90 cursor-pointer">
              Continue
            </button>
          </div>
        </div>
      )}

      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8 space-y-6">
        <ErrorAlert message={errorMessage} onDismiss={() => setErrorMessage(null)} title="Operation Notice" />

        {health && health.providers.available.length === 0 && (
          <div className="p-3 rounded-xl border border-amber-300 bg-amber-50 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200 dark:border-amber-800 text-xs">
            No language-model provider is configured on the server yet. Add <code>CEREBRAS_API_KEY</code>, <code>GROQ_API_KEY</code> or Cloudflare credentials to the deployment's environment variables (or <code>LLM_PROVIDERS=mock</code> for a dry run).
          </div>
        )}

        <div className="space-y-6">
          <UploadPanel
            files={files}
            isUploading={isUploading}
            onUploadFile={handleUploadFile}
            onRemoveFile={handleRemoveFile}
            onLoadSample={handleLoadSample}
            isLoadingSample={isLoadingSample}
            onError={(msg) => setErrorMessage(msg)}
          />

          <DiscussionGuidePanel guide={discussionGuide} onChange={setDiscussionGuide} pdfFilesCount={pdfFilesCount} sessionId={sessionId} />

          <GenerationSettingsPanel
            settings={settings}
            onChange={(updated) => setSettings((prev) => ({ ...prev, ...updated }))}
            onGenerate={() => handleGenerate()}
            onResume={() => handleGenerate(participants.length + 1)}
            participantsCount={participants.length}
            isGenerating={isGenerating}
            progress={progress}
            hasFiles={files.length > 0}
            hasGuide={discussionGuide.trim().length > 0}
            discussionGuideText={discussionGuide}
          />
        </div>

        <div id="results-container" className="pt-4 space-y-5">
          <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-3">
            <div>
              <h2 className="text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <span>Generated Research Transcripts & Structured Data</span>
                {participants.length > 0 && (
                  <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                    {participants.length} {participants.length === 1 ? 'Participant' : 'Participants'}
                  </span>
                )}
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Each section of every interview is grounded in excerpts retrieved from your uploaded research. {health ? policyLabel : ''}
              </p>
            </div>
          </div>

          {participants.length > 0 && <ExportBar participants={participants} guideTitle="Discussion Guide Study" />}

          {participants.length > 0 ? (
            <ResultsView participants={participants} />
          ) : (
            <div id="empty-results-placeholder" className="p-12 text-center rounded-2xl border-2 border-dashed border-slate-200 dark:border-slate-800 bg-white/60 dark:bg-slate-900/40">
              <div className="w-14 h-14 rounded-2xl theme-bg-tint theme-text-primary flex items-center justify-center mx-auto mb-3 shadow-xs">
                <FileText className="w-7 h-7" />
              </div>
              <h3 className="text-base font-bold text-slate-900 dark:text-white">No Transcripts Generated Yet</h3>
              <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 max-w-md mx-auto mt-1 leading-relaxed">
                Upload your reference dataset (CSV, XLSX, JSON) or research documents (PDF), customize your discussion guide, and click{' '}
                <strong className="text-slate-700 dark:text-slate-300 font-semibold">Generate Transcripts</strong>.
              </p>
              <div className="mt-4 inline-flex items-center gap-1.5 text-xs theme-text-primary">
                <span>Or use</span>
                <button onClick={handleLoadSample} disabled={isLoadingSample} className="font-bold underline hover:opacity-80 cursor-pointer">
                  Quick Test: Load Sample Dataset & Guide
                </button>
                <span>above to test right away!</span>
              </div>
            </div>
          )}
        </div>
      </main>

      <footer className="border-t border-slate-200 dark:border-slate-800 py-4 bg-white/50 dark:bg-slate-900/50 text-center text-xs text-slate-500 dark:text-slate-400">
        <div className="max-w-7xl mx-auto px-4 flex flex-wrap items-center justify-between gap-2">
          <span>
            Synthetic Discussion-Guide Transcript Generator • {health ? `${health.models.generation} via ${health.providers.available.join(' → ') || 'no provider'}` : 'Open-weight models on free tiers'}
          </span>
          <span>Local hybrid retrieval • Raw files never leave the server</span>
        </div>
      </footer>
    </div>
  );
}
