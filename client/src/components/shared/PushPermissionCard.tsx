import { useState } from "react";
import { Bell } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { dismissPushCard, turnOnPush, usePushCardState } from "@/hooks/use-native-push";

const TEXT: Record<"parent" | "driver", string> = {
  parent: "Get a notice when the bus reaches your stop",
  driver: "Get a notice when you get a message",
};

/**
 * Soft ask for native push. Shows only when useNativePush found the permission
 * not yet asked (or denied) for a logged-in parent or driver on the phone app.
 * The OS prompt comes only from "Turn on".
 */
export function PushPermissionCard({ role }: { role: "parent" | "driver" }) {
  const state = usePushCardState();
  const [busy, setBusy] = useState(false);

  if (state === "hidden") return null;

  const onTurnOn = async () => {
    setBusy(true);
    try {
      await turnOnPush();
    } catch {
      console.warn("Push permission request failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="mb-6 border-blue-200 bg-blue-50" data-testid="card-push-permission">
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          <Bell className="w-5 h-5 text-blue-700 mt-0.5 shrink-0" aria-hidden="true" />
          <div className="flex-1 min-w-0">
            <p className="font-medium text-gray-900">{TEXT[role]}</p>
            {state === "denied" ? (
              <p className="text-sm text-gray-600 mt-1">
                Notifications are off. Turn them on in Settings &gt; School Bus Tracker.
              </p>
            ) : (
              <div className="flex flex-wrap gap-2 mt-3">
                <Button size="sm" onClick={onTurnOn} disabled={busy} data-testid="button-push-turn-on">
                  Turn on
                </Button>
                <Button size="sm" variant="outline" onClick={dismissPushCard} data-testid="button-push-not-now">
                  Not now
                </Button>
              </div>
            )}
          </div>
          {state === "denied" && (
            <Button size="sm" variant="ghost" onClick={dismissPushCard} data-testid="button-push-not-now">
              Not now
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
