const express = require("express");
const app = express();
const mongoose = require("mongoose");
const Listing = require("./models/listing.js");
const User = require("./models/user.js");
const path = require("path");
const MONGO_URL = process.env.MONGO_URL || "mongodb://127.0.0.1:27017/wanderlust";
const SITE_OWNER_EMAIL = (process.env.SITE_OWNER_EMAIL || "shivarajput37596@gmail.com").trim().toLowerCase();
const OWNER_BOOTSTRAP_PASSWORD = process.env.OWNER_BOOTSTRAP_PASSWORD;
const methodOverride = require("method-override");
const session = require("express-session");

main()
  .then(() => {
    console.log("connected to db");
  })
  .catch((err) => {
    console.log(err);
  });

async function main() {
  await mongoose.connect(MONGO_URL);
}

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "..", "frontend", "views"));
app.use(express.static(path.join(__dirname, "..", "frontend", "public")));
app.use(express.urlencoded({ extended: true }));
app.use(methodOverride("_method"));
app.use(
  session({
    name: "wanderlust.sid",
    secret: process.env.SESSION_SECRET || "wanderlust-secret",
    resave: true,
    saveUninitialized: true,
    rolling: true,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      maxAge: 1000 * 60 * 60 * 24 * 7,
      secure: false,
    },
  })
);

app.use((req, res, next) => {
  res.locals.currentUser = req.session.user || null;
  res.locals.escapeHTML = (value) =>
    String(value ?? "").replace(/[&<>"']/g, (character) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    })[character]);
  next();
});

const isLoggedIn = (req, res, next) => {
  if (!req.session.user) {
    const message = encodeURIComponent("Please sign in first, then you can add a new listing.");
    return res.redirect(`/signin?message=${message}`);
  }
  next();
};

const isSiteOwner = (user) => user?.email?.trim().toLowerCase() === SITE_OWNER_EMAIL;

const isListingOwner = async (req, res, next) => {
  const listing = await Listing.findById(req.params.id);
  if (!listing) return res.redirect("/listings");

  if (
    !isSiteOwner(req.session.user) &&
    (!listing.owner || listing.owner.toString() !== String(req.session.user.id))
  ) {
    return res.status(403).send("You can only edit or delete listings you created.");
  }

  next();
};

app.get("/", async (req, res) => {
  res.render("home");
});

app.get("/signin", (req, res) => {
  const message = req.query.message || null;
  res.render("signup", { message });
});

app.get("/signup", (req, res) => {
  res.redirect("/signin");
});

app.post("/signin", async (req, res) => {
  const userData = req.body.user;
  const email = userData.email.trim().toLowerCase();
  let user = await User.findOne({ email });

  if (!user) {
    if (email === SITE_OWNER_EMAIL && (!OWNER_BOOTSTRAP_PASSWORD || userData.password !== OWNER_BOOTSTRAP_PASSWORD)) {
      const message = encodeURIComponent("Owner account setup is locked. Start the app with OWNER_BOOTSTRAP_PASSWORD set.");
      return res.redirect(`/signin?message=${message}`);
    }

    user = new User({ ...userData, email });
    await user.save();
  } else if (user.password !== userData.password) {
    const message = encodeURIComponent("Incorrect email or password.");
    return res.redirect(`/signin?message=${message}`);
  }

  req.session.user = {
    id: user._id,
    name: user.name,
    email: user.email,
  };

  res.redirect("/listings");
});

app.post("/signup", async (req, res) => {
  res.redirect("/signin");
});

app.get("/logout", (req, res) => {
  req.session.destroy(() => {
    res.redirect("/signin");
  });
});

app.get("/listings", async (req, res) => {
  const searchTerm = (req.query.q || "").trim();
  const escapedTerm = searchTerm.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const searchFilter = escapedTerm
    ? {
        $or: [
          { title: { $regex: escapedTerm, $options: "i" } },
          { location: { $regex: escapedTerm, $options: "i" } },
          { country: { $regex: escapedTerm, $options: "i" } },
        ],
      }
    : {};
  const allListings = await Listing.find(searchFilter);
  res.render("listings/index", { allListings, searchTerm });
});

app.get("/listings/new", isLoggedIn, (req, res) => {
  res.render("listings/new");
});

app.post("/listings", isLoggedIn, async (req, res) => {
  const newListing = new Listing({ ...req.body.listing, owner: req.session.user.id });
  await newListing.save();
  res.redirect(`/listings/${newListing._id}`);
});

app.get("/listings/:id", async (req, res) => {
  const { id } = req.params;
  const listing = await Listing.findById(id);
  if (!listing) return res.redirect("/listings");
  const isOwner =
    isSiteOwner(req.session.user) ||
    (listing.owner && req.session.user ? listing.owner.toString() === String(req.session.user.id) : false);
  res.render("listings/show", { listing, isOwner });
});

app.post("/listings/:id/checkout", isLoggedIn, async (req, res) => {
  const listing = await Listing.findById(req.params.id);
  if (!listing) return res.redirect("/listings");

  const { mode, paymentMethod } = req.body;
  const validMode = mode === "rent" || (mode === "buy" && Number(listing.salePrice) > 0);
  const validPaymentMethod = ["upi", "card", "netbanking"].includes(paymentMethod);
  if (!validMode || !validPaymentMethod) {
    return res.status(400).send("Invalid checkout selection.");
  }

  const amount = mode === "buy" ? listing.salePrice : listing.price;
  res.render("listings/checkout", { listing, mode, paymentMethod, amount });
});

app.post("/listings/:id/reviews", isLoggedIn, async (req, res) => {
  const { rating, comment } = req.body.review;
  const numericRating = Number(rating);
  if (!Number.isInteger(numericRating) || numericRating < 1 || numericRating > 5 || !comment.trim()) {
    return res.redirect(`/listings/${req.params.id}#reviews`);
  }

  const listing = await Listing.findById(req.params.id);
  if (!listing) return res.redirect("/listings");

  listing.reviews.push({
    rating: numericRating,
    comment: comment.trim(),
    author: req.session.user.name,
  });
  await listing.save();
  res.redirect(`/listings/${listing._id}#reviews`);
});

app.get("/listings/:id/edit", isLoggedIn, isListingOwner, async (req, res) => {
  const { id } = req.params;
  const listing = await Listing.findById(id);
  res.render("listings/edit", { listing });
});

app.post("/listings/:id/edit", isLoggedIn, isListingOwner, async (req, res) => {
  const { id } = req.params;
  const listingData = { ...req.body.listing };
  delete listingData.owner;
  const listingFilter = { _id: id };
  if (!isSiteOwner(req.session.user)) listingFilter.owner = req.session.user.id;
  const listing = await Listing.findOneAndUpdate(listingFilter, listingData, {
    new: true,
    runValidators: true,
  });
  if (!listing) return res.redirect("/listings");
  res.redirect(`/listings/${listing._id}`);
});

app.post("/listings/:id/delete", isLoggedIn, isListingOwner, async (req, res) => {
  const { id } = req.params;
  const listingFilter = { _id: id };
  if (!isSiteOwner(req.session.user)) listingFilter.owner = req.session.user.id;
  await Listing.findOneAndDelete(listingFilter);
  res.redirect("/listings");
});

const port = process.env.PORT || 8080;
app.listen(port, () => {
  console.log(`server is listening to port ${port}`);
});
