import mongoose from "mongoose";

const eventSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: true,
      trim: true,
    },
    venue: {
      type: String,
      required: true,
      trim: true,
    },
    startsAt: {
      type: Date,
      required: true,
    },
    capacity: {
      type: Number,
      required: true,
      min: 1,
      validate: Number.isInteger,
    },
    availableSeats: {
      type: Number,
      required: true,
      min: 0,
      validate: Number.isInteger,
      default: function () {
        return this.capacity;
      },
    },
  },
  {
    timestamps: true,
  }
);
const Event = mongoose.model("Event", eventSchema);
export default Event;