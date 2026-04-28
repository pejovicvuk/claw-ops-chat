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
  // Teams scopes (Teams.ReadBasic.All, ChannelMessage.Read.All, Chat.ReadWrite)
  // require admin consent in every tenant and cannot be requested without it.
  // Firm deployments can grant admin consent via Azure Portal after connecting,
  // which makes Teams tools available automatically on the next sign-in.
];

export const MS365_SCOPE_STRING = MS365_SCOPES.join(" ");
