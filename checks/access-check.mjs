import { fileURLToPath } from "node:url";
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const root = process.argv[2] || fileURLToPath(new URL('../', import.meta.url));
const patchedServer = readFileSync(root + '/server/index.js', 'utf8');
// Run the transformed handlers and actual auth guards against model doubles.
process.env.APP_ORIGINS = 'http://localhost:5174';
const authSource = readFileSync(root + '/server/auth.js', 'utf8').replace(/^import .+;\n/gm, '').replace(/^export /gm, '');
const noopRouter = { use() {}, get() {}, post() {} };
const guards = new Function('express', 'session', 'MongoStore', 'bcrypt', 'rateLimit', 'randomBytes', 'User',
  authSource + '\nreturn {requireLogin, requireAdmin, requireTrustedRequest};')(
    { Router: () => noopRouter }, {}, {}, {}, () => () => {}, () => {}, {}
  );
const routes = new Map();
const app = { use() {}, post(path, ...handlers) { routes.set('POST ' + path, handlers); }, get(path, ...handlers) { routes.set('GET ' + path, handlers); } };
const eventId = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const userA = { _id: '111111111111111111111111', name: 'A', email: 'a@example.com', role: 'USER' };
const userB = { _id: '222222222222222222222222', name: 'B', email: 'b@example.com', role: 'USER' };
const admin = { _id: '333333333333333333333333', name: 'Admin', email: 'admin@example.com', role: 'ADMIN' };
let state;
let failPromotion = false;
const matches = (doc, filter) => Object.entries(filter).every(([key, value]) => String(doc[key]) === String(value));
function doc(value) {
  if (!value) return null;
  Object.defineProperty(value, 'save', { enumerable: false, configurable: true, value: async () => value });
  return value;
}
const Event = {
  async create(body) { return { ...body, _id: eventId }; },
  find() { return { sort: async () => state.event ? [state.event] : [] }; },
  async findById(id) { return state.event?._id === id ? doc(state.event) : null; },
  async findOneAndUpdate(filter, update) {
    if (state.event?._id !== filter._id) return null;
    if (filter.availableSeats && state.event.availableSeats <= 0) return null;
    for (const [key, value] of Object.entries(update.$inc)) state.event[key] += value;
    return doc(state.event);
  },
};
const Booking = {
  findOne(filter) { return { session: async () => doc(state.bookings.find(item => matches(item, filter))) }; },
  find(filter) { return { sort: async () => state.bookings.filter(item => matches(item, filter)) }; },
  async create(records) {
    return records.map(record => {
      const value = { ...record, _id: String(state.bookings.length + 1).padStart(24, '0'), createdAt: state.bookings.length };
      state.bookings.push(value); return doc(value);
    });
  },
  async findOneAndUpdate(filter, update, options) {
    assert.deepEqual(options.sort, { createdAt: 1, _id: 1 });
    if (failPromotion) throw new Error('Injected failure');
    const value = state.bookings.filter(item => matches(item, filter)).sort((a, b) => a.createdAt - b.createdAt || a._id.localeCompare(b._id))[0];
    if (value) Object.assign(value, update.$set);
    return doc(value);
  },
};
const mongoose = { connection: { async transaction(callback) {
  const original = structuredClone(state);
  try { return await callback({}); } catch (error) { state = original; throw error; }
} } };
const fakeExpress = Object.assign(() => app, { json: () => () => {} });
const runnable = patchedServer.replace(/^import[\s\S]*?;\n/gm, '').replace(/\nstartServer\(\);\s*$/, '\n');
new Function('express', 'Event', 'Booking', 'mongoose', 'requireLogin', 'requireAdmin', 'requireTrustedRequest', 'authRouter', 'loadCurrentUser', 'createAuthSession',
  runnable)(fakeExpress, Event, Booking, mongoose, guards.requireLogin, guards.requireAdmin, guards.requireTrustedRequest, {}, () => {}, () => {});
