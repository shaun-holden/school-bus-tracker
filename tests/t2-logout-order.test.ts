import { describe, it, expect, vi, beforeEach } from "vitest";
import { logoutThenRedirect, sendTokenOnce, setLoggingOut } from "../client/src/lib/pushToken";

describe("logoutThenRedirect: the redirect waits for the logout request", () => {
  it("redirects only after the logout POST has resolved (redirect after the await)", async () => {
    const events: string[] = [];
    let finishLogout!: () => void;
    const logout = () =>
      new Promise<void>((resolve) => {
        events.push("logout started");
        finishLogout = () => {
          events.push("logout finished");
          resolve();
        };
      });
    const redirect = vi.fn(() => events.push("redirect"));

    const done = logoutThenRedirect(logout, redirect);
    await Promise.resolve();
    expect(redirect).not.toHaveBeenCalled();
    finishLogout();
    await done;
    expect(events).toEqual(["logout started", "logout finished", "redirect"]);
  });

  it("still redirects after the logout POST rejects (finally), without throwing", async () => {
    const events: string[] = [];
    const logout = async () => {
      events.push("logout started");
      await Promise.resolve();
      events.push("logout failed");
      throw new Error("network down");
    };
    const redirect = vi.fn(() => events.push("redirect"));
    await expect(logoutThenRedirect(logout, redirect)).resolves.toBeUndefined();
    expect(events).toEqual(["logout started", "logout failed", "redirect"]);
    expect(redirect).toHaveBeenCalledTimes(1);
  });
});

describe("sendTokenOnce: no device-token POST while logout is running", () => {
  beforeEach(() => setLoggingOut(false));

  it("skips the POST while the logging-out flag is set (logging-out check)", async () => {
    const post = vi.fn(async () => {});
    setLoggingOut(true);
    expect(await sendTokenOnce("user-a", "tok-logout", post)).toBe("skipped");
    expect(post).not.toHaveBeenCalled();
    setLoggingOut(false);
  });

  it("control: sends once when not logging out, then skips the same (user, token)", async () => {
    const post = vi.fn(async () => {});
    expect(await sendTokenOnce("user-b", "tok-1", post)).toBe("sent");
    expect(await sendTokenOnce("user-b", "tok-1", post)).toBe("skipped");
    expect(await sendTokenOnce("user-c", "tok-1", post)).toBe("sent");
    expect(post).toHaveBeenCalledTimes(2);
  });

  it("a failed POST is reported and retried next time", async () => {
    const post = vi.fn().mockRejectedValueOnce(new Error("500")).mockResolvedValueOnce(undefined);
    expect(await sendTokenOnce("user-d", "tok-2", post)).toBe("failed");
    expect(await sendTokenOnce("user-d", "tok-2", post)).toBe("sent");
  });
});
