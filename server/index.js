import "dotenv/config";
import express from "express";
import mongoose from "mongoose";
import { setServers } from "node:dns/promises";
import Event from "./models/Event.js";
import Booking from "./models/Booking.js";
import {
  authRouter, createAuthSession, loadCurrentUser,
  requireLogin, requireAdmin, requireTrustedRequest,
} from "./auth.js";

const app = express();
const PORT = 3001;

app.use(express.json());

let authSessionMiddleware;
app.use((req, res, next) => authSessionMiddleware(req, res, next));
app.use(loadCurrentUser);
app.use("/api/auth", authRouter);

function apiError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

app.get("/api/health", (req, res) => {
  res.json({
    success: true,
    message: "Event Booking API is running",
  });
});

app.post("/api/events", requireAdmin, requireTrustedRequest, async (req, res, next) => {
  try {
    const { title, venue, startsAt, capacity } = req.body ?? {};

    const event = await Event.create({
      title,
      venue,
      startsAt,
      capacity,
    });

    res.status(201).json({
      success: true,
      message: "Event created successfully",
      event,
    });
  } catch (error) {
    next(error);
  }
});

app.get("/api/events", async (req, res, next) => {
  try {
    const events = await Event.find().sort({ startsAt: 1 });
    res.json({ success: true, events });
  } catch (error) {
    next(error);
  }
});

app.post("/api/events/:eventId/bookings", requireLogin, requireTrustedRequest, async (req, res, next) => {
  try {
    const { eventId } = req.params;
    const { name, email } = req.user;

    if (!/^[a-fA-F0-9]{24}$/.test(eventId)) {
      throw apiError(400, "Invalid event ID");
    }

    if (
      typeof name !== "string" ||
      !name.trim() ||
      name.trim().length > 100
    ) {
      throw apiError(400, "Name must contain 1 to 100 characters");
    }

    if (
      typeof email !== "string" ||
      email.trim().length > 254 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())
    ) {
      throw apiError(400, "Enter a valid email address");
    }

    const cleanName = name.trim();
    const cleanEmail = email.trim().toLowerCase();

    const result = await mongoose.connection.transaction(
      async (session) => {
        // Serialize new bookings with cancellations.
        const event = await Event.findOneAndUpdate(
          { _id: eventId },
          { $inc: { __v: 1 } },
          { returnDocument: "after", session }
        );

        if (!event) {
          throw apiError(404, "Event not found");
        }

        if (event.startsAt.getTime() <= Date.now()) {
          throw apiError(400, "Bookings are closed for this event");
        }

        const existing = await Booking.findOne({
          eventId,
          email: cleanEmail,
        }).session(session);

        if (existing) {
          throw apiError(409, "You already have a booking for this event");
        }

        const updatedEvent = await Event.findOneAndUpdate(
          { _id: eventId, availableSeats: { $gt: 0 } },
          { $inc: { availableSeats: -1 } },
          { returnDocument: "after", session }
        );

        const status = updatedEvent ? "CONFIRMED" : "WAITLISTED";

        const [booking] = await Booking.create(
          [{
            eventId,
            userId: req.user._id,
            name: cleanName,
            email: cleanEmail,
            status,
          }],
          { session }
        );

        return {
          booking,
          availableSeats: updatedEvent
            ? updatedEvent.availableSeats
            : 0,
        };
      },
      {
        readPreference: "primary",
        readConcern: { level: "snapshot" },
        writeConcern: { w: "majority" },
      }
    );

    res.status(201).json({
      success: true,
      message: result.booking.status === "CONFIRMED"
        ? "Booking confirmed"
        : "Event full. Added to waitlist",
      booking: result.booking,
      availableSeats: result.availableSeats,
    });
  } catch (error) {
    next(error);
  }
});


