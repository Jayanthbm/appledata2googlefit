const fs = require("fs");
const { google } = require("googleapis");
const axios = require("axios");
const readline = require("readline");
const open = async (url) => (await import("open")).default(url);
const { TOKEN_PATH, SCOPES, APP_NAME } = require("./constants");

// ---------- GOOGLE AUTH ----------
async function authorize() {
   const credentials = JSON.parse(fs.readFileSync("client_secret.json", "utf8"));
   const { client_secret, client_id, redirect_uris } =
      credentials.installed || credentials.web;
   const oAuth2Client = new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);

   if (fs.existsSync(TOKEN_PATH)) {
      const token = JSON.parse(fs.readFileSync(TOKEN_PATH, "utf8"));
      oAuth2Client.setCredentials(token);
      return oAuth2Client;
   }

   const authUrl = oAuth2Client.generateAuthUrl({ access_type: "offline", scope: SCOPES });
   console.log("Authorize this app by visiting this URL:", authUrl);
   await open(authUrl);
   const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
   const code = await new Promise((resolve) =>
      rl.question("Enter the code from that page here: ", (ans) => {
         rl.close();
         resolve(ans);
      })
   );

   const { tokens } = await oAuth2Client.getToken(code);
   oAuth2Client.setCredentials(tokens);
   fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens));
   console.log("Token stored to", TOKEN_PATH);
   return oAuth2Client;
}

// ---------- HELPERS ----------
// Convert ms to ns
function msToNs(ms) {
   return (BigInt(ms) * 1000000n).toString();
}
// ---------- SANITIZE ID ----------
function sanitizeId(name) {
   // Lowercase, replace spaces & invalid chars with underscore
   return name.toLowerCase().replace(/[^a-z0-9_]/g, "_");
}

// ---------- GET OR CREATE DATA SOURCE ----------
async function getOrCreateDataSource(oAuth2Client, dataTypeName, name, dataType = null) {
   const service = google.fitness({ version: "v1", auth: oAuth2Client });
   const dataSources = await service.users.dataSources.list({ userId: "me" });
   const sanitizedName = sanitizeId(name);

   // Check if existing source matches
   const existing = (dataSources.data.dataSource || []).find(ds => ds.dataStreamName === sanitizedName);
   if (existing) {
      console.log("ℹ️ Using existing data source:", sanitizedName);
      return existing.dataStreamId;
   }

   let createdDataType = dataType;
   if (!createdDataType) {
      createdDataType = {
         name: dataTypeName
      }
   }

   // Create new source
   const body = {
      dataStreamName: sanitizedName,
      type: "raw",
      application: { name: "AppleHealthSyncer", },
      dataType: createdDataType,
      device: {
         uid: `device_${sanitizedName}`,
         type: "watch",
         manufacturer: "Apple",
         model: "Health Export",
      },
   };


   const created = await service.users.dataSources.create({ userId: "me", requestBody: body });
   console.log("✅ Created data source:", sanitizedName);
   return created.dataStreamId;
}

