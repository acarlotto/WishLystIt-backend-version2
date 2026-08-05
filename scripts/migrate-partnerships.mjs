/**
 * Creates indexes for the partnerships collection.
 * Run once against production/staging: node scripts/migrate-partnerships.mjs
 * Requires MONGO_URI in environment (or .env loaded via dotenv).
 */
import dotenv from "dotenv";
import { MongoClient } from "mongodb";

dotenv.config();

const MONGO_URI = process.env.MONGO_URI;
if (!MONGO_URI) {
  console.error("MONGO_URI is required");
  process.exit(1);
}

const DB_NAME = "wishlystit";

async function migrate() {
  const client = new MongoClient(MONGO_URI);
  await client.connect();
  const col = client.db(DB_NAME).collection("partnerships");

  await col.createIndex(
    { inviteCode: 1 },
    {
      unique: true,
      partialFilterExpression: { inviteCode: { $type: "string" } },
      name: "partnerships_inviteCode_unique",
    }
  );

  await col.createIndex(
    { userId1: 1, status: 1 },
    { name: "partnerships_userId1_status" }
  );

  await col.createIndex(
    { userId2: 1, status: 1 },
    { name: "partnerships_userId2_status" }
  );

  await col.createIndex(
    { invitedBy: 1, status: 1 },
    { name: "partnerships_invitedBy_status" }
  );

  await col.createIndex(
    { status: 1, inviteCodeExpiresAt: 1 },
    {
      partialFilterExpression: { status: "pending" },
      name: "partnerships_pending_expiry",
    }
  );

  await col.createIndex(
    { userId1: 1, userId2: 1 },
    {
      unique: true,
      partialFilterExpression: { status: "accepted" },
      name: "partnerships_accepted_pair_unique",
    }
  );

  console.log("partnerships indexes created");
  await client.close();
}

migrate().catch((e) => {
  console.error(e);
  process.exit(1);
});
