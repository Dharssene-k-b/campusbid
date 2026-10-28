import { afterAll, beforeAll, describe, expect, it } from "vitest";
import supertest from "supertest";
import mongoose from "mongoose";

process.env.NODE_ENV = "test";
process.env.MONGODB_URI = "mongodb://127.0.0.1:27017/campusbid_test";
process.env.FRONTEND_URL = "http://localhost:5173";

const [{ createApp }, { closeExpiredAuctions }] = await Promise.all([
  import("./app.js"),
  import("./auction.js"),
  import("./models.js")
]);

let now = new Date("2026-10-28T05:00:00.000Z");
const app = createApp({
  now: () => new Date(now),
  emitAuctionUpdate: () => undefined
});

type Student = { agent: ReturnType<typeof supertest.agent>; displayName: string };
async function createStudent(email: string, displayName: string): Promise<Student> {
  const agent = supertest.agent(app);
  const registration = await agent.post("/api/auth/register").send({
    email,
    password: "campusbid-test-password",
    displayName
  });
  expect(registration.status).toBe(201);
  const verification = await agent.post("/api/auth/verify").send({ token: registration.body.developmentVerificationToken });
  expect(verification.status).toBe(200);
  return { agent, displayName };
}

async function uploadPhoto(student: Student): Promise<string> {
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/rvsAAAAASUVORK5CYII=", "base64");
  const uploaded = await student.agent.post("/api/uploads").attach("photo", png, { filename: "demo.png", contentType: "image/png" });
  expect(uploaded.status).toBe(201);
  return uploaded.body.url as string;
}

async function createListing(seller: Student, closing: Date, title = "Scientific calculator") {
  const photo = await uploadPhoto(seller);
  const response = await seller.agent.post("/api/listings").send({
    title,
    category: "Calculators",
    description: "A tested scientific calculator in good working condition.",
    condition: "Good",
    photos: [photo],
    startingPrice: 200,
    minimumIncrement: 20,
    closesAt: closing.toISOString()
  });
  expect(response.status).toBe(201);
  return response.body.listing as { _id: string };
}

beforeAll(async () => {
  await mongoose.connect(process.env.MONGODB_URI!);
  await mongoose.connection.dropDatabase();
});

