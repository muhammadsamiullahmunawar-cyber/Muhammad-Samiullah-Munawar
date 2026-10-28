import { createFileRoute, Link } from "@tanstack/react-router";
import { Lock, Users, Zap } from "lucide-react";
import hero from "@/assets/hero.jpg";
import { Brand, LangToggle } from "@/components/Brand";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Techu Brothers — Private messaging" },
      {
        name: "description",
        content:
          "Chat one-to-one or in groups with Techu Brothers, a private, fast messenger in English and Urdu.",
      },
      { property: "og:title", content: "Techu Brothers — Private messaging" },
      {
        property: "og:description",
        content: "Private one-to-one and group chats, in English and Urdu.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Landing,
});

function Landing() {
  const { t, lang } = useI18n();
  return (
    <div className="min-h-screen bg-hero">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-5 py-5">
        <Brand />
        <div className="flex items-center gap-2">
          <LangToggle />
          <Button asChild variant="ghost">
            <Link to="/auth">{t("signIn")}</Link>
          </Button>
        </div>
      </header>
      <main className="mx-auto grid max-w-6xl items-center gap-10 px-5 pb-20 pt-8 md:grid-cols-2">
        <div>
          <h1 className="text-5xl font-extrabold leading-[1.05] md:text-6xl">
            {lang === "ur" ? "ٹیچو برادرز" : "Techu Brothers"}
          </h1>
          <p className="mt-5 max-w-md text-xl text-muted-foreground">{t("tagline")}</p>
          <Button asChild size="lg" className="mt-8 rounded-full px-10">
            <Link to="/auth">{t("getStarted")}</Link>
          </Button>
          <ul className="mt-10 grid gap-3 text-sm">
            <li className="flex items-center gap-3">
              <Lock className="size-4 text-primary" /> Only chat members can read their messages
            </li>
            <li className="flex items-center gap-3">
              <Zap className="size-4 text-primary" /> Instant delivery, live updates
            </li>
            <li className="flex items-center gap-3">
              <Users className="size-4 text-primary" /> Groups up to 100 people
            </li>
          </ul>
        </div>
        <img
          src={hero}
          alt="Two phones exchanging protected messages"
          width={1200}
          height={1008}
          className="w-full rounded-3xl shadow-soft"
        />
      </main>
    </div>
  );
}
