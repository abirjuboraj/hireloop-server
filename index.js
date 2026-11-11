import express from "express";
import cors from "cors";
import "dotenv/config";
import { MongoClient, ObjectId } from "mongodb";

const app = express();

const port = process.env.PORT || 5000;

// Allow the client's origin with credentials so the better-auth session cookie reaches us.
app.use(
  cors({
    origin: true,
    credentials: true,
  })
);
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

const SESSION_COOKIE = "better-auth.session_token";

function parseCookies(req) {
  const cookies = {};
  const header = req.headers.cookie;
  if (!header) return cookies;

  for (const part of header.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    cookies[name] = decodeURIComponent(rest.join("="));
  }
  return cookies;
}

/**
 * Resolves the signed-in user (seeker, recruiter or admin) from the
 * better-auth session cookie — the frontend never sends any user info.
 * Attaches the user document (or null) to req.user.
 */
async function attachUser(req, res, next) {
  req.user = null;

  try {
    const token = parseCookies(req)[SESSION_COOKIE]?.split(".")[0];

    if (token) {
      const session = await db.collection("session").findOne({ token });

      if (session && new Date(session.expiresAt) > new Date()) {
        // userId may be stored as an ObjectId or a hex string depending on the adapter version.
        let user = await db.collection("user").findOne({ _id: session.userId });

        if (!user) {
          try {
            user = await db
              .collection("user")
              .findOne({ _id: new ObjectId(session.userId) });
          } catch {}
        }

        if (user) req.user = user;
      }
    }
  } catch (error) {
    console.error("Session lookup failed:", error);
  }

  next();
}

/** Blocks requests without a valid session. */
function requireUser(req, res, next) {
  if (!req.user) {
    return res
      .status(401)
      .send({ success: false, message: "Authentication required" });
  }
  next();
}

app.use(attachUser);

app.get("/", (req, res) => {
  res.send("Hireloop server is running");
});

// user get api

app.get("/users", async (req, res) => {
  const users = await usersCollection.find().toArray();
  res.send(users);
});

//job post api

app.post("/jobs", requireUser, async (req, res) => {
  try {
    const job = req.body;

    // The recruiter identity comes from the session, never from the client.
    const newJob = {
      ...job,
      recruiterId: req.user._id.toString(),
      recruiterEmail: req.user.email,
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
app.post("/applications", requireUser, async (req, res) => {
  try {
    const { jobId } = req.body;

    if (!jobId) {
      return res
        .status(400)
        .send({ success: false, message: "jobId is required" });
    }

    // The recruiter id comes from the stored job (null when the job has none).
    let job = null;
    try {
      job = await jobsCollection.findOne({ _id: new ObjectId(jobId) });
    } catch {}

    const newApplication = {
      ...req.body,
      jobId,
      // Identity comes from the session — any role (seeker/admin/recruiter) is accepted.
      seekerId: req.user._id.toString(),
      seekerEmail: req.user.email,
      recruiterId: job?.recruiterId ?? null,
      status: "Applied",
      appliedAt: new Date(),
      archived: false,
    };

    const result = await applicationsCollection.insertOne(newApplication);

    // Bump the applicant count on the job.
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

// applications get api — returns the signed-in user's applications
app.get("/applications", requireUser, async (req, res) => {
  try {
    const query = { seekerId: req.user._id.toString() };

    const { search, archived } = req.query;

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

app.listen(port, () => {
  console.log(`Hireloop server is running on port: ${port}`);
});

export default app();
