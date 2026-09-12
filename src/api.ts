/** Tiny fetch wrapper that attaches the optional access passcode and surfaces 401s and non-JSON errors. */

const PASSCODE_KEY = 'synthetic_transcripts_passcode';

export class PasscodeRequiredError extends Error {
  constructor() {
    super('Passcode required');
    this.name = 'PasscodeRequiredError';
  }
}

export function getPasscode(): string | null {
  try {
    return localStorage.getItem(PASSCODE_KEY);
  } catch {
    return null;
  }
}

export function setPasscode(code: string) {
  try {
    if (code) localStorage.setItem(PASSCODE_KEY, code);
    else localStorage.removeItem(PASSCODE_KEY);
  } catch {}
}

export async function apiFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers || {});
  const code = getPasscode();
  if (code) headers.set('x-app-passcode', code);
  const res = await fetch(input, { ...init, headers });
  if (res.status === 401) {
    let body: any = null;
    try {
      body = await res.clone().json();
    } catch {}
    if (body?.passcodeRequired) throw new PasscodeRequiredError();
  }
  return res;
}

/**
 * Parse a JSON response, but if the server (or the hosting platform) returned HTML/plain text —
 * e.g. a Vercel FUNCTION_INVOCATION_FAILED page — throw an error that says so instead of the
 * browser's cryptic "The string did not match the expected pattern".
 */
export async function readJson<T = any>(res: Response): Promise<T> {
  const text = await res.text();
  try {
    return JSON.parse(text) as T;
  } catch {
    const snippet = text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 160);
    throw new Error(
      `The server returned HTTP ${res.status} with a non-JSON response${snippet ? `: "${snippet}"` : ''}. ` +
        `Check the Vercel function logs (Deployments → Functions) for the underlying error.`
    );
  }
}
