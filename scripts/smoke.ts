/** Offline unit smoke test: redaction, anti-copy detection, guide parsing, schema coercion. Run: npm run test:smoke */
import { redactText } from '../server/retrieval';
import { checkSourceOverlap, parseGuideIntoSections, questionLines } from '../server/generation';
import { coerceToSchema, validateAgainstSchema, extractJson } from '../server/llm';

let failures = 0;
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
};

// 1. Redaction
const r = redactText('Participant 7 (P7) said: email jo@nyu.edu, call 212-555-0199, N12345678, see https://x.y/z. J. Alvarez agreed.', ['Alvarez']);
check('redacts email', !r.includes('jo@nyu.edu'), r);
check('redacts phone', !r.includes('212-555-0199'));
check('redacts N-number', !r.includes('N12345678'));
check('redacts participant codes', !/P7|Participant 7/.test(r));
check('redacts configured names', !r.includes('Alvarez'));

// 2. Anti-copy
const corpus = ['Kimmel dining pickup line took 25 minutes between classes. App claimed food was ready 10 mins before it was.'];
const copied = 'Moderator: What happened?\nAva: The Kimmel dining pickup line took 25 minutes between classes, honestly.';
const original = 'Moderator: What happened?\nAva: I waited ages at the Palladium counter because the order status never updated.';
check('flags verbatim 7-gram copy', checkSourceOverlap(copied, corpus, []).status === 'possible_overlap');
check('clears original wording', checkSourceOverlap(original, corpus, []).status === 'clear');
check('flags distinctive span reuse', checkSourceOverlap('She compared it to Captain Underpants Deluxe.', [], ['Captain Underpants Deluxe']).status === 'possible_overlap');

// 3. Guide parsing
const secs = parseGuideIntoSections('Section 1: Warm-up\n1. What apps do you open first?\nProbe: why?\nSection 2: Friction\n2. Describe a recent delay.\n3. How did you resolve it?');
check('parses two sections', secs.length === 2, JSON.stringify(secs.map((s) => s.section_id)));
check('question lines drop probes', questionLines(secs[0]).length === 1, JSON.stringify(questionLines(secs[0])));

// 4. Schema coercion
const schema = { type: 'object', properties: { age: { type: 'integer' }, mood: { type: 'string', enum: ['Low', 'High'] } }, required: ['age', 'mood'] };
const fixed = coerceToSchema(extractJson('```json\n{"age":"21","mood":"high"}\n```'), schema);
check('coerces numeric string + enum casing', validateAgainstSchema(fixed, schema).length === 0, JSON.stringify(fixed));

console.log(failures === 0 ? '\nALL SMOKE CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
