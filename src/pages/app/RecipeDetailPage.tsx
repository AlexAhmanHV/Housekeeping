import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { supabase } from "../../lib/supabase";

type Recipe = { id: string; title: string; tags: string[]; household_id: string };
type Ingredient = { id: string; name: string; qty: number | null; unit: string | null };
type PantryItem = { id: string; name: string; qty: number | null; unit: string | null };

function norm(s: string) {
  return s.trim().toLowerCase();
}

export default function RecipeDetailPage() {
  const nav = useNavigate();
  const { id } = useParams<{ id: string }>();

  const [userId, setUserId] = useState<string | null>(null);
  const [recipe, setRecipe] = useState<Recipe | null>(null);
  const [ings, setIngs] = useState<Ingredient[]>([]);
  const [pantry, setPantry] = useState<PantryItem[]>([]);

  const [ingName, setIngName] = useState("");
  const [ingQty, setIngQty] = useState<string>("");
  const [ingUnit, setIngUnit] = useState<string>("st");

  const [msg, setMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  async function loadAll(recipeId: string) {
    setMsg(null);

    const { data: r, error: rErr } = await supabase
      .from("recipes")
      .select("id,title,tags,household_id")
      .eq("id", recipeId)
      .single();

    if (rErr) {
      setMsg(rErr.message);
      return;
    }

    setRecipe(r as Recipe);

    const hid = (r as Recipe).household_id;

    const [ingRes, pantryRes] = await Promise.all([
      supabase
        .from("recipe_ingredients")
        .select("id,name,qty,unit")
        .eq("recipe_id", recipeId)
        .order("created_at", { ascending: true }),
      supabase
        .from("pantry_items")
        .select("id,name,qty,unit")
        .eq("household_id", hid)
        .order("created_at", { ascending: true }),
    ]);

    if (ingRes.error) setMsg(ingRes.error.message);
    else setIngs((ingRes.data ?? []) as Ingredient[]);

    if (pantryRes.error) setMsg(pantryRes.error.message);
    else setPantry((pantryRes.data ?? []) as PantryItem[]);

    setLoading(false);
  }

  useEffect(() => {
    let ch: ReturnType<typeof supabase.channel> | null = null;
    let alive = true;

    async function init() {
      setLoading(true);
      setMsg(null);

      if (!id) {
        setMsg("Saknar recept-id.");
        setLoading(false);
        return;
      }

      const { data: userRes } = await supabase.auth.getUser();
      const uid = userRes.user?.id;
      if (!uid) {
        setMsg("Inte inloggad.");
        setLoading(false);
        return;
      }
      setUserId(uid);

      await loadAll(id);
      if (!alive) return;

      // realtime på ingredienser för detta recept
      ch = supabase
        .channel(`ri:${id}`)
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "recipe_ingredients", filter: `recipe_id=eq.${id}` },
          () => loadAll(id)
        )
        .subscribe();
    }

    init();

    return () => {
      alive = false;
      if (ch) supabase.removeChannel(ch);
    };
  }, [id]);

  const pantrySet = useMemo(() => {
    const set = new Set<string>();
    for (const p of pantry) set.add(norm(p.name));
    return set;
  }, [pantry]);

  const missing = useMemo(() => {
    return ings.filter((i) => !pantrySet.has(norm(i.name)));
  }, [ings, pantrySet]);

  async function addIngredient() {
    setMsg(null);
    if (!id || !recipe?.household_id || !userId) return;

    const n = ingName.trim();
    if (!n) return;

    const q = ingQty.trim() === "" ? null : Number(ingQty);
    if (ingQty.trim() !== "" && Number.isNaN(q)) return setMsg("Mängd måste vara ett nummer.");

    const { error } = await supabase.from("recipe_ingredients").insert({
      recipe_id: id,
      household_id: recipe.household_id,
      name: n,
      qty: q,
      unit: ingUnit.trim() || null,
      created_by: userId,
    });

    if (error) return setMsg(error.message);

    setIngName("");
    setIngQty("");
    setIngUnit("st");
  }

  async function removeIngredient(i: Ingredient) {
    setMsg(null);
    const { error } = await supabase.from("recipe_ingredients").delete().eq("id", i.id);
    if (error) return setMsg(error.message);
  }

  async function addMissingToShopping() {
    setMsg(null);
    if (!recipe?.household_id || !userId) return;

    if (missing.length === 0) {
      setMsg("Inget saknas 🎉");
      return;
    }

    // Skapa en unik lista baserat på namn
    const uniqueNames = Array.from(new Set(missing.map((m) => norm(m.name))));

    // Kolla vad som redan finns i shopping listan för att undvika dubbletter
    const { data: existing, error: exErr } = await supabase
      .from("shopping_items")
      .select("text")
      .eq("household_id", recipe.household_id);

    if (exErr) return setMsg(exErr.message);

    const existingSet = new Set((existing ?? []).map((x: any) => norm(String(x.text))));

    const rows = uniqueNames
      .filter((n) => !existingSet.has(n))
      .map((n) => ({
        household_id: recipe.household_id,
        text: n, // spara som text (enkelt)
        created_by: userId,
      }));

    if (rows.length === 0) {
      setMsg("Allt saknat finns redan i inköpslistan ✅");
      return;
    }

    const { error } = await supabase.from("shopping_items").insert(rows);
    if (error) return setMsg(error.message);

    setMsg(`Lade till ${rows.length} saknade i inköpslistan ✅`);
  }

  if (loading) return <div>Laddar…</div>;

  if (!recipe) {
    return (
      <div style={{ display: "grid", gap: 10 }}>
        <div>Hittade inget recept.</div>
        <button onClick={() => nav("/app/recipes")} style={{ padding: "10px 12px", borderRadius: 10 }}>
          Tillbaka
        </button>
        {msg && <div style={{ padding: 10, background: "#f4f4f4", borderRadius: 10 }}>{msg}</div>}
      </div>
    );
  }

  return (
  <div className="page stack">
    {/* Header */}
    <section className="card stack">
      <div className="topbar">
        <div className="titleBlock">
          <Link to="/app/recipes" className="backLink">
            ← Tillbaka
          </Link>

          <h2>{recipe.title}</h2>

          {recipe.tags?.length > 0 && (
            <div className="tags">
              {recipe.tags.map((t) => (
                <span key={t} className="tag">
                  {t}
                </span>
              ))}
            </div>
          )}

          <div className="kicker">
            {missing.length === 0 ? (
              <span className="statusPill statusPill--ok">Inget saknas 🎉</span>
            ) : (
              <span className="statusPill statusPill--missing">
                Saknas: <b style={{ color: "var(--text)" }}>{missing.length}</b>
              </span>
            )}
          </div>
        </div>

        <div className="ctaRow">
          <button className="btn btn--primary" onClick={addMissingToShopping}>
            Lägg saknade i inköpslistan
          </button>
        </div>
      </div>
    </section>

    {/* Ingredients */}
    <section className="card formCard">
      <div className="card__header">
        <h3>Ingredienser</h3>
        <span className="badge">{ings.length} st</span>
      </div>

      <div className="stack" style={{ gap: 10 }}>
        <input
          className="input"
          value={ingName}
          onChange={(e) => setIngName(e.target.value)}
          placeholder="T.ex. kyckling, crème fraîche, ris…"
          onKeyDown={(e) => e.key === "Enter" && addIngredient()}
        />

        <div className="row row--wrap">
          <input
            className="input w-160"
            value={ingQty}
            onChange={(e) => setIngQty(e.target.value)}
            placeholder="Mängd (valfritt)"
          />
          <input
            className="input w-160"
            value={ingUnit}
            onChange={(e) => setIngUnit(e.target.value)}
            placeholder="Enhet"
          />
          <button className="btn btn--primary" onClick={addIngredient}>
            Lägg till
          </button>
        </div>

        <ul className="list">
          {ings.map((i) => {
            const has = pantrySet.has(norm(i.name));
            return (
              <li key={i.id} className="listItem">
                <div className="ingRow">
                  <div className="ingMain">
                    <div className="ingName">
                      {i.name}
                      <span className="ingQty">
                        {i.qty != null ? `${i.qty} ` : ""}
                        {i.unit ?? ""}
                      </span>
                    </div>

                    <div className="ingStatus">
                      {has ? (
                        <span className="statusPill statusPill--ok">Finns hemma ✅</span>
                      ) : (
                        <span className="statusPill statusPill--missing">Saknas</span>
                      )}
                    </div>
                  </div>

                  <button
                    className="btn btn--danger iconbtn iconbtn--sm"
                    onClick={() => removeIngredient(i)}
                    title="Ta bort"
                    aria-label="Ta bort ingrediens"
                  >
                    ✕
                  </button>
                </div>
              </li>
            );
          })}
        </ul>

        {missing.length > 0 && (
          <div className="note">
            Saknas: <b style={{ color: "var(--text)" }}>{missing.map((m) => m.name).join(", ")}</b>
          </div>
        )}
      </div>
    </section>

    {msg && <div className="alert">{msg}</div>}
  </div>
);

}
