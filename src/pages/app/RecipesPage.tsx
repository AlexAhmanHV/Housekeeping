import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../../lib/supabase";

type Recipe = { id: string; title: string; tags: string[] };

export default function RecipesPage() {
  const [householdId, setHouseholdId] = useState<string | null>(null);
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [title, setTitle] = useState("");
  const [tagsText, setTagsText] = useState("");
  const [msg, setMsg] = useState<string | null>(null);

  async function load(hid: string) {
    const { data, error } = await supabase
      .from("recipes")
      .select("id,title,tags")
      .eq("household_id", hid)
      .order("created_at", { ascending: false });

    if (error) setMsg(error.message);
    else {
      setMsg(null);
      setRecipes((data ?? []) as Recipe[]);
    }
  }

  useEffect(() => {
    let channel: ReturnType<typeof supabase.channel> | null = null;

    async function init() {
      setMsg(null);

      const { data: userRes } = await supabase.auth.getUser();
      const uid = userRes.user?.id;
      if (!uid) return setMsg("Inte inloggad.");

      const { data: ms, error: msErr } = await supabase
        .from("memberships")
        .select("household_id")
        .eq("user_id", uid)
        .limit(1);

      if (msErr) return setMsg(msErr.message);

      const hid = ms?.[0]?.household_id;
      if (!hid) return setMsg("Du har inget hushåll ännu.");

      setHouseholdId(hid);
      await load(hid);

      channel = supabase
        .channel(`recipes:${hid}`)
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "recipes", filter: `household_id=eq.${hid}` },
          () => load(hid)
        )
        .subscribe();
    }

    init();

    return () => {
      if (channel) supabase.removeChannel(channel);
    };
  }, []);

  async function addRecipe() {
    setMsg(null);
    const t = title.trim();
    if (!t || !householdId) return;

    const { data: userRes } = await supabase.auth.getUser();
    const uid = userRes.user?.id;
    if (!uid) return setMsg("Inte inloggad.");

    const tags = tagsText
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);

    const { error } = await supabase.from("recipes").insert({
      household_id: householdId,
      title: t,
      tags,
      created_by: uid,
    });

    if (error) return setMsg(error.message);

    setTitle("");
    setTagsText("");
  }

  async function removeRecipe(r: Recipe) {
    setMsg(null);
    const { error } = await supabase.from("recipes").delete().eq("id", r.id);
    if (error) return setMsg(error.message);
  }

  return (
  <div className="page stack">
    <h2>Rätter</h2>

    {/* Add recipe */}
    <section className="card formCard">
      <input
        className="input"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Ny rätt (t.ex. Kycklingwok)…"
        onKeyDown={(e) => e.key === "Enter" && addRecipe()}
      />

      <input
        className="input"
        value={tagsText}
        onChange={(e) => setTagsText(e.target.value)}
        placeholder="Taggar (komma-separerade), t.ex. snabb, veg, pasta"
        onKeyDown={(e) => e.key === "Enter" && addRecipe()}
      />

      <div className="row row--wrap">
        <button className="btn btn--primary" onClick={addRecipe}>
          Lägg till
        </button>
        <div className="note">Skriv taggar med kommatecken. Ex: <span className="code">snabb, veg, pasta</span></div>
      </div>
    </section>

    {/* List */}
    <ul className="list">
      {recipes.map((r) => (
        <li key={r.id} className="listItem">
          <div className="recipeRow">
            <div className="recipeMain">
              <Link to={`/app/recipes/${r.id}`} className="recipeLink">
                {r.title}
              </Link>

              {r.tags?.length > 0 && (
                <div className="tags">
                  {r.tags.map((t) => (
                    <span key={t} className="tag">
                      {t}
                    </span>
                  ))}
                </div>
              )}
            </div>

            <button className="btn btn--danger iconbtn iconbtn--sm" onClick={() => removeRecipe(r)} title="Ta bort">
              ✕
            </button>
          </div>
        </li>
      ))}
    </ul>

    {msg && <div className="alert">{msg}</div>}
  </div>
);
}