afterAll(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

describe("CampusBid basic auction lifecycle", () => {
  it("verifies students, enforces auction rules, closes, reserves, and completes a handover", async () => {
    const seller = await createStudent("seller@campus.test", "Senior Seller");
    const first = await createStudent("first@campus.test", "Junior One");
    const second = await createStudent("second@campus.test", "Junior Two");
    const listingId = (await createListing(seller, new Date(now.getTime() + 60_000)))._id;

    expect((await first.agent.post(`/api/listings/${listingId}/bids`).send({ amount: 199 })).status).toBe(400);
    expect((await seller.agent.post(`/api/listings/${listingId}/bids`).send({ amount: 200 })).status).toBe(403);
    expect((await first.agent.get("/api/listings?q=calculator&category=Calculators&condition=Good&minPrice=190&maxPrice=210")).body.items).toHaveLength(1);
    expect((await first.agent.get("/api/listings?closingSoon=true&sort=ending")).body.items).toHaveLength(1);
    expect((await first.agent.get("/api/listings?page=1&limit=1")).body.page).toBe(1);

    const firstBid = await first.agent.post(`/api/listings/${listingId}/bids`).send({ amount: 200 });
    expect(firstBid.status).toBe(201);
    const secondBid = await second.agent.post(`/api/listings/${listingId}/bids`).send({ amount: 220 });
    expect(secondBid.status).toBe(201);
    expect((await first.agent.post(`/api/listings/${listingId}/bids`).send({ amount: 225 })).status).toBe(400);

    const competing = await Promise.all([
      first.agent.post(`/api/listings/${listingId}/bids`).send({ amount: 240 }),
      second.agent.post(`/api/listings/${listingId}/bids`).send({ amount: 240 })
    ]);
    expect(competing.filter((response) => response.status === 201)).toHaveLength(1);
    expect(competing.filter((response) => [400, 409].includes(response.status))).toHaveLength(1);

    const details = await first.agent.get(`/api/listings/${listingId}`);
    expect(details.body.bidHistory).toHaveLength(3);
    expect(details.body.bidHistory[0].bidderAlias).toBeTruthy();
    expect(details.body.bidHistory[0].bidderAlias).not.toContain("@");
    const priceFiltered = await first.agent.get("/api/listings?category=Calculators&minPrice=230&maxPrice=300");
    expect(priceFiltered.body.items).toHaveLength(1);

    now = new Date(now.getTime() + 61_000);
    expect((await first.agent.post(`/api/listings/${listingId}/bids`).send({ amount: 500 })).status).toBe(409);
    expect(await closeExpiredAuctions(now)).toBe(1);
    const closed = await first.agent.get(`/api/listings/${listingId}`);
    expect(closed.body.listing.biddingStatus).toBe("Closed");
    expect(closed.body.listing.saleOutcome).toBe("Pending seller decision");

    expect((await second.agent.post(`/api/listings/${listingId}/decision`).send({ decision: "approve" })).status).toBe(409);
    expect((await seller.agent.post(`/api/listings/${listingId}/decision`).send({ decision: "approve" })).status).toBe(200);
    expect((await seller.agent.get(`/api/listings/${listingId}/handover`)).status).toBe(200);

    const firstIsWinner = (await first.agent.get(`/api/listings/${listingId}`)).body.listing.isProvisionalWinner;
    const winner = firstIsWinner ? first : second;
    expect((await seller.agent.post(`/api/listings/${listingId}/handover/confirm`)).status).toBe(200);
    expect((await winner.agent.post(`/api/listings/${listingId}/handover/confirm`)).body.complete).toBe(true);
    expect((await winner.agent.post(`/api/listings/${listingId}/handover/confirm`)).status).toBe(409);
    expect((await winner.agent.post(`/api/listings/${listingId}/handover/failed-pickup`)).status).toBe(409);
    expect((await seller.agent.get(`/api/listings/${listingId}`)).body.listing.saleOutcome).toBe("Completed");

    expect((await seller.agent.get("/api/notifications")).body.items.length).toBeGreaterThan(0);
    expect((await first.agent.get("/api/dashboard")).body.bids.length).toBeGreaterThan(0);
    const notification = (await seller.agent.get("/api/notifications")).body.items[0];
    expect((await seller.agent.post(`/api/notifications/${notification.id}/read`)).body.read).toBe(true);
    expect((await seller.agent.get(`/api/listings/${listingId}/handover`)).body.sellerConfirmedAt).toBeTruthy();
  });

  it("rejects unverified and unauthorized operations, and preserves cancellation history", async () => {
    const registering = supertest.agent(app);
    const response = await registering.post("/api/auth/register").send({
      email: "pending@campus.test",
      password: "campusbid-test-password",
      displayName: "Pending Student"
    });
    expect(response.status).toBe(201);
    expect((await registering.post("/api/listings").send({})).status).toBe(401);
    expect((await registering.post("/api/auth/verify").send({ token: "invalid-token-invalid-token" })).status).toBe(400);

    const seller = await createStudent("seller-two@campus.test", "Another Seller");
    const bidder = await createStudent("bidder-three@campus.test", "Another Bidder");
    const outsider = await createStudent("outsider@campus.test", "Campus Outsider");
    const listingId = (await createListing(seller, new Date(now.getTime() + 120_000), "Used campus calculator"))._id;
    expect((await outsider.agent.patch(`/api/listings/${listingId}`).send({ title: "Not yours" })).status).toBe(404);
    expect((await bidder.agent.post(`/api/listings/${listingId}/bids`).send({ amount: 200 })).status).toBe(201);
    expect((await seller.agent.post(`/api/listings/${listingId}/cancel`)).status).toBe(200);
    const cancelled = await bidder.agent.get(`/api/listings/${listingId}`);
    expect(cancelled.body.listing.biddingStatus).toBe("Cancelled");
    expect(cancelled.body.bidHistory).toHaveLength(1);
    expect((await outsider.agent.post(`/api/listings/${listingId}/bids`).send({ amount: 220 })).status).toBe(409);
    expect((await outsider.agent.post(`/api/listings/${listingId}/handover/confirm`)).status).toBe(409);
    expect((await seller.agent.post("/api/auth/logout")).status).toBe(204);
    expect((await seller.agent.get("/api/dashboard")).status).toBe(401);
  });

  it("marks no-bid auctions unsold and records seller rejection and failed pickup", async () => {
    const seller = await createStudent("seller-three@campus.test", "Graduating Seller");
    const buyer = await createStudent("buyer-four@campus.test", "Campus Buyer");
    const noBidId = (await createListing(seller, new Date(now.getTime() + 10_000), "Unbid calculator"))._id;
    const rejectedId = (await createListing(seller, new Date(now.getTime() + 20_000), "Rejected calculator"))._id;
    const failedId = (await createListing(seller, new Date(now.getTime() + 30_000), "Pickup calculator"))._id;
    expect((await buyer.agent.post(`/api/listings/${rejectedId}/bids`).send({ amount: 200 })).status).toBe(201);
    expect((await buyer.agent.post(`/api/listings/${failedId}/bids`).send({ amount: 200 })).status).toBe(201);
    now = new Date(now.getTime() + 15_000);
    expect(await closeExpiredAuctions(now)).toBe(1);
    expect((await seller.agent.get(`/api/listings/${noBidId}`)).body.listing.saleOutcome).toBe("Unsold");
    expect((await seller.agent.get(`/api/listings/${rejectedId}`)).body.listing.biddingStatus).toBe("Open");
    now = new Date(now.getTime() + 16_000);
    expect(await closeExpiredAuctions(now)).toBe(2);
    expect(await closeExpiredAuctions(now)).toBe(0);
    expect((await seller.agent.post(`/api/listings/${rejectedId}/decision`).send({ decision: "reject" })).status).toBe(200);
    expect((await seller.agent.get(`/api/listings/${rejectedId}`)).body.listing.saleOutcome).toBe("Rejected");
    expect((await buyer.agent.post(`/api/listings/${failedId}/decision`).send({ decision: "approve" })).status).toBe(409);
    expect((await seller.agent.post(`/api/listings/${failedId}/decision`).send({ decision: "approve" })).status).toBe(200);
    expect((await buyer.agent.post(`/api/listings/${failedId}/handover/failed-pickup`)).status).toBe(204);
    expect((await seller.agent.get(`/api/listings/${failedId}`)).body.listing.saleOutcome).toBe("Failed pickup");
  });

  it("rejects invalid photo references and invalid combined price ranges", async () => {
    const seller = await createStudent("seller-four@campus.test", "Book Seller");
    const invalidUpload = await seller.agent.post("/api/uploads").attach("photo", Buffer.from("this is not an image"), { filename: "image.png", contentType: "image/png" });
    expect(invalidUpload.status).toBe(400);
    const invalid = await seller.agent.post("/api/listings").send({
      title: "Campus textbook",
      category: "Books",
      description: "Used textbook with all pages in place.",
      condition: "Good",
      photos: ["https://example.com/image.jpg"],
      startingPrice: 200,
      minimumIncrement: 20,
      closesAt: new Date(now.getTime() + 60_000).toISOString()
    });
    expect(invalid.status).toBe(400);
    const filters = await supertest(app).get("/api/listings?minPrice=500&maxPrice=100");
    expect(filters.status).toBe(400);
  });

  it("expires verification links and issues a fresh development link on resend", async () => {
    const agent = supertest.agent(app);
    const registered = await agent.post("/api/auth/register").send({
      email: "expired@campus.test",
      password: "campusbid-test-password",
      displayName: "Expired Link"
    });
    expect(registered.status).toBe(201);
    now = new Date(now.getTime() + 24 * 60 * 60 * 1000 + 1);
    expect((await agent.post("/api/auth/verify").send({ token: registered.body.developmentVerificationToken })).status).toBe(400);
    const resent = await agent.post("/api/auth/resend-verification").send({ email: "expired@campus.test" });
    expect(resent.status).toBe(200);
    expect(resent.body.developmentVerificationToken).toBeTruthy();
    expect((await agent.post("/api/auth/verify").send({ token: resent.body.developmentVerificationToken })).status).toBe(200);
  });
});
