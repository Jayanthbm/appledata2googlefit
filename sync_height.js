/**
 * sync_height.js
 *
 * Stream Apple Health export.xml and upload height to Google Fit
 * Uses constants and functions from separate modules.
 */

const fs = require("fs");
const sax = require("sax");
const cliProgress = require("cli-progress");
const { EXPORT_XML } = require("./constants"); // remove DATA_SOURCE_ID
const { authorize, uploadDataPoints, getOrCreateDataSource } = require("./functions");

// ---------- STREAM APPLE HEALTH XML ----------
async function parseAndUploadHeights(oAuth2Client, dataSourceId) {
   const heights = [];
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
      if (node.name === "Record" && node.attributes.type === "HKQuantityTypeIdentifierHeight") {
         const dateMs = new Date(node.attributes.startDate).getTime();
         let value = parseFloat(node.attributes.value);

         //convert value from cm to metera
         value = parseFloat(value / 100);
         heights.push([dateMs, value]);

         parsedCount++;
         bar.setTotal(parsedCount); // dynamically adjust total
         bar.update(parsedCount);
      }
   });

   parser.on("end", async () => {
      bar.stop();
      console.log(`\n⏱ Parsed ${heights.length} weight records. Starting upload...`);
      const dataTypeName = "com.google.height";
      await uploadDataPoints(oAuth2Client, dataSourceId, heights, dataTypeName, 100);
   });

   fs.createReadStream(EXPORT_XML).pipe(parser);
}

// ---------- MAIN ----------
(async () => {
   console.log("⏱ Starting height sync...");
   const auth = await authorize();

   // Get or create the clean height source
   const cleanName = "apple_health_height_clean";
   const dataSourceId = await getOrCreateDataSource(auth, "com.google.height", cleanName);

   await parseAndUploadHeights(auth, dataSourceId);
})();
