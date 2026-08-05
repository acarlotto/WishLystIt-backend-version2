import crypto from "crypto";
import { db } from "../app.mjs";

const INVITE_CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const INVITE_EXPIRY_DAYS = 7;
const FRONTEND_URL = (process.env.FRONTEND_URL || "https://app.wishlystit.com").replace(
  /\/$/,
  ""
);

function generateInviteCode() {
  let code = "";
  for (let i = 0; i < 8; i++) {
    code += INVITE_CODE_CHARS[crypto.randomInt(0, INVITE_CODE_CHARS.length)];
  }
  return code;
}

function formatUserName(user) {
  if (!user) return "Someone";
  return `${user.firstName || ""} ${user.lastName || ""}`.trim() || "Someone";
}

function normalizeCode(code) {
  return String(code || "").trim().toUpperCase();
}

async function findActivePartnership(userId) {
  return db.collection("partnerships").findOne({
    status: "accepted",
    $or: [{ userId1: userId }, { userId2: userId }],
  });
}

async function declineOtherPending(userIds, excludeId, now) {
  const ids = userIds.filter(Boolean);
  if (ids.length === 0) return;

  await db.collection("partnerships").updateMany(
    {
      status: "pending",
      _id: { $ne: excludeId },
      $or: [
        { userId1: { $in: ids } },
        { invitedBy: { $in: ids } },
      ],
    },
    {
      $set: {
        status: "declined",
        declinedAt: now,
        inviteCode: null,
        inviteCodeExpiresAt: null,
      },
    }
  );
}

function partnerIdForUser(partnership, userId) {
  if (partnership.userId1.equals(userId)) return partnership.userId2;
  return partnership.userId1;
}

export const createInvite = async (req, res) => {
  try {
    const userId = req.user._id;
    const active = await findActivePartnership(userId);
    if (active) {
      return res.status(400).json({
        message:
          "You already have an active partner. Disconnect first to invite someone new.",
        code: "already_partnered",
      });
    }

    const inviteCode = generateInviteCode();
    const now = new Date();
    const expiresAt = new Date(
      now.getTime() + INVITE_EXPIRY_DAYS * 24 * 60 * 60 * 1000
    );

    await db.collection("partnerships").insertOne({
      userId1: userId,
      userId2: null,
      status: "pending",
      invitedBy: userId,
      createdAt: now,
      acceptedAt: null,
      declinedAt: null,
      unlinkedAt: null,
      inviteCode,
      inviteCodeExpiresAt: expiresAt,
      inviteCodeUsedAt: null,
    });

    res.json({
      inviteCode,
      inviteUrl: `${FRONTEND_URL}/invite/${inviteCode}`,
      expiresAt,
    });
  } catch (error) {
    console.log(error);
    res.status(500).json({ message: "Something went wrong" });
  }
};

export const getInvitePreview = async (req, res) => {
  try {
    const code = normalizeCode(req.params.code);
    if (!code) {
      return res.status(400).json({ message: "Invalid invite code." });
    }

    const partnership = await db.collection("partnerships").findOne({
      inviteCode: code,
    });

    if (!partnership) {
      return res.status(404).json({
        message: "Invite not found or already used.",
        code: "invite_not_found",
      });
    }

    if (partnership.status !== "pending") {
      return res.status(400).json({
        message: "This invite has already been used.",
        code: "invite_used",
      });
    }

    if (new Date() > new Date(partnership.inviteCodeExpiresAt)) {
      return res.status(400).json({
        message: "This invite has expired.",
        code: "invite_expired",
      });
    }

    const inviter = await db
      .collection("users")
      .findOne({ _id: partnership.userId1 });

    res.json({
      inviterName: formatUserName(inviter),
      expiresAt: partnership.inviteCodeExpiresAt,
    });
  } catch (error) {
    console.log(error);
    res.status(500).json({ message: "Something went wrong" });
  }
};

