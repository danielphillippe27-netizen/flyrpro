# Current setup · Mac 0.3.1

Open `/Applications/WolfGrid Mac Preview.app`, sign in and click **Enable sync with WolfGrid contacts**. If prompted, allow WolfGrid in System Settings → Privacy & Security → Full Disk Access, then quit and reopen the app. Existing and future uniquely matched CRM contacts sync automatically, including available downloaded history. **Pause sync** keeps saved history.

AI connection and message access remain separate under Permissions & devices. Previously saved key/AI preferences are preserved. Calendar and Reminders are optional reviewed exports.

The following older pilot details are retained as historical validation context; per-contact approvals are no longer required by the main setup.

---

# Daniel’s Apple integration pilot

Open **WolfGrid Mac Preview** in your personal Applications folder. Version **0.3.0** opens the new Apple Integrations command centre. This protected pilot is separate from the public site and uses a temporary preview entry link.

1. Sign in with **Continue with Google** using your linked `daniel.phillippe27@gmail.com` identity. It belongs to the existing `daniel@wolfgrid.app` WolfGrid account. Choose workspace **22**.
2. In **System Settings → Privacy & Security → Full Disk Access**, enable the installed WolfGrid app, then quit and reopen it. The toolbar’s **Check Messages access** verifies access without reading message content.
3. **Import contacts** opens Apple Contacts selection and then a CRM review. Saving an import automatically approves future messages for unique phone/email matches. It preserves populated CRM details, and never turns on AI access.
4. In the **Messages** section, enable CRM Messages synchronization. Review any other CRM contacts you want to connect. Choose future-only, 30 days, 90 days or all available history. Shared/ambiguous identifiers stay blocked. The two earlier Daniel test messages are preserved as private saved history.
5. Open **Private inbox** to read history, request a summary, draft a reply, or continue in Apple Messages. Drafts are reviewed and sent by you in Messages; WolfGrid never sends automatically.
6. In **Permissions & devices**, connect your personal OpenAI API key using **Verify & save**. Enter it in the app, not this chat. Separately enable **Allow AI to use my synced messages** if wanted. OpenAI API usage is billed separately from ChatGPT subscriptions.
7. Connect Calendar or Reminders from their cards. Each export opens a native review so you choose a calendar/list and approve the exact item. These are one-way exports; personal events and unrelated reminders are not imported.
8. Optionally enable **Keep running in the menu bar** and **Open at login**. Both are explicit device settings. Without menu-bar mode, closing the last window pauses sync; quitting always stops the app.

Turning sync off preserves saved history. Per-contact privacy controls in the inbox offer export and explicitly confirmed deletion. Deleting imported history does not delete the CRM contact or the originals in Apple Messages.

Public release remains gated on Developer ID/notarization and installed-device acceptance. See `command-center.md` for implemented capabilities, test boundaries and remaining work.
