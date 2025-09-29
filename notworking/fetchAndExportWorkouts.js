/**
 * Google Fit Workout Session Exporter (2022-Present)
 * * This script fetches all recorded fitness sessions from the Google Fit REST API
 * starting from January 1, 2022, and saves the details into a JSON file.
 * * Prerequisites:
 * 1. Install dependencies: npm install axios
 * 2. Obtain an OAuth 2.0 Access Token with 'https://www.googleapis.com/auth/fitness.activity.read' scope.
 * 3. Replace the placeholder for ACCESS_TOKEN below.
 */

const fs = require('fs')

const axios = require('axios');
const { promisify } = require('util')

const token = require('../token.json')
// --- CONFIGURATION ---

// IMPORTANT: Replace this with your actual, valid OAuth 2.0 Access Token.
// This token must have access to the 'https://www.googleapis.com/auth/fitness.activity.read' scope.
const ACCESS_TOKEN = token.token;

// Output file path
const OUTPUT_FILE = 'google_fit_workouts.json';

// Start date: January 1, 2022, 00:00:00 UTC (1640995200000 milliseconds)
const START_TIME_MILLIS = 1640995200000;

// End date: Current timestamp in milliseconds
const END_TIME_MILLIS = Date.now();

// Base URL for the Google Fit Sessions API
const API_URL = 'https://www.googleapis.com/fitness/v1/users/me/sessions';

// --- ACTIVITY TYPE MAPPING (Partial List) ---

const ACTIVITY_TYPES = {
   // Standard activities are frequently sessions
   9: 'Running',
   7: 'Walking',
   19: 'Cycling',
   93: 'Badminton',
   10: 'Handball',
   109: 'Gymnastics',
   119: 'Weightlifting',
   113: 'Yoga',
   134: 'Hiking',
   0: 'Unknown/Other'
};

/**
 * Converts milliseconds since epoch to a readable local date and time string.
 * @param {string} ms - Timestamp in milliseconds (as a string from the API).
 * @returns {string} Formatted date and time string.
 */
function msToDateTime(ms) {
   if (!ms) return '';
   return new Date(parseInt(ms, 10)).toLocaleString();
}

/**
 * Calculates the duration of the session in minutes.
 * @param {string} startMs - Start time in milliseconds.
 * @param {string} endMs - End time in milliseconds.
 * @returns {number} Duration in minutes (rounded to 2 decimal places).
 */
function calculateDurationMinutes(startMs, endMs) {
   const start = parseInt(startMs, 10);
   const end = parseInt(endMs, 10);
   if (isNaN(start) || isNaN(end) || end <= start) return 0;

   // Duration in milliseconds / (1000 ms/s * 60 s/min)
   return parseFloat(((end - start) / 60000).toFixed(2));
}

/**
 * Fetches all sessions from the Google Fit API and exports them to a JSON file.
 */
async function fetchAndExportWorkouts() {
   if (ACCESS_TOKEN === 'YOUR_GOOGLE_FIT_ACCESS_TOKEN' || !ACCESS_TOKEN) {
      console.error("ERROR: Please update the ACCESS_TOKEN variable in the script with a valid OAuth token.");
      return;
   }

   console.log(`Starting data sync from ${msToDateTime(START_TIME_MILLIS)} to ${msToDateTime(END_TIME_MILLIS)}...`);

   const params = {
      // Time range for fetching sessions
      startTime: START_TIME_MILLIS,
      endTime: END_TIME_MILLIS,

      // Return only sessions created by applications
      'includeDeleted': false
   };

   try {
      const response = await axios.get(API_URL, {
         params: params,
         headers: {
            'Authorization': `Bearer ${ACCESS_TOKEN}`,
            'Content-Type': 'application/json'
         }
      });

      const sessions = response.data.session || [];

      console.log(`Successfully retrieved ${sessions.length} sessions.`);

      if (sessions.length === 0) {
         console.log("No fitness sessions found in the specified date range.");
         return;
      }

      // 1. Process Sessions into a cleaner JSON structure
      const structuredSessions = sessions.map(session => {
         const durationMinutes = calculateDurationMinutes(session.startTimeMillis, session.endTimeMillis);
         const activityName = ACTIVITY_TYPES[session.activityType] || 'Activity Code ' + session.activityType;

         return {
            id: session.id,
            name: session.name || 'N/A',
            description: session.description || 'N/A',
            activity: activityName,
            activityCode: session.activityType,
            sourceApplication: session.application?.name || 'Unknown',
            startTimeLocal: msToDateTime(session.startTimeMillis),
            endTimeLocal: msToDateTime(session.endTimeMillis),
            durationMinutes: durationMinutes,
            startTimeMillis: session.startTimeMillis,
            endTimeMillis: session.endTimeMillis
         };
      });

      // 2. Format as JSON string with 2-space indentation
      const jsonOutput = JSON.stringify(structuredSessions, null, 2);

      // 3. Write to JSON File
      await promisify(fs.writeFile)(OUTPUT_FILE, jsonOutput, 'utf8');

      console.log(`\n✅ Success! All workout data has been saved to: ${OUTPUT_FILE}`);
      console.log(`Total sessions exported: ${structuredSessions.length}`);

   } catch (error) {
      console.error('\n--- API Request Error ---');
      if (error.response) {
         // The request was made and the server responded with a status code
         console.error(`Status: ${error.response.status}`);
         console.error('Data:', error.response.data, error.response.data.error.errors);
         console.error('Make sure your ACCESS_TOKEN is correct and the user has granted read access.');
      } else if (error.request) {
         // The request was made but no response was received
         console.error('No response received from Google Fit API.');
      } else {
         // Something happened in setting up the request
         console.error('Error during script execution:', error.message);
      }
   }
}

fetchAndExportWorkouts();
