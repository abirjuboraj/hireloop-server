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
const applicationsCollection = db.collection("applications");

app.get("/", (req, res) => {
  res.send("Hireloop server is running");
});

// user get api

app.get("/users", async (req, res) => {
  const users = await usersCollection.find().toArray();
  res.send(users);
});

//job post api

app.post("/jobs", async (req, res) => {
  try {
    const job = req.body;

    // User identity (recruiterId/recruiterEmail) is sent from the frontend
    // session for now — JWT-based auth will replace this later.
    const newJob = {
      ...job,
      recruiterId: job.recruiterId ?? null,
      recruiterEmail: job.recruiterEmail ?? null,
    };

    const result = await jobsCollection.insertOne(newJob);

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

//job get api

app.get("/jobs", async (req, res) => {
  try {
    const query = {};

    const { companyName, location, jobType, category, isRemote, search } =
      req.query;

    if (companyName) {
      query.companyName = {
        $regex: companyName,
        $options: "i",
      };
    }

    if (category) {
      query.category = category;
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
        { category: { $regex: search, $options: "i" } },
        { jobType: { $regex: search, $options: "i" } },
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

//job details api
app.get("/jobs/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const job = await jobsCollection.findOne({ _id: new ObjectId(id) });

    res.send(job);
  } catch (error) {
    console.error(error);
    res.status(500).send({ message: error.message });
  }
});

// application post api
app.post("/applications", async (req, res) => {
  try {
    const { jobId, seekerId } = req.body;

    // User identity (seekerId/seekerEmail) is sent from the frontend session.
    if (!jobId || !seekerId) {
      return res
        .status(400)
        .send({ success: false, message: "jobId and seekerId are required" });
    }

    const newApplication = {
      ...req.body,
      jobId,
      recruiterId: req.body.recruiterId ?? null,
      status: "Applied",
      appliedAt: new Date(),
      archived: false,
    };

    const result = await applicationsCollection.insertOne(newApplication);

    // Bump the applicant count on the job.
    let job = null;
    try {
      job = await jobsCollection.findOne({ _id: new ObjectId(jobId) });
    } catch {}

    if (job) {
      await jobsCollection.updateOne(
        { _id: job._id },
        { $inc: { applicants: 1 } }
      );
    }

    res.send({
      success: true,
      message: "Apply to the job is successful",
      insertedId: result.insertedId,
    });
  } catch (error) {
    console.error("Error posting application:", error);
    res.send({
      success: false,
      message: "Apply to the job is failed",
      error: error,
    });
  }
});

// applications get api — seekerId comes from the frontend session
app.get("/applications", async (req, res) => {
  try {
    const { seekerId, search, archived } = req.query;

    if (!seekerId) {
      return res
        .status(400)
        .send({ success: false, message: "Job seeker Id is required" });
    }

    const query = { seekerId };

    if (archived !== undefined) {
      query.archived = archived === "true";
    }

    if (search) {
      query.$or = [
        { title: { $regex: search, $options: "i" } },
        { companyName: { $regex: search, $options: "i" } },
      ];
    }

    const applications = await applicationsCollection
      .find(query)
      .sort({ appliedAt: -1 })
      .toArray();

    res.send(applications);
  } catch (error) {
    console.error("Error getting applications:", error);
    res.status(500).send({
      success: false,
      message: "Failed to get applications",
    });
  }
});

//application count
app.get("/applications/count", async (req, res) => {
  try {
    const { seekerId } = req.query;

    if (!seekerId) {
      return res
        .status(400)
        .send({ success: false, message: "Job seeker Id is required" });
    }

    const query = { seekerId };

    const applicationsCount = await applicationsCollection
      .countDocuments(query)
      

    res.send({count: applicationsCount});
  } catch (error) {
    console.error("Error getting applications count:", error);
    res.status(500).send({
      success: false,
      message: "Failed to get applications count",
    });
  }
});
app.listen(port, () => {
  console.log(`Hireloop server is running on port: ${port}`);
});

export default app;
