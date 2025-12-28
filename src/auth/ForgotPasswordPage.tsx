import { useState } from "react";
import { Link } from "react-router-dom";
import AuthLayout from "../components/AuthLayout";
import TextField from "../components/TextField";
import { supabase } from "../lib/supabase";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSend() {
    setMsg(null);
    setLoading(true);
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset`,
    });
    setLoading(false);

    if (error) return setMsg(error.message);
    setMsg("Kolla din e-post för återställningslänk.");
  }

  return (
  <AuthLayout title="Återställ lösenord">
    <section className="authCard">
      <div className="authForm">
        <TextField label="E-post" value={email} onChange={setEmail} />

        <button className="btn btn--primary" onClick={onSend} disabled={loading}>
          {loading ? "Skickar..." : "Skicka återställningslänk"}
        </button>

        <div className="authLinks" style={{ justifyContent: "flex-start" }}>
          <Link to="/login">← Tillbaka</Link>
        </div>

        {msg && <div className="alert">{msg}</div>}
      </div>
    </section>
  </AuthLayout>
);

}
