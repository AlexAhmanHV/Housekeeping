import { useState } from "react";
import { supabase } from "../../lib/supabase";

export default function OnboardingPage({ onDone }: { onDone: () => void }) {
  const [name, setName] = useState("Vårt hushåll");
  const [joinCode, setJoinCode] = useState("");
  const [createdCode, setCreatedCode] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function createHousehold() {
    setMsg(null);
    setLoading(true);
    const { data, error } = await supabase.rpc("create_household", { p_name: name });
    setLoading(false);

    if (error) return setMsg(error.message);

    const row = Array.isArray(data) ? data[0] : data;
    setCreatedCode(row.join_code);
    setMsg("Skapat! Dela koden med din sambo.");
    onDone();
  }

  async function joinHousehold() {
    setMsg(null);
    setLoading(true);
    const { error } = await supabase.rpc("join_household", { p_join_code: joinCode });
    setLoading(false);

    if (error) return setMsg(error.message);

    setMsg("Gick med i hushållet ✅");
    onDone();
  }

  return (
    <div style={{ display: "grid", gap: 14 }}>
      <h2>Kom igång</h2>

      <div style={{ padding: 12, border: "1px solid #ddd", borderRadius: 12, display: "grid", gap: 8 }}>
        <h3 style={{ margin: 0 }}>Skapa hushåll</h3>
        <label>
          Namn
          <input value={name} onChange={(e) => setName(e.target.value)} style={{ width: "100%", padding: 8 }} />
        </label>
        <button onClick={createHousehold} disabled={loading} style={{ padding: 10, borderRadius: 10 }}>
          Skapa
        </button>
        {createdCode && (
          <div>
            <b>Join-kod:</b> {createdCode}
          </div>
        )}
      </div>

      <div style={{ padding: 12, border: "1px solid #ddd", borderRadius: 12, display: "grid", gap: 8 }}>
        <h3 style={{ margin: 0 }}>Gå med via kod</h3>
        <label>
          Kod
          <input value={joinCode} onChange={(e) => setJoinCode(e.target.value)} style={{ width: "100%", padding: 8 }} />
        </label>
        <button onClick={joinHousehold} disabled={loading} style={{ padding: 10, borderRadius: 10 }}>
          Gå med
        </button>
      </div>

      {msg && <div style={{ padding: 10, background: "#f4f4f4", borderRadius: 10 }}>{msg}</div>}
    </div>
  );
}
