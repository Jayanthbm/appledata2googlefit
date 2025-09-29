/**
 * sync_calories.js
 *
 * Stream Apple Health export.xml and upload calories.expended to Google Fit
 */

const fs = require("fs");
const sax = require("sax");
const cliProgress = require("cli-progress");
const axios = require("axios");
const { EXPORT_XML } = require("./constants");
const { authorize, getOrCreateDataSource, msToNs } = require("./functions");

// Default interval if Apple Health start === end
const DEFAULT_DURATION_MS = 60 * 1000; // 1 minute

// Minimum interval for Google Fit data points (1 minute)
const MIN_INTERVAL_MS = 60 * 1000;

// ---------- STREAM APPLE HEALTH XML ----------
async function parseAndUploadCalories(oAuth2Client, dataSourceId) {
   const caloriesByMinute = {}; // Aggregate calories per minute
   const calories = [];
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
      if (node.name === "Record" && node.attributes.type === "HKQuantityTypeIdentifierActiveEnergyBurned") {
         let startMs = new Date(node.attributes.startDate).getTime();
         let endMs = new Date(node.attributes.endDate).getTime();
         const value = parseFloat(node.attributes.value); // Calories already in kcal

         // Enforce minimum interval
         if (endMs <= startMs) endMs = startMs + MIN_INTERVAL_MS;
         else if (endMs - startMs < MIN_INTERVAL_MS) endMs = startMs + MIN_INTERVAL_MS;

         // Aggregate per minute to avoid too small intervals
         const minuteKey = new Date(startMs).toISOString().slice(0, 16); // YYYY-MM-DDTHH:MM
         if (!caloriesByMinute[minuteKey]) caloriesByMinute[minuteKey] = 0;
         caloriesByMinute[minuteKey] += value;

         parsedCount++;
         bar.setTotal(parsedCount);
         bar.update(parsedCount);
      }
   });

   parser.on("end", async () => {
      bar.stop();
      console.log(`\n⏱ Parsed ${parsedCount} calorie records. Starting upload...`);

      // Prepare final points
      const dataPoints = Object.entries(caloriesByMinute).map(([key, value]) => {
         const startMs = new Date(key + ":00Z").getTime();
         return {
            startTimeNanos: msToNs(startMs),
            endTimeNanos: msToNs(startMs + MIN_INTERVAL_MS),
            dataTypeName: "com.google.calories.expended",
            value: [{ fpVal: value }],
         };
      });

      await uploadCalories(oAuth2Client, dataSourceId, dataPoints);
   });

   fs.createReadStream(EXPORT_XML).pipe(parser);
}

// ---------- UPLOAD DATA POINTS ----------
async function uploadCalories(oAuth2Client, dataSourceId, dataPoints, CHUNK_SIZE = 1000) {
   const tokenObj = await oAuth2Client.getAccessToken();
   const accessToken = tokenObj?.token;
   if (!accessToken) throw new Error("No access token available");
   if (!dataPoints.length) return console.log("⚠️ No data points to upload");

   const startTime = Date.now();

   const bar = new cliProgress.SingleBar({
      format: "Uploading |{bar}| {percentage}% || {value}/{total} uploaded",
      barCompleteChar: "\u2588",
      barIncompleteChar: "\u2591",
      hideCursor: true,
   });
   bar.start(dataPoints.length, 0);

   for (let i = 0; i < dataPoints.length; i += CHUNK_SIZE) {
      const chunk = dataPoints.slice(i, i + CHUNK_SIZE);
      const chunkPayload = {
         dataSourceId,
         minStartTimeNs: chunk[0].startTimeNanos,
         maxEndTimeNs: chunk[chunk.length - 1].endTimeNanos,
         point: chunk,
      };

      const url = `https://www.googleapis.com/fitness/v1/users/me/dataSources/${dataSourceId}/datasets/${chunkPayload.minStartTimeNs}-${chunkPayload.maxEndTimeNs}`;

      try {
         await axios.patch(url, chunkPayload, {
            headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
         });
         bar.update(Math.min(i + CHUNK_SIZE, dataPoints.length));
      } catch (err) {
         if (err.response) console.error("❌ API Error:", err.response.status, err.response.data);
         else console.error("❌ Upload Error:", err.message);
      }
   }

   bar.stop();
   console.log(`✅ Upload finished in ${(Date.now() - startTime) / 1000}s`);
}

// ---------- MAIN ----------
(async () => {
   console.log("⏱ Starting calories sync...");
   const auth = await authorize();

   // Create or reuse calories data source
   const cleanName = "apple_health_calories_clean";
   const dataSourceId = await getOrCreateDataSource(auth, "com.google.calories.expended", cleanName);

   await parseAndUploadCalories(auth, dataSourceId);
})();
