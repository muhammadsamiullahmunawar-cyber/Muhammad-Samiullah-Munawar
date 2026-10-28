import { Link } from "@tanstack/react-router";
import { MessageCircleHeart } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { Button } from "@/components/ui/button";

export function Brand() {
  const { lang } = useI18n();
  return (
    <Link to="/" className="flex items-center gap-2 font-display text-lg font-bold">
      <span className="grid size-9 place-items-center rounded-xl bg-primary text-primary-foreground">
        <MessageCircleHeart className="size-5" />
      </span>
      {lang === "ur" ? "ٹیچو برادرز" : "Techu Brothers"}
    </Link>
  );
}

export function LangToggle() {
  const { lang, setLang } = useI18n();
  return (
    <Button variant="ghost" size="sm" onClick={() => setLang(lang === "en" ? "ur" : "en")}>
      {lang === "en" ? "اردو" : "English"}
    </Button>
  );
}
