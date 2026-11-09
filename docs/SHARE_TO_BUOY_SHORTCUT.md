# Share to Buoy — Apple Shortcut (iPhone and Mac)

Stage 26c. Sends shared text or a web page link to Buoy as a task tagged
`check`, which shows under Tasks → "Needs a look". No Inbox page.

## 1. Create a device token

Buoy → Admin → Share devices → type a device name (e.g. "Oliver's iPhone") →
Create token. Copy the token straight away; it is shown once. Only a hash is
kept on the server. One token per device.

## 2. Build the Shortcut

1. Shortcuts → + → name it **Share to Buoy**.
2. Shortcut settings (i): turn on **Show in Share Sheet**; accept **URLs** and
   **Text**. On Mac, also tick **Use as Quick Action**.
3. **If** Shortcut Input **has any value** → continue. **Otherwise** →
   **Ask for Input** (Text, prompt "Capture") so the shortcut also works from
   the home screen or Siri.
4. **Get Contents of URL**
   - URL: `https://buoy.thinhalo.com/api/capture`
   - Method: POST
   - Headers: `Authorization` = `Bearer <your token>`
   - Request Body: JSON, key `text` = Shortcut Input (or Provided Input)
5. **Show Notification**: "Sent to Buoy".

Page titles (Stage 31): if only a link arrives, Buoy fetches the page title
itself, so the task reads as the page name and the link goes into the notes.
To send the title from the phone instead (useful for pages behind a login),
add **Get Details of Safari Web Page → Name** before step 4 and add the JSON
key `title` = Name.

Optional JSON keys: `url`, `title`, `dueDate` (YYYY-MM-DD), `domain`
(family | work | medicolegal | personal | health). Shared captures never file
straight into a project; sort them from "Needs a look".

## 3. Test

Share a Safari page → Share to Buoy → check Tasks → Needs a look.

## Limits and errors

| Code | Meaning |
|---|---|
| 200 | Saved |
| 400 | Empty or invalid field |
| 401 | Missing, wrong or revoked token |
| 413 | Body over 20 KB |
| 429 | More than 30 captures a minute from this device |

The token works only for `POST /api/capture`. It cannot read anything or reach
any other route. If a device is lost, revoke its token in Admin → Share devices.
