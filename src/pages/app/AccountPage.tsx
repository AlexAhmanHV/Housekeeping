import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";

type Membership = { household_id: string; role: string };
type Household = { id: string; name: string; join_code: string };

export default function AccountPage() {
  const [email, setEmail] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);

  const [membership, setMembership] = useState<Membership | null>(null);
  const [household, setHousehold] = useState<Household | null>(null);

  // Profile / name
  const [displayName, setDisplayName] = useState("");
  const [savingName, setSavingName] = useState(false);

  const [msg, setMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Push state
  const [pushSupported, setPushSupported] = useState(false);
  const [pushEnabled, setPushEnabled] = useState(false);
  const [pushBusy, setPushBusy] = useState(false);

  useEffect(() => {
    setPushSupported(
      typeof window !== "undefined" &&
        "serviceWorker" in navigator &&
        "PushManager" in window &&
        "Notification" in window
    );
  }, []);

  useEffect(() => {
    let alive = true;

    async function ensureProfile(uid: string) {
      // Hämta eller skapa profilrad
      const { data: prof, error: profErr } = await supabase
        .from("profiles")
        .select("display_name")
        .eq("user_id", uid)
        .maybeSingle();

      if (!alive) return;

      if (profErr) {
        setMsg(profErr.message);
        return;
      }

      if (!prof) {
        const { error: insErr } = await supabase.from("profiles").insert({ user_id: uid, display_name: "" });
        if (!alive) return;
        if (insErr) setMsg(insErr.message);
        setDisplayName("");
      } else {
        setDisplayName(prof.display_name ?? "");
      }
    }

    async function load() {
      setMsg(null);
      setLoading(true);

      const { data: userRes } = await supabase.auth.getUser();
      const user = userRes.user;
      if (!user) {
        if (!alive) return;
        setMsg("Inte inloggad.");
        setLoading(false);
        return;
      }

      setEmail(user.email ?? null);
      setUserId(user.id);

      await ensureProfile(user.id);
      if (!alive) return;

      // membership (select own policy)
      const { data: ms, error: msErr } = await supabase
        .from("memberships")
        .select("household_id,role")
        .eq("user_id", user.id)
        .limit(1);

      if (!alive) return;

      if (msErr) {
        setMsg(msErr.message);
        setLoading(false);
        return;
      }

      const m = (ms?.[0] ?? null) as Membership | null;
      setMembership(m);

      if (!m?.household_id) {
        setHousehold(null);
        setLoading(false);
        return;
      }

      // household info
      const { data: hh, error: hhErr } = await supabase
        .from("households")
        .select("id,name,join_code")
        .eq("id", m.household_id)
        .single();

      if (!alive) return;

      if (hhErr) setMsg(hhErr.message);
      else setHousehold(hh as Household);

      setLoading(false);

      // check push status (after we know user & household)
      if (pushSupported) {
        const enabled = await isPushEnabledInBrowser();
        if (!alive) return;
        setPushEnabled(enabled);
      }
    }

    load();

    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pushSupported]);

  async function saveName() {
    setMsg(null);
    if (!userId) return;

    setSavingName(true);
    const { error } = await supabase
      .from("profiles")
      .upsert({ user_id: userId, display_name: displayName.trim() });

    setSavingName(false);

    if (error) setMsg(error.message);
    else setMsg("Namn sparat ✅");
  }

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setMsg("Kopierat ✅");
      setTimeout(() => setMsg(null), 1200);
    } catch {
      setMsg("Kunde inte kopiera (webbläsaren blockerade).");
    }
  }

  function urlBase64ToUint8Array(base64Url: string) {
    const padding = "=".repeat((4 - (base64Url.length % 4)) % 4);
    const base64 = (base64Url + padding).replace(/-/g, "+").replace(/_/g, "/");
    const raw = atob(base64);
    return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
  }

  async function isPushEnabledInBrowser(): Promise<boolean> {
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      if (!reg) return false;
      const sub = await reg.pushManager.getSubscription();
      return !!sub;
    } catch {
      return false;
    }
  }

  async function enablePush() {
    setMsg(null);
    if (!pushSupported) return setMsg("Push stöds inte i den här webbläsaren/enheten.");
    if (!membership?.household_id || !userId) return setMsg("Saknar hushåll eller användare.");

    const vapidPublic = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined;
    if (!vapidPublic) return setMsg("Saknar VITE_VAPID_PUBLIC_KEY i .env");

    setPushBusy(true);
    try {
      const perm = await Notification.requestPermission();
      if (perm !== "granted") return setMsg("Notiser nekades. Tillåt notiser i webbläsarens inställningar.");

      // Register SW (localhost ok; i produktion krävs https)
      const reg = await navigator.serviceWorker.register("/sw.js");

      // Subscribe
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidPublic),
      });

      // Save subscription in DB
      const { error } = await supabase.from("push_subscriptions").upsert(
        {
          user_id: userId,
          household_id: membership.household_id,
          endpoint: sub.endpoint,
          subscription: sub.toJSON(),
        },
        { onConflict: "endpoint" }
      );

      if (error) return setMsg(error.message);

      setPushEnabled(true);
      setMsg("Push-notiser aktiverade ✅");
    } catch (e: any) {
      setMsg(e?.message ?? "Kunde inte aktivera push.");
    } finally {
      setPushBusy(false);
    }
  }

  async function disablePush() {
    setMsg(null);
    if (!pushSupported) return;
    if (!userId) return;

    setPushBusy(true);
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = await reg?.pushManager.getSubscription();

      if (sub) {
        // Remove from DB first (by endpoint)
        const { error } = await supabase.from("push_subscriptions").delete().eq("endpoint", sub.endpoint);
        if (error) return setMsg(error.message);

        await sub.unsubscribe();
      }

      setPushEnabled(false);
      setMsg("Push-notiser avstängda.");
    } catch (e: any) {
      setMsg(e?.message ?? "Kunde inte stänga av push.");
    } finally {
      setPushBusy(false);
    }
  }

  if (loading) return <div className="page">Laddar…</div>;

