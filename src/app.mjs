// import express from "express";
// import dotenv from "dotenv";
// import cors from "cors";

// dotenv.config();

// const app = express();
// app.use(express.json());

// // allow cors
// const corsOptions = {
//   origin: "*",
// };
// app.options("*", cors(corsOptions));
// app.use(cors(corsOptions));

// import AuthRouter from "./routes/auth.mjs";
// import ItemsRouter from "./routes/items.mjs";
// import { MongoClient } from "mongodb";
// import { Resend } from "resend";
// import ShareRouter from "./routes/share.mjs";

// // mongodb
// const mongoClient = new MongoClient(process.env.MONGO_URI);
// export const db = mongoClient.db("wishlystit");
// export const resend = new Resend(process.env.RESEND_API_KEY);

// app.get("/", (req, res) => {
//   res.send("Hello World!");
// });

// // debug route ← ADD HERE
// app.get("/api/v1/auth/debug", (req, res) => {
//   res.json({ message: "auth routes are reachable" });
// });


// app.use("/api/v1/auth", AuthRouter);
// app.use("/api/v1/items", ItemsRouter);
// app.use("/api/v1/share", ShareRouter);

// app.listen(process.env.PORT || 3500, () => {
//   console.log(`app listening at http://localhost:${process.env.PORT || 3500}`);
// });

import express from "express";
import dotenv from "dotenv";
import cors from "cors";
import { MongoClient } from "mongodb";
import { Resend } from "resend";
import AuthRouter from "./routes/auth.mjs";
import ItemsRouter from "./routes/items.mjs";
import ShareRouter from "./routes/share.mjs";

dotenv.config();

const app = express();
app.use(express.json({ limit: "12mb" }));

const corsOptions = {
  origin: "*",
  methods: ["GET", "HEAD", "PUT", "PATCH", "POST", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
};
app.options("*", cors(corsOptions));
app.use(cors(corsOptions));

const mongoClient = new MongoClient(process.env.MONGO_URI);
export const db = mongoClient.db("wishlystit");


console.log("RESEND_API_KEY set:", !!process.env.RESEND_API_KEY);
// export const resend = new Resend(process.env.RESEND_API_KEY);

export const resend = new Resend(process.env.RESEND_API_KEY || "placeholder");

app.get("/", (req, res) => {
  res.send("Hello World!");
});

app.use("/api/v1/auth", AuthRouter);
app.use("/api/v1/items", ItemsRouter);
app.use("/api/v1/share", ShareRouter);

const port = Number.parseInt(process.env.PORT || "3500", 10);
app.listen(port, "0.0.0.0", () => {
  console.log(`app listening on 0.0.0.0:${port}`);
});
