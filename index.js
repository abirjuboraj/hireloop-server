import express from 'express';
import cors from 'cors';
import 'dotenv/config';
import { MongoClient } from 'mongodb';

const app = express();

const port = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());


const client = new MongoClient(`mongodb://${process.env.DB_USER}:${process.env.DB_PASS}@ac-zz1wfyb-shard-00-00.ga134je.mongodb.net:27017,ac-zz1wfyb-shard-00-01.ga134je.mongodb.net:27017,ac-zz1wfyb-shard-00-02.ga134je.mongodb.net:27017/?ssl=true&replicaSet=atlas-7beluy-shard-0&authSource=admin`);

export async function connectToMongoDB() {
  try {
    await client.connect();
    console.log("You successfully connected to MongoDB!");
    return client;
  } catch (err) {
    console.dir(err);
  }
}

const connectedClient = await connectToMongoDB();

const db = connectedClient.db("hireloop");

const usersCollection = db.collection("users");
const jobsCollection = db.collection("jobs");


app.get("/", (req, res)=> {
    res.send("Hireloop server is running");
});

app.get("/users", async(req, res)=> {
    const users = await usersCollection.find().toArray();
    res.send(users);
})

app.listen(port, ()=> {
    console.log(`Hireloop server is running on port: ${port}`);
})