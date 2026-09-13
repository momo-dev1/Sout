# Getting a Gemini API key and adding it to Sout

Sout sends your recordings to Google's Gemini (`gemini-3.6-flash`) for transcription, so it needs a Gemini API key. The key is created once in Google AI Studio, pasted into Sout's Settings, and then stored encrypted on your PC.

## 1. Get the key from Google AI Studio

1. Open **https://aistudio.google.com/apikey** in your browser and sign in with a Google account.
2. If this is your first visit, accept the Google AI Studio terms when prompted.
3. Click **Create API key**.
   - If AI Studio asks which project to use, pick **Create API key in new project** (or select an existing Google Cloud project if you already have one).
4. Copy the key. It is a long random string — newer keys start with `AQ.`, older ones with `AIza`.
   - You can come back to the same page at any time to view, copy, or delete your keys.

Treat the key like a password: anyone who has it can make requests on your account. Don't paste it into chats, screenshots, or files you share.

## 2. Add the key in Sout

1. Start Sout.
   - On a fresh install with no key, the **Settings** page opens automatically.
   - Otherwise open it from the tray icon next to the clock (right-click → **Settings**), or click **Add Gemini API key** on the Dictation page.
2. In the **Gemini API** card, paste the key into the **API key** field. The eye icon shows or hides what you pasted.
3. Click **Test key**. You should see:
   `API key works and Gemini 3.6 Flash is available.`
4. Click **Save key**. You should see:
   `API key saved with Windows secure storage.`
   The card now shows a **Saved securely ••••xxxx** badge (last four characters of your key), and the bottom of the sidebar changes from *API key needed* to **Ready to dictate**.
5. Press your global hotkey from any app to start dictating. The default is `Ctrl+Shift+Space`; the current one is shown in the **Global hotkey** card.

## Replacing or removing the key

- **Replace:** paste the new key into the same field and click **Save key**. It overwrites the old one.
- **Remove from this PC:** click **Remove** next to **Save key**. Sout goes back to *API key needed*.
- **Revoke completely:** delete the key in AI Studio (https://aistudio.google.com/apikey). Any copy of it stops working immediately.

## Where the key is stored

- File: `%APPDATA%\sout-egyptian-dictation\gemini-key.bin`
- It is encrypted with Windows DPAPI through Electron's `safeStorage`, so only your Windows user account on this machine can decrypt it.
- It is never written to `settings.json`, to logs, or exposed to the app's UI code. The only place it is sent is `generativelanguage.googleapis.com`.

## Troubleshooting

| Message in Sout | What it means | What to do |
|---|---|---|
| `That API key looks too short.` | Fewer than 20 characters were pasted. | Copy the whole key again from AI Studio. |
| `The Gemini API key is invalid or cannot access Gemini 3.6 Flash.` | Google rejected the key (401/403). | Make sure you copied it fully and it hasn't been deleted in AI Studio. If the key is valid but the model is not available on your project, check the project's plan/billing in AI Studio. |
| `Gemini quota reached. Wait a minute, or enable billing on your key's Google project.` | You are over the quota for your key's project (429). On the free tier this is usually the requests-per-day cap — every dictation is one request. | Per-minute caps clear in about a minute; daily caps reset at midnight Pacific. To stop hitting them, open https://aistudio.google.com/apikey, find your key's Google Cloud project, and enable billing on it. Your key does not change, so nothing needs re-entering in Sout. |
| `Could not reach the Gemini API. Check your connection and try again.` | No network, or a firewall/proxy is blocking `generativelanguage.googleapis.com`. | Check your internet connection and any VPN or firewall. |
| `Windows secure storage is unavailable on this account.` | DPAPI can't encrypt for this Windows user (usually a restricted or temporary account). | Sign in with a normal local or Microsoft account and try again. |
| `Add your Gemini API key in Settings before starting dictation.` | You pressed the hotkey with no key saved. | Follow section 2 above. |
