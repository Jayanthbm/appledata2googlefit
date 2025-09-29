const path = require("path");

// Path to Apple Health XML export
const EXPORT_XML = path.join(
   "/Users/jayanthbharadwajm/Downloads/apple_health_export",
   "export.xml"
);

// Google Fit data source ID (will be created if missing)
const DATA_SOURCE_ID = "raw:com.google.height:apple_health:jbm-ah2gfit-024";

// OAuth scopes for Google Fit
const SCOPES = ["https://www.googleapis.com/auth/fitness.body.write",
   "https://www.googleapis.com/auth/fitness.activity.write",
   "https://www.googleapis.com/auth/fitness.sleep.write",
   "https://www.googleapis.com/auth/fitness.heart_rate.write"];

// Token path for storing credentials
const TOKEN_PATH = "./token.json";

const APP_NAME = "AppleHealthSyncer";

module.exports = { EXPORT_XML, DATA_SOURCE_ID, SCOPES, TOKEN_PATH, APP_NAME };
