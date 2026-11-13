import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  clearPushToken,
  isLoggingOut,
  runWhileLoggingOut,
  sendTokenOnce,
  setLoggingOut,
  setPushToken,
} from "../client/src/lib/pushToken";

// There is no component test harness (vitest runs in `node`), so the call-site
// wiring is pinned on the source, and the helpers it calls are tested for behaviour.
const read = (p: string) => readFileSync(resolve(__dirname, "..", p), "utf8");
const NAV = read("client/src/components/shared/Navigation.tsx");
const AUTH = read("client/src/hooks/use-auth.ts");
const NATIVE_PUSH = read("client/src/hooks/use-native-push.ts");
const ADMIN = read("client/src/pages/admin-dashboard.tsx");

describe("re-login without a reload re-sends the push token (lastSentKey reset)", () => {
  beforeEach(() => setLoggingOut(false));

  it("after logout clears the token, the same user and token log in again → POST again (clearPushToken resets lastSentKey)", async () => {
    const post = vi.fn(async () => {});
    setPushToken("tok-relogin");
    expect(await sendTokenOnce("user-r", "tok-relogin", post)).toBe("sent");
    expect(await sendTokenOnce("user-r", "tok-relogin", post)).toBe("skipped");
    clearPushToken(); // what logout runs at its end (clearNativePushAfterLogout)
    expect(await sendTokenOnce("user-r", "tok-relogin", post)).toBe("sent");
    expect(post).toHaveBeenCalledTimes(2);
  });

  it("use-auth's logout ends with clearPushToken (red if logout stops clearing the token / sent key)", () => {
    expect(AUTH).toMatch(/async function clearNativePushAfterLogout[\s\S]*?clearPushToken\(\);[\s\S]*?\n}/);
    expect(AUTH).toMatch(/finally \{\s*await clearNativePushAfterLogout\(token, loggedOut\);/);
  });
});

describe("3x: isLoggingOut() is false after logout, whether it resolved or rejected", () => {
  beforeEach(() => setLoggingOut(false));

  it("resolved: the flag is on while logout runs and off afterwards", async () => {
    let during: boolean | null = null;
    const result = await runWhileLoggingOut(async () => {
      during = isLoggingOut();
      return "ok";
    });
    expect(result).toBe("ok");
    expect(during).toBe(true);
    expect(isLoggingOut()).toBe(false);
  });

  it("rejected: the error still reaches the caller and the flag is off afterwards (finally)", async () => {
    await expect(
      runWhileLoggingOut(async () => {
        throw new Error("network down");
      }),
    ).rejects.toThrow("network down");
    expect(isLoggingOut()).toBe(false);
  });

  it("wiring: use-auth's logout mutation runs inside runWhileLoggingOut and sets the flag nowhere else", () => {
    expect(AUTH).toMatch(/const logoutMutation = useMutation\(\{\s*mutationFn: \(\) =>(?:\s*\/\/[^\n]*)*\s*runWhileLoggingOut\(/);
    expect(AUTH).not.toMatch(/setLoggingOut\(/);
  });
});

describe("1b: Navigation's logout redirects only after the logout POST settles", () => {
  it("logout goes through logoutThenRedirect(logoutAsync, …) and '/' is set only inside its redirect callback", () => {
    expect(NAV).toMatch(
      /const logout = \(\) =>\s*logoutThenRedirect\(logoutAsync, \(\) => \{\s*window\.location\.href = '\/';\s*\}\);/,
    );
    expect(NAV.match(/window\.location\.href = ['"]\/['"]/g)).toHaveLength(1);
    expect(NAV).not.toMatch(/\blogout\(\);?\s*\n\s*window\.location/);
  });

  it("handleLogout returns the logout promise, and both Sign Out items are disabled while logging out", () => {
    expect(NAV).toMatch(/const handleLogout = async \(\) => \{\s*return logout\(\);/);
    expect(NAV).toMatch(/const \{ user, logoutAsync, isLoggingOut \} = useAuth\(\);/);
    const signOuts = NAV.match(/onClick=\{handleLogout\}\s*disabled=\{isLoggingOut\}/g) ?? [];
    expect(signOuts).toHaveLength(2);
  });
});

describe("2b: the registration listener sends the token only through sendTokenOnce", () => {
  it("the listener calls sendTokenOnce(userId, value, …) and /api/device-tokens is POSTed only inside it", () => {
    const listener = NATIVE_PUSH.match(/addListener\("registration", async \(\{ value \}\) => \{[\s\S]*?\n\s{6}\}\),/);
    expect(listener).not.toBeNull();
    expect(listener![0]).toMatch(/await sendTokenOnce\(userId, value, \(token\) =>\s*apiRequest\("\/api\/device-tokens", "POST"/);
    expect(NATIVE_PUSH.match(/\/api\/device-tokens/g)).toHaveLength(1);
  });
});

describe("4x: the admin dashboard's delay badge isn't rendered for 0 or null", () => {
  // Evaluates the badge's real condition from the source. React renders
  // nothing for false / null / undefined, but it renders the number 0.
  const cond = ADMIN.match(/\{(notification\.estimatedDelay[^{}]*?) && \(\s*<Badge[^>]*>\s*~\{notification\.estimatedDelay\} min delay/);
  const badge = (estimatedDelay: unknown) =>
    new Function("notification", `return (${cond![1]}) && "badge";`)({ estimatedDelay });
  const rendersNothing = (v: unknown) => v === false || v === null || v === undefined;

  it("the badge condition is found next to the delay text", () => {
    expect(cond).not.toBeNull();
  });

  it("0, null and undefined render nothing (no stray '0')", () => {
    expect(rendersNothing(badge(0))).toBe(true);
    expect(rendersNothing(badge(null))).toBe(true);
    expect(rendersNothing(badge(undefined))).toBe(true);
  });

  it("control: a delay above 0 shows the badge", () => {
    expect(badge(5)).toBe("badge");
  });
});