app.get("/api/events/:eventId/bookings", requireLogin, async (req, res, next) => {
  res.set("Cache-Control", "no-store");
  try {
    const { eventId } = req.params;

    if (!/^[a-fA-F0-9]{24}$/.test(eventId)) {
      throw apiError(400, "Invalid event ID");
    }

    const event = await Event.findById(eventId);

    if (!event) {
      throw apiError(404, "Event not found");
    }

    const bookings = await Booking.find({
      eventId,
      ...(req.user.role === "ADMIN" ? {} : { userId: req.user._id }),
    })
      .sort({ createdAt: 1, _id: 1 });

    res.json({
      success: true,
      event: {
        _id: event._id,
        title: event.title,
        availableSeats: event.availableSeats,
      },
      bookings,
    });
  } catch (error) {
    next(error);
  }
});


app.post("/api/events/:eventId/bookings/:bookingId/cancel", requireLogin, requireTrustedRequest, async (req, res, next) => {
  try {
    const { eventId, bookingId } = req.params;

    if (![eventId, bookingId].every((id) => /^[a-fA-F0-9]{24}$/.test(id))) {
      throw apiError(400, "Invalid event or booking ID");
    }

    const result = await mongoose.connection.transaction(
      async (session) => {
        const event = await Event.findOneAndUpdate(
          { _id: eventId },
          { $inc: { __v: 1 } },
          { returnDocument: "after", session }
        );

        if (!event) {
          throw apiError(404, "Event not found");
        }

        const booking = await Booking.findOne({
          _id: bookingId,
          eventId,
          ...(req.user.role === "ADMIN" ? {} : { userId: req.user._id }),
        }).session(session);

        if (!booking) {
          throw apiError(404, "Booking not found");
        }

        if (booking.status === "CANCELLED") {
          return {
            booking,
            promotedBooking: null,
            availableSeats: event.availableSeats,
            alreadyCancelled: true,
          };
        }

        if (event.startsAt.getTime() <= Date.now()) {
          throw apiError(400, "Cancellations are closed for this event");
        }

        const wasConfirmed = booking.status === "CONFIRMED";
        booking.status = "CANCELLED";
        await booking.save({ session });

        let promotedBooking = null;

        if (wasConfirmed) {
          promotedBooking = await Booking.findOneAndUpdate(
            { eventId, status: "WAITLISTED" },
            { $set: { status: "CONFIRMED" } },
            {
              sort: { createdAt: 1, _id: 1 },
              returnDocument: "after",
              session,
            }
          );

          if (!promotedBooking) {
            event.availableSeats += 1;
            await event.save({ session });
          }
        }

        return {
          booking,
          promotedBooking,
          availableSeats: event.availableSeats,
          alreadyCancelled: false,
        };
      },
      {
        readPreference: "primary",
        readConcern: { level: "snapshot" },
        writeConcern: { w: "majority" },
      }
    );

    res.json({
      success: true,
      message: result.alreadyCancelled
        ? "Booking already cancelled"
        : "Booking cancelled",
      ...result,
      promotedBooking: req.user.role === "ADMIN" ? result.promotedBooking : null,
    });
  } catch (error) {
    next(error);
  }
});

app.use((error, req, res, next) => {
  if (error.code === 11000) {
    return res.status(409).json({
      success: false,
      message: "You already have a booking for this event",
    });
  }

  const status = error.name === "ValidationError"
    ? 400
    : (error.status || 500);

  if (status >= 500) {
    console.error("Request failed:", error.message);
  }

  res.status(status).json({
    success: false,
    message: status >= 500 ? "Something went wrong" : error.message,
  });
});

async function startServer() {
  try {
    if (!process.env.MONGODB_URI) {
      throw new Error("MONGODB_URI missing in server/.env");
    }

    if (process.env.DNS_SERVERS) {
      setServers(
        process.env.DNS_SERVERS
          .split(",")
          .map((ip) => ip.trim())
          .filter(Boolean)
      );
    }

    await mongoose.connect(process.env.MONGODB_URI, {
      dbName: "event_booking",
    });

    await Event.init();
    await Booking.init();
    authSessionMiddleware = await createAuthSession(mongoose.connection.getClient());
    console.log("Auth routes ready");

    console.log("MongoDB connected");
    console.log("Booking indexes ready");

    app.listen(PORT, () => {
      console.log("Server running at http://localhost:" + PORT);
      console.log("Routes ready: events + bookings");
    });
  } catch (error) {
    console.error("Startup failed:", error.message);
    process.exit(1);
  }
}

startServer();