return (
  <div className="page stack">
    <h2>Mitt konto</h2>

    {/* Jag */}
    <section className="card stack">
      <div className="card__titleRow">
        <h3>Jag</h3>
        {userId && <span className="code" title="User ID">{userId}</span>}
      </div>

      <div className="kv">
        <div className="kv__row">
          <div className="kv__key">E-post</div>
          <div className="kv__val">{email ?? "-"}</div>
        </div>
      </div>

      <hr className="hr" />

      <label className="kv">
        <div className="kv__row" style={{ gridTemplateColumns: "1fr" }}>
          <div className="kv__key">
            <b style={{ color: "var(--text)" }}>Namn</b>
          </div>

          <input
            className="input"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="T.ex. Alex"
          />
        </div>
      </label>

      <div className="row row--wrap">
        <button className="btn btn--primary" onClick={saveName} disabled={savingName}>
          {savingName ? "Sparar..." : "Spara namn"}
        </button>
        <div className="note">Det här namnet kan visas i appen för andra i hushållet.</div>
      </div>
    </section>

    {/* Hushåll */}
    <section className="card stack">
      <div className="card__titleRow">
        <h3>Hushåll</h3>
        {membership?.household_id && <span className="badge">{membership.role}</span>}
      </div>

      {!membership?.household_id && <div className="note">Du är inte kopplad till ett hushåll ännu.</div>}

      {membership?.household_id && (
        <div className="stack" style={{ gap: 10 }}>
          <div className="kv">
            <div className="kv__row">
              <div className="kv__key">Roll</div>
              <div className="kv__val">{membership.role}</div>
            </div>

            <div className="kv__row">
              <div className="kv__key">Household ID</div>
              <div className="kv__val">
                <span className="code">{membership.household_id}</span>
              </div>
            </div>
          </div>

          {household && (
            <>
              <hr className="hr" />

              <div className="kv">
                <div className="kv__row">
                  <div className="kv__key">Namn</div>
                  <div className="kv__val">{household.name}</div>
                </div>

                <div className="kv__row">
                  <div className="kv__key">Join-kod</div>
                  <div className="kv__val row row--wrap">
                    <span className="code">{household.join_code}</span>
                    <button className="btn btn--sm" onClick={() => copy(household.join_code)}>
                      Kopiera
                    </button>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </section>

    {/* Push-notiser */}
    <section className="card stack">
      <div className="card__titleRow">
        <h3>Push-notiser</h3>

        <div className="status">
          <span className={pushEnabled ? "dot dot--ok" : "dot dot--off"} />
          <span className="badge">{pushEnabled ? "Aktiverat" : "Avstängt"}</span>
        </div>
      </div>

      {!pushSupported && (
        <div className="note">
          Push stöds inte här. (Tips: Chrome/Edge på Android eller en installerad PWA.)
        </div>
      )}

      {pushSupported && (
        <div className="stack" style={{ gap: 10 }}>
          <div className="kv">
            <div className="kv__row">
              <div className="kv__key">Status</div>
              <div className="kv__val">{pushEnabled ? "Aktiverat ✅" : "Avstängt"}</div>
            </div>
          </div>

          <div className="row row--wrap">
            {!pushEnabled ? (
              <button className="btn btn--primary" onClick={enablePush} disabled={pushBusy}>
                {pushBusy ? "Aktiverar..." : "Aktivera push-notiser"}
              </button>
            ) : (
              <button className="btn btn--danger" onClick={disablePush} disabled={pushBusy}>
                {pushBusy ? "Stänger av..." : "Stäng av push"}
              </button>
            )}

            <div className="note">
              Push funkar på <b>HTTPS</b> (localhost ok). På iPhone krävs ofta “Lägg till på hemskärmen”.
            </div>
          </div>
        </div>
      )}
    </section>

    {msg && <div className="alert">{msg}</div>}
  </div>
);
}
