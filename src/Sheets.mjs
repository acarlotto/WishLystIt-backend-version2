import dotenv from "dotenv";
dotenv.config();
import { google } from "googleapis";

const key = {
  private_key: process.env.GCP_PRIVATE_KEY.replace(/\\n/gm, "\n"),
  client_email: process.env.GCP_CLIENT_EMAIL,
};

// Authenticate with the Google Sheets API.
export const jwtClient = new google.auth.JWT({
  email: key.client_email,
  key: key.private_key,
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});
// await jwtClient.authorize();

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
