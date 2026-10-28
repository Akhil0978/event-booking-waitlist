
import { useEffect, useRef, useState } from "react";
import "./BookingsPanel.css";

export default function BookingsPanel({
  eventId,
  user,
  revision,
  disabled,
  onChanged,
  onBusyChange,
}) {
  const [open, setOpen] = useState(false);
  const [reload, setReload] = useState(0);
  const [result, setResult] = useState({
    key: "",
    bookings: [],
    error: "",
  });
  const [notice, setNotice] = useState(null);
  const [cancellingId, setCancellingId] = useState("");
  const pending = useRef(false);

  const requestKey = eventId + ":" + revision + ":" + reload;
  const loading = open && result.key !== requestKey;

  useEffect(() => {
    if (!open) return;

    const controller = new AbortController();

    async function loadBookings() {
      try {
        const response = await fetch(
          "/api/events/" + eventId + "/bookings",
          { signal: controller.signal, credentials: "same-origin", cache: "no-store" }
        );
        const data = await response.json().catch(() => null);

        if (
          !response.ok ||
          !data?.success ||
          !Array.isArray(data.bookings)
        ) {
          throw new Error(data?.message || "Could not load bookings.");
        }

        if (!controller.signal.aborted) {
          setResult({
            key: requestKey,
            bookings: data.bookings,
            error: "",
          });
        }
      } catch (err) {
        if (!controller.signal.aborted) {
          setResult({
            key: requestKey,
            bookings: [],
            error: err.message || "Could not load bookings.",
          });
        }
      }
    }

    loadBookings();
    return () => controller.abort();
  }, [eventId, open, requestKey]);

  function toggleList() {
    if (disabled || pending.current) return;
    if (!open) setReload((value) => value + 1);
    setOpen((value) => !value);
  }

  async function cancelBooking(booking) {
    if (disabled || pending.current) return;

    pending.current = true;
    setCancellingId(booking._id);
    setNotice(null);
    onBusyChange(true);

    try {
      const response = await fetch(
        "/api/events/" + eventId + "/bookings/" + booking._id + "/cancel",
        {
          method: "POST",
          credentials: "same-origin",
          headers: { "X-Requested-With": "EventBooking" },
        }
      );
      const data = await response.json().catch(() => null);

      if (!response.ok || !data?.success) {
        throw new Error(
          data?.message ||
          "Could not confirm cancellation. Refresh bookings to check."
        );
      }

      if (
        data.booking?.status !== "CANCELLED" ||
        !Number.isInteger(data.availableSeats) ||
        data.availableSeats < 0
      ) {
        throw new Error(
          "Unexpected response. Refresh bookings to check the saved status."
        );
      }

      onChanged(eventId, data.availableSeats, true);

      setNotice({
        type: "success",
        text: data.alreadyCancelled
          ? "This booking was already cancelled."
          : data.promotedBooking
            ? "Booking cancelled. " +
              data.promotedBooking.name +
              " is now CONFIRMED."
            : "Booking cancelled.",
      });
    } catch (err) {
      setNotice({
        type: "error",
        text: err instanceof TypeError
          ? "Connection interrupted. Refresh bookings to check the saved status."
          : err.message || "Could not confirm cancellation.",
      });
    } finally {
      pending.current = false;
      setCancellingId("");
      onBusyChange(false);
    }
  }

  return (
    <section className="bookings-panel">
      <button
        type="button"
        className="outline-button"
        onClick={toggleList}
        disabled={disabled}
        aria-expanded={open}
        aria-controls={"bookings-" + eventId}
      >
        {open ? "Hide bookings" : user.role === "ADMIN" ? "View all bookings" : "My bookings"}
      </button>

      {open && (
        <div id={"bookings-" + eventId} className="bookings-content">
          <div className="bookings-heading">
            <h3>{user.role === "ADMIN" ? "Event bookings" : "My bookings"}</h3>
            <button
              type="button"
              className="outline-button"
              disabled={disabled || loading}
              onClick={() => setReload((value) => value + 1)}
            >
              Refresh list
            </button>
          </div>

          {notice && (
            <p
              className={"booking-feedback " + notice.type}
              role={notice.type === "error" ? "alert" : "status"}
            >
              {notice.text}
            </p>
          )}

          {loading && <p role="status">Loading bookings...</p>}

          {!loading && result.error && (
            <p role="alert">{result.error}</p>
          )}

          {!loading && !result.error && result.bookings.length === 0 && (
            <p>No bookings yet.</p>
          )}

          {!loading && !result.error && (
            <ul className="booking-list">
              {result.bookings.map((booking) => (
                <li className="booking-row" key={booking._id}>
                  <div className="booking-person">
                    <strong>{booking.name}</strong>
                    <small>{booking.email}</small>
                  </div>

                  <span className={"booking-status status-" + booking.status}>
                    {booking.status}
                  </span>

                  {["CONFIRMED", "WAITLISTED"].includes(booking.status) && (
                    <button
                      type="button"
                      className="cancel-button"
                      disabled={disabled || Boolean(cancellingId)}
                      onClick={() => cancelBooking(booking)}
                      aria-label={"Cancel booking for " + booking.name}
                    >
                      {cancellingId === booking._id
                        ? "Cancelling..."
                        : "Cancel booking"}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
