import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../lib/supabase";

type ImportantEvent = {
  id: string;
  title: string;
  starts_at: string;
  all_day: boolean;
  notes: string | null;
  done: boolean;
};

export default function ImportantPage() {
  const [householdId, setHouseholdId] = useState<string | null>(null);
  const [events, setEvents] = useState<ImportantEvent[]>([]);
  const [msg, setMsg] = useState<string | null>(null);

  const [title, setTitle] = useState("");
  const [startsAtLocal, setStartsAtLocal] = useState(""); // yyyy-mm-ddThh:mm
  const [allDay, setAllDay] = useState(false);
  const [notes, setNotes] = useState("");

  const now = useMemo(() => new Date(), []); // bara för default

  async function load(hid: string) {
    const { data, error } = await supabase
      .from("important_events")
      .select("id,title,starts_at,all_day,notes,done")
      .eq("household_id", hid)
      .order("starts_at", { ascending: true });

    if (error) setMsg(error.message);
    else {
      setMsg(null);
      setEvents((data ?? []) as ImportantEvent[]);
    }
  }

  useEffect(() => {
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

      // Default för datum/tid: “nästa hela timme”
      const d = new Date();
      d.setMinutes(0, 0, 0);
      d.setHours(d.getHours() + 1);
      setStartsAtLocal(toLocalInputValue(d));
    }

    init();
  }, []);

  function toLocalInputValue(d: Date) {
    // yyyy-mm-ddThh:mm i lokal tid
    const pad = (n: number) => String(n).padStart(2, "0");
    const yyyy = d.getFullYear();
    const mm = pad(d.getMonth() + 1);
    const dd = pad(d.getDate());
    const hh = pad(d.getHours());
    const mi = pad(d.getMinutes());
    return `${yyyy}-${mm}-${dd}T${hh}:${mi}`;
  }

  async function addEvent() {
    setMsg(null);
    if (!householdId) return;

    const t = title.trim();
    if (!t) return setMsg("Skriv en titel.");

    const { data: userRes } = await supabase.auth.getUser();
    const uid = userRes.user?.id;
    if (!uid) return setMsg("Inte inloggad.");

    if (!startsAtLocal) return setMsg("Välj datum och tid.");

    // Date(...) tolkar yyyy-mm-ddThh:mm som lokal tid => vi skickar ISO (UTC) till timestamptz
    const starts = new Date(startsAtLocal);

    const { error } = await supabase.from("important_events").insert({
      household_id: householdId,
      title: t,
      starts_at: starts.toISOString(),
      all_day: allDay,
      notes: notes.trim() || null,
      created_by: uid,
    });

    if (error) return setMsg(error.message);

    setTitle("");
    setNotes("");
    await load(householdId);
  }

  async function toggleDone(ev: ImportantEvent) {
    setMsg(null);
    const { error } = await supabase
      .from("important_events")
      .update({ done: !ev.done, done_at: !ev.done ? new Date().toISOString() : null })
      .eq("id", ev.id);

    if (error) return setMsg(error.message);
    if (householdId) await load(householdId);
  }

  async function removeEvent(ev: ImportantEvent) {
    setMsg(null);
    const { error } = await supabase.from("important_events").delete().eq("id", ev.id);
    if (error) return setMsg(error.message);
    if (householdId) await load(householdId);
  }

  const upcoming = events.filter((e) => !e.done);
  const doneList = events.filter((e) => e.done);

  return (
  <div className="page stack">
    <h2>Kommande evenemang</h2>

    {/* Add event */}
    <section className="card formCard">
      <input
        className="input"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="T.ex. Tandläkare, Betala hyra…"
        onKeyDown={(e) => e.key === "Enter" && addEvent()}
      />

      <div className="row row--wrap">
        <input
          className="input"
          type="datetime-local"
          value={startsAtLocal}
          onChange={(e) => setStartsAtLocal(e.target.value)}
          style={{ width: 260 }}
        />

        <label className="check">
          <input className="checkbox" type="checkbox" checked={allDay} onChange={(e) => setAllDay(e.target.checked)} />
          Hela dagen
        </label>
      </div>

      <textarea
        className="textarea"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="Anteckning (valfritt)"
        rows={3}
      />

      <div className="row row--wrap">
        <button className="btn btn--primary" onClick={addEvent}>
          Lägg till
        </button>
        <div className="note">Tips: tryck Enter i titelfältet för att lägga till snabbt.</div>
      </div>
    </section>

    {/* Upcoming */}
    <section className="stack" style={{ gap: 10 }}>
      <div className="card__header">
        <h3>Kommande</h3>
        <span className="badge">{upcoming.length} st</span>
      </div>

      {upcoming.length === 0 && <div className="note">Inga kommande events.</div>}

      <ul className="list">
        {upcoming.map((ev) => (
          <li key={ev.id} className="listItem">
            <div className="itemHeader">
              <div>
                <div className="itemTitle">{ev.title}</div>
                <div className="itemMeta">
                  {ev.all_day ? "Hela dagen" : new Date(ev.starts_at).toLocaleString()}
                </div>
                {ev.notes && <div className="itemNotes">{ev.notes}</div>}
              </div>

              <div className="actions">
                <button
                  className="btn iconbtn iconbtn--sm btn--primary"
                  onClick={() => toggleDone(ev)}
                  title="Klar"
                  aria-label="Markera klar"
                >
                  ✓
                </button>
                <button
                  className="btn iconbtn iconbtn--sm btn--danger"
                  onClick={() => removeEvent(ev)}
                  title="Ta bort"
                  aria-label="Ta bort"
                >
                  ✕
                </button>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </section>

    {/* Done */}
    {doneList.length > 0 && (
      <section className="stack" style={{ gap: 10 }}>
        <div className="card__header">
          <h3>Klart</h3>
          <span className="badge">{doneList.length} st</span>
        </div>

        <ul className="list">
          {doneList.map((ev) => (
            <li key={ev.id} className="listItem item--done">
              <div className="itemHeader">
                <div>
                  <div className="itemTitle strike">{ev.title}</div>
                  <div className="itemMeta">
                    {ev.all_day ? "Hela dagen" : new Date(ev.starts_at).toLocaleString()}
                  </div>
                </div>

                <div className="actions">
                  <button
                    className="btn iconbtn iconbtn--sm"
                    onClick={() => toggleDone(ev)}
                    title="Ångra klar"
                    aria-label="Ångra"
                  >
                    ↩
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      </section>
    )}

    {msg && <div className="alert">{msg}</div>}

    <div className="footerHint">Nu: {now.toLocaleString()}</div>
  </div>
);

}
