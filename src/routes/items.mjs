import { Router } from "express";
import {
  addItem,
  deleteItem,
  getDiscoverItems,
  getItems,
  getPublicItems,
} from "../controllers/items.mjs";
import { checkAuth } from "../controllers/auth.mjs";

const router = Router();

router.get("/", checkAuth, getItems);
router.get("/public", getPublicItems);
router.post("/", checkAuth, addItem);
router.delete("/:id", checkAuth, deleteItem);
router.get("/discover", getDiscoverItems); // no auth needed — public route

export default router;
