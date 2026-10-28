import http from "node:http";
import mongoose from "mongoose";
import { Server } from "socket.io";
import { config } from "./config.js";
import { createApp, sessionMiddleware } from "./app.js";
import { closeExpiredAuctions } from "./auction.js";
import { Listing } from "./models.js";

await mongoose.connect(config.MONGODB_URI, { serverSelectionTimeoutMS: 10000 });

const server = http.createServer(createApp({
  now: () => new Date(),
  emitAuctionUpdate: (listingId) => io.to(`auction:${listingId}`).emit("auction:updated", { listingId })
}));
const io = new Server(server, {
  cors: { origin: config.FRONTEND_URL, credentials: true },
  serveClient: false
});

io.engine.use(sessionMiddleware);
io.use((socket, next) => {
  const request = socket.request as typeof socket.request & { session?: { userId?: string } };
  if (!request.session?.userId) return next(new Error("Authentication required."));
  next();
});
io.on("connection", (socket) => {
  socket.on("auction:subscribe", async (listingId: unknown, acknowledge?: (result: { ok: boolean; error?: string }) => void) => {
    if (typeof listingId !== "string" || !/^[a-f\d]{24}$/i.test(listingId)) {
      acknowledge?.({ ok: false, error: "Invalid auction identifier." });
      return;
    }
    const exists = await Listing.exists({ _id: listingId });
    if (!exists) {
      acknowledge?.({ ok: false, error: "Auction not found." });
      return;
    }
    await socket.join(`auction:${listingId}`);
    acknowledge?.({ ok: true });
  });
});

await closeExpiredAuctions(new Date(), (listingId) => io.to(`auction:${listingId}`).emit("auction:updated", { listingId }));
const reconcileTimer = setInterval(() => {
  void closeExpiredAuctions(new Date(), (listingId) => io.to(`auction:${listingId}`).emit("auction:updated", { listingId }))
    .catch((error: unknown) => console.error("Auction reconciliation failed:", error));
}, config.AUCTION_RECONCILE_INTERVAL_MS);
reconcileTimer.unref();

server.listen(config.PORT, () => {
  console.log(`CampusBid API listening on port ${config.PORT}`);
});

async function shutdown() {
  clearInterval(reconcileTimer);
  server.close();
  await mongoose.disconnect();
}

process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());
