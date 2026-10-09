const express = require("express");
const cors = require("cors");

const app = express();

app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
  res.json({
    app: "SK EARN",
    status: "Backend running"
  });
});

app.get("/health", (req, res) => {
  res.json({
    status: "OK"
  });
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, "0.0.0.0", () => {
  console.log(`SK EARN server running on port ${PORT}`);
});
