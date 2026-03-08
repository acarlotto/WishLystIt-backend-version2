import { db, resend } from "../app.mjs";
import bcrypt from "bcrypt";
import crypto from "crypto";

const hashPassword = async (password) => {
  // hash password
  return await bcrypt.hash(password, 10);
};

const comparePassword = async (password, hashedPassword) => {
  // compare password
  // console.log(password, hashedPassword);
  const result = await bcrypt.compare(password, hashedPassword);
  // console.log(result);
  return result;
};

const generateToken = async (user) => {
  // generate token
  const token = crypto.randomBytes(32).toString("hex");
  // save token to db
  await db.collection("sessions").insertOne({
    token,
    userId: user._id,
    createdAt: new Date(),
    status: "active",
  });
  // return token
  return token;
};

export const getMe = async (req, res) => {
  try {
    res.json({
      user: {
        firstName: req.user.firstName,
        lastName: req.user.lastName,
        email: req.user.email,
      },
    });
  } catch (error) {
    console.log(error);
    res.status(500).json({ message: "Something went wrong" });
  }
};

export const login = async (req, res) => {
  try {
    // check if user exists
    const user = await db
      .collection("users")
      .findOne({ email: req.body.email });

    if (!user) {
      return res.status(400).json({ message: "Email or password incorrect." });
    }
    // check if password is correct
    const isPasswordCorrect = await comparePassword(
      req.body.password,
      user.password
    );

    if (!isPasswordCorrect) {
      return res.status(400).json({ message: "Email or password incorrect." });
    }
    // generate token
    const token = await generateToken(user);
    // send token
    res.json({
      user: {
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        token,
      },
    });
  } catch (error) {
    console.log(error);
    res.status(500).json({ message: "Something went wrong" });
  }
};

export const signup = async (req, res) => {
  try {
    // check if body contains, first name, last name, email, password
    const { firstName, lastName, email, password } = req.body;
    if (!firstName || !email || !password) {
      return res.status(400).json({ message: "Missing fields" });
    }
    // check if user exists
    const user = await db.collection("users").findOne({ email });
    if (user) {
      return res.status(400).json({ message: "User already exists" });
    }
    // hash password
    const hashedPassword = await hashPassword(password);
    // save user to db
    const result = await db.collection("users").insertOne({
      firstName,
      lastName,
      email,
      password: hashedPassword,
      createdAt: new Date(),
    });

    if (!result.insertedId) {
      return res.status(500).json({ message: "Something went wrong" });
    }
    res.json({ message: "User created" });
  } catch (error) {
    console.log(error);
    res.status(500).json({ message: "Something went wrong" });
  }
};

export const checkAuth = async (req, res, next) => {
  try {
    // check if token exists
    const token = req.headers.authorization;
    if (!token) {
      return res.status(401).json({ message: "Unauthorized" });
    }
    // check if token is valid and active
    const session = await db.collection("sessions").findOne({ token });
    if (!session || session.status !== "active") {
      return res.status(401).json({ message: "Unauthorized" });
    }

    // get user
    const user = await db.collection("users").findOne({ _id: session.userId });
    if (!user) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    // attach user to req
    req.user = user;

    next();
  } catch (error) {
    console.log(error);
    res.status(500).json({ message: "Something went wrong" });
  }
};

export const forgotPassword = async (req, res) => {
  try {
    // check if user exists
    const user = await db
      .collection("users")
      .findOne({ email: req.body.email });

    if (!user) {
      return res.status(400).json({ message: "User not found." });
    }

    // generate 6 digit numeric code
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    // save code to db
    await db.collection("password-reset-codes").insertOne({
      code,
      userId: user._id,
      createdAt: new Date(),
      status: "active",
    });

    // send email with code
    const { data, error } = await resend.emails.send({
      from: "WishLystit <hello@wishlystit.com>",
      to: [user.email],
      subject: "Password Reset Code",
      html: `<p>Hi ${user.firstName},</p>
      <p>Here is your password reset code: <strong>${code}</strong></p>
      <p>Thanks,</p>
      <p>WishLystit Team</p>`,
    });
//added for error code
    if (error) {
      console.error("Resend error:", error);
      return res.status(500).json({ message: "Failed to send email" });
    }
//end added for error code
    res.json({ message: "Code sent" });
  } catch (error) {
    console.log(error);
    res.status(500).json({ message: "Something went wrong" });
  }
};

export const resetPassword = async (req, res) => {
  try {
    // check if user exists
    const user = await db
      .collection("users")
      .findOne({ email: req.body.email });

    if (!user) {
      return res.status(400).json({ message: "User not found." });
    }

    // check if code exists
    const code = await db
      .collection("password-reset-codes")
      .findOne({ code: req.body.code, userId: user._id });

    if (!code) {
      return res.status(400).json({ message: "Invalid Code." });
    }

    // check if code is active or expired in 5 minutes
    const now = new Date();
    const createdAt = new Date(code.createdAt);
    const diff = now.getTime() - createdAt.getTime();
    const minutes = Math.floor(diff / 1000 / 60);
    if (minutes > 5 || code.status !== "active") {
      return res.status(400).json({ message: "Invalid Code." });
    }

    // hash password
    const hashedPassword = await hashPassword(req.body.password);

    // update user with new password
    await db
      .collection("users")
      .updateOne(
        { _id: user._id },
        { $set: { password: hashedPassword, emailVerified: true } }
      );

    // update code status to used
    await db
      .collection("password-reset-codes")
      .updateOne({ _id: code._id }, { $set: { status: "used" } });

    res.json({ message: "Password updated" });
  } catch (error) {
    console.log(error);
    res.status(500).json({ message: "Something went wrong" });
  }
};

export const changePassword = async (req, res) => {
  try {
    const user = req.user;
    // check if password is correct
    const isPasswordCorrect = await comparePassword(
      req.body.oldPassword,
      user.password
    );

    if (!isPasswordCorrect) {
      return res.status(400).json({ message: "Password incorrect." });
    }

    // hash password
    const hashedPassword = await hashPassword(req.body.newPassword);

    // update user with new password
    await db
      .collection("users")
      .updateOne({ _id: user._id }, { $set: { password: hashedPassword } });

    res.json({ message: "Password updated successfully!" });
  } catch (error) {
    console.log(error);
    res.status(500).json({ message: "Something went wrong" });
  }
};