function seed() {
  state = { event: { _id: eventId, capacity: 1, availableSeats: 1, __v: 0, startsAt: new Date(Date.now() + 86400000) }, bookings: [] };
  failPromotion = false;
}
async function call(method, path, user, options = {}) {
  const result = { status: 200, headers: {} };
  const req = {
    user, body: options.body || {}, params: { eventId, ...options.params },
    get(name) { return ({ Origin: 'http://localhost:5174', 'X-Requested-With': 'EventBooking', ...options.headers })[name]; },
  };
  const res = {
    status(code) { result.status = code; return this; },
    json(body) { result.body = body; },
    set(name, value) { result.headers[name] = value; },
  };
  for (const handler of routes.get(method + ' ' + path)) {
    let next = false;
    await handler(req, res, error => { next = true; result.error = error; });
    if (result.error || !next) break;
  }
  return result;
}
const bookingsPath = '/api/events/:eventId/bookings';
const cancelPath = bookingsPath + '/:bookingId/cancel';
seed();
for (const [method, path] of [['POST', '/api/events'], ['POST', bookingsPath], ['GET', bookingsPath], ['POST', cancelPath]]) {
  assert.equal((await call(method, path, null)).error.status, 401);
}
assert.equal((await call('POST', '/api/events', userA)).error.status, 403);
assert.equal((await call('POST', '/api/events', admin)).status, 201);
assert.equal((await call('POST', bookingsPath, userA, { headers: { Origin: 'https://untrusted.example' } })).error.status, 403);
assert.equal(state.bookings.length, 0);
let result = await call('POST', bookingsPath, userA, { body: { name: 'Impersonated', email: userB.email, userId: userB._id } });
assert.equal(result.body.booking.userId, userA._id);
assert.equal(result.body.booking.name, userA.name);
assert.equal(result.body.booking.email, userA.email);
assert.equal(result.body.booking.status, 'CONFIRMED');
const bookingA = result.body.booking._id;
result = await call('POST', bookingsPath, userB);
assert.equal(result.body.booking.status, 'WAITLISTED');
const bookingB = result.body.booking._id;
assert.equal((await call('POST', bookingsPath, userA)).error.status, 409);
result = await call('GET', bookingsPath, userA);
assert.deepEqual(result.body.bookings.map(item => item._id), [bookingA]);
assert.equal(result.headers['Cache-Control'], 'no-store');
assert.equal((await call('GET', bookingsPath, admin)).body.bookings.length, 2);
const originalState = structuredClone(state);
assert.equal((await call('POST', cancelPath, userB, { params: { bookingId: bookingA } })).error.status, 404);
assert.deepEqual(structuredClone(state), originalState);
result = await call('POST', cancelPath, userA, { params: { bookingId: bookingA } });
assert.equal(result.body.booking.status, 'CANCELLED');
assert.equal(result.body.promotedBooking, null);
assert.equal(state.bookings.find(item => item._id === bookingB).status, 'CONFIRMED');
assert.equal(state.event.availableSeats, 0);
result = await call('POST', cancelPath, userA, { params: { bookingId: bookingA } });
assert.equal(result.body.alreadyCancelled, true);
assert.equal(state.event.availableSeats, 0);
result = await call('POST', cancelPath, userB, { params: { bookingId: bookingB } });
assert.equal(result.body.availableSeats, 1);

seed();
await call('POST', bookingsPath, userA);
state.bookings[0].userId = null;
assert.equal((await call('GET', bookingsPath, userA)).body.bookings.length, 0);
assert.equal((await call('POST', cancelPath, userA, { params: { bookingId: state.bookings[0]._id } })).error.status, 404);
assert.equal((await call('POST', cancelPath, admin, { params: { bookingId: state.bookings[0]._id } })).body.booking.status, 'CANCELLED');

seed();
await call('POST', bookingsPath, userA);
await call('POST', bookingsPath, userB);
failPromotion = true;
const beforeFailure = structuredClone(state);
assert.match((await call('POST', cancelPath, userA, { params: { bookingId: state.bookings[0]._id } })).error.message, /Injected/);
assert.deepEqual(structuredClone(state), beforeFailure);
failPromotion = false;
result = await call('POST', cancelPath, admin, { params: { bookingId: state.bookings[0]._id } });
assert.equal(result.body.promotedBooking.userId, userB._id);
console.log('PASS: route handlers with in-memory models: role/ownership checks, forged identity, scoped lists, legacy records, privacy, promotion, repeated cancellation and rollback. Live MongoDB was not tested.');
