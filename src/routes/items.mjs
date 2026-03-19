import { Router } from "express";
import {
  addItem,
  deleteItem,
  getItems,
  getPublicItems,
} from "../controllers/items.mjs";
import { checkAuth } from "../controllers/auth.mjs";
import { getDiscoverItems } from "../controllers/items.mjs"; // adjust path

const router = Router();

router.get("/", checkAuth, getItems);
router.get("/public", getPublicItems);
router.post("/", checkAuth, addItem);
router.delete("/:id", checkAuth, deleteItem);
router.get("/items/discover", getDiscoverItems); // no auth needed — public route

export default router;
