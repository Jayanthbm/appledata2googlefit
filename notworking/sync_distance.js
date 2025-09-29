/**
 * sync_distance.js
 *
 * Stream Apple Health export.xml and upload distance to Google Fit
 */

const fs = require("fs");
const sax = require("sax");
const cliProgress = require("cli-progress");
const { EXPORT_XML } = require("../constants");
const { authorize, getOrCreateDataSource, uploadDistanceDataPoints, msToNs } = require("../functions");

// Default interval if start === end
const DEFAULT_INTERVAL_MS = 60 * 1000; // 1 minute

// ---------- STREAM APPLE HEALTH XML ----------
async function parseAndUploadDistance(oAuth2Client, dataSourceId) {
   const distanceByDay = {};
   const parser = sax.createStream(true);

   let parsedCount = 0;
   const bar = new cliProgress.SingleBar({
      format: "Parsing |{bar}| {value} records",
      barCompleteChar: "\u2588",
      barIncompleteChar: "\u2591",
      hideCursor: true
   });
   bar.start(0, 0);

   parser.on("opentag", (node) => {
      if (node.name === "Record" && node.attributes.type === "HKQuantityTypeIdentifierDistanceWalkingRunning") {
         let startMs = new Date(node.attributes.startDate).getTime();
         let endMs = new Date(node.attributes.endDate).getTime();

         if (endMs <= startMs) {
            endMs = startMs + DEFAULT_INTERVAL_MS; // avoid zero-length interval
         }

         const distance = parseFloat(node.attributes.value); // Apple Health stores meters

         const dayKey = new Date(startMs).toISOString().slice(0, 10);
         if (!distanceByDay[dayKey]) distanceByDay[dayKey] = [];
         distanceByDay[dayKey].push([startMs, endMs, distance]);

         parsedCount++;
         bar.setTotal(parsedCount);
         bar.update(parsedCount);
      }
   });

   parser.on("end", async () => {
      bar.stop();
      console.log(`\n⏱ Parsed ${parsedCount} distance records. Starting upload...`);

      for (const [day, distances] of Object.entries(distanceByDay)) {
         const sorted = distances.sort((a, b) => a[0] - b[0]);

         const dataPoints = sorted.map(([startMs, endMs, value]) => ({
            startTimeNanos: msToNs(startMs),
            endTimeNanos: msToNs(endMs),
            dataTypeName: "com.google.distance.delta",
            value: [{ fpVal: value }]
         }));

         await uploadDistanceDataPoints(oAuth2Client, dataSourceId, dataPoints);
         console.log(`✅ Uploaded distance for ${day} (${dataPoints.length} points)`);
      }
   });

   fs.createReadStream(EXPORT_XML).pipe(parser);
}

// ---------- MAIN ----------
(async () => {
   console.log("⏱ Starting distance sync...");
   const auth = await authorize();

   // Create or reuse distance data source
   const cleanName = "apple_health_distance_clean";
   const dataSourceId = await getOrCreateDataSource(auth, "com.google.distance.delta", cleanName);

   await parseAndUploadDistance(auth, dataSourceId);
})();
