import { useState } from "react";
import { Link } from "wouter";
import { ArrowLeft, Mail } from "lucide-react";
import Navigation from "@/components/shared/Navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useAuth } from "@/hooks/use-auth";
import { canSelfDeleteAccount, deleteAccountErrorText } from "@/lib/accountDeletion";
import { SUPPORT_EMAIL } from "@/pages/support";

// Q59: the signed-in user's account page. Parents and drivers can delete their
// own account here (App Store 5.1.1(v) / Google Play); staff see "contact support".
export default function AccountPage() {
  const { user, isLoading, deleteAccountAsync, isDeletingAccount } = useAuth();
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  if (isLoading || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-lg">Loading...</div>
      </div>
    );
  }

  const name = [user.firstName, user.lastName].filter(Boolean).join(" ") || "—";

  const handleDelete = async () => {
    setError(null);
    try {
      await deleteAccountAsync(password);
      // A full reload, so nothing of this account stays in memory.
      window.location.href = "/delete-account?done=1";
    } catch (err) {
      setError(deleteAccountErrorText(err));
    }
  };

  const onOpenChange = (next: boolean) => {
    if (isDeletingAccount) return;
    setOpen(next);
    if (!next) {
      setPassword("");
      setError(null);
    }
  };

  return (
    <div className="font-inter bg-background text-gray-800 min-h-screen safe-area-page-below-nav" data-testid="page-account">
      <Navigation />

      <div className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
        <div className="flex items-center gap-4">
          <Link href="/">
            <Button variant="ghost" size="sm">
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back to Dashboard
            </Button>
          </Link>
          <h1 className="text-2xl font-bold">Account</h1>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Your details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <div className="text-sm text-muted-foreground">Name</div>
              <div data-testid="text-account-name">{name}</div>
            </div>
            <div>
              <div className="text-sm text-muted-foreground">Email</div>
              <div className="break-all" data-testid="text-account-email">{user.email || "—"}</div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Delete account</CardTitle>
            <CardDescription>
              {canSelfDeleteAccount(user)
                ? "Permanently delete your School Bus Tracker account."
                : "Staff accounts are removed by your school's administrator."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {canSelfDeleteAccount(user) ? (
              <AlertDialog open={open} onOpenChange={onOpenChange}>
                <AlertDialogTrigger asChild>
                  <Button variant="destructive" data-testid="button-delete-account">
                    Delete my account
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Delete your account?</AlertDialogTitle>
                    <AlertDialogDescription asChild>
                      <div className="space-y-2 text-sm text-muted-foreground">
                        <p>This can't be undone.</p>
                        <ul className="list-disc pl-5 space-y-1">
                          <li>Your name, email, phone number and login are removed.</li>
                          <li>Your links to your children are removed.</li>
                          <li>You're signed out on all your devices.</li>
                          <li>
                            The school keeps its records, such as trips, attendance and messages; they
                            show "Deleted user" instead of your name.
                          </li>
                          <li>If you sign up again later, the new account starts empty.</li>
                        </ul>
                      </div>
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <form
                    className="space-y-2"
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (!isDeletingAccount && password) void handleDelete();
                    }}
                  >
                    <Label htmlFor="delete-account-password">Enter your password to confirm</Label>
                    <Input
                      id="delete-account-password"
                      type="password"
                      autoComplete="current-password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      disabled={isDeletingAccount}
                      aria-invalid={error ? true : undefined}
                      aria-describedby={error ? "delete-account-error" : undefined}
                      data-testid="input-delete-account-password"
                    />
                    {error && (
                      <p id="delete-account-error" role="alert" className="text-sm text-red-600" data-testid="text-delete-account-error">
                        {error}
                      </p>
                    )}
                    <AlertDialogFooter className="pt-2">
                      <AlertDialogCancel type="button" disabled={isDeletingAccount}>Cancel</AlertDialogCancel>
                      <Button
                        type="submit"
                        variant="destructive"
                        disabled={isDeletingAccount || !password}
                        data-testid="button-confirm-delete-account"
                      >
                        {isDeletingAccount ? "Deleting..." : "Delete my account"}
                      </Button>
                    </AlertDialogFooter>
                  </form>
                </AlertDialogContent>
              </AlertDialog>
            ) : (
              <p className="text-sm text-muted-foreground" data-testid="text-staff-contact-support">
                To close a school account, email{" "}
                <a href={`mailto:${SUPPORT_EMAIL}`} className="text-blue-700 underline inline-flex items-center gap-1">
                  <Mail className="h-4 w-4" />
                  {SUPPORT_EMAIL}
                </a>
                .
              </p>
            )}
            <p className="mt-4 text-sm text-muted-foreground">
              <a href="/delete-account" className="text-blue-700 underline">
                How account deletion works
              </a>
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
