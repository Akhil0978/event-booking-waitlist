import mongoose from "mongoose";

const bookingSchema = new mongoose.Schema(
  {
    // Existing demo bookings remain unowned and are managed by an admin.
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

    eventId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Event",
      required: true,
    },

    name: {
      type: String,
      required: true,
      trim: true,
      maxLength: 100,
    },

    email: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      maxLength: 254,
      match: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
    },

    status: {
      type: String,
      enum: ["CONFIRMED", "WAITLISTED", "CANCELLED"],
      required: true,
    },
  },
  {
    timestamps: true,
  }
);

bookingSchema.index(
  { eventId: 1, email: 1 },
  { unique: true }
);

bookingSchema.index({ eventId: 1, userId: 1 });

const Booking = mongoose.model("Booking", bookingSchema);

export default Booking;
