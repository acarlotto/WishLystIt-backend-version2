import { db } from "../app.mjs";
import md5 from "md5";

export const getDetails = async (req, res) => {
  try {
    const item = await db.collection("sharing").findOne({
      userId: req.user._id,
    });

    if (!item) {
      return res.json({ status: false, link: "" });
    }

    res.json({ status: item.status, link: item.link });
  } catch (error) {
    console.log(error);
    res.status(500).json({ message: "Something went wrong" });
  }
};

// generate unique token based on user._id
export const generateToken = async (user) => {
  const token = md5(user._id + new Date().getTime());
  return token;
};

export const share = async (req, res) => {
  try {
    let item = await db.collection("sharing").findOne({
      userId: req.user._id,
    });

    if (!item) {
      let token = await generateToken(req.user);
      item = {
        link: `${process.env.FRONTEND_URL}/share/${token}`,
        userId: req.user._id,
        status: true,
        token,
      };

      await db.collection("sharing").insertOne(item);
    }

    // update status
    item.status = req.body.status;
    await db.collection("sharing").updateOne(
      { userId: req.user._id },
      {
        $set: {
          status: req.body.status,
        },
      }
    );

    res.json({ status: item.status, link: item.link });
  } catch (error) {
    console.log(error);
    res.status(500).json({ message: "Something went wrong" });
  }
};

export const getItems = async (req, res) => {
  const page = req.query.page || 1;
  const limit = 10;
  try {
    const sharing = await db.collection("sharing").findOne({
      token: req.params.token,
    });

    if (!sharing) {
      return res.status(404).json({ message: "Sharing not found" });
    }

    if (!sharing.status) {
      return res.status(403).json({ message: "Sharing is disabled" });
    }

    const user = await db.collection("users").findOne({
      _id: sharing.userId,
    });

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    // get items from db by userId with pagination (10 items per page) and sort by createdAt, also return number of total items for pagination
    const items = await db
      .collection("items")
      .find({ userId: user._id })
      .project({ userId: 0 })
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .toArray();

    const totalItems = await db
      .collection("items")
      .countDocuments({ userId: user._id });

    const hasMore = totalItems > page * limit;
    const totalPages = Math.ceil(totalItems / limit);

    res.json({
      items,
      totalItems,
      page,
      hasMore,
      totalPages,
      userName: user.firstName + " " + user.lastName,
    });
  } catch (error) {
    console.log(error);
    res.status(500).json({ message: "Something went wrong" });
  }
};
