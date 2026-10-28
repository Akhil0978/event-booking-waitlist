
import { useEffect, useState } from "react";
import BookingForm from "./BookingForm.jsx";
import BookingsPanel from "./BookingsPanel.jsx";
import CreateEventForm from "./CreateEventForm.jsx";
import AuthPanel from "./AuthPanel.jsx";

const dateFormat = new Intl.DateTimeFormat("en-IN", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Kolkata",
});

export default function App() {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [bookingInProgress, setBookingInProgress] = useState(false);
  const [account, setAccount] = useState({ loading: true, user: null, error: "" });
  const currentUser = account.user;

  useEffect(() => {
    const controller = new AbortController();

    async function loadEvents() {
      try {
        const response = await fetch("/api/events", {
          signal: controller.signal,
        });

        const data = await response.json().catch(() => null);

        if (!response.ok || !data?.success || !Array.isArray(data.events)) {
          throw new Error(
            data?.message || "Could not load events. Please try again."
          );
        }

        if (!controller.signal.aborted) {
          setEvents(data.events);
        }
      } catch (err) {
        if (!controller.signal.aborted) {
          setError(
            err.message || "Could not load events. Please try again."
          );
        }
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    }

    loadEvents();
    return () => controller.abort();
  }, [refreshVersion]);

  function handleBooked(eventId, availableSeats, resetForm = false) {
    setEvents((current) =>
      current.map((item) =>
        item._id === eventId
          ? {
              ...item,
              availableSeats,
              bookingRevision: (item.bookingRevision || 0) + 1,
              formRevision: (item.formRevision || 0) + (resetForm ? 1 : 0),
            }
          : item
      )
    );
  }

  function handleEventCreated(event) {
    setEvents((current) =>
      [...current.filter((item) => item._id !== event._id), event].sort(
        (a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime()
      )
    );
  }

  function refreshEvents() {
    setLoading(true);
    setError("");
    setRefreshVersion((value) => value + 1);
  }

  return (
    <>
      <header className="site-header">
        <div className="container brand">
          Event Booking &amp; Waitlist
        </div>
      </header>

      <main className="container" aria-busy={loading}>
        <section className="intro">
          <div>
            <p className="eyebrow">EXPLORE EVENTS</p>
            <h1>Find your next event.</h1>
            <p className="subtitle">
              Browse events and check available seats.
            </p>
          </div>

          <button
            type="button"
            onClick={refreshEvents}
            disabled={loading || bookingInProgress}
          >
            {loading ? "Loading..." : "Refresh events"}
          </button>
        </section>

        <AuthPanel
          disabled={bookingInProgress}
          onBusyChange={setBookingInProgress}
          onSessionChange={setAccount}
        />

        {!account.loading && !account.error && !currentUser && (
          <p className="notice">Log in above to book a seat or view your bookings.</p>
        )}

        {currentUser?.role === "ADMIN" && (
          <CreateEventForm
            key={currentUser._id}
            onCreated={handleEventCreated}
            disabled={loading || bookingInProgress || Boolean(error)}
            onBusyChange={setBookingInProgress}
          />
        )}

        {loading && (
          <p className="notice" role="status">Loading events...</p>
        )}

        {error && (
          <p className="notice error" role="alert">{error}</p>
        )}

        {!loading && !error && events.length === 0 && (
          <p className="notice">No events available yet.</p>
        )}

        {!loading && !error && (
          <div className="event-grid">
            {events.map((event) => (
              <article className="event-card" key={event._id}>
                <span
                  className={
                    "badge" + (event.availableSeats === 0 ? " muted" : "")
                  }
                >
                  {event.availableSeats > 0
                    ? "Seats available"
                    : "Fully booked"}
                </span>

                <h2>{event.title}</h2>

                <dl>
                  <div>
                    <dt>Venue</dt>
                    <dd>{event.venue}</dd>
                  </div>

                  <div>
                    <dt>Date &amp; time</dt>
                    <dd>
                      <time dateTime={event.startsAt}>
                        {dateFormat.format(new Date(event.startsAt))} IST
                      </time>
                    </dd>
                  </div>
                </dl>

                <p className="seats">
                  <strong>{event.availableSeats}</strong>
                  {" / "}{event.capacity} seats available
                </p>
                {currentUser && (
                  <>
                    <BookingForm
                      key={currentUser._id + ":" + (event.formRevision || 0)}
                      event={event}
                      user={currentUser}
                      onBooked={handleBooked}
                      disabled={bookingInProgress}
                      onBusyChange={setBookingInProgress}
                    />
                    <BookingsPanel
                      key={currentUser._id}
                      eventId={event._id}
                      user={currentUser}
                      revision={event.bookingRevision || 0}
                      disabled={bookingInProgress}
                      onChanged={handleBooked}
                      onBusyChange={setBookingInProgress}
                    />
                  </>
                )}
              </article>
            ))}
          </div>
        )}
      </main>
    </>
  );
}
