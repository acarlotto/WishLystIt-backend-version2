import { Router } from "express";
import { checkAuth } from "../controllers/auth.mjs";
import {
  acceptInvite,
  createInvite,
  declineInvite,
  disconnectPartnership,
  getInvitePreview,
  getMyPartnership,
} from "../controllers/partnerships.mjs";

const router = Router();

router.post("/invite", checkAuth, createInvite);
router.get("/invite/:code", getInvitePreview);
router.post("/invite/:code/accept", checkAuth, acceptInvite);
router.post("/invite/:code/decline", checkAuth, declineInvite);
router.get("/me", checkAuth, getMyPartnership);
router.post("/disconnect", checkAuth, disconnectPartnership);

export default router;
