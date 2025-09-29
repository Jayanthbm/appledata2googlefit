/**
 * sync_sleep.js
 *
 * Stream Apple Health export.xml and upload sleep sessions + stages to Google Fit
 */

const fs = require("fs");
const sax = require("sax");
const cliProgress = require("cli-progress");
const axios = require("axios");
const { EXPORT_XML } = require("../constants");
const { authorize, msToNs } = require("../functions");
const { v4: uuidv4 } = require("uuid");

// Mapping Apple Health → Google Fit sleep stages
const SLEEP_STAGE_MAP = {
   HKCategoryValueSleepAnalysisInBed: 3,   // Out of bed
   HKCategoryValueSleepAnalysisAsleep: 2,  // Generic sleep
   HKCategoryValueSleepAnalysisAsleepCore: 4, // Light sleep
   HKCategoryValueSleepAnalysisAsleepDeep: 5, // Deep sleep
   HKCategoryValueSleepAnalysisAsleepREM: 6,  // REM
   HKCategoryValueSleepAnalysisAwake: 1,  // Awake
};

async function parseAndUploadSleep(oAuth2Client) {
   const sleepSessions = {};
   const parser = sax.createStream(true);

   let parsedCount = 0;
   const bar = new cliProgress.SingleBar({
      format: "Parsing |{bar}| {value} records",
      barCompleteChar: "\u2588",
      barIncompleteChar: "\u2591",
      hideCursor: true,
   });
   bar.start(0, 0);

   parser.on("opentag", (node) => {
      if (
         node.name === "Record" &&
         node.attributes.type === "HKCategoryTypeIdentifierSleepAnalysis"
      ) {
         const startMs = new Date(node.attributes.startDate).getTime();
         const endMs = new Date(node.attributes.endDate).getTime();
         const stage = node.attributes.value;

         const sleepStage = SLEEP_STAGE_MAP[stage] ?? 2; // fallback: generic sleep

         // Group by "night" (use start date as key)
         const dateKey = new Date(startMs).toISOString().split("T")[0];
         if (!sleepSessions[dateKey]) {
            sleepSessions[dateKey] = {
               id: `sleep-${uuidv4()}`,
               startTimeMillis: startMs,
               endTimeMillis: endMs,
               stages: [],
            };
         }

         // Expand session window
         sleepSessions[dateKey].startTimeMillis = Math.min(
            sleepSessions[dateKey].startTimeMillis,
            startMs
         );
         sleepSessions[dateKey].endTimeMillis = Math.max(
            sleepSessions[dateKey].endTimeMillis,
            endMs
         );

         // Add stage
         sleepSessions[dateKey].stages.push({
            startTimeNanos: msToNs(startMs),
            endTimeNanos: msToNs(endMs),
            dataTypeName: "com.google.sleep.segment",
            value: [{ intVal: sleepStage }],
         });

         parsedCount++;
         bar.setTotal(parsedCount);
         bar.update(parsedCount);
      }
   });

   parser.on("end", async () => {
      bar.stop();
      console.log(`\n⏱ Parsed ${parsedCount} sleep records. Starting upload...`);
      await uploadSleep(oAuth2Client, Object.values(sleepSessions));
   });

   fs.createReadStream(EXPORT_XML).pipe(parser);
}

// Data source for sleep stages
const DS_ID =
   "raw:com.google.sleep.segment:755476916213:Apple:Health Export:device_apple_health_sleep:apple_health_sleep_clean";

// ---------- UPLOAD SLEEP SESSIONS + STAGES ----------
async function uploadSleep(oAuth2Client, sessions) {
   const tokenObj = await oAuth2Client.getAccessToken();
   const accessToken = tokenObj?.token;
   if (!accessToken) throw new Error("No access token available");
   if (!sessions.length) return console.log("⚠️ No sleep data found");

   for (const s of sessions) {
      try {
         // 1. Create Session
         const url = `https://www.googleapis.com/fitness/v1/users/me/sessions/${s.id}`;
         const sessionBody = {
            id: s.id,
            name: "Sleep",
            description: "Imported from Apple Health",
            startTimeMillis: s.startTimeMillis,
            endTimeMillis: s.endTimeMillis,
            activityType: 72, // Sleep
            application: { name: "Apple Health Sync", version: "1.0" },
         };

         await axios.put(url, sessionBody, {
            headers: {
               Authorization: `Bearer ${accessToken}`,
               "Content-Type": "application/json",
            },
         });
         console.log("✅ Sleep session inserted:", s.id);

         // 2. Upload Stages (com.google.sleep.segment)
         const datasetId = `${msToNs(s.startTimeMillis)}-${msToNs(
            s.endTimeMillis
         )}`;

         const datasetUrl = `https://www.googleapis.com/fitness/v1/users/me/dataSources/${DS_ID}/datasets/${datasetId}`;
         const dataSetBody = {
            dataSourceId: DS_ID,
            minStartTimeNs: msToNs(s.startTimeMillis),
            maxEndTimeNs: msToNs(s.endTimeMillis),
            point: s.stages,
         };

         await axios.patch(datasetUrl, dataSetBody, {
            headers: {
               Authorization: `Bearer ${accessToken}`,
               "Content-Type": "application/json",
            },
         });

         console.log("✅ Sleep stages uploaded for:", s.id);
      } catch (err) {
         console.error(
            "❌ Error uploading sleep:",
            err.response ? err.response.data : err.message
         );
      }
   }
}

// ---------- MAIN ----------
(async () => {
   console.log("⏱ Starting sleep sync...");
   const auth = await authorize();
   await parseAndUploadSleep(auth);
})();
