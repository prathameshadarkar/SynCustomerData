import { useState } from 'react';
import { FileSpreadsheet, FileText, Check, Copy } from 'lucide-react';
import { ParticipantResult } from '../types';

interface ExportBarProps {
  participants: ParticipantResult[];
  guideTitle?: string;
}

export function ExportBar({ participants, guideTitle = 'Undergraduate Student Qualitative Research' }: ExportBarProps) {
  const [copiedAll, setCopiedAll] = useState(false);

  if (participants.length === 0) return null;

  // 1. Download all transcripts as formatted .txt
  const handleDownloadTxt = () => {
    let content = `EVIDENCE-INFORMED SYNTHETIC DISCUSSION-GUIDE RESEARCH TRANSCRIPTS\n`;
    content += `Study: ${guideTitle}\n`;
    content += `Generated: ${new Date().toLocaleString()}\n`;
    content += `Total Participants: ${participants.length}\n`;
    content += `Methodology: Server-sampled persona spec, section-by-section generation, local hybrid retrieval (embeddings + BM25) grounding\n`;
    content += `Anti-Imitation Safeguard: Enforced (No copying of distinctive quotes or anecdotes)\n`;
    content += `================================================================\n\n`;

    participants.forEach((p, idx) => {
      const year = p.persona.academic_year || 'Undergraduate';
      const school = p.persona.school_or_field || 'CAS';
      const major = p.persona.major || p.persona.occupation || 'Student';
      const familiarity = p.persona.topic_familiarity || 'Moderate';
      const usage = p.persona.usage_intensity || 'Regular';
      const overlapStatus = p.source_overlap_status === 'possible_overlap' ? 'Possible overlap flagged' : 'Clear (No unusual overlap detected)';

      content += `================================================================\n`;
      content += `PARTICIPANT #${p.participantIndex || idx + 1}: ${p.persona.name}\n`;
      content += `Age: ${p.persona.age} | Academic Year: ${year} | School/Field: ${school} | Major: ${major}\n`;
      content += `Topic Familiarity: ${familiarity} | Usage Intensity: ${usage}\n`;
      content += `Source Overlap Check: ${overlapStatus}\n`;
      content += `Persona Profile: ${p.persona.background}\n`;
      if (p.persona.behavioral_pattern) content += `Behavioral Pattern: ${p.persona.behavioral_pattern}\n`;
      if (p.persona.attitude_baseline) content += `Attitude Baseline: ${p.persona.attitude_baseline}\n`;
      content += `Grounded in: ${(p.grounding_sources || []).join('; ')}\n`;
      content += `----------------------------------------------------------------\n`;
      content += `VERBATIM INTERVIEW TRANSCRIPT:\n\n`;
      content += p.transcript;
      content += `\n\n`;
      content += `STRUCTURED SUMMARY:\n`;
      p.responses.forEach((r, rIdx) => {
        content += `Q${rIdx + 1}: ${r.question}\n`;
        content += `Answer: ${r.answer_summary}\n`;
        content += `Sentiment: ${r.sentiment} | Rating: ${r.rating_1_to_5}/5\n\n`;
      });
      content += `================================================================\n\n`;
    });

    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `synthetic_student_transcripts_${Date.now()}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // 2. Download structured responses as CSV
  const handleDownloadCsv = () => {
    const headers = [
      'participant_name',
      'age',
      'academic_year',
      'school_or_field',
      'major',
      'topic_familiarity',
      'usage_intensity',
      'background',
      'behavioral_pattern',
      'attitude_baseline',
      'question',
      'answer_summary',
      'sentiment',
      'rating',
      'grounding_sources',
      'source_overlap_status',
    ];

    const escapeCsv = (str: string | number | undefined | null) => {
      if (str === undefined || str === null) return '""';
      const val = String(str).replace(/"/g, '""');
      return `"${val}"`;
    };

    const rows: string[] = [];
    rows.push(headers.join(','));

    participants.forEach((p) => {
      p.responses.forEach((r) => {
        const row = [
          escapeCsv(p.persona.name),
          escapeCsv(p.persona.age),
          escapeCsv(p.persona.academic_year || 'Undergraduate'),
          escapeCsv(p.persona.school_or_field || 'CAS'),
          escapeCsv(p.persona.major || p.persona.occupation || 'Student'),
          escapeCsv(p.persona.topic_familiarity || 'Moderate'),
          escapeCsv(p.persona.usage_intensity || 'Regular'),
          escapeCsv(p.persona.background),
          escapeCsv(p.persona.behavioral_pattern || ''),
          escapeCsv(p.persona.attitude_baseline || ''),
          escapeCsv(r.question),
          escapeCsv(r.answer_summary),
          escapeCsv(r.sentiment),
          escapeCsv(r.rating_1_to_5),
          escapeCsv((p.grounding_sources || []).join(' | ')),
          escapeCsv(p.source_overlap_status || 'clear'),
        ];
        rows.push(row.join(','));
      });
    });

    const csvString = rows.join('\r\n');
    const blob = new Blob([csvString], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `synthetic_student_responses_${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleCopyAllTranscripts = () => {
    let full = '';
    participants.forEach((p, idx) => {
      const year = p.persona.academic_year || 'Undergrad';
      const school = p.persona.school_or_field || 'CAS';
      const major = p.persona.major || p.persona.occupation || 'Student';
      full += `=== PARTICIPANT #${p.participantIndex || idx + 1}: ${p.persona.name} (${p.persona.age} yrs • ${year} • ${school} • ${major}) ===\n`;
      full += `${p.transcript}\n\n`;
    });
    navigator.clipboard.writeText(full);
    setCopiedAll(true);
    setTimeout(() => setCopiedAll(false), 2500);
  };

  return (
    <div
      id="export-bar"
      className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm flex flex-wrap items-center justify-between gap-3"
    >
      <div>
        <p className="text-sm font-bold text-slate-900 dark:text-white">
          Export Generated Research Transcripts
        </p>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
          {participants.length} {participants.length === 1 ? 'participant' : 'participants'} with academic persona profiles, verbatim dialogues, and structured responses
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          id="download-transcripts-txt-btn"
          onClick={handleDownloadTxt}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs sm:text-sm font-semibold text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700 transition-colors shadow-xs active:scale-95 cursor-pointer"
          title="Download concatenated verbatim transcripts as .txt"
        >
          <FileText className="w-4 h-4 text-indigo-500" />
          <span>Download all transcripts (.txt)</span>
        </button>

        <button
          id="download-responses-csv-btn"
          onClick={handleDownloadCsv}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs sm:text-sm font-semibold text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/50 hover:bg-emerald-100 dark:hover:bg-emerald-900/60 border border-emerald-200/80 dark:border-emerald-800/60 transition-colors shadow-xs active:scale-95 cursor-pointer"
          title="Download per-question structured response data with ratings as .csv"
        >
          <FileSpreadsheet className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
          <span>Download structured responses (.csv)</span>
        </button>

        <button
          id="copy-all-btn"
          onClick={handleCopyAllTranscripts}
          className="p-2 rounded-xl text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-700 transition-colors cursor-pointer"
          title="Copy all transcripts to clipboard"
          aria-label="Copy all transcripts"
        >
          {copiedAll ? <Check className="w-4 h-4 text-emerald-500" /> : <Copy className="w-4 h-4" />}
        </button>
      </div>
    </div>
  );
}
