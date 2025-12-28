import { Link, Outlet, useLocation } from "react-router-dom";
import { useEffect, useState, type ReactNode } from "react";
import { supabase } from "../../lib/supabase";

function NavLink({ to, children }: { to: string; children: ReactNode }) {
  const loc = useLocation();

  const active =
    to === "/app"
      ? loc.pathname === "/app" // exact match only for overview
      : loc.pathname === to || loc.pathname.startsWith(to + "/");

  return (
    <Link to={to} className={active ? "navLink navLink--active" : "navLink"}>
      {children}
    </Link>
  );
}

export default function AppLayout() {
  const [householdName, setHouseholdName] = useState<string>("Hushåll");
  const [householdId, setHouseholdId] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    let ch: ReturnType<typeof supabase.channel> | null = null;

    async function loadHouseholdName() {
      const { data: userRes } = await supabase.auth.getUser();
      const uid = userRes.user?.id;
      if (!uid) return;

      // 1) find household_id
      const { data: ms, error: msErr } = await supabase
        .from("memberships")
        .select("household_id")
        .eq("user_id", uid)
        .limit(1);

      if (!alive) return;

      if (msErr) {
        setHouseholdName("Hushåll");
        return;
      }

      const hid = ms?.[0]?.household_id ?? null;
      setHouseholdId(hid);

      if (!hid) {
        setHouseholdName("Hushåll");
        return;
      }

      // 2) fetch household name
      const { data: hh, error: hhErr } = await supabase.from("households").select("name").eq("id", hid).single();

      if (!alive) return;

      if (!hhErr && hh?.name) setHouseholdName(hh.name);
      else setHouseholdName("Hushåll");

      // 3) realtime updates for household name
      ch = supabase
        .channel(`household:${hid}`)
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "households", filter: `id=eq.${hid}` },
          async () => {
            const { data: hh2 } = await supabase.from("households").select("name").eq("id", hid).single();
            if (alive && hh2?.name) setHouseholdName(hh2.name);
          }
        )
        .subscribe();
    }

    loadHouseholdName();

    return () => {
      alive = false;
      if (ch) supabase.removeChannel(ch);
    };
  }, []);

  return (
    <div className="appFrame">
      <main className="appMain">
        <div className="shell stack" style={{ gap: 14 }}>
          <header className="appHeader appHeader--mobileRow">
            {/* Top row: household name + actions (mobile wants same row) */}
            <div className="headerTop">
              <div className="brandTop">
                <h1 className="brand__title">{householdName}</h1>
              </div>

              <div className="headerActions">
                <Link to="/app/account" className="btn btn--ghost btn--sm">
                  Mitt konto
                </Link>

                <button className="btn btn--danger btn--sm" onClick={() => supabase.auth.signOut()}>
                  Logga ut
                </button>
              </div>
            </div>

            {/* Nav row */}
            <nav className="nav" aria-label="App navigation">
              <NavLink to="/app">Översikt</NavLink>
              <NavLink to="/app/shopping">Mat</NavLink>
              <NavLink to="/app/agenda">Att göra &amp; evenemang</NavLink>
              <NavLink to="/app/economy">Ekonomi</NavLink>
            </nav>
          </header>

          <hr className="divider" />
          <Outlet />
        </div>
      </main>

      <footer className="appFooter">
        <div className="appFooterInner">
          <span className="muted">Hushåll</span>
          {householdId ? (
            <>
              {" "}
              • <span className="muted">ID:</span> <span className="code">{householdId}</span>
            </>
          ) : null}
        </div>
      </footer>
    </div>
  );
}
