/**
 * sync_bmi.js
 *
 * Stream Apple Health export.xml and upload BMI to Google Fit
 * Uses constants and functions from separate modules.
 */

const fs = require("fs");
const sax = require("sax");
const cliProgress = require("cli-progress");
const { EXPORT_XML } = require("../constants");
const { authorize, uploadDataPoints, getOrCreateDataSource } = require("../functions");

// ---------- STREAM APPLE HEALTH XML ----------
async function parseAndUploadBMI(oAuth2Client, dataSourceId) {
   const bmis = [];
   const parser = sax.createStream(true);

   // Initialize parsing progress bar
   const bar = new cliProgress.SingleBar({
      format: 'Parsing |{bar}| {value} records',
      barCompleteChar: '\u2588',
      barIncompleteChar: '\u2591',
      hideCursor: true
   });
   let parsedCount = 0;
   bar.start(0, 0);

   parser.on("opentag", (node) => {
      if (node.name === "Record" && node.attributes.type === "HKQuantityTypeIdentifierBodyMassIndex") {
         const dateMs = new Date(node.attributes.startDate).getTime();
         let value = parseFloat(node.attributes.value); // Apple Health stores BMI directly
         bmis.push([dateMs, value]);

         parsedCount++;
         bar.setTotal(parsedCount);
         bar.update(parsedCount);
      }
   });

   parser.on("end", async () => {
      bar.stop();
      console.log(`\n⏱ Parsed ${bmis.length} BMI records. Starting upload...`);
      const dataTypeName = "com.google.body.mass.index";
      await uploadDataPoints(oAuth2Client, dataSourceId, bmis, dataTypeName, 100);
   });

   fs.createReadStream(EXPORT_XML).pipe(parser);
}

// ---------- MAIN ----------
(async () => {
   console.log("⏱ Starting BMI sync...");
   const auth = await authorize();

   // Create or reuse a clean BMI data source
   const cleanName = "apple_health_bmi_clean";
   const dataType = {
      "name": "com.google.body.mass.index",
      "field": [
         {
            "name": "value",
            "format": "floatPoint"
         },
         {
            "name": "timestamp",
            "format": "integer"
         }
      ]
   }
   const dataSourceId = await getOrCreateDataSource(auth, "com.google.body.mass.index", cleanName, dataType);

   await parseAndUploadBMI(auth, dataSourceId);
})();
