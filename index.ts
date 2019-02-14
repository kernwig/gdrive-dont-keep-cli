import 'source-map-support/register'
import * as fs from 'fs';
import * as readline from 'readline';
import {google} from 'googleapis';

// If modifying these scopes, delete token.json.
const SCOPES = ['https://www.googleapis.com/auth/drive'];
// The file token.json stores the user's access and refresh tokens, and is
// created automatically when the authorization flow completes for the first time.
const TOKEN_PATH = 'token.json';

// Load client secrets from a local file.
fs.readFile('credentials.json', (err, content) => {
    if (err) return console.log('Error loading client secret file:', err);
    // Authorize a client with credentials, then call the Google Drive API.
    authorize(JSON.parse(content.toString()), processFiles);
});

/**
 * Create an OAuth2 client with the given credentials, and then execute the
 * given callback function.
 * @param {Object} credentials The authorization client credentials.
 * @param {function} callback The callback to call with the authorized client.
 */
function authorize(credentials, callback) {
    const {client_secret, client_id, redirect_uris} = credentials.installed;
    const oAuth2Client = new google.auth.OAuth2(
        client_id, client_secret, redirect_uris[0]);

    // Check if we have previously stored a token.
    fs.readFile(TOKEN_PATH, (err, token) => {
        if (err) return getAccessToken(oAuth2Client, callback);
        oAuth2Client.setCredentials(JSON.parse(token.toString()));
        callback(oAuth2Client);
    });
}

/**
 * Get and store new token after prompting for user authorization, and then
 * execute the given callback with the authorized OAuth2 client.
 * @param {google.auth.OAuth2} oAuth2Client The OAuth2 client to get token for.
 * @param {getEventsCallback} callback The callback for the authorized client.
 */
function getAccessToken(oAuth2Client, callback) {
    const authUrl = oAuth2Client.generateAuthUrl({
        access_type: 'offline',
        scope: SCOPES,
    });
    console.log('Authorize this app by visiting this url:', authUrl);
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    });
    rl.question('Enter the code from that page here: ', (code) => {
        rl.close();
        oAuth2Client.getToken(code, (err, token) => {
            if (err) return console.error('Error retrieving access token', err);
            oAuth2Client.setCredentials(token);
            // Store the token to disk for later program executions
            fs.writeFile(TOKEN_PATH, JSON.stringify(token), (err) => {
                if (err) console.error(err);
                console.log('Token stored to', TOKEN_PATH);
            });
            callback(oAuth2Client);
        });
    });
}

/**
 * Lists the names and IDs of up to 10 files.
 * @param {google.auth.OAuth2} auth An authorized OAuth2 client.
 */
async function processFiles(auth) {
    try {
        const drive = google.drive({version: 'v3', auth});
        let nextPageToken;

        do {
            const pageSize = 100;
            console.log(`Checking next ${pageSize} files...`);
            const res = await drive.files.list({
                pageSize,
                fields: 'nextPageToken, files(id, name, ownedByMe, mimeType)',
                q: "trashed = false",
                pageToken: nextPageToken,
            });
            nextPageToken = res.data.nextPageToken;

            const files = res.data.files as any[];
            if (files.length) {
                for (const file of files) {
                    if (file.ownedByMe && file.mimeType !== "application/vnd.google-apps.folder") {
                        //console.log(`${file.name} (${file.id})`);
                        await getRevisions(drive, file);
                    }
                }
            } else {
                console.log('No more files found.');
                break;
            }
        } while (nextPageToken);
    }
    catch (err) {
        console.error(err);
    }
}

async function getRevisions(drive, file): Promise<void> {
    try {
        const res = await drive.revisions.list({fileId: file.id, fields: '*'});
        for (const rev of res.data.revisions) {
            // console.log(`\trev ${rev.modifiedTime} keepForever=${rev.keepForever}`);
            if (rev.keepForever) {
                await cleanRevision(drive, file, rev);
            }
        }
    }
    catch (err) {
        if (err.message === 'The file does not support revisions.') {
            console.warn(err.toString(), JSON.stringify(file));
        }
    }
}

async function cleanRevision(drive, file, revision): Promise<void> {
    const res = await drive.revisions.update({
        fileId: file.id,
        revisionId: revision.id,
        requestBody: {
            keepForever: false
        }
    });
    console.log(`Cleared keep-forever on "${file.name}" revision ${revision.id}`);
}
