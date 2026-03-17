import { Router } from "express";
import {
  changePassword,
  checkAuth,
  forgotPassword,
  getMe,
  login,
  resetPassword,
  signup,
  deleteAccount,
} from "../controllers/auth.mjs";

const router = Router();

router.get("/me", getMe);
router.post("/login", login);
router.post("/signup", signup);
router.post("/forgot-password", forgotPassword);
router.post("/reset-password", resetPassword);
router.post("/change-password", checkAuth, changePassword);
router.delete("/delete-account", checkAuth, deleteAccount);

export default router;
// At the bottom of auth.mjs
