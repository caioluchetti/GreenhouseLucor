import os

from google_auth_oauthlib.flow import InstalledAppFlow


SCOPES = ["https://www.googleapis.com/auth/drive"]
CLIENT_SECRET = os.environ.get(
    "GOOGLE_DRIVE_CLIENT_SECRET",
    "client_secret_432146247142-enui3hf8h39mls1cnr7obks5rb5epu2c.apps.googleusercontent.com.json",
)
TOKEN_FILE = os.environ.get("GOOGLE_DRIVE_TOKEN", "google-drive-token.json")
PORT = int(os.environ.get("GOOGLE_DRIVE_OAUTH_PORT", "8080"))


flow = InstalledAppFlow.from_client_secrets_file(CLIENT_SECRET, SCOPES)
credentials = flow.run_local_server(
    port=PORT,
    open_browser=False,
    access_type="offline",
    prompt="consent",
)

with open(TOKEN_FILE, "w", encoding="utf-8") as token:
    token.write(credentials.to_json())

print(f"Saved Google Drive token to {TOKEN_FILE}")
