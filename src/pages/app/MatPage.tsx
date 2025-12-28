import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../../lib/supabase";

type PantryItem = { id: string; name: string };
type ShoppingItem = { id: string; text: string; checked: boolean };
type Recipe = { id: string; title: string };

function norm(s: string) {
  return s.trim().toLowerCase();
}

export default function MatPage() {
  const [householdId, setHouseholdId] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);

  const [pantry, setPantry] = useState<PantryItem[]>([]);
  const [shopping, setShopping] = useState<ShoppingItem[]>([]);
  const [recipes, setRecipes] = useState<Recipe[]>([]);

  const [pantryText, setPantryText] = useState("");
  const [shoppingText, setShoppingText] = useState("");
  const [recipeTitle, setRecipeTitle] = useState("");

  const [msg, setMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Debounce edit (så vi inte skickar update vid varje tangent)
  const editTimers = useRef<Record<string, number>>({});

  const pantrySet = useMemo(() => new Set(pantry.map((p) => norm(p.name))), [pantry]);
  const uncheckedCount = useMemo(() => shopping.filter((x) => !x.checked).length, [shopping]);

  async function loadAll(hid: string) {
    // Pantry
    const pantryRes = await supabase
      .from("pantry_items")
      .select("id,name")
      .eq("household_id", hid)
      .order("created_at", { ascending: true });

    if (pantryRes.error) setMsg(pantryRes.error.message);
    else setPantry((pantryRes.data ?? []) as PantryItem[]);

    // Shopping
    const shopRes = await supabase
      .from("shopping_items")
      .select("id,text,checked")
      .eq("household_id", hid)
      .order("created_at", { ascending: true });

    if (shopRes.error) setMsg(shopRes.error.message);
    else setShopping((shopRes.data ?? []) as ShoppingItem[]);

    // Recipes
    const recRes = await supabase
      .from("recipes")
      .select("id,title")
      .eq("household_id", hid)
      .order("created_at", { ascending: false });

    if (recRes.error) setMsg(recRes.error.message);
    else setRecipes((recRes.data ?? []) as Recipe[]);
  }

  useEffect(() => {
    let alive = true;
    let chPantry: ReturnType<typeof supabase.channel> | null = null;
    let chShop: ReturnType<typeof supabase.channel> | null = null;
    let chRec: ReturnType<typeof supabase.channel> | null = null;

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

      const hid = ms?.[0]?.household_id ?? null;
      if (!hid) {
        setMsg("Du har inget hushåll ännu.");
        setLoading(false);
        return;
      }

      setHouseholdId(hid);

      await loadAll(hid);
      if (!alive) return;

      // Realtime (laddar om listorna när något ändras)
      chPantry = supabase
        .channel(`mat:pantry:${hid}`)
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "pantry_items", filter: `household_id=eq.${hid}` },
          () => loadAll(hid)
        )
        .subscribe();

      chShop = supabase
        .channel(`mat:shopping:${hid}`)
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "shopping_items", filter: `household_id=eq.${hid}` },
          () => loadAll(hid)
        )
        .subscribe();

      chRec = supabase
        .channel(`mat:recipes:${hid}`)
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "recipes", filter: `household_id=eq.${hid}` },
          () => loadAll(hid)
        )
        .subscribe();

      setLoading(false);
    }

    init();

    return () => {
      alive = false;
      if (chPantry) supabase.removeChannel(chPantry);
      if (chShop) supabase.removeChannel(chShop);
      if (chRec) supabase.removeChannel(chRec);
    };
  }, []);

  // -------------------------
  // Pantry (Finns hemma)
  // -------------------------

  async function addPantry() {
    setMsg(null);
    if (!householdId || !userId) return;

    const name = pantryText.trim();
    if (!name) return;

    // Undvik dubletter
    if (pantrySet.has(norm(name))) {
      setPantryText("");
      return;
    }

    const tempId = `temp-${crypto.randomUUID()}`;
    setPantry((prev) => [...prev, { id: tempId, name }]);
    setPantryText("");

    const { data, error } = await supabase
      .from("pantry_items")
      .insert({ household_id: householdId, name, created_by: userId })
      .select("id,name")
      .single();

    if (error) {
      setMsg(error.message);
      setPantry((prev) => prev.filter((x) => x.id !== tempId));
      return;
    }

    setPantry((prev) => prev.map((x) => (x.id === tempId ? (data as PantryItem) : x)));
  }

  function schedulePantryRename(id: string, name: string) {
    // UI direkt
    setPantry((prev) => prev.map((x) => (x.id === id ? { ...x, name } : x)));

    // Debounce DB
    const prevTimer = editTimers.current[id];
    if (prevTimer) window.clearTimeout(prevTimer);

    editTimers.current[id] = window.setTimeout(async () => {
      const { error } = await supabase.from("pantry_items").update({ name }).eq("id", id);
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

  // -------------------------
  // Shopping (Behöver köpas)
  // -------------------------

  async function addShopping() {
    setMsg(null);
    if (!householdId || !userId) return;

    const text = shoppingText.trim();
    if (!text) return;

    const tempId = `temp-${crypto.randomUUID()}`;
    setShopping((prev) => [...prev, { id: tempId, text, checked: false }]);
    setShoppingText("");

    const { data, error } = await supabase
      .from("shopping_items")
      .insert({ household_id: householdId, text, created_by: userId })
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

    const ids = shopping.filter((x) => x.checked).map((x) => x.id);
    if (ids.length === 0) return;

    const snapshot = shopping;
    setShopping((prev) => prev.filter((x) => !x.checked));

    const { error } = await supabase.from("shopping_items").delete().in("id", ids);
    if (error) {
      setMsg(error.message);
      setShopping(snapshot);
    }
  }

  async function moveToPantryFromShopping(item: ShoppingItem) {
    setMsg(null);
    if (!householdId || !userId) return;

    const name = item.text.trim();
    if (!name) return;

    const snapshot = shopping;
    setShopping((prev) => prev.filter((x) => x.id !== item.id));

    try {
      if (!pantrySet.has(norm(name))) {
        const { error: insErr } = await supabase.from("pantry_items").insert({
          household_id: householdId,
          name,
          created_by: userId,
        });
        if (insErr) throw new Error(insErr.message);
      }

      const { error: delErr } = await supabase.from("shopping_items").delete().eq("id", item.id);
      if (delErr) throw new Error(delErr.message);
    } catch (e: any) {
      setMsg(e?.message ?? "Kunde inte flytta till ‘finns hemma’.");
      setShopping(snapshot);
    }
  }

  // -------------------------
  // Recipes (Maträttsbank)
  // -------------------------

  async function addRecipe() {
    setMsg(null);
    if (!householdId || !userId) return;

    const title = recipeTitle.trim();
    if (!title) return;

    const tempId = `temp-${crypto.randomUUID()}`;
    setRecipes((prev) => [{ id: tempId, title }, ...prev]);
    setRecipeTitle("");

    const { data, error } = await supabase
      .from("recipes")
      .insert({ household_id: householdId, title, tags: [], created_by: userId })
      .select("id,title")
      .single();

    if (error) {
      setMsg(error.message);
      setRecipes((prev) => prev.filter((x) => x.id !== tempId));
      return;
    }

    setRecipes((prev) => prev.map((x) => (x.id === tempId ? (data as Recipe) : x)));
  }

  async function removeRecipe(r: Recipe) {
    setMsg(null);

    const snapshot = recipes;
    setRecipes((prev) => prev.filter((x) => x.id !== r.id));

    const { error } = await supabase.from("recipes").delete().eq("id", r.id);
    if (error) {
      setMsg(error.message);
      setRecipes(snapshot);
    }
  }

  if (loading) return <div className="page loading">Laddar…</div>;

  return (
    <div className="page stack">
      <header className="stack" style={{ gap: 6 }}>
        <h2>Mat</h2>
        <div className="note">
          Hemma: {pantry.length} • Handla: {uncheckedCount} • Rätter: {recipes.length}
        </div>
      </header>

      {/* -------- Pantry -------- */}
      <section className="card stack">
        <div className="card__header">
          <h3>Detta finns hemma</h3>
          <span className="badge">{pantry.length} st</span>
        </div>

        <div className="row">
          <input
            className="input flex-1"
            value={pantryText}
            onChange={(e) => setPantryText(e.target.value)}
            placeholder="Skriv en grej… (t.ex. Bananer)"
            onKeyDown={(e) => e.key === "Enter" && addPantry()}
          />
          <button className="btn btn--primary" onClick={addPantry} aria-label="Lägg till hemma">
            +
          </button>
        </div>

        <ul className="list">
          {pantry.map((p) => (
            <li key={p.id} className="listItem">
              <div className="row">
                <input
                  className="input flex-1"
                  value={p.name}
                  onChange={(e) => schedulePantryRename(p.id, e.target.value)}
                />
                <button
                  className="btn btn--danger iconbtn iconbtn--sm"
                  onClick={() => removePantry(p)}
                  title="Ta bort"
                >
                  ✕
                </button>
              </div>
            </li>
          ))}
        </ul>
      </section>

      {/* -------- Shopping -------- */}
      <section className="card stack">
        <div className="card__header">
          <h3>Detta behövs köpas</h3>
          <button className="btn btn--ghost btn--sm" onClick={clearChecked}>
            Rensa avbockade
          </button>
        </div>

        <div className="row">
          <input
            className="input flex-1"
            value={shoppingText}
            onChange={(e) => setShoppingText(e.target.value)}
            placeholder="Lägg till… (t.ex. Mjölk)"
            onKeyDown={(e) => e.key === "Enter" && addShopping()}
          />
          <button className="btn btn--primary" onClick={addShopping} aria-label="Lägg till vara">
            +
          </button>
        </div>

        <ul className="list" style={{ gap: 6 }}>
          {shopping.map((s) => (
            <li key={s.id} className="listItem--row">
              <input className="checkbox" type="checkbox" checked={s.checked} onChange={() => toggleShopping(s)} />
              <span className={s.checked ? "strike flex-1" : "flex-1"}>{s.text}</span>

              <button
                className="btn btn--sm"
                onClick={() => moveToPantryFromShopping(s)}
                title="Flytta till ‘finns hemma’"
              >
                → Hemma
              </button>

              <button className="btn btn--danger btn--sm" onClick={() => removeShopping(s)} title="Ta bort">
                ✕
              </button>
            </li>
          ))}
        </ul>
      </section>

      {/* -------- Recipes -------- */}
      <section className="card stack">
        <div className="card__header">
          <h3>Maträttsbank</h3>
          <span className="badge">{recipes.length} st</span>
        </div>

        <div className="row">
          <input
            className="input flex-1"
            value={recipeTitle}
            onChange={(e) => setRecipeTitle(e.target.value)}
            placeholder="Lägg till rätt… (t.ex. Tacos)"
            onKeyDown={(e) => e.key === "Enter" && addRecipe()}
          />
          <button className="btn btn--primary" onClick={addRecipe} aria-label="Lägg till rätt">
            +
          </button>
        </div>

        <ul className="list">
          {recipes.map((r) => (
            <li key={r.id} className="listItem">
              <div className="row">
                <div className="flex-1" style={{ fontWeight: 700 }}>
                  {r.title}
                </div>
                <button
                  className="btn btn--danger iconbtn iconbtn--sm"
                  onClick={() => removeRecipe(r)}
                  title="Ta bort"
                >
                  ✕
                </button>
              </div>
            </li>
          ))}
        </ul>
      </section>

      {msg && <div className="alert">{msg}</div>}
      {!householdId && <div className="note">Du har inget hushåll ännu.</div>}
    </div>
  );
}
