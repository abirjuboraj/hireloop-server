import express from "express";
import cors from "cors";
import "dotenv/config";
import { MongoClient, ObjectId } from "mongodb";

const app = express();

const port = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

const client = new MongoClient(
  `mongodb://${process.env.DB_USER}:${process.env.DB_PASS}@ac-zz1wfyb-shard-00-00.ga134je.mongodb.net:27017,ac-zz1wfyb-shard-00-01.ga134je.mongodb.net:27017,ac-zz1wfyb-shard-00-02.ga134je.mongodb.net:27017/?ssl=true&replicaSet=atlas-7beluy-shard-0&authSource=admin`,
);

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

const usersCollection = db.collection("user");
const jobsCollection = db.collection("jobs");

app.get("/", (req, res) => {
  res.send("Hireloop server is running");
});

app.get("/users", async (req, res) => {
  const users = await usersCollection.find().toArray();
  res.send(users);
});

//job api post

app.post("/jobs", async (req, res) => {
  try {
    const job = req.body;
    console.log("Received job:", job);
    console.log("Applicants:", job.applicants);
    const result = await jobsCollection.insertOne(job);

    res.send({
      success: true,
      message: "Job posted successfully",
      jobId: result.insertedId,
    });
  } catch (error) {
    console.error("Error posting job:", error);
    res.status(500).send({ success: false, message: "Failed to post job" });
  }
});

//job api get

app.get("/jobs", async (req, res) => {
  try {
    const query = {};

    const { companyName, location, jobType, isRemote, search } = req.query;

    if (companyName) {
      query.companyName = {
        $regex: companyName,
        $options: "i",
      };
    }

    if (jobType) {
      query.jobType = jobType;
    }

    if (location) {
      query.location = {
        $regex: location,
        $options: "i",
      };
    }

    if (isRemote !== undefined) {
      query.isRemote = isRemote === "true";
    }

    if (search) {
      query.$or = [
        { title: { $regex: search, $options: "i" } },
        { companyName: { $regex: search, $options: "i" } },
        { location: { $regex: search, $options: "i" } },
      ];
    }

    const jobs = await jobsCollection.find(query).toArray();

    res.send(jobs);
  } catch (error) {
    console.error("Error getting jobs:", error);
    res.status(500).send({
      success: false,
      message: "Failed to get jobs",
    });
  }
});
//job delete api
app.delete("/jobs/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const result = await jobsCollection.deleteOne({
      _id: new ObjectId(id),
    });

    res.send(result);
  } catch (error) {
    console.error(error);
    res.status(500).send({ message: error.message });
  }
});

app.listen(port, () => {
  console.log(`Hireloop server is running on port: ${port}`);
});
