import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../../lib/supabase";

type Todo = { id: string; title: string; done: boolean };
type EventRow = { id: string; title: string; starts_at: string; notes: string | null };

function formatSvDateTime(iso: string) {
  try {
    return new Date(iso).toLocaleString("sv-SE", { timeZone: "Europe/Stockholm" });
  } catch {
    return iso;
  }
}

function toLocalInputValue(iso: string) {
  // datetime-local vill ha: YYYY-MM-DDTHH:mm (utan timezone)
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  const yyyy = d.getFullYear();
  const mm = pad(d.getMonth() + 1);
  const dd = pad(d.getDate());
  const hh = pad(d.getHours());
  const mi = pad(d.getMinutes());
  return `${yyyy}-${mm}-${dd}T${hh}:${mi}`;
}

function fromLocalInputValue(local: string) {
  // tolka local som lokal tid -> ISO (UTC)
  const d = new Date(local);
  return d.toISOString();
}

export default function TasksEventsPage() {
  const [householdId, setHouseholdId] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);

  const [todos, setTodos] = useState<Todo[]>([]);
  const [events, setEvents] = useState<EventRow[]>([]);

  // inputs
  const [todoTitle, setTodoTitle] = useState("");

  const [eventTitle, setEventTitle] = useState("");
  const [eventStartsAt, setEventStartsAt] = useState(""); // datetime-local str
  const [eventNotes, setEventNotes] = useState("");

  const [msg, setMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Debounce edit för events (title/starts_at/notes)
  const eventTimers = useRef<Record<string, number>>({});

  const openTodosCount = useMemo(() => todos.filter((t) => !t.done).length, [todos]);
  const upcomingEventsCount = useMemo(() => {
    const now = Date.now();
    return events.filter((e) => new Date(e.starts_at).getTime() >= now).length;
  }, [events]);

  async function loadTodos(hid: string) {
    const { data, error } = await supabase
      .from("household_todos")
      .select("id,title,done")
      .eq("household_id", hid)
      .order("done", { ascending: true })
      .order("created_at", { ascending: false });

    if (error) setMsg(error.message);
    else setTodos((data ?? []) as Todo[]);
  }

  async function loadEvents(hid: string) {
    const { data, error } = await supabase
      .from("important_events")
      .select("id,title,starts_at,notes")
      .eq("household_id", hid)
      .order("starts_at", { ascending: true });

    if (error) setMsg(error.message);
    else setEvents((data ?? []) as EventRow[]);
  }

  async function loadAll(hid: string) {
    await Promise.all([loadTodos(hid), loadEvents(hid)]);
  }

  useEffect(() => {
    let alive = true;

    let chTodos: ReturnType<typeof supabase.channel> | null = null;
    let chEvents: ReturnType<typeof supabase.channel> | null = null;

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

      chTodos = supabase
        .channel(`ae:todos:${hid}`)
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "household_todos", filter: `household_id=eq.${hid}` },
          () => loadTodos(hid)
        )
        .subscribe();

      chEvents = supabase
        .channel(`ae:events:${hid}`)
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "important_events", filter: `household_id=eq.${hid}` },
          () => loadEvents(hid)
        )
        .subscribe();

      setLoading(false);
    }

    init();

    return () => {
      alive = false;
      if (chTodos) supabase.removeChannel(chTodos);
      if (chEvents) supabase.removeChannel(chEvents);
    };
  }, []);

  // -------------------------
  // TODOS
  // -------------------------

  async function addTodo() {
    setMsg(null);
    if (!householdId || !userId) return;

    const title = todoTitle.trim();
    if (!title) return;

    const tempId = `temp-${crypto.randomUUID()}`;
    setTodos((prev) => [{ id: tempId, title, done: false }, ...prev]);
    setTodoTitle("");

    const { data, error } = await supabase
      .from("household_todos")
      .insert({ household_id: householdId, title, done: false, created_by: userId })
      .select("id,title,done")
      .single();

    if (error) {
      setMsg(error.message);
      setTodos((prev) => prev.filter((x) => x.id !== tempId));
      return;
    }

    setTodos((prev) => prev.map((x) => (x.id === tempId ? (data as Todo) : x)));
  }

  async function toggleTodo(t: Todo) {
    setMsg(null);
    const next = !t.done;

    setTodos((prev) => prev.map((x) => (x.id === t.id ? { ...x, done: next } : x)));

    const { error } = await supabase
      .from("household_todos")
      .update({ done: next, done_at: next ? new Date().toISOString() : null })
      .eq("id", t.id);

    if (error) {
      setMsg(error.message);
      setTodos((prev) => prev.map((x) => (x.id === t.id ? { ...x, done: t.done } : x)));
    }
  }

  async function removeTodo(t: Todo) {
    setMsg(null);

    const snapshot = todos;
    setTodos((prev) => prev.filter((x) => x.id !== t.id));

    const { error } = await supabase.from("household_todos").delete().eq("id", t.id);
    if (error) {
      setMsg(error.message);
      setTodos(snapshot);
    }
  }

  async function clearDoneTodos() {
    setMsg(null);
    const doneIds = todos.filter((t) => t.done).map((t) => t.id);
    if (doneIds.length === 0) return;

    const snapshot = todos;
    setTodos((prev) => prev.filter((t) => !t.done));

    const { error } = await supabase.from("household_todos").delete().in("id", doneIds);
    if (error) {
      setMsg(error.message);
      setTodos(snapshot);
    }
  }

  // -------------------------
  // EVENTS
  // -------------------------

  async function addEvent() {
    setMsg(null);
    if (!householdId || !userId) return;

    const title = eventTitle.trim();
    if (!title) return;

    if (!eventStartsAt.trim()) {
      return setMsg("Välj datum & tid för evenemanget.");
    }

    const starts_at = fromLocalInputValue(eventStartsAt);
    const notes = eventNotes.trim() ? eventNotes.trim() : null;

    const tempId = `temp-${crypto.randomUUID()}`;
    setEvents((prev) => [...prev, { id: tempId, title, starts_at, notes }].sort((a, b) => +new Date(a.starts_at) - +new Date(b.starts_at)));
    setEventTitle("");
    setEventStartsAt("");
    setEventNotes("");

    const { data, error } = await supabase
      .from("important_events")
      .insert({ household_id: householdId, title, starts_at, notes, created_by: userId })
      .select("id,title,starts_at,notes")
      .single();

    if (error) {
      setMsg(error.message);
      setEvents((prev) => prev.filter((x) => x.id !== tempId));
      return;
    }

    setEvents((prev) =>
      prev
        .map((x) => (x.id === tempId ? (data as EventRow) : x))
        .sort((a, b) => +new Date(a.starts_at) - +new Date(b.starts_at))
    );
  }

  function scheduleEventPatch(id: string, patch: Partial<EventRow>) {
    setEvents((prev) =>
      prev
        .map((x) => (x.id === id ? { ...x, ...patch } : x))
        .sort((a, b) => +new Date(a.starts_at) - +new Date(b.starts_at))
    );

    const prevTimer = eventTimers.current[id];
    if (prevTimer) window.clearTimeout(prevTimer);

    eventTimers.current[id] = window.setTimeout(async () => {
      const { error } = await supabase.from("important_events").update(patch).eq("id", id);
      if (error) setMsg(error.message);
    }, 400);
  }

  async function removeEvent(e: EventRow) {
    setMsg(null);

    const snapshot = events;
    setEvents((prev) => prev.filter((x) => x.id !== e.id));

    const { error } = await supabase.from("important_events").delete().eq("id", e.id);
    if (error) {
      setMsg(error.message);
      setEvents(snapshot);
    }
  }

  if (loading) return <div className="page loading">Laddar…</div>;

  return (
    <div className="page stack">
      <header className="stack" style={{ gap: 6 }}>
        <h2>Att göra & evenemang</h2>
        <div className="note">
          Att göra: {openTodosCount} öppna • Evenemang: {upcomingEventsCount} kommande
        </div>
      </header>

      {/* -------- TODOS -------- */}
      <section className="card stack">
        <div className="card__header">
          <h3>Att göra hemma</h3>
          <div className="row">
            <span className="badge">{openTodosCount} kvar</span>
            <button className="btn btn--ghost btn--sm" onClick={clearDoneTodos}>
              Rensa klara
            </button>
          </div>
        </div>

        <div className="row">
          <input
            className="input flex-1"
            value={todoTitle}
            onChange={(e) => setTodoTitle(e.target.value)}
            placeholder="Lägg till… (t.ex. Dammsuga)"
            onKeyDown={(e) => e.key === "Enter" && addTodo()}
          />
          <button className="btn btn--primary" onClick={addTodo} aria-label="Lägg till att göra">
            +
          </button>
        </div>

        <ul className="list" style={{ gap: 6 }}>
          {todos.map((t) => (
            <li key={t.id} className="listItem--row">
              <input className="checkbox" type="checkbox" checked={t.done} onChange={() => toggleTodo(t)} />
              <span className={t.done ? "strike flex-1" : "flex-1"}>{t.title}</span>
              <button className="btn btn--danger btn--sm" onClick={() => removeTodo(t)} title="Ta bort">
                ✕
              </button>
            </li>
          ))}
        </ul>
      </section>

      {/* -------- EVENTS -------- */}
      <section className="card stack">
        <div className="card__header">
          <h3>Viktigt (evenemang)</h3>
          <span className="badge">{events.length} st</span>
        </div>

        <div className="stack" style={{ gap: 8 }}>
          <input
            className="input"
            value={eventTitle}
            onChange={(e) => setEventTitle(e.target.value)}
            placeholder="Titel (t.ex. Besiktning, Tandläkare)"
            onKeyDown={(e) => e.key === "Enter" && addEvent()}
          />

          <div className="row row--wrap">
            <input
              className="input"
              type="datetime-local"
              value={eventStartsAt}
              onChange={(e) => setEventStartsAt(e.target.value)}
            />

            <button className="btn btn--primary" onClick={addEvent}>
              Lägg till
            </button>
          </div>

          <input
            className="input"
            value={eventNotes}
            onChange={(e) => setEventNotes(e.target.value)}
            placeholder="Anteckning (valfritt)"
          />
        </div>

        <ul className="list">
          {events.map((e) => (
            <li key={e.id} className="listItem">
              <div className="stack" style={{ gap: 8 }}>
                <div className="row">
                  <input
                    className="input flex-1"
                    value={e.title}
                    onChange={(ev) => scheduleEventPatch(e.id, { title: ev.target.value })}
                  />
                  <button
                    className="btn btn--danger iconbtn iconbtn--sm"
                    onClick={() => removeEvent(e)}
                    title="Ta bort"
                  >
                    ✕
                  </button>
                </div>

                <div className="row row--wrap">
                  <input
                    className="input"
                    type="datetime-local"
                    value={toLocalInputValue(e.starts_at)}
                    onChange={(ev) => scheduleEventPatch(e.id, { starts_at: fromLocalInputValue(ev.target.value) })}
                  />
                  <div className="note">Visas som: {formatSvDateTime(e.starts_at)}</div>
                </div>

                <input
                  className="input"
                  value={e.notes ?? ""}
                  onChange={(ev) => scheduleEventPatch(e.id, { notes: ev.target.value.trim() ? ev.target.value : null })}
                  placeholder="Anteckning (valfritt)"
                />
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
