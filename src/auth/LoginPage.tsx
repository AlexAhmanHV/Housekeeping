import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import AuthLayout from "../components/AuthLayout";
import TextField from "../components/TextField";
import { supabase } from "../lib/supabase";

export default function LoginPage() {
  const nav = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onLogin() {
    setMsg(null);
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);

    if (error) return setMsg(error.message);
    nav("/app");
  }

  return (
  <AuthLayout title="Logga in" subtitle="E-post + lösenord">
    <section className="authCard">
      <div className="authForm">
        <TextField label="E-post" value={email} onChange={setEmail} placeholder="du@exempel.se" />
        <TextField label="Lösenord" type="password" value={password} onChange={setPassword} />

        <button className="btn btn--primary" onClick={onLogin} disabled={loading}>
          {loading ? "Loggar in..." : "Logga in"}
        </button>

        <div className="authLinks">
          <Link to="/signup">Skapa konto</Link>
          <Link to="/forgot">Glömt lösenord?</Link>
        </div>

        {msg && <div className="alert">{msg}</div>}
      </div>
    </section>
  </AuthLayout>
);
}
