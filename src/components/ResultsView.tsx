import { useState } from 'react';
import {
  ChevronDown,
  ChevronUp,
  MessageSquare,
  Table as TableIcon,
  Star,
  ExternalLink,
  Copy,
  Check,
  Search,
  Sparkles,
  ShieldCheck,
  AlertTriangle,
  GraduationCap,
  BookOpen,
  Compass,
} from 'lucide-react';
import { ParticipantResult, SentimentType } from '../types';

interface ResultsViewProps {
  participants: ParticipantResult[];
}

export function ResultsView({ participants }: ResultsViewProps) {
  const [expandedIds, setExpandedIds] = useState<Record<string, boolean>>(() => {
    // Expand the first participant by default
    const initial: Record<string, boolean> = {};
    if (participants.length > 0) {
      initial[participants[0].id] = true;
    }
    return initial;
  });

  const [activeTabs, setActiveTabs] = useState<Record<string, 'transcript' | 'table'>>({});
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [sentimentFilter, setSentimentFilter] = useState<string>('all');

  const toggleExpand = (id: string) => {
    setExpandedIds((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const expandAll = () => {
    const all: Record<string, boolean> = {};
    participants.forEach((p) => (all[p.id] = true));
    setExpandedIds(all);
  };

  const collapseAll = () => {
    setExpandedIds({});
  };

  const copyTranscript = (id: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2500);
  };

  // Filter participants based on search query or sentiment
  const filteredParticipants = participants.filter((p) => {
    const pName = p.persona?.name || '';
    const pMajor = p.persona?.major || '';
    const pSchool = p.persona?.school_or_field || '';
    const pOcc = p.persona?.occupation || '';
    const query = searchQuery.toLowerCase();

    const matchesSearch =
      searchQuery.trim() === '' ||
      pName.toLowerCase().includes(query) ||
      pMajor.toLowerCase().includes(query) ||
      pSchool.toLowerCase().includes(query) ||
      pOcc.toLowerCase().includes(query) ||
      p.transcript.toLowerCase().includes(query) ||
      p.responses.some((r) => r.answer_summary.toLowerCase().includes(query));

    const matchesSentiment =
      sentimentFilter === 'all' ||
      p.responses.some((r) => r.sentiment.toLowerCase() === sentimentFilter.toLowerCase());

    return matchesSearch && matchesSentiment;
  });

  const renderSentimentBadge = (sentiment: SentimentType) => {
    switch (sentiment.toLowerCase()) {
      case 'positive':
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800/60">
            Positive
          </span>
        );
      case 'negative':
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-300 border border-rose-200 dark:border-rose-800/60">
            Negative
          </span>
        );
      case 'mixed':
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300 border border-amber-200 dark:border-amber-800/60">
            Mixed
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
            Neutral
          </span>
        );
    }
  };

  return (
    <div id="results-view" className="space-y-4">
      {/* Search & Filter Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 p-3 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs">
        <div className="flex flex-wrap items-center gap-3 flex-1 min-w-[260px]">
          {/* Search Box */}
          <div className="relative flex-1 min-w-[200px]">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Search by student name, major, school, or transcript keywords..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-3.5 py-1.5 rounded-xl text-xs bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          {/* Sentiment Filter */}
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-slate-500 dark:text-slate-400">Sentiment:</span>
            <select
              value={sentimentFilter}
              onChange={(e) => setSentimentFilter(e.target.value)}
              className="text-xs rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 py-1.5 px-2.5 focus:outline-none focus:ring-2 focus:ring-indigo-500 cursor-pointer"
            >
              <option value="all">All Sentiments</option>
              <option value="positive">Positive</option>
              <option value="mixed">Mixed</option>
              <option value="negative">Negative</option>
              <option value="neutral">Neutral</option>
            </select>
          </div>
        </div>

        <div className="flex items-center gap-2 text-xs">
          <button
            onClick={expandAll}
            className="px-2.5 py-1 rounded-lg text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 font-medium transition-colors cursor-pointer"
          >
            Expand All
          </button>
          <span className="text-slate-300 dark:text-slate-700">|</span>
          <button
            onClick={collapseAll}
            className="px-2.5 py-1 rounded-lg text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 font-medium transition-colors cursor-pointer"
          >
            Collapse All
          </button>
        </div>
      </div>

      {/* Participant Cards */}
      <div className="space-y-4">
        {filteredParticipants.map((p, idx) => {
          const isExpanded = !!expandedIds[p.id];
          const activeTab = activeTabs[p.id] || 'transcript';

          // Compute average rating
          const validRatings = p.responses.map((r) => r.rating_1_to_5).filter((n) => typeof n === 'number' && n > 0);
          const avgRating =
            validRatings.length > 0
              ? (validRatings.reduce((a, b) => a + b, 0) / validRatings.length).toFixed(1)
              : null;

          // Initials
          const initials = p.persona.name
            .split(' ')
            .map((n) => n[0])
            .join('')
            .slice(0, 2)
            .toUpperCase();

          const academicYear = p.persona.academic_year || 'Undergraduate';
          const schoolOrField = p.persona.school_or_field || 'CAS';
          const major = p.persona.major || p.persona.occupation || 'Student';
          const topicFamiliarity = p.persona.topic_familiarity || 'Moderate';
          const usageIntensity = p.persona.usage_intensity || 'Regular';
          const isPossibleOverlap = p.source_overlap_status === 'possible_overlap';

          return (
            <div
              key={p.id}
              id={`participant-card-${p.id}`}
              className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden transition-all"
            >
              {/* Card Header (Clickable) */}
              <div
                onClick={() => toggleExpand(p.id)}
                className="p-4 sm:p-5 flex flex-wrap items-center justify-between gap-4 cursor-pointer hover:bg-slate-50/70 dark:hover:bg-slate-800/50 transition-colors select-none"
              >
                <div className="flex items-start sm:items-center gap-3.5 min-w-0 flex-1">
                  {/* Initials Avatar */}
                  <div
                    className="w-12 h-12 rounded-xl text-white flex items-center justify-center font-bold text-sm shadow-sm shrink-0 mt-0.5 sm:mt-0"
                    style={{
                      background: `linear-gradient(135deg, var(--theme-gradient-from, #6366f1), var(--theme-gradient-to, #4f46e5))`,
                    }}
                  >
                    {initials}
                  </div>

                  <div className="min-w-0 flex-1">
                    {/* Top Row: Name, Year, School, Major */}
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-base font-bold text-slate-900 dark:text-white">
                        {p.persona.name}
                      </h3>
                      <span className="text-xs text-slate-500 dark:text-slate-400 font-medium">
                        ({p.persona.age} yrs)
                      </span>
                      <span className="text-[11px] font-semibold px-2 py-0.5 rounded-md bg-indigo-50 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800">
                        {academicYear} • {schoolOrField}
                      </span>
                      <span className="text-[11px] font-medium px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
                        {major}
                      </span>
                      <span className="text-[11px] font-semibold px-2 py-0.5 rounded-md theme-badge border">
                        Participant #{p.participantIndex || idx + 1}
                      </span>
                      {p.generation_metadata && (
                        <span
                          className={`text-[10px] font-medium px-2 py-0.5 rounded-md border ${
                            p.generation_metadata.fallback_used
                              ? 'bg-amber-50 dark:bg-amber-950/50 text-amber-800 dark:text-amber-300 border-amber-300 dark:border-amber-700'
                              : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-700'
                          }`}
                          title={
                            p.generation_metadata.fallback_used
                              ? `Model fallback: generated by ${p.generation_metadata.actual_model} after ${p.generation_metadata.retry_count || 1} retry attempt(s)`
                              : `Generated with primary model: ${p.generation_metadata.actual_model}`
                          }
                        >
                          {p.generation_metadata.fallback_used
                            ? `Fallback: ${p.generation_metadata.actual_model}`
                            : p.generation_metadata.actual_model || 'model'}
                        </span>
                      )}
                    </div>

                    {/* Meta Row: Topic Familiarity & Usage Intensity */}
                    <div className="flex flex-wrap items-center gap-3 mt-1.5 text-xs text-slate-500 dark:text-slate-400">
                      <span className="inline-flex items-center gap-1">
                        <BookOpen className="w-3.5 h-3.5 text-slate-400" />
                        <span>Familiarity: <strong className="text-slate-700 dark:text-slate-300 font-semibold">{topicFamiliarity}</strong></span>
                      </span>
                      <span>•</span>
                      <span className="inline-flex items-center gap-1">
                        <Compass className="w-3.5 h-3.5 text-slate-400" />
                        <span>Usage: <strong className="text-slate-700 dark:text-slate-300 font-semibold">{usageIntensity}</strong></span>
                      </span>
                    </div>

                    {/* 1-sentence background teaser */}
                    <p className="text-xs text-slate-600 dark:text-slate-300 mt-1.5 line-clamp-1 max-w-2xl leading-relaxed">
                      {p.persona.background}
                    </p>
                  </div>
                </div>

                {/* Right badges & toggle */}
                <div className="flex items-center gap-2.5 shrink-0">
                  {/* Source Overlap Status Badge */}
                  {isPossibleOverlap ? (
                    <div
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-amber-50 dark:bg-amber-950/60 border border-amber-300 dark:border-amber-800 text-[11px] font-semibold text-amber-800 dark:text-amber-300"
                      title="Source overlap check flagged potential phrasing similarity"
                    >
                      <AlertTriangle className="w-3 h-3 text-amber-600 dark:text-amber-400" />
                      <span>Possible source imitation</span>
                    </div>
                  ) : (
                    <div
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200/80 dark:border-emerald-800/50 text-[11px] font-semibold text-emerald-700 dark:text-emerald-300"
                      title="Post-generation validation confirmed original participant dialogue without copying distinctive quotes or anecdotes"
                    >
                      <ShieldCheck className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />
                      <span>No unusual overlap detected</span>
                    </div>
                  )}

                  {avgRating && (
                    <div className="hidden sm:flex items-center gap-1.5 px-3 py-1 rounded-lg bg-amber-50 dark:bg-amber-950/40 border border-amber-200/80 dark:border-amber-800/50 text-xs font-semibold text-amber-800 dark:text-amber-200">
                      <Star className="w-3.5 h-3.5 fill-amber-400 text-amber-400" />
                      <span>Avg Score: {avgRating}/5</span>
                    </div>
                  )}

                  <div className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200">
                    {isExpanded ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
                  </div>
                </div>
              </div>

              {/* Card Body (Expanded) */}
              {isExpanded && (
                <div className="border-t border-slate-100 dark:border-slate-800 p-4 sm:p-6 bg-slate-50/40 dark:bg-slate-950/40">
                  {/* Detailed Persona Traits Banner */}
                  <div className="mb-4 p-3.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-xs space-y-2">
                    <div className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-indigo-600 dark:text-indigo-400">
                      <GraduationCap className="w-3.5 h-3.5" />
                      <span>Participant Persona Profile</span>
                    </div>
                    <p className="text-slate-700 dark:text-slate-300 leading-relaxed">
                      {p.persona.background}
                    </p>
                    {(p.persona.behavioral_pattern || p.persona.attitude_baseline) && (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1 border-t border-slate-100 dark:border-slate-800 text-[11px] text-slate-600 dark:text-slate-400">
                        {p.persona.behavioral_pattern && (
                          <div>
                            <strong className="text-slate-800 dark:text-slate-200">Behavioral Pattern:</strong> {p.persona.behavioral_pattern}
                          </div>
                        )}
                        {p.persona.attitude_baseline && (
                          <div>
                            <strong className="text-slate-800 dark:text-slate-200">Attitude Baseline:</strong> {p.persona.attitude_baseline}
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Grounded In Row */}
                  <div
                    id={`grounding-sources-${p.id}`}
                    className="mb-5 p-3 rounded-xl bg-slate-100/80 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/80 flex flex-wrap items-start gap-2"
                  >
                    <div className="flex items-center gap-1.5 text-xs font-bold text-slate-700 dark:text-slate-300 shrink-0 mt-0.5">
                      <Sparkles className="w-3.5 h-3.5 text-indigo-500" />
                      <span>Grounded in:</span>
                    </div>
                    <div className="flex flex-wrap gap-1.5 flex-1">
                      {p.grounding_sources && p.grounding_sources.length > 0 ? (
                        p.grounding_sources.map((source, sIdx) => (
                          <span
                            key={sIdx}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 border border-slate-200 dark:border-slate-700 shadow-xs"
                            title={source}
                          >
                            <ExternalLink className="w-3 h-3 text-indigo-500 shrink-0" />
                            <span className="truncate max-w-xs">{source}</span>
                          </span>
                        ))
                      ) : (
                        <span className="text-xs text-slate-500">Retrieved excerpts from uploaded documents</span>
                      )}
                    </div>
                  </div>

                  {/* Tabs: Full Transcript vs Structured Table */}
                  <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
                    <div className="inline-flex p-1 rounded-xl bg-slate-200/80 dark:bg-slate-800 border border-slate-300 dark:border-slate-700">
                      <button
                        onClick={() => setActiveTabs((prev) => ({ ...prev, [p.id]: 'transcript' }))}
                        className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                          activeTab === 'transcript'
                            ? 'bg-white dark:bg-slate-900 theme-text-primary shadow-xs'
                            : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                        }`}
                      >
                        <MessageSquare className="w-3.5 h-3.5" />
                        <span>Full Transcript</span>
                      </button>

                      <button
                        onClick={() => setActiveTabs((prev) => ({ ...prev, [p.id]: 'table' }))}
                        className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                          activeTab === 'table'
                            ? 'bg-white dark:bg-slate-900 theme-text-primary shadow-xs'
                            : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                        }`}
                      >
                        <TableIcon className="w-3.5 h-3.5" />
                        <span>Structured Responses ({p.responses.length})</span>
                      </button>
                    </div>

                    <button
                      onClick={() => copyTranscript(p.id, p.transcript)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-200/70 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-700 transition-colors cursor-pointer"
                      title="Copy full verbatim transcript"
                    >
                      {copiedId === p.id ? (
                        <>
                          <Check className="w-3.5 h-3.5 text-emerald-500" />
                          <span className="text-emerald-600 dark:text-emerald-400 font-semibold">Copied!</span>
                        </>
                      ) : (
                        <>
                          <Copy className="w-3.5 h-3.5" />
                          <span>Copy Transcript</span>
                        </>
                      )}
                    </button>
                  </div>

                  {/* Tab 1: Full Transcript */}
                  {activeTab === 'transcript' && (
                    <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-4 sm:p-5 space-y-3 font-sans text-sm leading-relaxed">
                      {p.transcript
                        .split('\n')
                        .filter((line) => line.trim().length > 0)
                        .map((line, lIdx) => {
                          const trimmed = line.trim();
                          const isSectionHeader = trimmed.startsWith('[') && trimmed.endsWith(']');

                          if (isSectionHeader) {
                            return (
                              <div
                                key={lIdx}
                                className="pt-3 pb-1 flex items-center gap-2 border-b border-slate-200 dark:border-slate-800 text-xs font-bold theme-text-primary uppercase tracking-wider"
                              >
                                <span className="w-2 h-2 rounded-full" style={{ backgroundColor: 'var(--theme-brand)' }} />
                                <span>{trimmed.slice(1, -1)}</span>
                              </div>
                            );
                          }

                          const isModerator = trimmed.toLowerCase().startsWith('moderator:');
                          const isParticipant =
                            trimmed.toLowerCase().startsWith(`${p.persona.name.toLowerCase()}:`) ||
                            trimmed.toLowerCase().startsWith('participant:') ||
                            /^[A-Z][a-z]+(\s[A-Z][a-z]+)?:/.test(trimmed);

                          return (
                            <div
                              key={lIdx}
                              className={`p-3 rounded-xl border ${
                                isModerator
                                  ? 'theme-bg-tint theme-border-tint text-slate-800 dark:text-slate-200'
                                  : isParticipant
                                  ? 'bg-slate-50/80 dark:bg-slate-800/50 border-slate-200 dark:border-slate-700 text-slate-900 dark:text-slate-100'
                                  : 'bg-transparent border-transparent text-slate-700 dark:text-slate-300'
                              }`}
                            >
                              <div className="flex items-baseline gap-2">
                                <span
                                  className={`text-xs font-bold uppercase tracking-wider shrink-0 ${
                                    isModerator
                                      ? 'theme-text-primary'
                                      : 'text-slate-700 dark:text-slate-300'
                                  }`}
                                >
                                  {isModerator
                                    ? 'Moderator'
                                    : trimmed.split(':')[0]}
                                  :
                                </span>
                                <span className="flex-1 text-xs sm:text-sm">
                                  {trimmed.includes(':')
                                    ? trimmed.slice(trimmed.indexOf(':') + 1).trim()
                                    : trimmed}
                                </span>
                              </div>
                            </div>
                          );
                        })}
                    </div>
                  )}

                  {/* Tab 2: Structured Responses Table */}
                  {activeTab === 'table' && (
                    <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
                      <table className="w-full text-left border-collapse text-xs">
                        <thead>
                          <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 text-slate-700 dark:text-slate-300 font-semibold">
                            <th className="p-3 w-12 text-center">#</th>
                            <th className="p-3 w-1/3">Discussion Guide Question</th>
                            <th className="p-3 w-5/12">Participant Synthesis & Quotes</th>
                            <th className="p-3 w-28 text-center">Sentiment</th>
                            <th className="p-3 w-20 text-center">Rating</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
                          {p.responses.map((resp, rIdx) => (
                            <tr key={rIdx} className="hover:bg-slate-50/60 dark:hover:bg-slate-800/30 transition-colors">
                              <td className="p-3 text-center font-bold text-slate-400">
                                {rIdx + 1}
                              </td>
                              <td className="p-3 font-medium text-slate-900 dark:text-slate-100">
                                {resp.question}
                              </td>
                              <td className="p-3 text-slate-600 dark:text-slate-300 leading-relaxed">
                                {resp.answer_summary}
                              </td>
                              <td className="p-3 text-center">
                                {renderSentimentBadge(resp.sentiment)}
                              </td>
                              <td className="p-3 text-center">
                                <span className="font-bold text-slate-800 dark:text-slate-200">
                                  {resp.rating_1_to_5}
                                </span>
                                <span className="text-slate-400 text-[10px]">/5</span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}

        {filteredParticipants.length === 0 && (
          <div className="p-8 text-center rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-xs text-slate-500">
            No participant transcripts matched your search query or sentiment filter.
          </div>
        )}
      </div>
    </div>
  );
}
