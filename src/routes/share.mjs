import { Router } from "express";
import { getDetails, getItems, share } from "../controllers/share.mjs";
import { checkAuth } from "../controllers/auth.mjs";

const router = Router();

router.get("/", checkAuth, getDetails);
router.get("/:token", getItems);
router.post("/", checkAuth, share);

export default router;
