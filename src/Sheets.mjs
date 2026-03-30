import dotenv from "dotenv";
dotenv.config();
import { google } from "googleapis";

function buildJwtClient() {
  const raw = process.env.GCP_PRIVATE_KEY;
  const client_email = process.env.GCP_CLIENT_EMAIL;
  if (!raw || !client_email) {
    return null;
  }
  const private_key = raw.replace(/\\n/gm, "\n");
  return new google.auth.JWT({
    email: client_email,
    key: private_key,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
}

// Authenticate with the Google Sheets API (optional — omit env vars to skip Sheets on startup).
export const jwtClient = buildJwtClient();

// Initialize the Google Sheets API.
export const spreadsheetId = process.env.SPREADSHEET_ID;

export const sheetExists = async (sheetsApi, sheetTitle) => {
  const sheetProperties = await sheetsApi.spreadsheets.get({
    spreadsheetId,
  });

  const sheetsInSpreadsheet = sheetProperties.data.sheets;
  const sheetExists = sheetsInSpreadsheet.some(
    (sheet) => sheet.properties.title === sheetTitle
  );

  return sheetExists;
};

export const createSheet = async (sheetsApi, sheetTitle) => {
  await sheetsApi.spreadsheets.batchUpdate({
    spreadsheetId,
    resource: {
      requests: [
        {
          addSheet: {
            properties: {
              title: sheetTitle,
            },
          },
        },
      ],
    },
  });
};
