/**
 * server/app.ts — Express HTTP layer for the Synthetic Discussion-Guide Transcript Generator.
 *
 * Runs unchanged on: Vercel (auto-detected Node server), a plain VM (`npm run build && npm start`),
 * or locally (`npm run dev`). No Gemini / Google dependency.
 *
 *   storage   → server/storage.ts    (Vercel Blob or local FS: raw files + per-session JSON)
 *   retrieval → server/retrieval.ts  (parse, chunk, embed, hybrid search, redaction policy)
 *   llm       → server/llm.ts        (Cerebras → Groq → Cloudflare, one adapter)
 *   pipeline  → server/generation.ts (persona + per-section generation, anti-copy)
 */
import express, { NextFunction, Request, Response } from 'express';
import path from 'path';
import fs from 'fs';
import multer from 'multer';
import dotenv from 'dotenv';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

import { storage, keys, readJson, writeJson, clientUploadsEnabled } from './storage';
import {
  ingestFile,
  removeFileFromIndex,
  clearIndex,
  indexStats,
  parseFile,
  externalDataPolicy,
  embeddingsEnabled,
  SourceRole,
} from './retrieval';
import { availableProviders, configuredProviders, logicalModel } from './llm';
import {
  parseGuideIntoSections,
  samplePersonaSpec,
  generateParticipant,
  buildEvidenceProfile,
  extractGuideLocally,
  extractGuideWithModel,
} from './generation';

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT || 3000);
const IS_VERCEL = Boolean(process.env.VERCEL);

app.use(express.json({ limit: '4mb' }));
app.use(express.urlencoded({ extended: true, limit: '4mb' }));

// Multer keeps small uploads in memory (Vercel caps request bodies at 4.5 MB; larger files go
// browser → Blob directly via /api/store/upload-token, then /api/store/ingest).
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 100 * 1024 * 1024 } });

// ----------------------------------------------------------------------------
// Optional passcode gate for the public URL (set APP_PASSCODE to enable)
// ----------------------------------------------------------------------------
function passcodeGate(req: Request, res: Response, next: NextFunction) {
  const required = process.env.APP_PASSCODE;
  if (!required) return next();
  if (req.path === '/api/health') return next();
  const provided = (req.headers['x-app-passcode'] as string) || (req.query.passcode as string) || '';
  if (provided === required) return next();
  return res.status(401).json({ error: 'Passcode required.', passcodeRequired: true });
}
app.use(passcodeGate);

// ----------------------------------------------------------------------------
// Session state (JSON in storage, cached in memory while the instance is warm)
// ----------------------------------------------------------------------------
interface SessionFileRecord {
  id: string;
  name: string;
  size: number;
  category: 'dataset' | 'document';
  sourceRole?: SourceRole;
  mimeType: string;
  rawKey?: string;
  chunks?: number;
  uploadedAt: string;
  status: 'processing' | 'indexed' | 'error';
  errorMessage?: string;
}

interface SessionState {
  id: string;
  storeName: string;
  displayName: string;
  files: SessionFileRecord[];
  evidenceProfile?: any;
  createdAt: string;
}

const sessionCache = new Map<string, SessionState>();

async function loadSession(sessionId: string): Promise<SessionState | null> {
  if (sessionCache.has(sessionId)) return sessionCache.get(sessionId)!;
  const s = await readJson<SessionState>(keys.session(sessionId));
  if (s) sessionCache.set(sessionId, s);
  return s;
}

async function getOrCreateSession(sessionId: string): Promise<SessionState> {
  const existing = await loadSession(sessionId);
  if (existing) return existing;
  const cleanId = sessionId.replace(/[^a-zA-Z0-9]/g, '').toLowerCase().slice(0, 16);
  const s: SessionState = {
    id: sessionId,
    storeName: `local:${cleanId || Date.now()}`,
    displayName: `transcripts-session-${cleanId || Date.now()}`,
    files: [],
    createdAt: new Date().toISOString(),
  };
  await saveSession(s);
  return s;
}

async function saveSession(s: SessionState) {
  sessionCache.set(s.id, s);
  await writeJson(keys.session(s.id), s);
}

