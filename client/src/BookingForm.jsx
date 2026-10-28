
import { useRef, useState } from "react";
import "./BookingForm.css";

export default function BookingForm({
  event,
  user,
  onBooked,
  disabled,
  onBusyChange,
}) {
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState(null);
  const pending = useRef(false);

  async function handleSubmit(e) {
    e.preventDefault();

    if (pending.current || disabled) return;

    const form = e.currentTarget;
    const name = user.name;

    pending.current = true;
    setBusy(true);
    setFeedback(null);
    onBusyChange(true);

    try {
      const response = await fetch(
        "/api/events/" + event._id + "/bookings",
        {
          method: "POST",
          credentials: "same-origin",
          headers: {
            "Content-Type": "application/json",
            "X-Requested-With": "EventBooking",
          },
          body: JSON.stringify({}),
        }
      );

      const data = await response.json().catch(() => null);

      if (!response.ok || !data?.success) {
        throw new Error(
          data?.message || "Could not confirm the booking result."
        );
      }

      const status = data.booking?.status;

      if (
        !["CONFIRMED", "WAITLISTED"].includes(status) ||
        !Number.isInteger(data.availableSeats) ||
        data.availableSeats < 0
      ) {
        throw new Error(
          "Unexpected booking response. Check your booking before retrying."
        );
      }

      onBooked(event._id, data.availableSeats);

      setFeedback({
        type: status === "CONFIRMED" ? "success" : "waitlist",
        text: status === "CONFIRMED"
          ? "CONFIRMED: " + name + ", your seat is booked."
          : "WAITLISTED: " + name + ", you are on the waiting list.",
      });

      form.reset();
    } catch (err) {
      setFeedback({
        type: "error",
        text: err instanceof TypeError
          ? "Connection interrupted. Check your booking before retrying."
          : err.message || "Could not confirm the booking result.",
      });
    } finally {
      pending.current = false;
      setBusy(false);
      onBusyChange(false);
    }
  }

  return (
    <form
      className="booking-form"
      onSubmit={handleSubmit}
      onChange={() => setFeedback(null)}
      aria-busy={busy}
    >
      <fieldset disabled={disabled || busy}>
        <legend>Reserve your spot</legend>

        <p>
          Booking as <strong>{user.name}</strong><br />
          {user.email}
        </p>

        <button type="submit" disabled={disabled || busy}>
          {busy
            ? "Submitting..."
            : event.availableSeats > 0
              ? "Book seat"
              : "Join waitlist"}
        </button>
      </fieldset>

      {feedback && (
        <p
          className={"booking-feedback " + feedback.type}
          role={feedback.type === "error" ? "alert" : "status"}
        >
          {feedback.text}
        </p>
      )}
    </form>
  );
}
