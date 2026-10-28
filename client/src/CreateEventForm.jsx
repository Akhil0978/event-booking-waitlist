
import { useRef, useState } from "react";
import "./CreateEventForm.css";

export default function CreateEventForm({
  onCreated,
  disabled,
  onBusyChange,
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState(null);
  const pending = useRef(false);

  async function handleSubmit(e) {
    e.preventDefault();
    if (disabled || pending.current) return;

    const form = e.currentTarget;
    const values = new FormData(form);

    const title = String(values.get("title") || "").trim();
    const venue = String(values.get("venue") || "").trim();
    const capacity = Number(values.get("capacity"));
    const dateValue = String(values.get("startsAt") || "");
    const start = new Date(dateValue + "+05:30");

    if (!title || !venue) {
      setFeedback({
        type: "error",
        text: "Enter an event name and venue.",
      });
      return;
    }

    if (!Number.isSafeInteger(capacity) || capacity < 1) {
      setFeedback({
        type: "error",
        text: "Capacity must be a positive whole number.",
      });
      return;
    }

    if (!Number.isFinite(start.getTime()) || start.getTime() <= Date.now()) {
      setFeedback({
        type: "error",
        text: "Choose a future date and time in IST.",
      });
      return;
    }

    pending.current = true;
    setBusy(true);
    setFeedback(null);
    onBusyChange(true);

    try {
      const response = await fetch("/api/events", {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
          "X-Requested-With": "EventBooking",
        },
        body: JSON.stringify({
          title,
          venue,
          capacity,
          startsAt: start.toISOString(),
        }),
      });

      const data = await response.json().catch(() => null);

      if (!response.ok || !data?.success || !data.event?._id) {
        throw new Error(
          data?.message ||
          "Could not confirm creation. Refresh events before retrying."
        );
      }

      onCreated(data.event);

      setFeedback({
        type: "success",
        text: "Event created: " + data.event.title + ".",
      });

      form.reset();
    } catch (err) {
      setFeedback({
        type: "error",
        text: err instanceof TypeError
          ? "Connection interrupted. Refresh events before retrying."
          : err.message || "Could not confirm event creation.",
      });
    } finally {
      pending.current = false;
      setBusy(false);
      onBusyChange(false);
    }
  }

  return (
    <section className="create-event-panel">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        disabled={disabled || busy}
        aria-expanded={open}
        aria-controls="create-event-fields"
      >
        {open ? "Close event form" : "Create an event"}
      </button>

      {open && (
        <form
          id="create-event-fields"
          className="create-event-form"
          onSubmit={handleSubmit}
          onChange={() => setFeedback(null)}
          aria-busy={busy}
        >
          <fieldset disabled={disabled || busy}>
            <legend>Event details</legend>

            <div className="create-fields">
              <label>
                Event name
                <input
                  name="title"
                  type="text"
                  maxLength={120}
                  required
                />
              </label>

              <label>
                Venue
                <input
                  name="venue"
                  type="text"
                  maxLength={200}
                  required
                />
              </label>

              <label>
                Start date &amp; time (IST)
                <input
                  name="startsAt"
                  type="datetime-local"
                  step="60"
                  required
                />
              </label>

              <label>
                Capacity
                <input
                  name="capacity"
                  type="number"
                  min="1"
                  step="1"
                  required
                />
              </label>
            </div>

            <button type="submit" disabled={disabled || busy}>
              {busy ? "Creating..." : "Create event"}
            </button>
          </fieldset>
        </form>
      )}

      {feedback && (
        <p
          className={"create-feedback " + feedback.type}
          role={feedback.type === "error" ? "alert" : "status"}
        >
          {feedback.text}
        </p>
      )}
    </section>
  );
}
