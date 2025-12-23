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
    <div className="p-6 max-w-md mx-auto bg-white rounded-xl shadow-md">
      <h1 className="text-xl font-bold mb-4">Lovnotifier Settings</h1>

      <div className="space-y-4">
        <label className="flex items-center gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={settings.notify}
            onChange={() => toggle("notify")}
            className="w-5 h-5 rounded"
          />
          <span>Enable system notifications</span>
        </label>

        <label className="flex items-center gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={settings.float_window}
            onChange={() => toggle("float_window")}
            className="w-5 h-5 rounded"
          />
          <span>Show float window</span>
        </label>

        <div className="flex items-center gap-3">
          <span>Global shortcut:</span>
          <input
            type="text"
            value={settings.shortcut}
            onChange={(e) => setSettings((s) => ({ ...s, shortcut: e.target.value }))}
            className="border rounded px-2 py-1 w-20"
          />
        </div>
      </div>

      <button
        onClick={handleSave}
        className="mt-6 px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
      >
        {saved ? "Saved!" : "Save Settings"}
      </button>
    </div>
  );
}
