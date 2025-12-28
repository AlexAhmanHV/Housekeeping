import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../../lib/supabase";

type Todo = { id: string; title: string; done: boolean; assigned_to: string | null };
type ShoppingItem = { id: string; text: string; checked: boolean };
type ImportantEvent = { id: string; title: string; starts_at: string };

type Member = { user_id: string; role: string; display_name: string };
type Expense = { id: string; paid_by: string; amount_ore: number; title: string; created_at: string };

function formatSvDateTime(iso: string) {
  try {
    return new Date(iso).toLocaleString("sv-SE", { timeZone: "Europe/Stockholm" });
  } catch {
    return iso;
  }
}

function formatKr(ore: number) {
  const kr = ore / 100;
  return new Intl.NumberFormat("sv-SE", { style: "currency", currency: "SEK" }).format(kr);
}

function roundOre(n: number) {
  return Math.round(n);
}

function computeSettlements(balances: { display_name: string; balance_ore: number }[]) {
  const creditors = balances
    .filter((b) => b.balance_ore > 0)
    .map((b) => ({ ...b }))
    .sort((a, b) => b.balance_ore - a.balance_ore);

  const debtors = balances
    .filter((b) => b.balance_ore < 0)
    .map((b) => ({ ...b, balance_ore: -b.balance_ore })) // gör positiv skuld
    .sort((a, b) => b.balance_ore - a.balance_ore);

  const lines: { from: string; to: string; amount_ore: number }[] = [];

  let i = 0;
  let j = 0;

  while (i < debtors.length && j < creditors.length) {
    const d = debtors[i];
    const c = creditors[j];

    const x = Math.min(d.balance_ore, c.balance_ore);
    if (x > 0) lines.push({ from: d.display_name, to: c.display_name, amount_ore: x });

    d.balance_ore -= x;
    c.balance_ore -= x;

    if (d.balance_ore <= 0) i++;
    if (c.balance_ore <= 0) j++;
  }

  return lines;
}