const DATASET_EXTS = ['.csv', '.xlsx', '.xls', '.json'];
const DOC_EXTS = ['.pdf', '.txt'];

function mimeFor(ext: string) {
  return ext === '.pdf'
    ? 'application/pdf'
    : ext === '.csv'
    ? 'text/csv'
    : ext === '.json'
    ? 'application/json'
    : ext === '.xlsx' || ext === '.xls'
    ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    : 'text/plain';
}

/** Store raw bytes + parse/chunk/embed into the session index. */
async function addFileToSession(
  session: SessionState,
  originalName: string,
  buf: Buffer,
  category: 'dataset' | 'document',
  sourceRole: SourceRole
): Promise<SessionFileRecord> {
  const ext = path.extname(originalName).toLowerCase();
  const id = 'file-' + Date.now() + '-' + Math.random().toString(36).substring(2, 7);
  const rawKey = keys.raw(session.id, id, originalName);
  await storage().putBytes(rawKey, buf, mimeFor(ext));

  const record: SessionFileRecord = {
    id,
    name: originalName,
    size: buf.length,
    category,
    sourceRole,
    mimeType: mimeFor(ext),
    rawKey,
    uploadedAt: new Date().toISOString(),
    status: 'processing',
  };
  try {
    const r = await ingestFile(session.id, id, originalName, sourceRole, buf);
    record.status = 'indexed';
    record.chunks = r.chunks;
    console.log(`[ingest] ${originalName}: ${r.units} units → ${r.chunks} chunks (${r.kind}, embedded=${r.embedded}) in ${r.ms}ms`);
  } catch (e: any) {
    record.status = 'error';
    record.errorMessage = e?.message || String(e);
    console.error('[ingest] failed:', record.errorMessage);
  }
  session.files.push(record);
  session.evidenceProfile = undefined;
  await saveSession(session);
  return record;
}

// ----------------------------------------------------------------------------
// API routes
// ----------------------------------------------------------------------------

app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    time: new Date().toISOString(),
    passcodeRequired: Boolean(process.env.APP_PASSCODE),
    clientUploads: clientUploadsEnabled(),
    externalDataPolicy: externalDataPolicy(),
    embeddings: embeddingsEnabled(),
    providers: { configured: configuredProviders(), available: availableProviders() },
    models: { generation: logicalModel('generation'), utility: logicalModel('utility') },
    storage: storage().kind,
  });
});

