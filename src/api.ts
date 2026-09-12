/** Tiny fetch wrapper that attaches the optional access passcode and surfaces 401s. */

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
