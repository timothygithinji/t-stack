import { Monitor, Moon, Sun } from "lucide-react";
import { type Theme, useTheme } from "@/lib/theme";
import { cn } from "@/lib/utils";

const OPTIONS: { value: Theme; label: string; icon: typeof Sun }[] = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "System", icon: Monitor },
];

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();

  return (
    <fieldset
      aria-label="Theme"
      className="inline-flex items-center gap-0.5 rounded-md border border-border bg-card p-0.5"
    >
      {OPTIONS.map(({ value, label, icon: Icon }) => {
        const active = theme === value;
        return (
          <button
            aria-label={label}
            aria-pressed={active}
            className={cn(
              "inline-flex size-7 items-center justify-center rounded-sm transition-colors",
              "focus-visible:outline-2 focus-visible:outline-ring",
              active
                ? "bg-accent text-accent-foreground"
                : "text-muted-foreground hover:bg-accent/60 hover:text-foreground"
            )}
            key={value}
            onClick={() => setTheme(value)}
            title={label}
            type="button"
          >
            <Icon aria-hidden className="size-3.5" />
          </button>
        );
      })}
    </fieldset>
  );
}
