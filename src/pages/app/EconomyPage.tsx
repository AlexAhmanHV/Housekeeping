import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../lib/supabase";

type Member = {
  user_id: string;
  role: string;
  display_name: string;
};

type Expense = {
  id: string;
  household_id: string;
  paid_by: string;
  title: string;
  amount_ore: number;
  created_by: string;
  created_at: string;
};

function formatKr(ore: number) {
  const kr = ore / 100;
  return new Intl.NumberFormat("sv-SE", { style: "currency", currency: "SEK" }).format(kr);
}

function roundOre(n: number) {
  return Math.round(n);
}

// Enkel “matcha skulder” algoritm: debtors -> creditors
function computeSettlements(balances: { user_id: string; display_name: string; balance_ore: number }[]) {
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

export default function EconomyPage() {
  const [householdId, setHouseholdId] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);

  const [members, setMembers] = useState<Member[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);

  const [title, setTitle] = useState("");
  const [amountKr, setAmountKr] = useState(""); // input i kronor (t.ex. 129.50)

  const [msg, setMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  async function loadHouseholdBasics() {
    const { data: userRes } = await supabase.auth.getUser();
    const uid = userRes.user?.id ?? null;
    if (!uid) return { uid: null as string | null, hid: null as string | null };

    const { data: ms, error: msErr } = await supabase.from("memberships").select("household_id").eq("user_id", uid).limit(1);
    if (msErr) throw new Error(msErr.message);

    const hid = ms?.[0]?.household_id ?? null;
    return { uid, hid };
  }

  async function loadMembers() {
    const { data, error } = await supabase.rpc("get_household_members");
    if (error) throw new Error(error.message);
    setMembers((data ?? []) as Member[]);
  }

  async function loadExpenses(hid: string) {
    const { data, error } = await supabase
      .from("expenses")
      .select("id,household_id,paid_by,title,amount_ore,created_by,created_at")
      .eq("household_id", hid)
      .order("created_at", { ascending: false });

    if (error) throw new Error(error.message);
    setExpenses((data ?? []) as Expense[]);
  }

  useEffect(() => {
    let alive = true;
    let ch: ReturnType<typeof supabase.channel> | null = null;

    async function init() {
      setMsg(null);
      setLoading(true);

      try {
        const { uid, hid } = await loadHouseholdBasics();
        if (!alive) return;

        if (!uid) {
          setMsg("Inte inloggad.");
          setLoading(false);
          return;
        }
        setUserId(uid);

        if (!hid) {
          setMsg("Du har inget hushåll ännu.");
          setLoading(false);
          return;
        }

        setHouseholdId(hid);

        await Promise.all([loadMembers(), loadExpenses(hid)]);
        if (!alive) return;

        // Realtime
        ch = supabase
          .channel(`economy:${hid}`)
          .on(
            "postgres_changes",
            { event: "*", schema: "public", table: "expenses", filter: `household_id=eq.${hid}` },
            () => loadExpenses(hid)
          )
          .subscribe();

        setLoading(false);
      } catch (e: any) {
        setMsg(e?.message ?? "Kunde inte ladda ekonomi.");
        setLoading(false);
      }
    }

    init();

    return () => {
      alive = false;
      if (ch) supabase.removeChannel(ch);
    };
  }, []);

  const memberById = useMemo(() => {
    const m = new Map<string, Member>();
    members.forEach((x) => m.set(x.user_id, x));
    return m;
  }, [members]);

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
        user_id: m.user_id,
        display_name: (m.display_name || "").trim() || m.user_id.slice(0, 6),
        balance_ore: roundOre(paid - share),
      };
    });
  }, [members, totalsByUser, totalOre]);

  const settlements = useMemo(() => computeSettlements(balances), [balances]);

  const groupedExpenses = useMemo(() => {
    const by = new Map<string, Expense[]>();
    expenses.forEach((e) => {
      const arr = by.get(e.paid_by) ?? [];
      arr.push(e);
      by.set(e.paid_by, arr);
    });

    return members.map((m) => ({
      member: m,
      items: by.get(m.user_id) ?? [],
      total_ore: totalsByUser.get(m.user_id) ?? 0,
    }));
  }, [members, expenses, totalsByUser]);

  async function addExpense() {
    setMsg(null);
    if (!householdId || !userId) return;

    const t = title.trim();
    if (!t) return;

    const cleaned = amountKr.replace(",", ".").trim();
    const num = Number(cleaned);
    if (!cleaned || Number.isNaN(num) || num <= 0) return setMsg("Summa måste vara ett nummer > 0.");

    const ore = Math.round(num * 100);

    // Optimistisk UI
    const tempId = `temp-${crypto.randomUUID()}`;
    const optimistic: Expense = {
      id: tempId,
      household_id: householdId,
      paid_by: userId,
      title: t,
      amount_ore: ore,
      created_by: userId,
      created_at: new Date().toISOString(),
    };
    setExpenses((prev) => [optimistic, ...prev]);
    setTitle("");
    setAmountKr("");

    const { data, error } = await supabase
      .from("expenses")
      .insert({
        household_id: householdId,
        paid_by: userId,
        title: t,
        amount_ore: ore,
        created_by: userId,
      })
      .select("id,household_id,paid_by,title,amount_ore,created_by,created_at")
      .single();

    if (error) {
      setMsg(error.message);
      setExpenses((prev) => prev.filter((x) => x.id !== tempId));
      return;
    }

    setExpenses((prev) => prev.map((x) => (x.id === tempId ? (data as Expense) : x)));
  }

  async function removeExpense(e: Expense) {
    setMsg(null);

    const snapshot = expenses;
    setExpenses((prev) => prev.filter((x) => x.id !== e.id));

    const { error } = await supabase.from("expenses").delete().eq("id", e.id);
    if (error) {
      setMsg(error.message);
      setExpenses(snapshot);
    }
  }

  if (loading) return <div className="page loading">Laddar…</div>;

  const meName = userId ? (memberById.get(userId)?.display_name || "").trim() || "Jag" : "Jag";
  const sharePerPersonOre = Math.round(totalOre / Math.max(1, members.length));

  return (
    <div className="page stack">
      <header className="card card--glow stack" style={{ gap: 10 }}>
        <div className="card__header">
          <div style={{ display: "grid", gap: 4 }}>
            <h2>Ekonomi</h2>
            <div className="note">Håll koll på gemensamma utgifter och vem som ska swisha vem.</div>
          </div>

          <div className="pillrow">
            <span className="pill">
              Total <b>{formatKr(totalOre)}</b>
            </span>
            <span className="pill">
              Medlemmar <b>{members.length}</b>
            </span>
            <span className="pill">
              Andel <b>{formatKr(sharePerPersonOre)}</b>
            </span>
          </div>
        </div>
      </header>

      {/* Lägg till */}
      <section className="card stack">
        <div className="card__header baseline">
          <h3>Lägg till utgift</h3>
          <span className="badge">Betalas av: {meName}</span>
        </div>

        <div className="row row--wrap">
          <input
            className="input flex-1"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Namn (t.ex. Ica, El, Netflix)"
            onKeyDown={(e) => e.key === "Enter" && addExpense()}
          />

          <input
            className="input w-160"
            value={amountKr}
            onChange={(e) => setAmountKr(e.target.value)}
            placeholder="Summa (kr)"
            inputMode="decimal"
            onKeyDown={(e) => e.key === "Enter" && addExpense()}
          />

          <button className="btn btn--primary" onClick={addExpense}>
            Lägg till
          </button>
        </div>

        <div className="note">
          Tips: skriv <span className="code">129</span> eller <span className="code">129,50</span>.
        </div>
      </section>

      {/* “Vem ska swisha vem” först (det viktiga) */}
      <section className="card stack">
        <div className="card__header baseline">
          <h3>Swish-förslag</h3>
          <span className="badge">{settlements.length} rader</span>
        </div>

        {settlements.length === 0 ? (
          <div className="note">Allt är redan jämnt ✅</div>
        ) : (
          <ul className="list" style={{ gap: 6 }}>
            {settlements.map((s, idx) => (
              <li key={idx} className="listItem--row" style={{ alignItems: "baseline" }}>
                <div className="flex-1">
                  <span style={{ fontWeight: 800 }}>{s.from}</span>{" "}
                  <span className="muted">→</span>{" "}
                  <span style={{ fontWeight: 800 }}>{s.to}</span>
                </div>
                <div style={{ fontWeight: 900 }}>{formatKr(s.amount_ore)}</div>
              </li>
            ))}
          </ul>
        )}

        <div className="note">
          (Räknar ut minsta antal överföringar baserat på saldo per person.)
        </div>
      </section>

      {/* Balans */}
      <section className="card stack">
        <div className="card__header baseline">
          <h3>Saldo per person</h3>
          <span className="badge">Andel: {formatKr(sharePerPersonOre)}</span>
        </div>

        {members.length === 0 ? (
          <div className="note">Inga medlemmar hittades.</div>
        ) : (
          <ul className="list" style={{ gap: 6 }}>
            {balances.map((b) => {
              const positive = b.balance_ore >= 0;
              return (
                <li key={b.user_id} className="listItem--row" style={{ alignItems: "baseline" }}>
                  <div className="flex-1" style={{ fontWeight: 700 }}>
                    {b.display_name}
                  </div>

                  <span
                    className={positive ? "statusPill statusPill--ok" : "statusPill statusPill--missing"}
                    title={positive ? "Har lagt ut mer än sin andel" : "Har lagt ut mindre än sin andel"}
                  >
                    {positive ? `+${formatKr(b.balance_ore)}` : `-${formatKr(Math.abs(b.balance_ore))}`}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* Utgifter per person */}
      <section className="stack">
        <div className="card__header baseline">
          <h3 style={{ margin: 0 }}>Utgifter</h3>
          <span className="note">Senaste först</span>
        </div>

        {groupedExpenses.map((g) => (
          <section key={g.member.user_id} className="card stack">
            <div className="card__header baseline">
              <div style={{ display: "grid", gap: 4 }}>
                <div style={{ fontWeight: 850, letterSpacing: "-0.01em" }}>{g.member.display_name}</div>
                <div className="note">{g.items.length} st</div>
              </div>
              <span className="badge">{formatKr(g.total_ore)}</span>
            </div>

            {g.items.length === 0 ? (
              <div className="note">Inga utgifter ännu.</div>
            ) : (
              <ul className="list" style={{ gap: 6 }}>
                {g.items.map((e) => {
                  const canDelete = e.created_by === userId;
                  return (
                    <li key={e.id} className="listItem--row">
                      <div className="flex-1" style={{ minWidth: 0 }}>
                        <div style={{ fontWeight: 750 }}>{e.title}</div>
                        <div className="itemMeta">
                          {new Date(e.created_at).toLocaleString("sv-SE")}
                        </div>
                      </div>

                      <div style={{ fontWeight: 800 }}>{formatKr(e.amount_ore)}</div>

                      {canDelete ? (
                        <button className="btn btn--danger btn--sm iconbtn iconbtn--sm" onClick={() => removeExpense(e)} title="Ta bort">
                          ✕
                        </button>
                      ) : (
                        <span style={{ width: 34 }} />
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        ))}
      </section>

      {msg && <div className="alert">{msg}</div>}
      {!householdId && <div className="note">Du har inget hushåll ännu.</div>}
    </div>
  );
}
