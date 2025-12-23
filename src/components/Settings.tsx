import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

interface NotifierSettings {
  notify: boolean;
  float_window: boolean;
  menu_bar: boolean;
  shortcut: string;
}

export function Settings() {
  const [settings, setSettings] = useState<NotifierSettings>({
    notify: true,
    float_window: true,
    menu_bar: true,
    shortcut: "F4",
  });
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    invoke<NotifierSettings>("get_settings").then(setSettings).catch(console.error);
  }, []);

  const handleSave = async () => {
    try {
      await invoke("save_settings", { settings });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      console.error("Failed to save settings:", e);
    }
  };

  const toggle = (key: keyof NotifierSettings) => {
    if (typeof settings[key] === "boolean") {
      setSettings((s) => ({ ...s, [key]: !s[key] }));
    }
  };

  return (
    <div className="min-h-screen bg-background p-8">
      <div className="max-w-md mx-auto bg-card border border-border rounded-2xl p-6">
        <h1 className="font-serif text-xl text-foreground mb-6">Lovnotifier Settings</h1>

        <div className="space-y-5">
          <label className="flex items-center gap-3 cursor-pointer group">
            <button
              type="button"
              role="switch"
              aria-checked={settings.notify}
              onClick={() => toggle("notify")}
              className={`relative w-11 h-6 rounded-full transition-colors ${
                settings.notify ? "bg-primary" : "bg-muted"
              }`}
            >
              <span
                className={`absolute top-0.5 left-0.5 w-5 h-5 bg-card rounded-full transition-transform shadow-sm ${
                  settings.notify ? "translate-x-5" : "translate-x-0"
                }`}
              />
            </button>
            <span className="text-foreground">Enable system notifications</span>
          </label>

          <label className="flex items-center gap-3 cursor-pointer group">
            <button
              type="button"
              role="switch"
              aria-checked={settings.float_window}
              onClick={() => toggle("float_window")}
              className={`relative w-11 h-6 rounded-full transition-colors ${
                settings.float_window ? "bg-primary" : "bg-muted"
              }`}
            >
              <span
                className={`absolute top-0.5 left-0.5 w-5 h-5 bg-card rounded-full transition-transform shadow-sm ${
                  settings.float_window ? "translate-x-5" : "translate-x-0"
                }`}
              />
            </button>
            <span className="text-foreground">Show float window</span>
          </label>

          <div className="flex items-center gap-3">
            <span className="text-foreground">Global shortcut:</span>
            <input
              type="text"
              value={settings.shortcut}
              onChange={(e) => setSettings((s) => ({ ...s, shortcut: e.target.value }))}
              className="border border-input bg-background rounded-lg px-3 py-1.5 w-20 text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
        </div>

        <button
          onClick={handleSave}
          className="mt-6 px-5 py-2.5 bg-primary text-primary-foreground rounded-xl hover:bg-primary/90 transition-colors font-medium"
        >
          {saved ? "Saved!" : "Save Settings"}
        </button>
      </div>
    </div>
  );
}
