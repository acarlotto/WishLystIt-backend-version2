import { Router } from "express";
import {
  addItem,
  deleteItem,
  getItems,
  getPublicItems,
} from "../controllers/items.mjs";
import { checkAuth } from "../controllers/auth.mjs";

const router = Router();

router.get("/", checkAuth, getItems);
router.get("/public", getPublicItems);
router.post("/", checkAuth, addItem);
router.delete("/:id", checkAuth, deleteItem);

export default router;
