export const MS365_SCOPES = [
  "User.Read",
  "offline_access",
  "openid",
  "profile",
  "email",
  "Mail.ReadWrite",
  "Mail.Send",
  "Calendars.ReadWrite",
  "Contacts.ReadWrite",
  "Files.ReadWrite.All",
  "Tasks.ReadWrite",
  // Teams scopes require admin consent in org tenants; included so the
  // consent screen prompts for them. @softeria/ms-365-mcp-server degrades
  // gracefully when they are absent (personal accounts, no admin consent).
  "Teams.ReadBasic.All",
  "ChannelMessage.Read.All",
  "Chat.ReadWrite",
];

export const MS365_SCOPE_STRING = MS365_SCOPES.join(" ");
