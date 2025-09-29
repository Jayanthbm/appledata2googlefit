/**
 * sync_badminton.js
 *
 * Stream Apple Health export.xml and upload badminton sessions to Google Fit
 */

const fs = require("fs");
const sax = require("sax");
const cliProgress = require("cli-progress");
const axios = require("axios");
const { EXPORT_XML } = require("./constants");
const { authorize, msToNs } = require("./functions");
const { v4: uuidv4 } = require("uuid");

const BADMINTON_ACTIVITY_TYPE = 9; // Google Fit ActivityType enum

// ---------- STREAM APPLE HEALTH XML ----------
async function parseAndUploadBadminton(oAuth2Client) {
   const sessions = [];
   const parser = sax.createStream(true);

   let parsedCount = 0;
   const bar = new cliProgress.SingleBar({
      format: "Parsing |{bar}| {value} sessions",
      barCompleteChar: "\u2588",
      barIncompleteChar: "\u2591",
      hideCursor: true,
   });
   bar.start(0, 0);

   parser.on("opentag", (node) => {
      if (node.name === "Workout" && node.attributes.workoutActivityType === "HKWorkoutActivityTypeBadminton") {
         const startMs = new Date(node.attributes.startDate).getTime();
         const endMs = new Date(node.attributes.endDate).getTime();
         const calories = parseFloat(node.attributes.totalEnergyBurned) || 0;

         sessions.push({
            id: `badminton-${uuidv4()}`,
            name: "Badminton Match",
            description: "Imported from Apple Health",
            startTimeMillis: startMs,
            endTimeMillis: endMs,
            activityType: BADMINTON_ACTIVITY_TYPE,
            calories,
         });

         parsedCount++;
         bar.setTotal(parsedCount);
         bar.update(parsedCount);
      }
   });

   parser.on("end", async () => {
      bar.stop();
      console.log(`\n⏱ Parsed ${parsedCount} badminton sessions. Starting upload...`);
      await uploadSessions(oAuth2Client, sessions);
   });

   fs.createReadStream(EXPORT_XML).pipe(parser);
}

// ---------- UPLOAD BADMINTON SESSIONS ----------
async function uploadSessions(oAuth2Client, sessions) {
   const tokenObj = await oAuth2Client.getAccessToken();
   const accessToken = tokenObj?.token;
   if (!accessToken) throw new Error("No access token available");
   if (!sessions.length) return console.log("⚠️ No badminton sessions found");

   for (const s of sessions) {
      try {
         const url = `https://www.googleapis.com/fitness/v1/users/me/sessions/${s.id}`;
         const sessionBody = {
            id: s.id,
            name: s.name,
            description: s.description,
            startTimeMillis: s.startTimeMillis,
            endTimeMillis: s.endTimeMillis,
            activityType: s.activityType,
            application: { name: "Apple Health Sync", version: "1.0" },
         };

         const res = await axios.put(url, sessionBody, {
            headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
         });
         console.log("✅ Session inserted:", s.id, res.status);

         if (s.calories > 0) {
            await uploadCalories(oAuth2Client, s, accessToken);
         }
      } catch (err) {
         console.error("❌ Error inserting session:", err.response ? err.response.data : err.message);
      }
   }
}

// ---------- UPLOAD CALORIES LINKED TO SESSION ----------
async function uploadCalories(oAuth2Client, session, accessToken) {
   const dataSourceId = `raw:com.google.calories.expended:apple_health:badminton`;
   const datasetId = `${msToNs(session.startTimeMillis)}-${msToNs(session.endTimeMillis)}`;
   const url = `https://www.googleapis.com/fitness/v1/users/me/dataSources/${dataSourceId}/datasets/${datasetId}`;

   const dataSetBody = {
      dataSourceId,
      minStartTimeNs: msToNs(session.startTimeMillis),
      maxEndTimeNs: msToNs(session.endTimeMillis),
      point: [
         {
            startTimeNanos: msToNs(session.startTimeMillis),
            endTimeNanos: msToNs(session.endTimeMillis),
            dataTypeName: "com.google.calories.expended",
            value: [{ fpVal: session.calories }],
         },
      ],
   };

   try {
      await axios.patch(url, dataSetBody, {
         headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      });
      console.log("✅ Calories inserted for session:", session.id);
   } catch (err) {
      console.error("❌ Error inserting calories:", err.response ? err.response.data : err.message);
   }
}

// ---------- MAIN ----------
(async () => {
   console.log("⏱ Starting badminton sync...");
   const auth = await authorize();
   await parseAndUploadBadminton(auth);
})();
