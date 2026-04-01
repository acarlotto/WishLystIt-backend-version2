import { ObjectId } from "mongodb";
import { db } from "../app.mjs";
import { google } from "googleapis";
import { createSheet, jwtClient, sheetExists } from "../Sheets.mjs";
import { discoverByImage as discoverByImageService } from "../services/discover.mjs";
import {
  checkPriceByProductName,
  parseNumericPrice,
  runPriceChecksOnce,
  sendPriceDropPush,
} from "../services/priceAlerts.mjs";

export const getItems = async (req, res) => {
  const page = req.query.page || 1;
  const limit = 50;
  try {
    // get items from db by userId with pagination (10 items per page) and sort by createdAt, also return number of total items for pagination
    const items = await db
      .collection("items")
      .find({ userId: req.user._id })
      .project({ userId: 0 })
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .toArray();

    const totalItems = await db
      .collection("items")
      .countDocuments({ userId: req.user._id });

    const hasMore = totalItems > page * limit;
    const totalPages = Math.ceil(totalItems / limit);

    res.json({ items, totalItems, page, hasMore, totalPages });
  } catch (error) {
    console.log(error);
    res.status(500).json({ message: "Something went wrong" });
  }
};

export const getPublicItems = async (req, res) => {
  try {
    // get last 10 items from db
    const items = await db
      .collection("items")
      .find()
      .project({ userId: 0 })
      .sort({ createdAt: -1 })
      .limit(10)
      .toArray();
    res.json(items);
  } catch (error) {
    console.log(error);
    res.status(500).json({ message: "Something went wrong" });
  }
};

export const addItem = async (req, res) => {
  try {
    const savedPrice = parseNumericPrice(req.body.price);
    const item = {
      brand: req.body.brand,
      brandUrl: req.body.brandUrl,
      title: req.body.title,
      price: req.body.price,
      image: req.body.image,
      url: req.body.url,
      color: req.body.color,
      size: req.body.size,
      savedPrice,
      currentPrice: savedPrice,
      lastAlerted: null,
    };

    const result = await db.collection("items").insertOne({
      ...item,
      userId: req.user._id,
      createdAt: new Date(),
    });

    item._id = result.insertedId;
    addItemToGoogleSheet(item, req.user);
    res.json(item);
  } catch (error) {
    console.log(error);
    res.status(500).json({ message: "Something went wrong" });
  }
};

const addItemToGoogleSheet = async (item, user) => {
  try {
    if (!jwtClient || !process.env.SPREADSHEET_ID) {
      return;
    }
    // await jwtClient.authorize();
    const sheetsApi = google.sheets({ version: "v4", auth: jwtClient });
    const values = [item._id, item.price, item.url, user.email];
    const sheet = new URL(item.url).hostname.replace("www.", "");
    const resource = {
      values: [values],
    };

    // Check if the sheet exists
    const DoesSheetExists = await sheetExists(sheetsApi, sheet);

    if (!DoesSheetExists) {
      // Create the sheet if it doesn't exist
      await createSheet(sheetsApi, sheet);
    }

    const response = sheetsApi.spreadsheets.values.append({
      spreadsheetId: process.env.SPREADSHEET_ID,
      range: sheet,
      valueInputOption: "USER_ENTERED",
      resource,
    });

    console.log("item saved to google sheet");
  } catch (error) {
    console.log("failed to save item to google sheet", error);
  }
};

export const deleteItem = async (req, res) => {
  try {
    await db.collection("items").deleteOne({
      _id: new ObjectId(req.params.id),
      userId: req.user._id,
    });
    res.json({ message: "Item deleted successfully" });
  } catch (error) {
    console.log(error);
    res.status(500).json({ message: "Something went wrong" });
  }
};

// discover page: up to 50 items from all users
export const getDiscoverItems = async (req, res) => {
  try {
    const items = await db
      .collection("items")
      .find()
      .project({ userId: 0 })
      .sort({ createdAt: -1 })
      .limit(50)
      .toArray();

    res.json({ items });
  } catch (error) {
    console.log(error);
    res.status(500).json({ message: "Something went wrong" });
  }
};

export const discoverByImage = async (req, res) => {
  try {
    const imageBase64 = req.body?.imageBase64;
    const imageUrl = req.body?.imageUrl;
    const rawLimit = Number.parseInt(req.body?.limit, 10);
    const limit = Number.isFinite(rawLimit)
      ? Math.min(Math.max(rawLimit, 1), 50)
      : 20;

    if (!imageBase64 && !imageUrl) {
      return res.status(400).json({
        message: "Please provide imageBase64 or imageUrl",
      });
    }

    const response = await discoverByImageService({
      imageBase64,
      imageUrl,
      limit,
    });

    return res.json(response);
  } catch (error) {
    console.log(error);
    return res.status(500).json({
      message: "Image discovery failed",
      error: error.message,
    });
  }
};

export const runManualPriceCheck = async (req, res) => {
  try {
    const startedAt = new Date();
    const result = await runPriceChecksOnce({ userId: req.user?._id });
    const finishedAt = new Date();
    return res.json({
      success: true,
      startedAt,
      finishedAt,
      triggeredBy: req.user?.email || "authenticated-user",
      checked: result?.checked ?? 0,
      notified: result?.notified ?? 0,
      debug: result?.debug || [],
    });
  } catch (error) {
    console.log(error);
    return res.status(500).json({ message: "Failed to run price checks" });
  }
};

export const checkPriceByName = async (req, res) => {
  try {
    const title = req.body?.title;
    const limit = Number.parseInt(req.body?.limit, 10) || 10;
    const baselinePrice = parseNumericPrice(req.body?.baselinePrice);
    const notifyOnDrop = req.body?.notifyOnDrop === true;
    const result = await checkPriceByProductName({ title, limit });

    let notification = {
      attempted: false,
      sent: false,
      reason: null,
    };

    const bestPrice = result?.bestPrice?.price;
    const isDrop =
      typeof bestPrice === "number" &&
      typeof baselinePrice === "number" &&
      bestPrice < baselinePrice;

    if (notifyOnDrop) {
      notification.attempted = true;
      if (!isDrop) {
        notification.reason = "not_dropped";
      } else if (!req.user?.expoPushToken) {
        notification.reason = "push_token_missing";
      } else {
        await sendPriceDropPush({
          expoPushToken: req.user.expoPushToken,
          productName: title || "Wishlist item",
          savedPrice: baselinePrice,
          currentPrice: bestPrice,
          productUrl: result?.bestPrice?.link || null,
        });
        notification.sent = true;
        notification.reason = "sent";
      }
    }

    return res.json({
      ...result,
      baselinePrice: baselinePrice ?? null,
      isPriceDrop: Boolean(isDrop),
      notification,
    });
  } catch (error) {
    console.log(error);
    return res.status(400).json({
      success: false,
      message: "Price check failed",
      error: error.message,
    });
  }
};