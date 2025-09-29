/**
 * sync_steps.js
 *
 * Stream Apple Health export.xml and upload step_count.delta to Google Fit
 */

const fs = require("fs");
const sax = require("sax");
const cliProgress = require("cli-progress");
const { EXPORT_XML } = require("./constants");
const { authorize, getOrCreateDataSource, uploadStepDataPoints, msToNs } = require("./functions");

// Default step interval if Apple Health has start === end
const DEFAULT_STEP_DURATION_MS = 60 * 1000; // 1 minute

// ---------- STREAM APPLE HEALTH XML ----------
async function parseAndUploadSteps(oAuth2Client, dataSourceId) {
   const stepsByDay = {}; // group steps by YYYY-MM-DD for daily datasets
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
      if (node.name === "Record" && node.attributes.type === "HKQuantityTypeIdentifierStepCount") {
         let startMs = new Date(node.attributes.startDate).getTime();
         let endMs = new Date(node.attributes.endDate).getTime();

         if (endMs <= startMs) {
            endMs = startMs + DEFAULT_STEP_DURATION_MS; // avoid zero-length interval
         }

         const steps = parseInt(node.attributes.value, 10);

         const dayKey = new Date(startMs).toISOString().slice(0, 10); // YYYY-MM-DD
         if (!stepsByDay[dayKey]) stepsByDay[dayKey] = [];
         stepsByDay[dayKey].push([startMs, endMs, steps]);

         parsedCount++;
         bar.setTotal(parsedCount);
         bar.update(parsedCount);
      }
   });

   parser.on("end", async () => {
      bar.stop();
      console.log(`\n⏱ Parsed ${parsedCount} step records. Starting upload...`);

      // Upload each day's steps as a separate dataset
      for (const [day, steps] of Object.entries(stepsByDay)) {
         const sorted = steps.sort((a, b) => a[0] - b[0]);
         const minStartNs = msToNs(sorted[0][0]);
         const maxEndNs = msToNs(sorted[sorted.length - 1][1]);

         const dataPoints = sorted.map(([startMs, endMs, value]) => ({
            startTimeNanos: msToNs(startMs),
            endTimeNanos: msToNs(endMs),
            dataTypeName: "com.google.step_count.delta",
            value: [{ intVal: value }],
         }));

         await uploadStepDataPoints(oAuth2Client, dataSourceId, dataPoints, "com.google.step_count.delta");
         console.log(`✅ Uploaded steps for ${day} (${dataPoints.length} points)`);
      }
   });

   fs.createReadStream(EXPORT_XML).pipe(parser);
}

// ---------- MAIN ----------
(async () => {
   console.log("⏱ Starting step sync...");
   const auth = await authorize();

   // Create or reuse step data source
   const cleanName = "apple_health_steps_clean";
   const dataSourceId = await getOrCreateDataSource(auth, "com.google.step_count.delta", cleanName);

   await parseAndUploadSteps(auth, dataSourceId);
})();
