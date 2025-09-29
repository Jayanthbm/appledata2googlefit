/**
 * sync_weight.js
 *
 * Stream Apple Health export.xml and upload weight to Google Fit
 * Uses constants and functions from separate modules.
 */

const fs = require("fs");
const sax = require("sax");
const cliProgress = require("cli-progress");
const { EXPORT_XML } = require("./constants");
const { authorize, uploadDataPoints, getOrCreateDataSource } = require("./functions");

// ---------- STREAM APPLE HEALTH XML ----------
async function parseAndUploadWeights(oAuth2Client, dataSourceId) {
   const weights = [];
   const parser = sax.createStream(true);

   // Initialize progress bar for parsing
   const bar = new cliProgress.SingleBar({
      format: 'Parsing |{bar}| {value} records',
      barCompleteChar: '\u2588',
      barIncompleteChar: '\u2591',
      hideCursor: true
   });
   let parsedCount = 0;
   bar.start(0, 0);

   parser.on("opentag", (node) => {
      if (node.name === "Record" && node.attributes.type === "HKQuantityTypeIdentifierBodyMass") {
         const dateMs = new Date(node.attributes.startDate).getTime();
         let value = parseFloat(node.attributes.value); // Apple Health already stores weight in kg
         weights.push([dateMs, value]);

         parsedCount++;
         bar.setTotal(parsedCount); // dynamically adjust total
         bar.update(parsedCount);
      }
   });

   parser.on("end", async () => {
      bar.stop();
      console.log(`\n⏱ Parsed ${weights.length} weight records. Starting upload...`);
      const dataTypeName = "com.google.weight";
      await uploadDataPoints(oAuth2Client, dataSourceId, weights, dataTypeName, 100);
   });

   fs.createReadStream(EXPORT_XML).pipe(parser);
}

// ---------- MAIN ----------
(async () => {
   console.log("⏱ Starting weight sync...");
   const auth = await authorize();

   // Create or reuse a clean weight data source
   const cleanName = "apple_health_weight_clean";
   const dataSourceId = await getOrCreateDataSource(auth, "com.google.weight", cleanName);

   await parseAndUploadWeights(auth, dataSourceId);
})();
