import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../lib/supabase";

type Todo = {
  id: string;
  title: string;
  done: boolean;
  assigned_to: string | null;
};

type Member = {
  user_id: string;
  role: string;
  display_name: string;
};

type Filter = "all" | "mine" | "unassigned";

export default function TodosPage() {
  const [householdId, setHouseholdId] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);

  const [members, setMembers] = useState<Member[]>([]);
  const [todos, setTodos] = useState<Todo[]>([]);

  const [title, setTitle] = useState("");
  const [assignee, setAssignee] = useState<string>(""); // "" = oassignad
  const [filter, setFilter] = useState<Filter>("all");

  const [msg, setMsg] = useState<string | null>(null);

  async function loadTodos(hid: string) {
    const { data, error } = await supabase
      .from("household_todos")
      .select("id,title,done,assigned_to")
      .eq("household_id", hid)
      .order("done", { ascending: true })
      .order("created_at", { ascending: false });

    if (error) setMsg(error.message);
    else {
      setMsg(null);
      setTodos((data ?? []) as Todo[]);
    }
  }

  async function loadMembers() {
    const { data, error } = await supabase.rpc("get_household_members");
    if (error) {
      setMsg(error.message);
      setMembers([]);
      return;
    }
    setMembers((data ?? []) as Member[]);
  }

  useEffect(() => {
    let channel: ReturnType<typeof supabase.channel> | null = null;

    async function init() {
      setMsg(null);

      const { data: userRes } = await supabase.auth.getUser();
      const user = userRes.user;
      if (!user) return setMsg("Inte inloggad.");
      setUserId(user.id);

      const { data: ms, error: msErr } = await supabase
        .from("memberships")
        .select("household_id")
        .eq("user_id", user.id)
        .limit(1);

      if (msErr) return setMsg(msErr.message);

      const hid = ms?.[0]?.household_id;
      if (!hid) return setMsg("Du har inget hushåll ännu.");

      setHouseholdId(hid);

      await loadMembers();
      await loadTodos(hid);

      channel = supabase
        .channel(`todos:${hid}`)
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "household_todos", filter: `household_id=eq.${hid}` },
          async () => {
            await loadTodos(hid);
          }
        )
        .subscribe();
    }

    init();

    return () => {
      if (channel) supabase.removeChannel(channel);
    };
  }, []);

  const visibleTodos = useMemo(() => {
    if (!userId) return todos;

    if (filter === "all") return todos;
    if (filter === "mine") return todos.filter((t) => t.assigned_to === userId);
    return todos.filter((t) => t.assigned_to == null);
  }, [todos, filter, userId]);

  function myName() {
    const me = members.find((m) => m.user_id === userId);
    const dn = (me?.display_name ?? "").trim();
    return dn ? dn : "Jag";
  }

  function memberLabel(m: Member) {
    const dn = (m.display_name ?? "").trim();
    if (m.user_id === userId) return myName();
    return dn ? dn : `Medlem ${m.user_id.slice(0, 6)}`;
  }

  // Samma logik för alla (inkl dig) – ingen "Jag" om du har valt ett namn
  function labelForUserId(uid: string | null) {
    if (!uid) return "Oassignad";
    const m = members.find((x) => x.user_id === uid);
    const dn = (m?.display_name ?? "").trim();
    if (dn) return dn;
    if (uid === userId) return myName();
    return `Medlem ${uid.slice(0, 6)}`;
  }

  async function addTodo() {
    setMsg(null);
    const t = title.trim();
    if (!t || !householdId || !userId) return;

    const { error } = await supabase.from("household_todos").insert({
      household_id: householdId,
      title: t,
      done: false,
      assigned_to: assignee ? assignee : null,
      created_by: userId,
    });

    if (error) return setMsg(error.message);

    setTitle("");
    setAssignee("");
    await loadTodos(householdId);
  }

  async function toggleTodo(todo: Todo) {
    setMsg(null);
    const next = !todo.done;

    const { error } = await supabase
      .from("household_todos")
      .update({ done: next, done_at: next ? new Date().toISOString() : null })
      .eq("id", todo.id);

    if (error) return setMsg(error.message);
    if (householdId) await loadTodos(householdId);
  }

  async function setAssigned(todo: Todo, assigned_to: string | null) {
    setMsg(null);
    const { error } = await supabase
      .from("household_todos")
      .update({ assigned_to })
      .eq("id", todo.id);

    if (error) return setMsg(error.message);
    if (householdId) await loadTodos(householdId);
  }

  async function removeTodo(todo: Todo) {
    setMsg(null);
    const { error } = await supabase.from("household_todos").delete().eq("id", todo.id);
    if (error) return setMsg(error.message);
    if (householdId) await loadTodos(householdId);
  }

  return (
  <div className="page stack">
    <h2>Att göra hemma</h2>

    {/* Filters */}
    <div className="chips" aria-label="Filter">
      <button
        className={filter === "all" ? "chip chip--active" : "chip"}
        onClick={() => setFilter("all")}
      >
        Alla
      </button>
      <button
        className={filter === "mine" ? "chip chip--active" : "chip"}
        onClick={() => setFilter("mine")}
      >
        Mina
      </button>
      <button
        className={filter === "unassigned" ? "chip chip--active" : "chip"}
        onClick={() => setFilter("unassigned")}
      >
        Oassignade
      </button>
    </div>

    {/* Add todo */}
    <section className="card formCard">
      <input
        className="input"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="T.ex. Dammsuga, Rensa avlopp…"
        onKeyDown={(e) => e.key === "Enter" && addTodo()}
      />

      <div className="row row--wrap">
        <div className="note">Tilldela:</div>

        <select className="select" value={assignee} onChange={(e) => setAssignee(e.target.value)}>
          <option value="">Oassignad</option>
          {members.map((m) => (
            <option key={m.user_id} value={m.user_id}>
              {memberLabel(m)}
            </option>
          ))}
        </select>

        <button className="btn btn--primary" onClick={addTodo}>
          Lägg till
        </button>
      </div>
    </section>

    {/* List */}
    <ul className="list">
      {visibleTodos.map((t) => (
        <li key={t.id} className="listItem">
          <div className="stack" style={{ gap: 10 }}>
            <div className="todoTop">
              <input className="checkbox" type="checkbox" checked={t.done} onChange={() => toggleTodo(t)} />
              <div className={t.done ? "todoTitle strike" : "todoTitle"}>{t.title}</div>

              <button className="btn btn--danger iconbtn iconbtn--sm" onClick={() => removeTodo(t)} title="Ta bort">
                ✕
              </button>
            </div>

            <div className="todoMetaRow">
              <div className="todoMeta">
                Ansvarig: <b style={{ color: "var(--text)" }}>{labelForUserId(t.assigned_to)}</b>
              </div>

              <select
                className="select select--sm"
                value={t.assigned_to ?? ""}
                onChange={(e) => setAssigned(t, e.target.value ? e.target.value : null)}
                aria-label="Ändra ansvarig"
              >
                <option value="">Oassignad</option>
                {members.map((m) => (
                  <option key={m.user_id} value={m.user_id}>
                    {memberLabel(m)}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </li>
      ))}
    </ul>

    {msg && <div className="alert">{msg}</div>}
  </div>
);

}
