import { ObjectId } from "mongodb";
import { db } from "../app.mjs";
import { google } from "googleapis";
import { createSheet, jwtClient, sheetExists } from "../Sheets.mjs";

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
    const item = {
      brand: req.body.brand,
      brandUrl: req.body.brandUrl,
      title: req.body.title,
      price: req.body.price,
      image: req.body.image,
      url: req.body.url,
      color: req.body.color,
      size: req.body.size,
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
