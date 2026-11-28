import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { apiRequest, API_TIMEOUT_MESSAGE } from '../client/src/lib/queryClient';

// Q190: apiRequest gives up after 30 s (or options.timeoutMs) even if the
// fetch never answers and ignores its signal (as iOS CapacitorHttp may).
// Unit test, no DB: fetch is stubbed and the clock is fake.

type Settled = { state: 'pending' } | { state: 'resolved'; value: unknown } | { state: 'rejected'; error: any };

function track(p: Promise<unknown>) {
  const out: { s: Settled } = { s: { state: 'pending' } };
  p.then(
    (value) => { out.s = { state: 'resolved', value }; },
    (error) => { out.s = { state: 'rejected', error }; },
  );
  return out;
}

// A fetch that never settles and never looks at its signal.
const neverFetch = () => vi.fn((_url: string, _init?: RequestInit) => new Promise<Response>(() => {}));

describe('Q190 apiRequest time limit', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('a never-answering fetch: DELETE rejects after 30 s with the timeout message, and fetch got an aborted signal (red if the race timer is dropped)', async () => {
    const fetchMock = neverFetch();
    vi.stubGlobal('fetch', fetchMock);

    const t = track(apiRequest('/x', 'DELETE'));
    await vi.advanceTimersByTimeAsync(29_999);
    expect(t.s.state).toBe('pending');

    await vi.advanceTimersByTimeAsync(1);
    expect(t.s.state).toBe('rejected');
    const err = (t.s as any).error;
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe('Timed out. Check your connection, then refresh.');
    expect(err.message).toBe(API_TIMEOUT_MESSAGE);
    expect(err.message).not.toMatch(/^\d{3}:/);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const init = fetchMock.mock.calls[0][1]!;
    expect(init.method).toBe('DELETE');
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(init.signal!.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('a fast response resolves and leaves no timer behind (red if clearTimeout is dropped)', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: 1 }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    try {
      await expect(apiRequest('/x', 'PUT', { a: 1 })).resolves.toEqual({ ok: 1 });
      expect(vi.getTimerCount()).toBe(0);
      await vi.advanceTimersByTimeAsync(60_000);
      expect(unhandled).not.toHaveBeenCalled();
      const init = (fetchMock.mock.calls[0] as any)[1] as RequestInit;
      expect(init.signal!.aborted).toBe(false);
    } finally {
      process.off('unhandledRejection', unhandled);
    }
  });

  it('a server error still rejects with "<status>: <body>" and leaves no timer (control)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"message":"nope"}', { status: 409 })));
    await expect(apiRequest('/x', 'DELETE')).rejects.toThrow('409: {"message":"nope"}');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('{ timeoutMs: 1000 } is honoured (red if the option is ignored)', async () => {
    vi.stubGlobal('fetch', neverFetch());
    const t = track(apiRequest('/x', 'POST', { a: 1 }, { timeoutMs: 1000 }));
    await vi.advanceTimersByTimeAsync(999);
    expect(t.s.state).toBe('pending');
    await vi.advanceTimersByTimeAsync(1);
    expect(t.s.state).toBe('rejected');
    expect((t.s as any).error.message).toBe(API_TIMEOUT_MESSAGE);
  });
});
