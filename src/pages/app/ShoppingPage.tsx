import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../../lib/supabase";

export type Mode = "pantry" | "shopping" | "both";

type ShoppingItem = { id: string; text: string; checked: boolean };
type PantryItem = { id: string; name: string; qty: number | null; unit: string | null };

function norm(s: string) {
  return s.trim().toLowerCase();
}

export default function ShoppingPage({ mode = "both" }: { mode?: Mode }) {
  const [householdId, setHouseholdId] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);

  // Shopping
  const [shopping, setShopping] = useState<ShoppingItem[]>([]);
  const [shoppingText, setShoppingText] = useState("");

  // Pantry
  const [pantry, setPantry] = useState<PantryItem[]>([]);
  const [pantryName, setPantryName] = useState("");
  const [pantryQty, setPantryQty] = useState<string>("");
  const [pantryUnit, setPantryUnit] = useState<string>("st");

  const [msg, setMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Debounce updates for pantry edits
  const pantryTimers = useRef<Record<string, number>>({});

  async function loadShopping(hid: string) {
    const { data, error } = await supabase
      .from("shopping_items")
      .select("id,text,checked")
      .eq("household_id", hid)
      .order("created_at", { ascending: true });

    if (error) setMsg(error.message);
    else setShopping((data ?? []) as ShoppingItem[]);
  }

  async function loadPantry(hid: string) {
    const { data, error } = await supabase
      .from("pantry_items")
      .select("id,name,qty,unit")
      .eq("household_id", hid)
      .order("created_at", { ascending: true });

    if (error) setMsg(error.message);
    else setPantry((data ?? []) as PantryItem[]);
  }

  useEffect(() => {
    let chShop: ReturnType<typeof supabase.channel> | null = null;
    let chPantry: ReturnType<typeof supabase.channel> | null = null;
    let alive = true;

    async function init() {
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
      setUserId(uid);

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

      const hid = ms?.[0]?.household_id;
      if (!hid) {
        setMsg("Du har inget hushåll ännu.");
        setLoading(false);
        return;
      }

      setHouseholdId(hid);

      await Promise.all([loadShopping(hid), loadPantry(hid)]);
      if (!alive) return;

      // Realtime shopping
      chShop = supabase
        .channel(`shopping:${hid}`)
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "shopping_items", filter: `household_id=eq.${hid}` },
          () => loadShopping(hid)
        )
        .subscribe();

      // Realtime pantry
      chPantry = supabase
        .channel(`pantry:${hid}`)
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "pantry_items", filter: `household_id=eq.${hid}` },
          () => loadPantry(hid)
        )
        .subscribe();

      setLoading(false);
    }

    init();

    return () => {
      alive = false;
      if (chShop) supabase.removeChannel(chShop);
      if (chPantry) supabase.removeChannel(chPantry);
    };
  }, []);

  const pantryNameSet = useMemo(() => new Set(pantry.map((p) => norm(p.name))), [pantry]);

  // ---- SHOPPING actions ----

  async function addShopping() {
    setMsg(null);
    const t = shoppingText.trim();
    if (!t || !householdId || !userId) return;

    const tempId = `temp-${crypto.randomUUID()}`;
    setShopping((prev) => [...prev, { id: tempId, text: t, checked: false }]);
    setShoppingText("");

    const { data, error } = await supabase
      .from("shopping_items")
      .insert({ household_id: householdId, text: t, created_by: userId })
      .select("id,text,checked")
      .single();

    if (error) {
      setMsg(error.message);
      setShopping((prev) => prev.filter((x) => x.id !== tempId));
      return;
    }

    setShopping((prev) => prev.map((x) => (x.id === tempId ? (data as ShoppingItem) : x)));
  }

  async function toggleShopping(item: ShoppingItem) {
    setMsg(null);

    setShopping((prev) => prev.map((x) => (x.id === item.id ? { ...x, checked: !x.checked } : x)));

    const { error } = await supabase.from("shopping_items").update({ checked: !item.checked }).eq("id", item.id);
    if (error) {
      setMsg(error.message);
      setShopping((prev) => prev.map((x) => (x.id === item.id ? { ...x, checked: item.checked } : x)));
    }
  }

  async function removeShopping(item: ShoppingItem) {
    setMsg(null);

    const snapshot = shopping;
    setShopping((prev) => prev.filter((x) => x.id !== item.id));

    const { error } = await supabase.from("shopping_items").delete().eq("id", item.id);
    if (error) {
      setMsg(error.message);
      setShopping(snapshot);
    }
  }

  async function clearChecked() {
    setMsg(null);
    if (!householdId) return;

    const checkedIds = shopping.filter((s) => s.checked).map((s) => s.id);
    if (checkedIds.length === 0) return;

    const snapshot = shopping;
    setShopping((prev) => prev.filter((x) => !x.checked));

    const { error } = await supabase.from("shopping_items").delete().in("id", checkedIds);
    if (error) {
      setMsg(error.message);
      setShopping(snapshot);
    }
  }

  async function moveToPantry(item: ShoppingItem) {
    setMsg(null);
    if (!householdId || !userId) return;

    const name = item.text.trim();
    if (!name) return;

    const snapshot = shopping;
    setShopping((prev) => prev.filter((x) => x.id !== item.id));

    try {
      if (!pantryNameSet.has(norm(name))) {
        const { error: insErr } = await supabase.from("pantry_items").insert({
          household_id: householdId,
          name,
          qty: null,
          unit: null,
          created_by: userId,
        });
        if (insErr) throw new Error(insErr.message);
      }

      const { error: delErr } = await supabase.from("shopping_items").delete().eq("id", item.id);
      if (delErr) throw new Error(delErr.message);
    } catch (e: any) {
      setMsg(e?.message ?? "Kunde inte flytta till 'finns hemma'.");
      setShopping(snapshot);
    }
  }

  // ---- PANTRY actions ----

  async function addPantry() {
    setMsg(null);
    const n = pantryName.trim();
    if (!n || !householdId || !userId) return;

    const q = pantryQty.trim() === "" ? null : Number(pantryQty);
    if (pantryQty.trim() !== "" && Number.isNaN(q)) return setMsg("Mängd måste vara ett nummer.");

    const tempId = `temp-${crypto.randomUUID()}`;
    const optimistic: PantryItem = { id: tempId, name: n, qty: q, unit: pantryUnit.trim() || null };
    setPantry((prev) => [...prev, optimistic]);

    setPantryName("");
    setPantryQty("");
    setPantryUnit("st");

    const { data, error } = await supabase
      .from("pantry_items")
      .insert({
        household_id: householdId,
        name: n,
        qty: q,
        unit: pantryUnit.trim() || null,
        created_by: userId,
      })
      .select("id,name,qty,unit")
      .single();

    if (error) {
      setMsg(error.message);
      setPantry((prev) => prev.filter((x) => x.id !== tempId));
      return;
    }

    setPantry((prev) => prev.map((x) => (x.id === tempId ? (data as PantryItem) : x)));
  }

  function schedulePantryUpdate(id: string, patch: Partial<PantryItem>) {
    setPantry((prev) => prev.map((x) => (x.id === id ? { ...x, ...patch } : x)));

    const prevTimer = pantryTimers.current[id];
    if (prevTimer) window.clearTimeout(prevTimer);

    pantryTimers.current[id] = window.setTimeout(async () => {
      const { error } = await supabase.from("pantry_items").update(patch).eq("id", id);
      if (error) setMsg(error.message);
    }, 350);
  }

  async function removePantry(item: PantryItem) {
    setMsg(null);

    const snapshot = pantry;
    setPantry((prev) => prev.filter((x) => x.id !== item.id));

    const { error } = await supabase.from("pantry_items").delete().eq("id", item.id);
    if (error) {
      setMsg(error.message);
      setPantry(snapshot);
    }
  }

  // ---- UI ----

  if (loading) return <div className="page">Laddar…</div>;

  return (
    <div className="page stack">
      {/* Pantry */}
      {(mode === "pantry" || mode === "both") && (
        <section className="card stack">
          <div className="card__header">
            <h3>Detta finns hemma</h3>
            <div className="badge">{pantry.length} st</div>
          </div>

          <div className="stack" style={{ gap: 8 }}>
            <input
              className="input"
              value={pantryName}
              onChange={(e) => setPantryName(e.target.value)}
              placeholder="T.ex. Pasta, Krossade tomater…"
              onKeyDown={(e) => e.key === "Enter" && addPantry()}
            />

            <div className="row row--wrap">
              <input
                className="input w-160"
                value={pantryQty}
                onChange={(e) => setPantryQty(e.target.value)}
                placeholder="Mängd (valfritt)"
              />
              <input
                className="input w-160"
                value={pantryUnit}
                onChange={(e) => setPantryUnit(e.target.value)}
                placeholder="Enhet (st/kg/g/ml...)"
              />
              <button className="btn btn--primary" onClick={addPantry}>
                Lägg till
              </button>
            </div>
          </div>

          <ul className="list">
            {pantry.map((it) => (
              <li key={it.id} className="listItem">
                <div className="row row--wrap">
                  <input
                    className="input flex-1 min-180"
                    value={it.name}
                    onChange={(e) => schedulePantryUpdate(it.id, { name: e.target.value })}
                  />

                  <input
                    className="input w-110"
                    value={it.qty ?? ""}
                    onChange={(e) => {
                      const v = e.target.value;
                      if (v.trim() === "") return schedulePantryUpdate(it.id, { qty: null });
                      const num = Number(v);
                      if (!Number.isNaN(num)) schedulePantryUpdate(it.id, { qty: num });
                    }}
                    placeholder="qty"
                  />

                  <input
                    className="input w-110"
                    value={it.unit ?? ""}
                    onChange={(e) => schedulePantryUpdate(it.id, { unit: e.target.value })}
                    placeholder="enhet"
                  />

                  <button className="btn btn--danger iconbtn" onClick={() => removePantry(it)} title="Ta bort">
                    ✕
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Shopping */}
      {(mode === "shopping" || mode === "both") && (
        <section className="card stack">
          <div className="card__header">
            <h3>Detta behövs köpas</h3>

            <div className="row">
              <div className="badge">{shopping.filter((x) => !x.checked).length} kvar</div>
              <button className="btn btn--ghost btn--sm" onClick={clearChecked}>
                Rensa avbockade
              </button>
            </div>
          </div>

          <div className="row">
            <input
              className="input flex-1"
              value={shoppingText}
              onChange={(e) => setShoppingText(e.target.value)}
              placeholder="Lägg till vara…"
              onKeyDown={(e) => e.key === "Enter" && addShopping()}
            />
            <button className="btn btn--primary" onClick={addShopping} aria-label="Lägg till">
              +
            </button>
          </div>

          <ul className="list" style={{ gap: 6 }}>
            {shopping.map((it) => (
              <li key={it.id} className="listItem--row">
                <input className="checkbox" type="checkbox" checked={it.checked} onChange={() => toggleShopping(it)} />
                <span className={it.checked ? "strike flex-1" : "flex-1"}>{it.text}</span>

                <button className="btn btn--sm" onClick={() => moveToPantry(it)} title="Flytta till 'finns hemma'">
                  → Hemma
                </button>

                <button className="btn btn--danger btn--sm" onClick={() => removeShopping(it)} title="Ta bort">
                  ✕
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {msg && <div className="alert">{msg}</div>}
    </div>
  );
}
