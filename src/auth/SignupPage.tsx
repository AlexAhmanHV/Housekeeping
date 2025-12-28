import { useState } from "react";
import { Link } from "react-router-dom";
import AuthLayout from "../components/AuthLayout";
import TextField from "../components/TextField";
import { supabase } from "../lib/supabase";

export default function SignupPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSignup() {
    setMsg(null);
    setLoading(true);
    const { error } = await supabase.auth.signUp({ email, password });
    setLoading(false);

    if (error) return setMsg(error.message);
    setMsg("Konto skapat ✅ Du kan logga in nu.");
  }

  return (
  <AuthLayout title="Skapa konto">
    <section className="authCard">
      <div className="authForm">
        <TextField label="E-post" value={email} onChange={setEmail} />
        <TextField label="Lösenord" type="password" value={password} onChange={setPassword} />

        <button className="btn btn--primary" onClick={onSignup} disabled={loading}>
          {loading ? "Skapar..." : "Skapa konto"}
        </button>

        <div className="authLinks" style={{ justifyContent: "flex-start" }}>
          <Link to="/login">← Tillbaka till login</Link>
        </div>

        {msg && (
          <div className={msg.includes("✅") ? "alert alert--ok" : "alert"}>
            {msg}
          </div>
        )}
      </div>
    </section>
  </AuthLayout>
);

}
