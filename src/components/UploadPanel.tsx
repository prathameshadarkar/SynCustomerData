import { useState, useRef, DragEvent, ChangeEvent } from 'react';
import {
  Upload,
  FileSpreadsheet,
  FileText,
  CheckCircle2,
  Trash2,
  Loader2,
  Sparkles,
  AlertTriangle,
  BookOpen,
  Database,
  Users,
} from 'lucide-react';
import { UploadedFileRecord, FileSourceRole } from '../types';

interface UploadPanelProps {
  files: UploadedFileRecord[];
  isUploading: boolean;
  onUploadFile: (file: File, role: FileSourceRole, category: 'dataset' | 'document') => Promise<void>;
  onRemoveFile: (fileId: string) => Promise<void>;
  onLoadSample: () => Promise<void>;
  isLoadingSample: boolean;
  onError: (msg: string) => void;
}

const MAX_FILE_SIZE_BYTES = 100 * 1024 * 1024; // 100MB

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

export function UploadPanel({
  files,
  isUploading,
  onUploadFile,
  onRemoveFile,
  onLoadSample,
  isLoadingSample,
  onError,
}: UploadPanelProps) {
  const [dragActiveGuide, setDragActiveGuide] = useState(false);
  const [dragActiveResearch, setDragActiveResearch] = useState(false);
  const [dragActivePrior, setDragActivePrior] = useState(false);

  const guideInputRef = useRef<HTMLInputElement>(null);
  const researchInputRef = useRef<HTMLInputElement>(null);
  const priorInputRef = useRef<HTMLInputElement>(null);

  const validateAndUpload = async (file: File, role: FileSourceRole) => {
    // 100MB Limit enforcement
    if (file.size > MAX_FILE_SIZE_BYTES) {
      onError(`File "${file.name}" (${formatBytes(file.size)}) exceeds the maximum allowed limit of 100MB.`);
      return;
    }

    const ext = '.' + file.name.split('.').pop()?.toLowerCase();

    if (role === 'guide') {
      const allowed = ['.pdf', '.txt'];
      if (!allowed.includes(ext)) {
        onError(`Invalid file "${file.name}" for Discussion Guide. Only PDF (or TXT) files are accepted.`);
        return;
      }
      await onUploadFile(file, 'guide', 'document');
    } else {
      const allowed = ['.pdf', '.csv', '.xlsx', '.xls', '.json', '.txt'];
      if (!allowed.includes(ext)) {
        onError(`Invalid file "${file.name}". Only PDF, CSV, XLSX, and JSON files are accepted.`);
        return;
      }
      const isTabular = ['.csv', '.xlsx', '.xls', '.json'].includes(ext);
      await onUploadFile(file, role, isTabular ? 'dataset' : 'document');
    }
  };

  const handleDrag = (e: DragEvent<HTMLDivElement>, role: FileSourceRole, status: boolean) => {
    e.preventDefault();
    e.stopPropagation();
    if (role === 'guide') setDragActiveGuide(status);
    else if (role === 'research') setDragActiveResearch(status);
    else setDragActivePrior(status);
  };

  const handleDrop = async (e: DragEvent<HTMLDivElement>, role: FileSourceRole) => {
    e.preventDefault();
    e.stopPropagation();
    if (role === 'guide') setDragActiveGuide(false);
    else if (role === 'research') setDragActiveResearch(false);
    else setDragActivePrior(false);

    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const droppedFiles = Array.from(e.dataTransfer.files) as File[];
      for (const file of droppedFiles) {
        await validateAndUpload(file, role);
      }
    }
  };

  const handleFileInputChange = async (e: ChangeEvent<HTMLInputElement>, role: FileSourceRole) => {
    if (e.target.files && e.target.files.length > 0) {
      const selectedFiles = Array.from(e.target.files) as File[];
      for (const file of selectedFiles) {
        await validateAndUpload(file, role);
      }
      e.target.value = '';
    }
  };

  const getRoleLabel = (role?: FileSourceRole, category?: string) => {
    if (role === 'guide') return { label: 'Discussion Guide', color: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300' };
    if (role === 'prior_evidence') return { label: 'Prior Evidence', color: 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300' };
    if (role === 'research') return { label: 'Research Source', color: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300' };
    return category === 'dataset'
      ? { label: 'Dataset', color: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300' }
      : { label: 'Research Document', color: 'bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300' };
  };

  return (
    <div id="upload-panel" className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5 sm:p-6 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
        <div>
          <h2 className="text-base sm:text-lg font-bold text-slate-900 dark:text-white flex flex-wrap items-center gap-x-2 gap-y-1">
            <span>1. Grounding Data Ingestion</span>
            <span className="text-xs font-normal whitespace-nowrap shrink-0 px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400">
              Private server-side index
            </span>
          </h2>
          <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 mt-0.5">
            Files are parsed, chunked and embedded on the server. Raw files never leave the app; only small retrieved excerpts (subject to the redaction policy) are sent to the language model.
          </p>
        </div>

        {/* Quick Sample Button */}
        <button
          id="load-sample-btn"
          onClick={onLoadSample}
          disabled={isLoadingSample || isUploading}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs sm:text-sm font-semibold theme-text-primary theme-bg-tint theme-border-tint hover:opacity-90 border transition-all shadow-xs active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
          title="Pre-load a synthetic NYU campus survey CSV and research brief PDF"
        >
          {isLoadingSample ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Sparkles className="w-4 h-4 theme-icon" />
          )}
          <span>Quick Test: Load Sample Study (NYU Undergrads)</span>
        </button>
      </div>

      {/* Three Conceptual Upload Areas */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Area 1: Discussion Guide */}
        <div
          id="guide-dropzone"
          onDragEnter={(e) => handleDrag(e, 'guide', true)}
          onDragOver={(e) => handleDrag(e, 'guide', true)}
          onDragLeave={(e) => handleDrag(e, 'guide', false)}
          onDrop={(e) => handleDrop(e, 'guide')}
          onClick={() => guideInputRef.current?.click()}
          className={`relative group border-2 border-dashed rounded-xl p-4 sm:p-5 flex flex-col items-center justify-between text-center cursor-pointer transition-all duration-150 ${
            dragActiveGuide
              ? 'border-indigo-500 bg-indigo-50/70 dark:bg-indigo-950/30 ring-2 ring-indigo-500/20'
              : 'border-slate-300 dark:border-slate-700 hover:border-indigo-400 dark:hover:border-indigo-500 bg-slate-50/50 dark:bg-slate-900/40 hover:bg-slate-50 dark:hover:bg-slate-800/40'
          }`}
        >
          <input
            ref={guideInputRef}
            type="file"
            accept=".pdf,.txt"
            className="hidden"
            onChange={(e) => handleFileInputChange(e, 'guide')}
          />
          <div className="w-10 h-10 rounded-xl bg-indigo-100 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 flex items-center justify-center mb-2 shadow-sm group-hover:scale-105 transition-transform">
            <BookOpen className="w-5 h-5" />
          </div>
          <div>
            <p className="text-sm font-bold text-slate-800 dark:text-slate-200">
              Discussion Guide
            </p>
            <p className="text-[11px] font-semibold text-indigo-600 dark:text-indigo-400 mt-0.5">
              Accepts PDF
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 leading-relaxed">
              Moderator questions, sections, probes, exercises, and interview protocol.
            </p>
          </div>
          <div className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-indigo-600 dark:text-indigo-400">
            <Upload className="w-3.5 h-3.5" />
            <span>Upload Guide (Max 100MB)</span>
          </div>
        </div>

        {/* Area 2: Background / Research Sources */}
        <div
          id="research-dropzone"
          onDragEnter={(e) => handleDrag(e, 'research', true)}
          onDragOver={(e) => handleDrag(e, 'research', true)}
          onDragLeave={(e) => handleDrag(e, 'research', false)}
          onDrop={(e) => handleDrop(e, 'research')}
          onClick={() => researchInputRef.current?.click()}
          className={`relative group border-2 border-dashed rounded-xl p-4 sm:p-5 flex flex-col items-center justify-between text-center cursor-pointer transition-all duration-150 ${
            dragActiveResearch
              ? 'border-emerald-500 bg-emerald-50/70 dark:bg-emerald-950/30 ring-2 ring-emerald-500/20'
              : 'border-slate-300 dark:border-slate-700 hover:border-emerald-400 dark:hover:border-emerald-500 bg-slate-50/50 dark:bg-slate-900/40 hover:bg-slate-50 dark:hover:bg-slate-800/40'
          }`}
        >
          <input
            ref={researchInputRef}
            type="file"
            accept=".pdf,.csv,.xlsx,.xls,.json,.txt"
            multiple
            className="hidden"
            onChange={(e) => handleFileInputChange(e, 'research')}
          />
          <div className="w-10 h-10 rounded-xl bg-emerald-100 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 flex items-center justify-center mb-2 shadow-sm group-hover:scale-105 transition-transform">
            <Database className="w-5 h-5" />
          </div>
          <div>
            <p className="text-sm font-bold text-slate-800 dark:text-slate-200">
              Background / Research Sources
            </p>
            <p className="text-[11px] font-semibold text-emerald-600 dark:text-emerald-400 mt-0.5">
              Accepts PDF, CSV, XLSX, JSON
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 leading-relaxed">
              Secondary research, category research, survey data, brand information, behavioral data, or other evidence used to ground participant attitudes.
            </p>
          </div>
          <div className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-emerald-600 dark:text-emerald-400">
            <Upload className="w-3.5 h-3.5" />
            <span>Upload Sources (Max 100MB)</span>
          </div>
        </div>

        {/* Area 3: Prior Participant Evidence — Optional */}
        <div className="flex flex-col">
          <div
            id="prior-evidence-dropzone"
            onDragEnter={(e) => handleDrag(e, 'prior_evidence', true)}
            onDragOver={(e) => handleDrag(e, 'prior_evidence', true)}
            onDragLeave={(e) => handleDrag(e, 'prior_evidence', false)}
            onDrop={(e) => handleDrop(e, 'prior_evidence')}
            onClick={() => priorInputRef.current?.click()}
            className={`relative group flex-1 border-2 border-dashed rounded-xl p-4 sm:p-5 flex flex-col items-center justify-between text-center cursor-pointer transition-all duration-150 ${
              dragActivePrior
                ? 'border-amber-500 bg-amber-50/70 dark:bg-amber-950/30 ring-2 ring-amber-500/20'
                : 'border-slate-300 dark:border-slate-700 hover:border-amber-400 dark:hover:border-amber-500 bg-slate-50/50 dark:bg-slate-900/40 hover:bg-slate-50 dark:hover:bg-slate-800/40'
            }`}
          >
            <input
              ref={priorInputRef}
              type="file"
              accept=".pdf,.csv,.xlsx,.xls,.json,.txt"
              multiple
              className="hidden"
              onChange={(e) => handleFileInputChange(e, 'prior_evidence')}
            />
            <div className="w-10 h-10 rounded-xl bg-amber-100 dark:bg-amber-950/60 text-amber-600 dark:text-amber-400 flex items-center justify-center mb-2 shadow-sm group-hover:scale-105 transition-transform">
              <Users className="w-5 h-5" />
            </div>
            <div>
              <p className="text-sm font-bold text-slate-800 dark:text-slate-200">
                Prior Participant Evidence — Optional
              </p>
              <p className="text-[11px] font-semibold text-amber-600 dark:text-amber-400 mt-0.5">
                Accepts PDF, CSV, XLSX, JSON
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 leading-relaxed">
                Previous qualitative findings, transcripts, or participant feedback. Used to infer themes and behavioral patterns, not to copy participant language.
              </p>
            </div>
            <div className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-amber-600 dark:text-amber-400">
              <Upload className="w-3.5 h-3.5" />
              <span>Upload Evidence (Max 100MB)</span>
            </div>
          </div>

          {/* Anti-imitation warning under Section 3 */}
          <div className="mt-2 p-2.5 rounded-xl bg-amber-50/90 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/60 text-[11px] text-amber-800 dark:text-amber-200 flex items-start gap-2">
            <AlertTriangle className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
            <p className="leading-snug">
              <strong>Anti-Imitation Safeguard:</strong> Distinctive quotes, anecdotes, examples, and projective responses from real participants should not be reproduced in synthetic responses.
            </p>
          </div>
        </div>
      </div>

      {/* Uploading indicator */}
      {isUploading && (
        <div id="uploading-progress-indicator" className="mt-4 p-3 rounded-xl bg-indigo-50/80 dark:bg-indigo-950/40 border border-indigo-200/80 dark:border-indigo-800/60 flex items-center gap-3">
          <Loader2 className="w-4 h-4 text-indigo-600 dark:text-indigo-400 animate-spin shrink-0" />
          <p className="text-xs font-medium text-indigo-900 dark:text-indigo-200">
            Uploading, parsing and embedding on the server… Large files upload directly to private storage first.
          </p>
        </div>
      )}

      {/* Uploaded Files Listing */}
      {files.length > 0 && (
        <div id="uploaded-files-list" className="mt-5 pt-4 border-t border-slate-100 dark:border-slate-800">
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Active Store Documents ({files.length})
            </p>
            <span className="text-xs text-emerald-600 dark:text-emerald-400 flex items-center gap-1 font-medium">
              <CheckCircle2 className="w-3.5 h-3.5" />
              Indexed & Ready for Retrieval Grounding
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
            {files.map((file) => {
              const isDataset = file.category === 'dataset' || file.name.endsWith('.csv') || file.name.endsWith('.xlsx') || file.name.endsWith('.json');
              const roleMeta = getRoleLabel(file.role, file.category);

              return (
                <div
                  key={file.id}
                  className="flex items-center justify-between p-2.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/40 text-xs"
                >
                  <div className="flex items-center gap-2.5 min-w-0 pr-2">
                    <div
                      className={`p-1.5 rounded-lg shrink-0 ${
                        isDataset
                          ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300'
                          : 'bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300'
                      }`}
                    >
                      {isDataset ? <FileSpreadsheet className="w-4 h-4" /> : <FileText className="w-4 h-4" />}
                    </div>
                    <div className="min-w-0">
                      <p className="font-semibold text-slate-900 dark:text-white truncate" title={file.name}>
                        {file.name}
                      </p>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <span className={`text-[10px] font-semibold px-1.5 py-0.2 rounded-md ${roleMeta.color}`}>
                          {roleMeta.label}
                        </span>
                        <span className="text-[11px] text-slate-400">
                          {formatBytes(file.size)}
                        </span>
                      </div>
                    </div>
                  </div>

                  <button
                    onClick={() => onRemoveFile(file.id)}
                    className="p-1.5 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/50 transition-colors shrink-0 cursor-pointer"
                    title="Remove from session list"
                    aria-label={`Remove ${file.name}`}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
