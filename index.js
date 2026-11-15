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

//user related api

// user get api

app.get("/users", async (req, res) => {
  const users = await usersCollection.find().toArray();
  res.send(users);
});

// user plan get api

app.get("/users/:id/plan", async (req, res) => {
  try {
    const id = req.params.id;

    if (!id) {
      console.warn("[user-plan] Missing user id in request");
      return res
        .status(400)
        .send({ success: false, message: "User id is required" });
    }

    const isObjectId = /^[a-f\d]{24}$/i.test(id);
    const userIdQuery = isObjectId ? new ObjectId(id) : id;

    const result = await usersCollection.findOne(
      { _id: userIdQuery },
      { projection: { plan: 1, starter: 1, growth: 1, premium: 1 } },
    );

    if (!result) {
      return res.send({ success: false, message: "User not found" });
    }
    res.send(result);
  } catch (error) {
    console.error("[user-plan] Error fetching user plan:", error.message);
    res
      .status(500)
      .send({ success: false, message: "Failed to get user plan" });
  }
});

//user role change api

app.patch("/users/:id/role", async (req, res) => {
  try {
    const id = req.params.id;

    const updateRole = await usersCollection.updateOne(
      { _id: new ObjectId(id) },
      {
        $set: {
          role: req.body.role,
        },
      },
    );

    res.send({
      updateRole,
      success: true,
      message: "Successfully updated user role",
    });
  } catch (error) {
    console.log(error);

    res.send({success: false, message: "User role update failed", error});
  }
});

// user suspend (ban) / activate api
// NOTE: there is NO "status" field in the database. A suspended user is
// simply a user whose `banned` field is true — the frontend sends
// banned: true to suspend and banned: false to activate.
app.patch("/users/:id/ban", async (req, res) => {
  try {
    const id = req.params.id;

    // Boolean() makes sure we always store a real true/false value.
    const banned = Boolean(req.body.banned);

    const updateBan = await usersCollection.updateOne(
      { _id: new ObjectId(id) },
      {
        $set: {
          banned,
        },
      },
    );

    res.send({
      updateBan,
      success: true,
      message: banned
        ? "User suspended successfully"
        : "User activated successfully",
    });
  } catch (error) {
    console.log(error);

    res.send({ success: false, message: "User ban update failed", error });
  }
});

// user delete api
// Deletes only the user document. If you later want to clean up everything
// related to the user, you can also delete their rows from the `session`
// and `account` collections here.
app.delete("/users/:id", async (req, res) => {
  try {
    const id = req.params.id;

    const deleteUser = await usersCollection.deleteOne({
      _id: new ObjectId(id),
    });

    res.send({
      deleteUser,
      success: true,
      message: "User deleted successfully",
    });
  } catch (error) {
    console.log(error);

    res.send({ success: false, message: "User delete failed", error });
  }
});

// job related api

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

    const {
      companyName,
      location,
      jobType,
      category,
      isRemote,
      search,
      recruiterId,
    } = req.query;

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

    if (recruiterId) {
      query.recruiterId = recruiterId;
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

//application related api

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

// applications get api — used by BOTH sides:
//   seekers:    ?seekerId=...  → their own applications
//   recruiters: ?jobId=...     → everyone who applied to one specific job
app.get("/applications", async (req, res) => {
  try {
    const { seekerId, jobId, search, archived } = req.query;

    // A request must identify whose data to load — either one seeker's
    // applications or one job's applicant list.
    if (!seekerId && !jobId) {
      return res
        .status(400)
        .send({ success: false, message: "seekerId or jobId is required" });
    }

    console.log(
      `[applications] Fetching — ${seekerId ? `seekerId=${seekerId}` : `jobId=${jobId}`}`,
    );

    const query = {};

    if (seekerId) query.seekerId = seekerId;
    if (jobId) query.jobId = jobId;

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

    // Recruiters need to see WHO applied. Applications only store the
    // seekerId + email snapshot, so look up each user and attach their name
    // (sent back as `applicantName` for the recruiter's applicants table).
    const seekerIds = [
      ...new Set(applications.map((a) => a.seekerId).filter(Boolean)),
    ];

    if (seekerIds.length > 0) {
      // User documents are stored with plain string _ids (better-auth), but
      // include the ObjectId form too so both storage styles always match.
      const idVariants = seekerIds.flatMap((id) =>
        /^[a-f\d]{24}$/i.test(id) ? [id, new ObjectId(id)] : [id],
      );

      const users = await usersCollection
        .find({ _id: { $in: idVariants } })
        .toArray();
      const usersById = new Map(users.map((u) => [u._id.toString(), u]));

      console.log(
        `[applications] Attached names for ${users.length}/${seekerIds.length} applicants`,
      );

      for (const application of applications) {
        const user = usersById.get(String(application.seekerId));
        application.applicantName = user?.name ?? null;
      }
    }

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

// application status update api

app.patch("/applications/:id", async (req, res) => {
  try {
    const id = req.params.id;

    const application = await applicationsCollection.updateOne(
      { _id: new ObjectId(id) },
      {
        $set: {
          status: req.body.status,
        },
      },
    );

    res.send({
      success: true,
      message: "successfully updated application status",
      application,
    });
  } catch (error) {
    console.log(error.message);

    res
      .status(500)
      .send({
        success: false,
        message: "Failed to update application status",
        error,
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

//payment verify
app.post("/payments/checkout-verify", async (req, res) => {
  try {
    const { sessionId, userId } = req.body;

    if (!sessionId) {
      console.warn("[checkout-verify] Missing session id in request body");
      return res.send({ success: false, message: "Session Id is required" });
    }

    console.log(`[checkout-verify] Verifying Stripe session: ${sessionId}`);

    const {
      status,
      payment_status,
      payment_intent,
      customer_email,
      metadata,
      amount_total,
      currency,
    } = await stripe.checkout.sessions.retrieve(sessionId);

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
          `[checkout-verify] User mismatch: session belongs to ${metadata.userId}, requested by ${userId}`,
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
          `[checkout-verify] Payment already verified for session: ${sessionId}`,
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
        `[checkout-verify] Payment record inserted (${metadata.role ?? "seeker"}/${plan}, ${amount_total / 100} ${currency}): ${result.insertedId}`,
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
        `[checkout-verify] User plan updated to "${plan}" (matched: ${updatedUser.matchedCount}, modified: ${updatedUser.modifiedCount})`,
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
      `[checkout-verify] Session not paid yet — status: ${status}, payment_status: ${payment_status}`,
    );
    res.send({
      success: false,
      message: "Payment not completed",
      status,
      payment_status,
    });
  } catch (error) {
    console.error("[checkout-verify] Error:", error.message);

    res
      .status(500)
      .send({ success: false, message: "Payment verification failed" });
  }
});

app.listen(port, () => {
  console.log(`Hireloop server is running on port: ${port}`);
});

export default app;
