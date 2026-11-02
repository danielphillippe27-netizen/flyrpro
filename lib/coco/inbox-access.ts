export function canUseInbox(email: string | null | undefined): boolean {
  return email?.trim().toLowerCase() === "daniel.phillippe27@gmail.com";
}
