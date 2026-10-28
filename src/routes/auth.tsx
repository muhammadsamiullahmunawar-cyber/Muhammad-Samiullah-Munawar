import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { Check, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Brand, LangToggle } from "@/components/Brand";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useI18n } from "@/lib/i18n";
import { passwordScore, signupSchema } from "@/lib/password";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Sign in — Techu Brothers" },
      { name: "description", content: "Sign in or create your Techu Brothers account." },
      { property: "og:title", content: "Sign in — Techu Brothers" },
      { property: "og:description", content: "Sign in or create your Techu Brothers account." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AuthPage,
});

type Mode = "signin" | "signup" | "forgot";

function AuthPage() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [usernameStatus, setUsernameStatus] = useState<
    "checking" | "available" | "taken" | "invalid" | null
  >(null);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (data.user) navigate({ to: "/chats", replace: true });
    });
  }, [navigate]);

  // Debounced live username check
  useEffect(() => {
    const clean = username.trim().toLowerCase();
    if (!clean) {
      setUsernameStatus(null);
      return;
    }
    if (!/^[a-z0-9_]{3,24}$/.test(clean)) {
      setUsernameStatus("invalid");
      return;
    }
    setUsernameStatus("checking");
    const timer = setTimeout(async () => {
      try {
        const { data: free, error } = await supabase.rpc("username_available", {
          _username: clean,
        });
        if (error) {
          setUsernameStatus(null);
          return;
        }
        setUsernameStatus(free ? "available" : "taken");
      } catch {
        setUsernameStatus(null);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [username]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (mode === "signup" && usernameStatus === "taken") {
      toast.error(t("usernameTaken"));
      return;
    }
    setBusy(true);
    try {
      if (mode === "signup") {
        const trimmedDisplay = displayName.trim();
        const parsed = signupSchema.safeParse({
          email,
          username,
          password,
          displayName: trimmedDisplay || undefined,
        });
        if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Invalid input");
        const { data: free } = await supabase.rpc("username_available", {
          _username: parsed.data.username,
        });
        if (!free) throw new Error("That username is taken");
        const { error } = await supabase.auth.signUp({
          email: parsed.data.email,
          password,
          options: {
            emailRedirectTo: `${window.location.origin}/chats`,
            data: {
              username: parsed.data.username,
              display_name: trimmedDisplay || parsed.data.username,
            },
          },
        });
        if (error) throw error;
        setSent("Check your email to confirm your account, then sign in.");
      } else if (mode === "signin") {
        const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
        if (error) throw new Error("Wrong email or password");
        navigate({ to: "/chats", replace: true });
      } else {
        const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
          redirectTo: `${window.location.origin}/reset-password`,
        });
        if (error) throw error;
        setSent("If that email has an account, a reset link is on its way.");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  const score = passwordScore(password);

  return (
    <div className="min-h-screen bg-hero">
      <header className="mx-auto flex max-w-md items-center justify-between px-5 py-5">
        <Brand />
        <LangToggle />
      </header>
      <main className="mx-auto max-w-md px-5 pb-16">
        <div className="rounded-3xl border bg-card p-7 shadow-soft">
          <h1 className="text-2xl font-bold">
            {mode === "signup" ? t("signUp") : mode === "forgot" ? t("forgot") : t("signIn")}
          </h1>
          {sent ? (
            <p className="mt-6 rounded-xl bg-secondary p-4 text-sm">{sent}</p>
          ) : (
            <form onSubmit={submit} className="mt-6 space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="email">{t("email")}</Label>
                <Input
                  id="email"
                  type="email"
                  required
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
              {mode === "signup" && (
                <>
                  <div className="space-y-1.5">
                    <Label htmlFor="displayName">{t("displayName")}</Label>
                    <Input
                      id="displayName"
                      required
                      maxLength={40}
                      value={displayName}
                      onChange={(e) => setDisplayName(e.target.value)}
                      placeholder="e.g. Sami Munawar"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <Label htmlFor="username">{t("username")}</Label>
                      {usernameStatus === "checking" && (
                        <span className="flex items-center gap-1 text-xs text-muted-foreground">
                          <Loader2 className="size-3 animate-spin" /> {t("usernameChecking")}
                        </span>
                      )}
                      {usernameStatus === "available" && (
                        <span className="flex items-center gap-1 text-xs font-medium text-primary">
                          <Check className="size-3" /> {t("usernameAvailable")}
                        </span>
                      )}
                      {usernameStatus === "taken" && (
                        <span className="flex items-center gap-1 text-xs font-medium text-destructive">
                          <X className="size-3" /> {t("usernameTaken")}
                        </span>
                      )}
                    </div>
                    <Input
                      id="username"
                      required
                      value={username}
                      onChange={(e) =>
                        setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ""))
                      }
                      placeholder="e.g. sami_m"
                      maxLength={24}
                    />
                  </div>
                </>
              )}
              {mode !== "forgot" && (
                <div className="space-y-1.5">
                  <Label htmlFor="password">{t("password")}</Label>
                  <Input
                    id="password"
                    type="password"
                    required
                    minLength={mode === "signup" ? 10 : 1}
                    autoComplete={mode === "signup" ? "new-password" : "current-password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                  {mode === "signup" && (
                    <div className="flex gap-1 pt-1" aria-label="Password strength">
                      {[1, 2, 3, 4].map((i) => (
                        <span
                          key={i}
                          className={`h-1.5 flex-1 rounded-full ${score >= i ? (score >= 3 ? "bg-primary" : "bg-accent") : "bg-muted"}`}
                        />
                      ))}
                    </div>
                  )}
                </div>
              )}
              <Button
                type="submit"
                className="w-full rounded-full"
                size="lg"
                disabled={
                  busy ||
                  (mode === "signup" &&
                    (usernameStatus === "taken" ||
                      usernameStatus === "checking" ||
                      usernameStatus === "invalid" ||
                      !username ||
                      !displayName.trim()))
                }
              >
                {mode === "signup" ? t("signUp") : mode === "forgot" ? t("sendReset") : t("signIn")}
              </Button>
            </form>
          )}
          <div className="mt-6 flex flex-col gap-2 text-sm">
            {mode !== "signin" && (
              <button
                className="text-primary"
                onClick={() => {
                  setMode("signin");
                  setSent(null);
                }}
              >
                {t("signIn")}
              </button>
            )}
            {mode !== "signup" && (
              <button
                className="text-primary"
                onClick={() => {
                  setMode("signup");
                  setSent(null);
                }}
              >
                {t("signUp")}
              </button>
            )}
            {mode === "signin" && (
              <button className="text-muted-foreground" onClick={() => setMode("forgot")}>
                {t("forgot")}
              </button>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
