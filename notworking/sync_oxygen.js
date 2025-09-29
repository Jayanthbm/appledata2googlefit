/**
 * sync_oxygen.js
 *
 * Stream Apple Health export.xml and upload oxygen saturation to Google Fit
 */

const fs = require("fs");
const sax = require("sax");
const cliProgress = require("cli-progress");
const { EXPORT_XML } = require("../constants");
const { authorize, uploadDataPoints, sanitizeId, getOrCreateDataSource, msToNs } = require("../functions");

// ---------- STREAM APPLE HEALTH XML ----------
async function parseAndUploadOxygen(oAuth2Client, dataSourceId) {
   const sats = [];
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
      if (node.name === "Record" && node.attributes.type === "HKQuantityTypeIdentifierOxygenSaturation") {
         const dateMs = new Date(node.attributes.startDate).getTime();
         let value = parseFloat(node.attributes.value); // fraction from Apple
         value = value * 100; // convert to percentage
         sats.push([dateMs, value]);

         parsedCount++;
         bar.setTotal(parsedCount);
         bar.update(parsedCount);
      }
   });

   parser.on("end", async () => {
      bar.stop();
      console.log(`\n⏱ Parsed ${sats.length} oxygen saturation records. Starting upload...`);
      const dataTypeName = "com.google.oxygen_saturation";
      await uploadDataPoints(oAuth2Client, dataSourceId, sats, dataTypeName, 100);
   });

   fs.createReadStream(EXPORT_XML).pipe(parser);
}

// ---------- MAIN ----------
(async () => {
   console.log("⏱ Starting Oxygen Saturation sync...");
   const auth = await authorize();

   // Create or reuse a clean oxygen saturation data source
   const cleanName = "apple_health_oxygen_clean";
   const dataSourceId = await getOrCreateDataSource(auth, "com.google.oxygen_saturation", cleanName);

   await parseAndUploadOxygen(auth, dataSourceId);
})();