// ---------- UPLOAD DATA POINTS ----------
async function uploadDataPoints(oAuth2Client, dataSourceId, dataPoints, dataTypeName, CHUNK_SIZE = 100) {
   const tokenObj = await oAuth2Client.getAccessToken();
   const accessToken = tokenObj?.token;
   if (!accessToken) throw new Error("No access token available");
   if (!dataPoints.length) return console.log("⚠️ No data points to upload");

   const startTime = Date.now();

   const MIN_INTERVAL_MS = 60 * 1000;

   const bar = new (require("cli-progress").SingleBar)({
      format: 'Progress |{bar}| {percentage}% || {value}/{total} uploaded',
      barCompleteChar: '\u2588',
      barIncompleteChar: '\u2591',
      hideCursor: true,
   });
   bar.start(dataPoints.length, 0);

   for (let i = 0; i < dataPoints.length; i += CHUNK_SIZE) {
      const chunk = dataPoints.slice(i, i + CHUNK_SIZE);
      // const points = chunk.map(([ms, value]) => ({
      //    startTimeNanos: msToNs(ms),
      //    endTimeNanos: msToNs(ms),
      //    dataTypeName: dataTypeName,
      //    value: [{ fpVal: value }],
      // }));

      const points = chunk.map(dp => {
         let startNs = dp.startTimeNanos;
         let endNs = dp.endTimeNanos;

         // Add 1 minute if start and end are equal
         if (startNs === endNs) {
            endNs += MIN_INTERVAL_MS * 1e6; // convert ms → ns
         }

         return {
            startTimeNanos: startNs,
            endTimeNanos: endNs,
            dataTypeName: dp.dataTypeName,
            value: dp.value
         };
      });

      const chunkPayload = {
         dataSourceId,
         minStartTimeNs: msToNs(chunk[0][0]),
         maxEndTimeNs: msToNs(chunk[chunk.length - 1][0]),
         point: points,
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

/**
 * Upload step data points safely
 * @param {*} oAuth2Client - authorized Google OAuth2 client
 * @param {*} dataSourceId - raw:com.google.step_count.delta:...
 * @param {*} dataPoints - array of [timestampMs, stepsCount]
 * @param {*} CHUNK_SIZE - how many points per API request
 */
async function uploadStepDataPoints(oAuth2Client, dataSourceId, dataPoints, dataTypeName, CHUNK_SIZE = 100) {
   const tokenObj = await oAuth2Client.getAccessToken();
   const accessToken = tokenObj?.token;
   if (!accessToken) throw new Error("No access token available");
   if (!dataPoints.length) return console.log("⚠️ No data points to upload");

   const startTime = Date.now();

   const bar = new (require("cli-progress").SingleBar)({
      format: 'Uploading |{bar}| {percentage}% || {value}/{total} uploaded',
      barCompleteChar: '\u2588',
      barIncompleteChar: '\u2591',
      hideCursor: true
   });

   bar.start(dataPoints.length, 0);

   for (let i = 0; i < dataPoints.length; i += CHUNK_SIZE) {
      const chunk = dataPoints.slice(i, i + CHUNK_SIZE);
      const points = chunk.map(dp => ({
         startTimeNanos: dp.startTimeNanos,
         endTimeNanos: dp.endTimeNanos,
         dataTypeName: dp.dataTypeName,
         value: dp.value
      }));

      const chunkPayload = {
         dataSourceId,
         minStartTimeNs: chunk[0].startTimeNanos,
         maxEndTimeNs: chunk[chunk.length - 1].endTimeNanos,
         point: points,
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



async function uploadDistanceDataPoints(oAuth2Client, dataSourceId, dataPoints, CHUNK_SIZE = 100) {
   const tokenObj = await oAuth2Client.getAccessToken();
   const accessToken = tokenObj?.token;
   if (!accessToken) throw new Error("No access token available");
   if (!dataPoints.length) return console.log("⚠️ No distance data points to upload");

   const MIN_INTERVAL_MS = 60 * 1000;
   const bar = new (require("cli-progress").SingleBar)({
      format: 'Uploading |{bar}| {percentage}% || {value}/{total} uploaded',
      barCompleteChar: '\u2588',
      barIncompleteChar: '\u2591',
      hideCursor: true
   });

   bar.start(dataPoints.length, 0);

   for (let i = 0; i < dataPoints.length; i += CHUNK_SIZE) {
      const chunk = dataPoints.slice(i, i + CHUNK_SIZE);

      const points = chunk.map(dp => {
         let startNs = dp.startTimeNanos;
         let endNs = dp.endTimeNanos;

         if (startNs === endNs) {
            endNs += MIN_INTERVAL_MS * 1e6;
         }

         return {
            startTimeNanos: startNs,
            endTimeNanos: endNs,
            dataTypeName: dp.dataTypeName,
            value: dp.value
         };
      });

      const chunkPayload = {
         dataSourceId,
         minStartTimeNs: points[0].startTimeNanos,
         maxEndTimeNs: points[points.length - 1].endTimeNanos,
         point: points
      };

      const url = `https://www.googleapis.com/fitness/v1/users/me/dataSources/${dataSourceId}/datasets/${chunkPayload.minStartTimeNs}-${chunkPayload.maxEndTimeNs}`;

      try {
         await axios.patch(url, chunkPayload, {
            headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" }
         });
         bar.update(Math.min(i + CHUNK_SIZE, dataPoints.length));
      } catch (err) {
         if (err.response) console.error("❌ API Error:", err.response.status, err.response.data);
         else console.error("❌ Upload Error:", err.message);
      }
   }

   bar.stop();
   console.log(`✅ Distance upload finished in ${(Date.now() - startTime) / 1000}s`);
}


module.exports = { authorize, msToNs, getOrCreateDataSource, uploadDataPoints, sanitizeId, uploadStepDataPoints, uploadDistanceDataPoints };
