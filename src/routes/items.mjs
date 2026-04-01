import { Router } from "express";
import {
  addItem,
  checkPriceByName,
  deleteItem,
  discoverByImage,
  getDiscoverItems,
  getItems,
  getPublicItems,
  runManualPriceCheck,
} from "../controllers/items.mjs";
import { checkAuth } from "../controllers/auth.mjs";

const router = Router();

router.get("/", checkAuth, getItems);
router.get("/public", getPublicItems);
router.post("/", checkAuth, addItem);
router.delete("/:id", checkAuth, deleteItem);
router.get("/discover", getDiscoverItems); // no auth needed — public route
router.post("/discover", discoverByImage); // no auth needed — public route
router.post("/price-check", checkAuth, checkPriceByName);
router.post("/price-check/run", checkAuth, runManualPriceCheck);

export default router;
