import express from "express";
import cors from "cors";
import "dotenv/config";
import { MongoClient, ObjectId } from "mongodb";
import Stripe from "stripe";

const app = express();

const port = process.env.PORT || 5000;

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

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
const payments = db.collection("payments");

app.get("/", (req, res) => {
  res.send("Hireloop server is running");
});

// user get api

app.get("/users", async (req, res) => {
  const users = await usersCollection.find().toArray();
  res.send(users);
});

// user plan get api
// NOTE: better-auth stores user documents with a plain string _id (not a Mongo
// ObjectId), so we try ObjectId first for legacy docs and fall back to a raw
// string lookup instead of crashing with a cast error.
app.get("/users/:id/plan", async (req, res) => {
  try {
    const id = req.params.id;

    if (!id) {
      console.warn("[user-plan] Missing user id in request");
      return res
        .status(400)
        .send({ success: false, message: "User id is required" });
    }

    // Match by ObjectId when possible, otherwise by the raw string id.
    const isObjectId = /^[a-f\d]{24}$/i.test(id);
    const userIdQuery = isObjectId ? new ObjectId(id) : id;

    console.log(`[user-plan] Fetching plan for user: ${id}`);

    const result = await usersCollection.findOne(
      { _id: userIdQuery },
      // Projection returns the plan flag(s) the payment flow maintains so the
      // frontend can gate the checkout page for users who already paid.
      { projection: { plan: 1, starter: 1, growth: 1, premium: 1 } }
    );

    if (!result) {
      console.warn(`[user-plan] No user found for id: ${id}`);
      return res.send({ success: false, message: "User not found" });
    }

    console.log(`[user-plan] Plan found for user ${id}:`, result.plan ?? null);
    res.send(result);
  } catch (error) {
    console.error("[user-plan] Error fetching user plan:", error.message);
    res.status(500).send({ success: false, message: "Failed to get user plan" });
  }
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
        { $inc: { applicants: 1 } },
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

    res.send({
      success: true,
      message: "Successfully fetched applications",
      applications: applications,
    });
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

    const applicationsCount =
      await applicationsCollection.countDocuments(query);

    res.send({ count: applicationsCount });
  } catch (error) {
    console.error("Error getting applications count:", error);
    res.status(500).send({
      success: false,
      message: "Failed to get applications count",
    });
  }
});

//payment related api

app.post("/payments/checkout-verify", async (req, res) => {
  try {
    const { sessionId, userId } = req.body;

    if (!sessionId) {
      console.warn("[checkout-verify] Missing session id in request body");
      return res.send({ success: false, message: "Session Id is required" });
    }

    console.log(`[checkout-verify] Verifying Stripe session: ${sessionId}`);

    const { status, payment_status, payment_intent, customer_email, metadata, amount_total, currency } =
      await stripe.checkout.sessions.retrieve(sessionId);

    //1. if the session is new
    //2. check if the session id is for the currently logged in user.
    //3. insert sessionId into the payment collection
    //4. update user information as plan (starter, growth, pro) user.

    if (status === "complete" && payment_status === "paid") {
   
      if (!metadata?.userId) {
        console.error("[checkout-verify] Session metadata.userId is missing");
        return res.send({
          success: false,
          message: "Session has no user attached — cannot verify payment",
        });
      }

      if (userId && metadata.userId !== userId) {
        console.warn(
          `[checkout-verify] User mismatch: session belongs to ${metadata.userId}, requested by ${userId}`
        );
        return res.send({
          success: false,
          message: "This payment session belongs to a different user",
        });
      }

      const sessionQuery = { sessionId };

      const existingPayment = await payments.findOne(sessionQuery);

      if (existingPayment) {
        console.log(
          `[checkout-verify] Payment already verified for session: ${sessionId}`
        );
  
        return res.send({
          success: true,
          message: "Payment already verified",
          alreadyVerified: true,
          plan: existingPayment.plan,
        });
      }

      // The selected plan travels in session metadata (set by the Next.js API
      // route when the session was created). Defaults to "starter" to keep the
      // original behaviour for sessions created before this change.
      const plan = ["starter", "growth", "premium"].includes(metadata.plan)
        ? metadata.plan
        : "starter";

      // Standard payment record: who paid, for what, how much, and when.
      const payment = {
        sessionId,
        status,
        payment_status,
        customer_email,
        userId: metadata.userId,
        payment_intent,
        plan,
        role: metadata.role ?? "seeker",
        billingCycle: metadata.billingCycle ?? "monthly",
        amount_total,
        currency,
        createdAt: new Date(),
      };

      const result = await payments.insertOne(payment);
      console.log(
        `[checkout-verify] Payment record inserted (${metadata.role ?? "seeker"}/${plan}, ${amount_total / 100} ${currency}): ${result.insertedId}`
      );

 
      const updatedUser = await usersCollection.updateOne(
        {
          _id: metadata.userId.match(/^[a-f\d]{24}$/i)
            ? new ObjectId(metadata.userId)
            : metadata.userId,
        },
        {
          $set: {
            [plan]: true,
            plan,
            planUpdatedAt: new Date(),
          },
        },
      );
      console.log(
        `[checkout-verify] User plan updated to "${plan}" (matched: ${updatedUser.matchedCount}, modified: ${updatedUser.modifiedCount})`
      );

      res.send({
        success: true,
        message: "Payment verification successful",
        plan,
        result,
        updatedUser,
      });

      return;
    }

    console.log(
      `[checkout-verify] Session not paid yet — status: ${status}, payment_status: ${payment_status}`
    );
    res.send({
      success: false,
      message: "Payment not completed",
      status,
      payment_status,
    });
  } catch (error) {
    console.error("[checkout-verify] Error:", error.message);

    res.status(500).send({ success: false, message: "Payment verification failed" });
  }
});

app.listen(port, () => {
  console.log(`Hireloop server is running on port: ${port}`);
});

export default app;