export default function OverviewPage() {
  const [householdId, setHouseholdId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);

  const [todos, setTodos] = useState<Todo[]>([]);
  const [shopping, setShopping] = useState<ShoppingItem[]>([]);
  const [important, setImportant] = useState<ImportantEvent[]>([]);

  // Ekonomi
  const [members, setMembers] = useState<Member[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);

  async function loadTodos(hid: string) {
    const res = await supabase
      .from("household_todos")
      .select("id,title,done,assigned_to")
      .eq("household_id", hid)
      .eq("done", false)
      .order("created_at", { ascending: false })
      .limit(6);

    if (res.error) setMsg(res.error.message);
    else setTodos((res.data ?? []) as Todo[]);
  }

  async function loadShopping(hid: string) {
    const res = await supabase
      .from("shopping_items")
      .select("id,text,checked")
      .eq("household_id", hid)
      .eq("checked", false)
      .order("created_at", { ascending: true })
      .limit(8);

    if (res.error) setMsg(res.error.message);
    else setShopping((res.data ?? []) as ShoppingItem[]);
  }

  async function loadImportant(hid: string) {
    const res = await supabase
      .from("important_events")
      .select("id,title,starts_at")
      .eq("household_id", hid)
      .gte("starts_at", new Date().toISOString())
      .order("starts_at", { ascending: true })
      .limit(5);

    if (res.error) setMsg(res.error.message);
    else setImportant((res.data ?? []) as ImportantEvent[]);
  }

  async function loadEconomy(hid: string) {
    // members
    const mRes = await supabase.rpc("get_household_members");
    if (mRes.error) setMsg(mRes.error.message);
    else setMembers((mRes.data ?? []) as Member[]);

    // expenses
    const eRes = await supabase
      .from("expenses")
      .select("id,paid_by,amount_ore,title,created_at")
      .eq("household_id", hid)
      .order("created_at", { ascending: false });

    if (eRes.error) setMsg(eRes.error.message);
    else setExpenses((eRes.data ?? []) as Expense[]);
  }

  async function initAndLoadAll(hid: string) {
    setMsg(null);
    await Promise.all([loadTodos(hid), loadShopping(hid), loadImportant(hid), loadEconomy(hid)]);
  }

  useEffect(() => {
    let chTodos: ReturnType<typeof supabase.channel> | null = null;
    let chShop: ReturnType<typeof supabase.channel> | null = null;
    let chImp: ReturnType<typeof supabase.channel> | null = null;
    let chEco: ReturnType<typeof supabase.channel> | null = null;

    let alive = true;

    async function start() {
      setMsg(null);
      setLoading(true);

      const { data: userRes } = await supabase.auth.getUser();
      const uid = userRes.user?.id;
      if (!uid) {
        if (!alive) return;
        setMsg("Inte inloggad.");
        setLoading(false);
        return;
      }

      const { data: ms, error: msErr } = await supabase
        .from("memberships")
        .select("household_id")
        .eq("user_id", uid)
        .limit(1);

      if (!alive) return;

      if (msErr) {
        setMsg(msErr.message);
        setLoading(false);
        return;
      }

      const hid = ms?.[0]?.household_id ?? null;
      if (!hid) {
        setMsg("Du har inget hushåll ännu.");
        setLoading(false);
        return;
      }

      setHouseholdId(hid);
      await initAndLoadAll(hid);
      if (!alive) return;

      // Realtime: refresha
      chTodos = supabase
        .channel(`ov:todos:${hid}`)
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "household_todos", filter: `household_id=eq.${hid}` },
          () => loadTodos(hid)
        )
        .subscribe();

      chShop = supabase
        .channel(`ov:shopping:${hid}`)
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "shopping_items", filter: `household_id=eq.${hid}` },
          () => loadShopping(hid)
        )
        .subscribe();

      chImp = supabase
        .channel(`ov:important:${hid}`)
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "important_events", filter: `household_id=eq.${hid}` },
          () => loadImportant(hid)
        )
        .subscribe();

      // Ekonomi realtime: uppdatera vid nya/ändrade utgifter
      chEco = supabase
        .channel(`ov:economy:${hid}`)
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "expenses", filter: `household_id=eq.${hid}` },
          () => loadEconomy(hid)
        )
        .subscribe();

      setLoading(false);
    }

    start();

    return () => {
      alive = false;
      if (chTodos) supabase.removeChannel(chTodos);
      if (chShop) supabase.removeChannel(chShop);
      if (chImp) supabase.removeChannel(chImp);
      if (chEco) supabase.removeChannel(chEco);
    };
  }, []);

  const totalOre = useMemo(() => expenses.reduce((sum, e) => sum + (e.amount_ore ?? 0), 0), [expenses]);

  const totalsByUser = useMemo(() => {
    const map = new Map<string, number>();
    for (const e of expenses) map.set(e.paid_by, (map.get(e.paid_by) ?? 0) + e.amount_ore);
    return map;
  }, [expenses]);

  const balances = useMemo(() => {
    if (members.length === 0) return [];
    const share = totalOre / members.length;

    return members.map((m) => {
      const paid = totalsByUser.get(m.user_id) ?? 0;
      return {
        display_name: m.display_name || m.user_id.slice(0, 6),
        balance_ore: roundOre(paid - share),
      };
    });
  }, [members, totalsByUser, totalOre]);

  const settlements = useMemo(() => computeSettlements(balances).slice(0, 4), [balances]); // visa max 4 rader här

  if (loading) return <div className="page loading">Laddar…</div>;

  return (
    <div className="page stack">
      <h2>Översikt</h2>

      <div className="grid3">
        {/* Att göra */}
        <section className="card">
          <div className="cardHeader">
            <h3>Att göra</h3>
            <Link to="/app/todos" className="openLink">
              Öppna →
            </Link>
          </div>

          {todos.length === 0 ? (
            <div className="emptyState">Inga öppna just nu 🎉</div>
          ) : (
            <ul className="bullets">
              {todos.map((t) => (
                <li key={t.id} className="bulletRow">
                  <span className="bulletDot" />
                  <div className="bulletMain">
                    <div className="bulletTitle" style={{ fontWeight: 500 }}>
                      {t.title}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Viktigt */}
        <section className="card">
          <div className="cardHeader">
            <h3>Kommande evenemang</h3>
            <Link to="/app/important" className="openLink">
              Öppna →
            </Link>
          </div>

          {important.length === 0 ? (
            <div className="emptyState">Inga kommande just nu.</div>
          ) : (
            <ul className="bullets">
              {important.map((e) => (
                <li key={e.id} className="bulletRow" style={{ alignItems: "baseline" }}>
                  <span className="bulletDot" />
                  <div className="bulletMain">
                    <div className="bulletTitle">{e.title}</div>
                    <div className="bulletSub">{formatSvDateTime(e.starts_at)}</div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Handla */}
        <section className="card">
          <div className="cardHeader">
            <h3>Saker att handla</h3>
            <Link to="/app/shopping" className="openLink">
              Öppna →
            </Link>
          </div>

          {shopping.length === 0 ? (
            <div className="emptyState">Inget på listan.</div>
          ) : (
            <ul className="bullets">
              {shopping.map((s) => (
                <li key={s.id} className="bulletRow">
                  <span className="bulletDot" />
                  <div className="bulletMain">
                    <div className="bulletTitle" style={{ fontWeight: 500 }}>
                      {s.text}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {/* Ekonomi (fullbredd under grid) */}
      <section className="card">
        <div className="cardHeader">
          <h3>Ekonomi</h3>
          <Link to="/app/economy" className="openLink">
            Öppna →
          </Link>
        </div>

        {members.length === 0 ? (
          <div className="emptyState">Inga medlemmar ännu.</div>
        ) : totalOre === 0 ? (
          <div className="emptyState">Inga utgifter än. Lägg till första i Ekonomi.</div>
        ) : settlements.length === 0 ? (
          <div className="emptyState">
            Total: <b>{formatKr(totalOre)}</b> • Allt är jämnt ✅
          </div>
        ) : (
          <div className="stack" style={{ gap: 10 }}>
            <div className="note">
              Total denna period: <b>{formatKr(totalOre)}</b>
            </div>

            <ul className="bullets">
              {settlements.map((s, idx) => (
                <li key={idx} className="bulletRow" style={{ alignItems: "baseline" }}>
                  <span className="bulletDot" />
                  <div className="bulletMain">
                    <div className="bulletTitle" style={{ fontWeight: 600 }}>
                      {s.from} → {s.to}
                    </div>
                    <div className="bulletSub">{formatKr(s.amount_ore)}</div>
                  </div>
                </li>
              ))}
            </ul>

            <div className="note">
              (Visar max 4 rader här. Se hela listan på <b>Ekonomi</b>.)
            </div>
          </div>
        )}
      </section>

      {msg && <div className="alert">{msg}</div>}
      {!householdId && <div className="note">Du har inget hushåll ännu.</div>}
    </div>
  );
}
