import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import AuthLayout from "../components/AuthLayout";
import TextField from "../components/TextField";
import { supabase } from "../lib/supabase";

export default function ResetPasswordPage() {
  const [password, setPassword] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(false);

  // Supabase-js plockar upp recovery-session från URL (hash) när sidan laddas.
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setReady(!!data.session);
      if (!data.session) {
        setMsg("Öppna sidan via länken i e-postmeddelandet för att kunna sätta nytt lösenord.");
      }
    });
  }, []);

  async function onUpdate() {
    setMsg(null);
    setLoading(true);
    const { error } = await supabase.auth.updateUser({ password });
    setLoading(false);

    if (error) return setMsg(error.message);
    setMsg("Lösenord uppdaterat ✅ Du kan logga in nu.");
  }

  return (
    <AuthLayout title="Sätt nytt lösenord">
      <div style={{ display: "grid", gap: 12 }}>
        <TextField label="Nytt lösenord" type="password" value={password} onChange={setPassword} />
        <button onClick={onUpdate} disabled={!ready || loading} style={{ padding: "10px 12px", borderRadius: 10 }}>
          {loading ? "Sparar..." : "Spara nytt lösenord"}
        </button>
        <div style={{ fontSize: 14 }}>
          <Link to="/login">Till login</Link>
        </div>
        {msg && <div style={{ padding: 10, background: "#f4f4f4", borderRadius: 10 }}>{msg}</div>}
      </div>
    </AuthLayout>
  );
}
