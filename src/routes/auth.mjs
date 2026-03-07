import { Router } from "express";
import {
  changePassword,
  checkAuth,
  forgotPassword,
  getMe,
  login,
  resetPassword,
  signup,
} from "../controllers/auth.mjs";

const router = Router();

router.get("/me", getMe);
router.post("/login", login);
router.post("/signup", signup);
router.post("/forgot-password", forgotPassword);
router.post("/reset-password", resetPassword);
router.post("/change-password", checkAuth, changePassword);

export default router;
