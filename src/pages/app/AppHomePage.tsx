import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";
import OnboardingPage from "./OnboardingPage.tsx";

export default function AppHomePage() {
  const [loading, setLoading] = useState(true);
  const [householdId, setHouseholdId] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;

    async function load() {
      setErr(null);
      setLoading(true);

      const { data: userRes } = await supabase.auth.getUser();
      const uid = userRes.user?.id;
      if (!uid) {
        if (!alive) return;
        setErr("Inte inloggad.");
        setLoading(false);
        return;
      }

      const { data, error } = await supabase
        .from("memberships")
        .select("household_id")
        .eq("user_id", uid)
        .limit(1);

      if (!alive) return;

      if (error) setErr(error.message);
      setHouseholdId(data?.[0]?.household_id ?? null);
      setLoading(false);
    }

    load();
    return () => {
      alive = false;
    };
  }, []);

  if (loading) return <div className="page loading">Laddar…</div>;

  if (err)
    return (
      <div className="page">
        <div className="alert">{err}</div>
      </div>
    );

  if (!householdId) {
    return <OnboardingPage onDone={() => window.location.reload()} />;
  }

  return (
    <div className="page center">
      <div className="hero">
        <section className="card card--glow stack">
          <div className="stack" style={{ gap: 8 }}>
            <h2 className="hero__title">Du är inne 🎉</h2>
            <p className="hero__subtitle">Allt klart — du är kopplad till ditt hushåll.</p>
          </div>

          <div className="pillrow">
            <span className="pill">
              <b>Household</b> <span className="code">{householdId}</span>
            </span>
          </div>

          <hr className="hr" />

          <div className="stack" style={{ gap: 10 }}>
            <div className="note">
              Nästa: inköpslista + mat + utgifter + viktigt.
            </div>

            {/* Optional CTA buttons (keep or remove) */}
            <div className="row row--wrap">
              <button className="btn btn--primary" onClick={() => (window.location.href = "/app/shopping")}>
                Gå till Mat
              </button>
              <button className="btn btn--ghost" onClick={() => (window.location.href = "/app/account")}>
                Mitt konto
              </button>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
