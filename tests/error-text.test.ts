import { describe, it, expect } from 'vitest';
import { friendlyErrorText } from '../client/src/lib/errorText';

// Q23: toasts show the server's message, not the raw `401: {"message":...}`
// that throwIfResNotOk throws. Display only: what is thrown is unchanged.
const GENERIC = 'Something went wrong, please try again';

describe('friendlyErrorText', () => {
  it('extracts the JSON message after the status prefix', () => {
    expect(friendlyErrorText(new Error('401: {"message":"Invalid email or password"}'))).toBe('Invalid email or password');
    expect(friendlyErrorText('429: {"message":"Too many attempts, please try again in 15 minutes"}')).toBe(
      'Too many attempts, please try again in 15 minutes',
    );
  });

  it('keeps short plain text, with or without the status prefix', () => {
    expect(friendlyErrorText(new Error('500: Internal Server Error'))).toBe('Internal Server Error');
    expect(friendlyErrorText(new Error('Network request failed'))).toBe('Network request failed');
  });

  it('falls back to the generic text for garbage', () => {
    expect(friendlyErrorText('502: <html><body>Bad Gateway</body></html>')).toBe(GENERIC);
    expect(friendlyErrorText('400: {"error":"no message field"}')).toBe(GENERIC);
    expect(friendlyErrorText('400: {"message":""}')).toBe(GENERIC);
    expect(friendlyErrorText('')).toBe(GENERIC);
    expect(friendlyErrorText(undefined)).toBe(GENERIC);
    expect(friendlyErrorText({ status: 500 })).toBe(GENERIC);
    expect(friendlyErrorText('x'.repeat(500))).toBe(GENERIC);
  });

  it('uses the caller-supplied fallback', () => {
    expect(friendlyErrorText(null, 'Invalid email or password')).toBe('Invalid email or password');
  });
});