app.get('/api/store/status', async (req: Request, res: Response) => {
  const sessionId = (req.query.sessionId as string) || 'default-session';
  try {
    const session = await loadSession(sessionId);
    if (!session) return res.json({ exists: false, files: [], activeDocumentsCount: 0 });
    const stats = await indexStats(sessionId);
    res.json({
      exists: true,
      storeName: session.storeName,
      displayName: session.displayName,
      files: session.files,
      activeDocumentsCount: session.files.length,
      chunks: stats.chunks,
      embedModel: stats.embedModel,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to check store status' });
  }
});

/** Small-file path (≤ ~4 MB on Vercel; any size on a VM). */
app.post('/api/store/upload', upload.single('file'), async (req: Request, res: Response) => {
  try {
    const file = req.file;
    const sessionId = (req.body.sessionId as string) || 'default-session';
    const category = (req.body.category as 'dataset' | 'document') || 'dataset';
    const sourceRole = (req.body.sourceRole as SourceRole) || (category === 'document' ? 'research' : 'prior_evidence');
    if (!file) return res.status(400).json({ error: 'No file uploaded.' });

    const ext = path.extname(file.originalname).toLowerCase();
    if (category === 'dataset' && !DATASET_EXTS.includes(ext)) {
      return res.status(400).json({ error: `Invalid dataset file type (${ext}). Allowed types: CSV, XLSX, JSON.` });
    }
    if (category === 'document' && !DOC_EXTS.includes(ext)) {
      return res.status(400).json({ error: `Invalid document file type (${ext}). Allowed types: PDF, TXT.` });
    }

    const session = await getOrCreateSession(sessionId);
    const record = await addFileToSession(session, file.originalname, file.buffer, category, sourceRole);
    if (record.status === 'error') {
      return res.status(422).json({ error: `Could not read "${file.originalname}": ${record.errorMessage}`, file: record });
    }
    res.json({ success: true, file: record, storeName: session.storeName, activeDocumentsCount: session.files.length });
  } catch (err: any) {
    console.error('Upload error:', err);
    res.status(500).json({ error: err.message || 'File upload failed' });
  }
});

/** Large-file path, step 1: the browser asks for a short-lived client-upload token (Vercel Blob). */
app.post('/api/store/upload-token', async (req: Request, res: Response) => {
  if (!clientUploadsEnabled()) return res.status(400).json({ error: 'Direct uploads are not enabled on this deployment.' });
  try {
    const { handleUpload } = await import('@vercel/blob/client');
    const body = req.body;
    const json = await handleUpload({
      body,
      request: req as any,
      onBeforeGenerateToken: async (pathname: string) => {
        if (!pathname.startsWith('sessions/') || !pathname.includes('/incoming/')) {
          throw new Error('Invalid upload path.');
        }
        return {
          allowedContentTypes: [
            'application/pdf',
            'text/plain',
            'text/csv',
            'application/json',
            'application/vnd.ms-excel',
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'application/octet-stream',
          ],
          maximumSizeInBytes: 100 * 1024 * 1024,
          addRandomSuffix: false,
          allowOverwrite: true,
          tokenPayload: JSON.stringify({}),
        } as any;
      },
      onUploadCompleted: async () => {
        /* ingestion is triggered explicitly by the browser via /api/store/ingest */
      },
    } as any);
    res.json(json);
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Upload token error' });
  }
});

/** Large-file path, step 2: move the uploaded blob into the session and index it. */
app.post('/api/store/ingest', async (req: Request, res: Response) => {
  try {
    const { sessionId = 'default-session', pathname, originalName, category = 'dataset', sourceRole } = req.body || {};
    if (!pathname || !originalName) return res.status(400).json({ error: 'pathname and originalName are required.' });
    const expectedPrefix = keys.sessionPrefix(sessionId) + 'incoming/';
    if (!String(pathname).startsWith(expectedPrefix)) return res.status(400).json({ error: 'Upload path does not belong to this session.' });

    const buf = await storage().getBytes(pathname);
    if (!buf) return res.status(404).json({ error: 'Uploaded file not found. Please retry the upload.' });

    const session = await getOrCreateSession(sessionId);
    const role: SourceRole = sourceRole || (category === 'document' ? 'research' : 'prior_evidence');
    const record = await addFileToSession(session, originalName, buf, category, role);
    await storage().del(pathname);
    if (record.status === 'error') {
      return res.status(422).json({ error: `Could not read "${originalName}": ${record.errorMessage}`, file: record });
    }
    res.json({ success: true, file: record, storeName: session.storeName, activeDocumentsCount: session.files.length });
  } catch (err: any) {
    console.error('Ingest error:', err);
    res.status(500).json({ error: err.message || 'Ingest failed' });
  }
});

/** Client asks where to put a large upload (keeps key layout server-controlled). */
app.post('/api/store/upload-path', (req: Request, res: Response) => {
  const { sessionId = 'default-session', filename = 'upload.bin' } = req.body || {};
  res.json({ pathname: keys.incoming(sessionId, filename) });
});

// ----------------------------------------------------------------------------
// Sample data (synthetic — safe to send to any provider)
// ----------------------------------------------------------------------------
async function createSampleResearchPdf(): Promise<Buffer> {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([595, 842]);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const fontRegular = await pdfDoc.embedFont(StandardFonts.Helvetica);
  page.drawText('UNDERGRADUATE QUALITATIVE RESEARCH PROTOCOL & STUDY BRIEF', { x: 45, y: 795, size: 13, font: fontBold, color: rgb(0.12, 0.16, 0.28) });
  page.drawText('Study Topic: NYU Undergraduate Campus Mobile Tools, Dining UX & Study Habits', { x: 45, y: 778, size: 9, font: fontRegular, color: rgb(0.35, 0.4, 0.5) });
  const lines = [
    'EXECUTIVE SUMMARY & STUDY OBJECTIVES:',
    'This qualitative research investigation explores student digital routines, cognitive load,',
    'campus dining service friction, and academic mobile tools across undergraduate schools',
    '(including CAS, Stern, Tandon, Tisch, Steinhardt, and Gallatin).',
    '',
    'NOTABLE FIELD BENCHMARKS & EMPIRICAL EVIDENCE:',
    '- 72% of students report mobile dining app order pickup delays during peak noon lunch hours.',
    '- Transit between Brooklyn (Tandon) and Manhattan (Washington Sq) causes fragmented study schedules.',
    '- Students heavily rely on class group chats (Discord, GroupMe) over official university portals.',
    '- Automated study timers and noise cancellations are popular for deep focus sessions at Bobst Library.',
    '',
    'MODERATOR DISCUSSION GUIDE QUESTIONS:',
    'Section 1: Warm-up & Daily Campus Routines',
    '1. Walk me through a typical weekday at NYU. How do you plan your transit, class schedule, and study spots?',
    '2. Which digital apps or campus tools (e.g., Brightspace, NYU Mobile, campus dining) do you open first, and why?',
    '',
    'Section 2: Digital Friction & Dining Experience',
    '3. Think back to a recent moment when a campus mobile tool or ordering process caused you frustration or delay. What happened, and how did you resolve it?',
    '4. How do you manage dining dollars, meal plans, or off-campus food spending between classes?',
    '',
    'Section 3: Projective Exercise & Future Wishlist',
    '5. Projective exercise: If your campus digital services were a person or fictional character, how would you describe their personality and dependability?',
    '6. On a scale of 1 to 5, how satisfied are you with the overall mobile digital experience on campus, and what is the #1 improvement you would request?',
    '',
    'INTERVIEW PROBES & DEPTH GUIDANCE:',
    '- Probe deeply into differences between freshman dorm life and senior off-campus apartment routines.',
    '- For question 5, ensure participant invents an authentic metaphor without repeating stock examples.',
  ];
  let y = 745;
  for (const line of lines) {
    const isHeading = /^(EXECUTIVE|NOTABLE|MODERATOR|Section|INTERVIEW)/.test(line);
    page.drawText(line, { x: 45, y, size: isHeading ? 9.5 : 8, font: isHeading ? fontBold : fontRegular, color: isHeading ? rgb(0.12, 0.2, 0.4) : rgb(0.2, 0.22, 0.26) });
    y -= line === '' ? 10 : 16;
  }
  return Buffer.from(await pdfDoc.save());
}

const SAMPLE_CSV = `participant_code,academic_year,school,major,topic_familiarity,quote_theme,feedback_summary,sentiment
p201,Junior,Stern,Finance & Computing,High,Grubhub Dining Delays,"Kimmel dining pickup line took 25 minutes between classes. App claimed food was ready 10 mins before it was.",negative
p202,First-year,CAS,Biology,Moderate,Albert Course Registration,"Registering for chem lab on Albert at 8:00 AM crashed twice. Had to use my phone hotspot to secure a seat.",negative
p203,Senior,Tisch,Film & TV,High,Bobst Study Rooms,"Booking quiet editing suites through the library portal is great, but calendar sync with Google Cal is glitchy.",mixed
p204,Sophomore,Tandon,Computer Science,High,Campus Transit & Brightspace,"Commuting from Brooklyn to Washington Sq on the subway means offline lecture downloads on Brightspace are vital.",positive
p205,Junior,Steinhardt,Media & Culture,Moderate,Campus Notifications,"Push notifications from NYU Safe and campus announcements are way too frequent. I mute all alerts.",mixed
p206,First-year,Gallatin,Individualized Study,Low,Dining Dollars Balance,"Finding which local deli takes Campus Cash versus dining dollars is totally confusing for freshmen.",negative
p207,Senior,CAS,Economics,High,Discord Class Channels,"Official discussion forums feel dead; everyone uses student-run Discord channels for problem set questions.",positive
p208,Sophomore,Stern,Marketing,High,Campus Gym Booking,"The 404 Fitness reservation tool fills up within 30 seconds every Sunday midnight. Extremely stressful.",negative
p209,Junior,Tandon,Mechanical Engineering,Moderate,NYU Mobile App Navigation,"The campus map on NYU Mobile is decent for finding building numbers, but elevator status isn't tracked.",positive
p210,Senior,Steinhardt,Applied Psychology,High,Study Focus & Wellness,"I use noise-cancelling headphones and forest timer apps to block out city street noise while studying.",positive`;

const DEFAULT_GUIDE = `Section 1: Warm-up & Daily Campus Routines
1. Walk me through a typical weekday at NYU. How do you plan your transit, class schedule, and study spots?
2. Which digital apps or campus tools (e.g., Brightspace, NYU Mobile, campus dining) do you open first, and why?

Section 2: Digital Friction & Dining Experience
3. Think back to a recent moment when a campus mobile tool or ordering process caused you frustration or delay. What happened, and how did you resolve it?
4. How do you manage dining dollars, meal plans, or off-campus food spending between classes?

Section 3: Projective Exercise & Future Wishlist
5. Projective exercise: If your campus digital services were a person or fictional character, how would you describe their personality and dependability?
6. On a scale of 1 to 5, how satisfied are you with the overall mobile digital experience on campus, and what is the #1 improvement you would request?`;

app.post('/api/store/sample', async (req: Request, res: Response) => {
  try {
    const sessionId = (req.body.sessionId as string) || 'default-session';
    const session = await getOrCreateSession(sessionId);
    const f1 = await addFileToSession(session, 'nyu_campus_survey_evidence.csv', Buffer.from(SAMPLE_CSV, 'utf8'), 'dataset', 'prior_evidence');
    const f2 = await addFileToSession(session, 'nyu_campus_digital_experience_research_brief.pdf', await createSampleResearchPdf(), 'document', 'guide');
    res.json({ success: true, files: [f1, f2], activeDocumentsCount: session.files.length, sampleDiscussionGuide: DEFAULT_GUIDE });
  } catch (err: any) {
    console.error('Sample loading error:', err);
    res.status(500).json({ error: err.message || 'Failed to load sample dataset' });
  }
});

app.delete('/api/store/clear', async (req: Request, res: Response) => {
  const sessionId = (req.query.sessionId as string) || 'default-session';
  try {
    const all = await storage().list(keys.sessionPrefix(sessionId));
    if (all.length) await storage().del(all);
    await clearIndex(sessionId);
    sessionCache.delete(sessionId);
    res.json({ success: true, message: 'Store and session reset successfully' });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to clear store' });
  }
});

app.delete('/api/store/file/:fileId', async (req: Request, res: Response) => {
  const sessionId = (req.query.sessionId as string) || 'default-session';
  const fileId = req.params.fileId;
  try {
    const session = await loadSession(sessionId);
    if (!session) return res.json({ success: true, files: [] });
    const f = session.files.find((x) => x.id === fileId);
    if (f?.rawKey) await storage().del(f.rawKey);
    await removeFileFromIndex(sessionId, fileId);
    session.files = session.files.filter((x) => x.id !== fileId);
    session.evidenceProfile = undefined;
    await saveSession(session);
    res.json({ success: true, files: session.files });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to remove file' });
  }
});

// ----------------------------------------------------------------------------
// Discussion guide extraction (from the uploaded document's own text)
// ----------------------------------------------------------------------------
app.post('/api/guide/extract-from-pdf', async (req: Request, res: Response) => {
  try {
    const sessionId = (req.body.sessionId as string) || 'default-session';
    const fileId = req.body.fileId as string | undefined;
    const session = await loadSession(sessionId);
    const documents = session?.files.filter((f) => f.category === 'document' || f.mimeType === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf')) || [];
    if (documents.length === 0) {
      return res.status(400).json({ error: 'No uploaded PDF reference document found. Please upload a PDF in the Reference Documents section or load the sample study first.' });
    }
    const target = fileId
      ? documents.find((d) => d.id === fileId) || documents[documents.length - 1]
      : documents.find((d) => d.sourceRole === 'guide') || documents[documents.length - 1];
    if (!target?.rawKey) return res.status(400).json({ error: 'Target document could not be located.' });

    const buf = await storage().getBytes(target.rawKey);
    if (!buf) return res.status(404).json({ error: 'Document bytes are no longer available. Please re-upload it.' });
    const parsed = await parseFile(buf, target.name);
    const text = parsed.units.map((u) => u.text).join('\n\n');
    if (!text.trim()) return res.status(400).json({ error: `"${target.name}" contains no extractable text (scanned PDF?).` });

    // The guide is study material, not participant data — but honour the policy anyway.
    let extracted = externalDataPolicy() === 'none' || availableProviders().length === 0 ? extractGuideLocally(text) : await extractGuideWithModel(text);
    if (!extracted || extracted.toUpperCase() === 'NONE' || extracted.length < 5) extracted = extractGuideLocally(text);
    if (!extracted || extracted.length < 5) {
      return res.status(400).json({ error: `No discussion guide questions or topics were found in "${target.name}".` });
    }
    res.json({ success: true, questions: extracted, documentName: target.name });
  } catch (err: any) {
    console.error('Discussion guide extraction error:', err);
    res.status(500).json({ error: err.message || 'Failed to extract discussion guide from uploaded PDF.' });
  }
});

// ----------------------------------------------------------------------------
// Generation stream (SSE). Contract unchanged; `endIndex` added so the browser can
// request one participant per HTTP call (keeps each call well under Vercel's 300 s).
// ----------------------------------------------------------------------------
async function handleGenerateStream(req: Request, res: Response) {
  const {
    sessionId = 'default-session',
    discussionGuide,
    targetAudience = 'Undergraduate students',
    academicYears = ['First-year', 'Sophomore', 'Junior', 'Senior'],
    schoolSelectionType = 'diverse',
    customSchools = '',
    additionalConstraints = '',
    personaDiversity = 'High',
    interviewDepth = 'Full Discussion Guide',
    priorityQuestions = '',
    toneStyle = 'Natural focus-group conversation',
    numParticipants = 3,
    startIndex = 1,
    endIndex,
    existingPersonas = [],
    batchSeed,
  } = req.body;

  if (!discussionGuide || typeof discussionGuide !== 'string' || !discussionGuide.trim()) {
    return res.status(400).json({ error: 'Discussion guide is required.' });
  }
  const session = await loadSession(sessionId);
  if (!session || session.files.filter((f) => f.status === 'indexed').length === 0) {
    return res.status(400).json({ error: 'Please upload at least one reference dataset or document to ground generation in your data.' });
  }
  if (availableProviders().length === 0) {
    return res.status(503).json({
      error: 'No LLM provider is configured on the server. Add CEREBRAS_API_KEY, GROQ_API_KEY or Cloudflare credentials in the environment settings.',
    });
  }

  const total = Math.max(1, Math.min(15, Number(numParticipants) || 3));
  const startFrom = Math.max(1, Math.min(total, Number(startIndex) || 1));
  const endAt = Math.max(startFrom, Math.min(total, Number(endIndex) || total));
  const sections = parseGuideIntoSections(discussionGuide);

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();
  const send = (data: any) => res.write(`data: ${JSON.stringify(data)}\n\n`);
  const keepalive = setInterval(() => res.write(`: keepalive ${Date.now()}\n\n`), 15000);
  let closed = false;
  req.on('close', () => {
    closed = true;
    clearInterval(keepalive);
  });

  send({
    type: 'init',
    total,
    startIndex: startFrom,
    storeName: session.storeName,
    message: `Generating participants ${startFrom}–${endAt} of ${total} with ${logicalModel('generation')} (${availableProviders().join(' → ')})…`,
  });

  // Evidence profile once per session (optional; skipped under policy=none)
  let evidenceProfile: any = session.evidenceProfile || null;
  if (!evidenceProfile && externalDataPolicy() !== 'none') {
    try {
      send({ type: 'progress', currentIndex: startFrom, total, statusMessage: 'Synthesizing evidence profile from reference research…' });
      evidenceProfile = await buildEvidenceProfile(sessionId, `${targetAudience} ${sections.map((s) => s.section_title).join(' ')}`);
      if (evidenceProfile) {
        session.evidenceProfile = evidenceProfile;
        await saveSession(session);
      }
    } catch (e: any) {
      console.warn('[EvidenceProfile] skipped:', e?.message || e);
    }
  }

  const defaultSchools = ['Stern', 'CAS', 'Tandon', 'Tisch', 'Steinhardt', 'Gallatin'];
  const schools = schoolSelectionType === 'custom' && String(customSchools).trim()
    ? String(customSchools).split(/[,;\n]+/).map((s: string) => s.trim()).filter(Boolean)
    : defaultSchools;
  const years = Array.isArray(academicYears) && academicYears.length > 0 ? academicYears : ['First-year', 'Sophomore', 'Junior', 'Senior'];
  const personas: any[] = Array.isArray(existingPersonas) ? [...existingPersonas] : [];
  const seed = String(batchSeed || `${sessionId}:${discussionGuide.length}:${Date.now()}`);
  const results: any[] = [];

  for (let i = startFrom; i <= endAt && !closed; i++) {
    try {
      const spec = samplePersonaSpec(i, years, schools, personaDiversity, personas, seed);
      send({ type: 'progress', currentIndex: i, total, statusMessage: `Generating participant ${i} of ${total}…` });
      const participant = await generateParticipant({
        sessionId,
        index: i,
        sections,
        targetAudience,
        additionalConstraints,
        personaDiversity,
        interviewDepth,
        priorityQuestions,
        toneStyle,
        spec,
        existingPersonas: personas,
        evidenceProfile,
        fileNames: session.files.map((f) => f.name),
        onProgress: (statusMessage, extra) => send({ type: 'progress', currentIndex: i, total, statusMessage, ...(extra || {}) }),
      });
      personas.push(participant.persona);
      results.push(participant);
      send({ type: 'participant', participant, currentIndex: i, total });
      send({ type: 'progress', currentIndex: i, total, statusMessage: `Participant ${i} complete` });
    } catch (err: any) {
      console.error(`[Participant ${i} Error]:`, err);
      const msg = String(err?.message || err);
      const friendly = /rate limit|429/i.test(msg)
        ? 'Free-tier rate limits were reached on all configured providers. Completed participants are saved — click "Resume Remaining" in a minute.'
        : /No LLM provider/i.test(msg)
        ? msg
        : /schema/i.test(msg)
        ? 'The model returned malformed output for this participant. Click "Resume Remaining" to try again.'
        : `Generation hit a temporary problem: ${msg.slice(0, 160)}`;
      send({ type: 'error_item', currentIndex: i, total, error: friendly, canRetryRemaining: true });
      break;
    }
  }

  clearInterval(keepalive);
  send({
    type: 'complete',
    totalGenerated: results.length,
    requestedTotal: total,
    endIndex: endAt,
    participants: results,
    message: `Completed ${results.length} evidence-informed participant transcript${results.length === 1 ? '' : 's'}.`,
  });
  res.end();
}

app.post('/api/transcripts/generate-stream', handleGenerateStream);
app.post('/api/generate-stream', handleGenerateStream);

// ----------------------------------------------------------------------------
// Frontend: Vite middleware in dev; static `public/` (Vite build output) otherwise.
// On Vercel the CDN serves public/** itself; this fallback only handles deep links.
// ----------------------------------------------------------------------------
async function attachFrontend() {
  if (process.env.NODE_ENV !== 'production' && !IS_VERCEL) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({ server: { middlewareMode: true }, appType: 'spa' });
    app.use(vite.middlewares);
    return;
  }
  const publicDir = path.join(process.cwd(), 'public');
  app.use(express.static(publicDir));
  app.get('*', (req, res) => {
    if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Not found' });
    const index = path.join(publicDir, 'index.html');
    if (fs.existsSync(index)) return res.sendFile(index);
    res.status(200).send('Frontend not built. Run `npm run build`.');
  });
}

// Vercel: api/index.ts re-exports `app`; the CDN serves public/**; static middleware is mounted
// synchronously so deep links still resolve. Local / VM: start.ts calls start().
if (IS_VERCEL) {
  void attachFrontend();
}

export async function start() {
  await attachFrontend();
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server listening on http://0.0.0.0:${PORT} | storage=${storage().kind} | policy=${externalDataPolicy()} | providers=${availableProviders().join(',') || 'none'}`);
  });
}

export default app;
