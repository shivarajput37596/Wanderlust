const mongoose = require("mongoose");
const Schema = mongoose.Schema;

const listeningSchema = new Schema({
    title:{
        type: String,
        required:true,
    },
    description: String,
    image: {
        filename: String,
        url: String,
    },
    price: Number,
    salePrice: { type: Number, min: 0 },
    location:String,
    country:String,
    owner: {
        type: Schema.Types.ObjectId,
        ref: "User",
    },
    reviews: [{
        rating: { type: Number, required: true, min: 1, max: 5 },
        comment: { type: String, required: true, trim: true },
        author: { type: String, required: true },
        createdAt: { type: Date, default: Date.now },
    }],
})

const Listing = mongoose.model("Listing",listeningSchema);
module.exports = Listing;