export const acceptInvite = async (req, res) => {
  try {
    const userId = req.user._id;
    const code = normalizeCode(req.params.code);
    if (!code) {
      return res.status(400).json({ message: "Invalid invite code." });
    }

    const partnership = await db.collection("partnerships").findOne({
      inviteCode: code,
    });

    if (!partnership) {
      return res.status(404).json({
        message: "Invite not found or already used.",
        code: "invite_not_found",
      });
    }

    if (partnership.status !== "pending") {
      return res.status(400).json({
        message: "This invite has already been used.",
        code: "invite_used",
      });
    }

    if (new Date() > new Date(partnership.inviteCodeExpiresAt)) {
      return res.status(400).json({
        message: "This invite has expired.",
        code: "invite_expired",
      });
    }

    if (partnership.userId1.equals(userId)) {
      return res.status(400).json({
        message: "You cannot accept your own invite.",
        code: "self_invite",
      });
    }

    const myActive = await findActivePartnership(userId);
    if (myActive) {
      const partnerId = partnerIdForUser(myActive, userId);
      const partner = await db.collection("users").findOne({ _id: partnerId });
      return res.status(400).json({
        message: `You're already connected with ${formatUserName(partner)}. Disconnect first to link with someone new.`,
        code: "already_partnered",
        partnerName: formatUserName(partner),
      });
    }

    const inviterActive = await findActivePartnership(partnership.userId1);
    if (inviterActive) {
      return res.status(400).json({
        message: "This invite is no longer valid.",
        code: "inviter_partnered",
      });
    }

    const now = new Date();
    const result = await db.collection("partnerships").updateOne(
      {
        _id: partnership._id,
        status: "pending",
        inviteCode: code,
      },
      {
        $set: {
          userId2: userId,
          status: "accepted",
          acceptedAt: now,
          inviteCode: null,
          inviteCodeExpiresAt: null,
          inviteCodeUsedAt: now,
        },
      }
    );

    if (result.modifiedCount !== 1) {
      return res.status(400).json({
        message: "This invite is no longer valid.",
        code: "invite_used",
      });
    }

    await declineOtherPending([userId, partnership.userId1], partnership._id, now);

    const inviter = await db
      .collection("users")
      .findOne({ _id: partnership.userId1 });

    res.json({
      message: "Partnership accepted",
      partnership: {
        id: partnership._id.toString(),
        status: "accepted",
        acceptedAt: now,
        partner: {
          _id: inviter._id.toString(),
          firstName: inviter.firstName,
          lastName: inviter.lastName,
        },
      },
    });
  } catch (error) {
    console.log(error);
    res.status(500).json({ message: "Something went wrong" });
  }
};

export const declineInvite = async (req, res) => {
  try {
    const userId = req.user._id;
    const code = normalizeCode(req.params.code);
    if (!code) {
      return res.status(400).json({ message: "Invalid invite code." });
    }

    const partnership = await db.collection("partnerships").findOne({
      inviteCode: code,
    });

    if (!partnership) {
      return res.status(404).json({
        message: "Invite not found or already used.",
        code: "invite_not_found",
      });
    }

    if (partnership.status !== "pending") {
      return res.status(400).json({
        message: "This invite has already been used.",
        code: "invite_used",
      });
    }

    if (partnership.userId1.equals(userId)) {
      return res.status(400).json({
        message: "You cannot decline your own invite.",
        code: "self_invite",
      });
    }

    const now = new Date();
    await db.collection("partnerships").updateOne(
      { _id: partnership._id, status: "pending", inviteCode: code },
      {
        $set: {
          status: "declined",
          declinedAt: now,
          inviteCode: null,
          inviteCodeExpiresAt: null,
          inviteCodeUsedAt: now,
        },
      }
    );

    res.json({ message: "Invite declined" });
  } catch (error) {
    console.log(error);
    res.status(500).json({ message: "Something went wrong" });
  }
};

export const getMyPartnership = async (req, res) => {
  try {
    const userId = req.user._id;
    const partnership = await findActivePartnership(userId);

    if (!partnership) {
      return res.json({ partnership: null });
    }

    const partnerId = partnerIdForUser(partnership, userId);
    const partner = await db.collection("users").findOne({ _id: partnerId });

    res.json({
      partnership: {
        id: partnership._id.toString(),
        status: partnership.status,
        acceptedAt: partnership.acceptedAt,
        partner: partner
          ? {
              _id: partner._id.toString(),
              firstName: partner.firstName,
              lastName: partner.lastName,
            }
          : null,
      },
    });
  } catch (error) {
    console.log(error);
    res.status(500).json({ message: "Something went wrong" });
  }
};

export const disconnectPartnership = async (req, res) => {
  try {
    const userId = req.user._id;
    const partnership = await findActivePartnership(userId);

    if (!partnership) {
      return res.status(400).json({ message: "No active partnership." });
    }

    const now = new Date();
    await db.collection("partnerships").updateOne(
      { _id: partnership._id },
      { $set: { status: "unlinked", unlinkedAt: now } }
    );

    res.json({ message: "Disconnected" });
  } catch (error) {
    console.log(error);
    res.status(500).json({ message: "Something went wrong" });
  }
};
