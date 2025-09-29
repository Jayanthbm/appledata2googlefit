/**
 * sync_body_fat.js
 *
 * Stream Apple Health export.xml and upload body fat % to Google Fit
 * Uses constants and functions from separate modules.
 */

const fs = require("fs");
const sax = require("sax");
const cliProgress = require("cli-progress");
const { EXPORT_XML } = require("./constants");
const {
   authorize,
   uploadDataPoints,
   getOrCreateDataSource,
} = require("./functions");

// ---------- STREAM APPLE HEALTH XML ----------
async function parseAndUploadBodyFat(oAuth2Client, dataSourceId) {
   const bodyFats = [];
   const parser = sax.createStream(true);

   // Progress bar for parsing
   const bar = new cliProgress.SingleBar({
      format: 'Parsing |{bar}| {value} records',
      barCompleteChar: '\u2588',
      barIncompleteChar: '\u2591',
      hideCursor: true
   });
   let parsedCount = 0;
   bar.start(0, 0);

   parser.on("opentag", (node) => {
      if (node.name === "Record" && node.attributes.type === "HKQuantityTypeIdentifierBodyFatPercentage") {
         const dateMs = new Date(node.attributes.startDate).getTime();
         let value = parseFloat(node.attributes.value); // Apple Health stores % as number
         value = parseFloat(value) * 100; // convert fraction to percentage
         bodyFats.push([dateMs, value]);

         parsedCount++;
         bar.setTotal(parsedCount); // dynamically grow
         bar.update(parsedCount);
      }
   });

   parser.on("end", async () => {
      bar.stop();
      console.log(`\n⏱ Parsed ${bodyFats.length} body fat records. Starting upload...`);
      const dataTypeName = "com.google.body.fat.percentage";
      await uploadDataPoints(oAuth2Client, dataSourceId, bodyFats, dataTypeName, 100);
   });

   fs.createReadStream(EXPORT_XML).pipe(parser);
}

// ---------- MAIN ----------
(async () => {
   console.log("⏱ Starting body fat sync...");
   const auth = await authorize();

   // Create or reuse a clean body fat data source
   const cleanName = "apple_health_body_fat_clean";
   const dataSourceId = await getOrCreateDataSource(auth, "com.google.body.fat.percentage", cleanName);

   await parseAndUploadBodyFat(auth, dataSourceId);
})();
